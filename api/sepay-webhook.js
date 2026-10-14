// api/sepay-webhook.js
import crypto from 'crypto';
import { INITIAL_MEMBERS } from './_members.js';

// Bộ nhớ đệm fallback khi chưa cấu hình Redis
let fallbackBalances = new Map();
let fallbackProcessedTxs = new Set();

function removeVietnameseTones(str) {
  if (!str) return '';
  return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function matchMember(content) {
  if (!content) return null;
  const clean = removeVietnameseTones(content.toLowerCase()).trim();

  // TẦNG 1: ƯU TIÊN SỐ 1 TUYỆT ĐỐI - Khớp chính xác theo STT kèm tiền tố quỹ
  // Bắt các định dạng: Q30, Q 30, Q-30, Q_30, QUY 30, 2K6 30
  const sttMatch = clean.match(/(?:^|\s|[._-])(?:q|quy|2k6)[\s._-]*0*(\d{1,2})(?:$|\s|[._-])/i);
  if (sttMatch && sttMatch[1]) {
    const parsedId = parseInt(sttMatch[1], 10);
    const member = INITIAL_MEMBERS.find(m => m.id === parsedId);
    if (member) {
      return member.id;
    }
  }

  // TẦNG 2: Khớp theo Họ và tên đầy đủ (Không dấu)
  // Ưu tiên tên có độ dài dài hơn trước để tránh trùng lặp
  const sortedByNameLength = [...INITIAL_MEMBERS]
    .filter(m => m.name && m.name.trim())
    .sort((a, b) => b.name.length - a.name.length);

  for (const m of sortedByNameLength) {
    const fullName = removeVietnameseTones(m.name.toLowerCase()).trim();
    if (fullName && clean.includes(fullName)) {
      return m.id;
    }
  }

  // TẦNG 3: Khớp theo Tên gọi (Last Name) ĐỘC LẬP kèm tiền tố quỹ
  // Chỉ kiểm tra khi có tiền tố quỹ (q, quy, 2k6) VÀ tên phải là từ đứng độc lập (Word boundary)
  // Chống lỗi nghiêm trọng: từ "an" bị dính vào trong chữ "dang" hay "thanh"
  const hasFundPrefix = /(?:^|\s|[._-])(?:q|quy|2k6)(?:$|\s|[._-])/i.test(clean);
  if (hasFundPrefix) {
    for (const m of INITIAL_MEMBERS) {
      if (!m.name) continue;
      const nameParts = removeVietnameseTones(m.name.toLowerCase()).trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1];
      if (!lastName) continue;

      // Bắt buộc lastName phải đứng độc lập giữa các khoảng trắng hoặc dấu phân cách
      const wordRegex = new RegExp(`(?:^|\\s|[._-])${lastName}(?:$|\\s|[._-])`, 'i');
      if (wordRegex.test(clean)) {
        return m.id;
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const SEPAY_API_KEY = process.env.SEPAY_API_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Hỗ trợ kiểm tra endpoint qua trình duyệt hoặc ping test
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'active',
      message: 'SePay Webhook Endpoint đang hoạt động sẵn sàng tiếp nhận POST request'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 1. BẢO MẬT: Kiểm tra Authorization Header (Chống Timing Attack)
  if (SEPAY_API_KEY) {
    const authHeader = req.headers['authorization'] || '';
    const match = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
    const providedKey = match ? match[1].trim() : authHeader.trim();

    if (!safeCompare(providedKey, SEPAY_API_KEY.trim())) {
      console.warn('Webhook Unauthorized: Header Authorization không hợp lệ');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
  }

  try {
    const body = req.body || {};
    console.log('SePay Webhook Received:', JSON.stringify(body));

    const content = body.content || body.transaction_content || body.description || '';
    const amount = Number(body.transferAmount || body.amount_in || body.amount || 0);
    const transactionId = String(body.id || body.referenceCode || body.reference_number || '').trim();

    // 2. BẢO MẬT: Chống Replay Attack (Kiểm tra mã giao dịch duy nhất)
    if (transactionId) {
      if (REDIS_URL && REDIS_TOKEN) {
        try {
          const saddRes = await fetch(`${REDIS_URL}/sadd/processed_transactions/${encodeURIComponent(transactionId)}`, {
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
          });
          const saddData = await saddRes.json();
          // Nếu result === 0: Mã giao dịch này đã được xử lý trước đó
          if (saddData && saddData.result === 0) {
            console.warn(`[Replay Attack Blocked] Mã giao dịch ${transactionId} đã được xử lý trước đó.`);
            return res.status(200).json({
              success: true,
              message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)',
              transactionId
            });
          }
        } catch (redisErr) {
          console.warn('Lỗi kiểm tra transaction trên Redis:', redisErr);
        }
      } else {
        if (fallbackProcessedTxs.has(transactionId)) {
          return res.status(200).json({
            success: true,
            message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)'
          });
        }
        fallbackProcessedTxs.add(transactionId);
      }
    }

    // 3. KHỚP THÀNH VIÊN & CỘNG DỒN NGUYÊN TỬ VÀO REDIS HASH
    const matchedId = matchMember(content);

    if (matchedId && amount > 0) {
      if (REDIS_URL && REDIS_TOKEN) {
        // Lệnh HINCRBY member_balances [ID] [AMOUNT] (Nguyên tử O(1))
        await fetch(`${REDIS_URL}/hincrby/member_balances/${matchedId}/${amount}`, {
          headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
        });
        console.log(`[Q - Quỹ] Cập nhật thành viên #${matchedId} +${amount} VNĐ`);
      } else {
        const cur = fallbackBalances.get(matchedId) || 0;
        fallbackBalances.set(matchedId, cur + amount);
        console.log(`[Q - Quỹ Fallback] Cập nhật thành viên #${matchedId} +${amount} VNĐ`);
      }
    }

    // Trả về HTTP 200 cho SePay
    return res.status(200).json({
      success: true,
      matchedMemberId: matchedId || null,
      amountAdded: amount,
      transactionId: transactionId || null
    });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(200).json({ success: true, error: err.message });
  }
}
