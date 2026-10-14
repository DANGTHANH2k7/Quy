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

  // Kiểm tra tiền tố quỹ: q, quy, 2k6
  const hasFundPrefix = /(?:^|\s|[._-])(?:q|quy|2k6)(?:$|\s|[._-])/i.test(clean);

  for (const m of INITIAL_MEMBERS) {
    const stt = String(m.id).padStart(2, '0');
    const sttRegex = new RegExp(`(?:^|\\s|[._-])(?:q|quy|2k6)[\\s._-]*0?${m.id}(?:$|\\s|[._-])`, 'i');
    const hasSttMatch = (hasFundPrefix && (
      clean.includes(stt) ||
      clean.includes(' ' + m.id + ' ') ||
      clean.includes(' ' + m.id + '.') ||
      clean.startsWith(m.id + ' ') ||
      clean.endsWith(' ' + m.id)
    )) || sttRegex.test(clean);
    
    let hasNameMatch = false;
    if (m.name) {
      const nameParts = removeVietnameseTones(m.name.toLowerCase()).trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1];
      const fullName = removeVietnameseTones(m.name.toLowerCase()).trim();
      hasNameMatch = clean.includes(fullName) || (hasFundPrefix && clean.includes(lastName));
    }

    if (hasSttMatch || hasNameMatch) {
      return m.id;
    }
  }
  return null;
}

export default async function handler(req, res) {
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const SEPAY_API_KEY = process.env.SEPAY_API_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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
