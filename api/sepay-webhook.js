// api/sepay-webhook.js
import crypto from 'crypto';
import { INITIAL_MEMBERS } from './_members.js';
import { getFundData, getSlugByPrefix, redisCommand } from './_db.js';

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

// Hàm nhận diện thành viên cho một danh sách thành viên cụ thể
function matchMemberInList(cleanContent, membersList, prefix) {
  if (!cleanContent || !Array.isArray(membersList) || membersList.length === 0) return null;

  // 1. Khớp theo [PREFIX] [STT] (Ví dụ: Q 30, Q30, QL12 05, A12 01)
  const escapedPrefix = (prefix || 'Q').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sttRegex = new RegExp(`(?:^|\\s|[._-])${escapedPrefix}[\\s._-]*0*(\\d{1,3})(?:$|\\s|[._-])`, 'i');
  const sttMatch = cleanContent.match(sttRegex);
  if (sttMatch && sttMatch[1]) {
    const parsedId = parseInt(sttMatch[1], 10);
    const m = membersList.find(x => x.id === parsedId);
    if (m) return m.id;
  }

  // 2. Khớp theo Họ và tên đầy đủ
  const sortedByName = [...membersList]
    .filter(m => m.name && m.name.trim())
    .sort((a, b) => b.name.length - a.name.length);

  for (const m of sortedByName) {
    const fullName = removeVietnameseTones(m.name.toLowerCase()).trim();
    if (fullName && cleanContent.includes(fullName)) {
      return m.id;
    }
  }

  // 3. Khớp theo Tên gọi (Last Name) độc lập kèm tiền tố quỹ
  const hasPrefix = new RegExp(`(?:^|\\s|[._-])${escapedPrefix}(?:$|\\s|[._-])`, 'i').test(cleanContent);
  if (hasPrefix) {
    for (const m of membersList) {
      if (!m.name) continue;
      const parts = removeVietnameseTones(m.name.toLowerCase()).trim().split(/\s+/);
      const lastName = parts[parts.length - 1];
      if (!lastName) continue;
      const wordRegex = new RegExp(`(?:^|\\s|[._-])${lastName}(?:$|\\s|[._-])`, 'i');
      if (wordRegex.test(cleanContent)) {
        return m.id;
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  const SEPAY_API_KEY = process.env.SEPAY_API_KEY;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'active',
      message: 'SePay Webhook Multi-Tenant Endpoint sẵn sàng tiếp nhận POST request'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    console.log('SePay Webhook Received:', JSON.stringify(body));

    const content = String(body.content || body.transaction_content || body.description || '');
    const amount = Number(body.transferAmount || body.amount_in || body.amount || 0);
    const transactionId = String(body.id || body.referenceCode || body.reference_number || '').trim();

    // 1. ĐỊNH TUYẾN ĐA QUỸ (Hỗ trợ cả Query Param và Prefix)
    // Ưu tiên 1: Đọc từ query URL ?slug=... hoặc ?fund=... (Phương án B: Mỗi chủ quỹ cấu hình webhook URL riêng)
    let targetSlug = req.query.slug || req.query.fund || null;
    let targetPrefix = null;

    const cleanContent = removeVietnameseTones(content.toLowerCase()).trim();

    // Ưu tiên 2: Nếu không có query, tự động nhận diện từ tiền tố trong nội dung
    if (!targetSlug) {
      const tokens = cleanContent.split(/[\s._-]+/).filter(Boolean);
      for (const token of tokens.slice(0, 4)) {
        const upperToken = token.toUpperCase();
        const matchedSlug = await getSlugByPrefix(upperToken);
        if (matchedSlug) {
          targetSlug = matchedSlug;
          targetPrefix = upperToken;
          break;
        }
      }
    }

    if (!targetSlug) targetSlug = 'default';

    // 2. LẤY DỮ LIỆU CỦA QUỸ THỤ HƯỞNG
    const targetFund = await getFundData(targetSlug);
    if (!targetFund) {
      console.warn(`[Webhook Warning] Không tìm thấy quỹ: ${targetSlug}`);
      return res.status(404).json({ success: false, message: 'Fund not found' });
    }

    // 3. XÁC THỰC API KEY RIÊNG CỦA CHỦ QUỸ (PHƯƠNG ÁN B)
    // Nếu chủ quỹ có cấu hình sepayApiKey riêng -> Dùng key của chủ quỹ đó
    // Nếu không -> Dùng SEPAY_API_KEY mặc định của hệ thống
    const expectedApiKey = (targetFund.sepayApiKey && targetFund.sepayApiKey.trim()) || SEPAY_API_KEY;
    if (expectedApiKey) {
      const authHeader = req.headers['authorization'] || '';
      const match = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
      const providedKey = match ? match[1].trim() : authHeader.trim();

      if (!safeCompare(providedKey, expectedApiKey.trim())) {
        console.warn(`[Webhook Unauthorized] Sai API Key cho quỹ [${targetSlug}]`);
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid SePay API Key' });
      }
    }

    // 4. Chống Replay Attack (Mã giao dịch chỉ xử lý 1 lần)
    if (transactionId) {
      const saddRes = await redisCommand('SADD', 'processed_transactions', transactionId);
      if (saddRes === 0) {
        console.warn(`[Replay Attack Blocked] Giao dịch ${transactionId} đã được xử lý trước đó.`);
        return res.status(200).json({
          success: true,
          message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)',
          transactionId
        });
      }
    }

    // 5. LẤY DANH SÁCH THÀNH VIÊN VÀ KHỚP ID
    const membersList = (targetFund && targetFund.members) ? targetFund.members : INITIAL_MEMBERS;
    const effectivePrefix = targetFund.prefix || targetPrefix || 'Q';

    const matchedId = matchMemberInList(cleanContent, membersList, effectivePrefix);

    if (matchedId && amount > 0) {
      const balanceKey = targetSlug === 'default' ? 'member_balances' : `fund:${targetSlug}:balances`;
      await redisCommand('HINCRBY', balanceKey, String(matchedId), String(amount));
      console.log(`[Webhook Multi-tenant] Quỹ [${targetSlug}] -> Thành viên #${matchedId} +${amount} đ`);
    } else {
      console.warn(`[Webhook Warning] Không tìm thấy thành viên phù hợp trong nội dung: "${content}"`);
    }

    return res.status(200).json({
      success: true,
      fundSlug: targetSlug,
      matchedMemberId: matchedId || null,
      amountAdded: amount,
      transactionId: transactionId || null
    });

  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(200).json({ success: true, error: err.message });
  }
}
