// api/sepay-webhook.js
import crypto from 'crypto';
import { INITIAL_MEMBERS } from './_members.js';

// Bộ nhớ đệm fallback khi chưa cấu hình Redis (chỉ dùng cho môi trường dev nội bộ)
let fallbackBalances = new Map();
let fallbackProcessedTxs = new Set();

const EXPECTED_ACCOUNT_NO = '88808112007999';
const MAX_SINGLE_TRANSFER_AMOUNT = 500_000_000; // Trần an toàn 500 triệu VNĐ / giao dịch
const REDIS_TIMEOUT_MS = 4000;

// Danh sách các từ đơn (tên gọi cuối) dễ gây nhầm lẫn với từ thông dụng trong nội dung chuyển khoản
// hoặc trùng lặp giữa nhiều thành viên / trùng họ, tên đệm:
// - Trùng tên giữa nhiều thành viên: "anh" (#02, #03), "dat" (#08, #09), "minh" (#18, #19, #20)
// - Trùng từ khóa ngân hàng / tiếng Việt không dấu:
//   + "chuyen" (#05 - "chuyển khoản / chuyển tiền")
//   + "tu" (#28 - ngân hàng tự chèn "CT tu ..." = "Chuyển tiền từ ...")
//   + "an" (#01 - "tiền ăn / đi ăn")
//   + "dung" (#06 - "nội dung / sử dụng")
//   + "bao" (#04 - "thông báo")
//   + "thanh" (#30 - "hoàn thành / thành viên / thành công")
//   + "quan" (#25 - "MBBank Quân Đội / liên quan")
//   + "nhat" (#22 - "cập nhật / chủ nhật / sinh nhật")
//   + "thai" (#29 - "trạng thái"), "long" (#16 - "vui lòng"), "ton" (#27 - "tồn quỹ")
// - Trùng Họ hoặc Tên đệm của thành viên khác:
//   + "nguyen" (#21 - trùng họ Nguyễn của 9 thành viên)
//   + "hoang" (#11 - trùng họ/tên đệm Hoàng), "quang" (#24 - trùng tên đệm Quang)
const AMBIGUOUS_SINGLE_LAST_NAMES = new Set([
  'an',
  'anh',
  'bao',
  'chuyen',
  'dat',
  'dung',
  'hoang',
  'long',
  'minh',
  'nguyen',
  'nhat',
  'quan',
  'quang',
  'thanh',
  'thai',
  'ton',
  'tu'
]);

function removeVietnameseTones(str) {
  if (!str) return '';
  return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function fetchRedis(url, token, timeoutMs = REDIS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function matchMember(content) {
  if (!content) return null;
  const clean = removeVietnameseTones(String(content).toLowerCase()).trim();
  if (!clean) return null;

  // TẦNG 1: ƯU TIÊN SỐ 1 TUYỆT ĐỐI - Khớp chính xác theo STT kèm tiền tố quỹ
  // Hỗ trợ mọi ký tự phân cách của ngân hàng (: / . - _ khoảng trắng) và bỏ qua mã giả như Q99, Q00
  const sttRegex = /(?:^|[^a-z0-9])(?:q|quy|2k6)[\s._/-]*0*(\d{1,2})(?=$|[^a-z0-9])/gi;
  const validSttIds = new Set();
  for (const match of clean.matchAll(sttRegex)) {
    const parsedId = parseInt(match[1], 10);
    const member = INITIAL_MEMBERS.find(m => m.id === parsedId);
    if (member) {
      validSttIds.add(member.id);
    }
  }
  if (validSttIds.size === 1) {
    return [...validSttIds][0];
  }

  // TẦNG 1.5: Dự phòng trường hợp ngân hàng xóa toàn bộ khoảng trắng (VD: "Q01TRUONGHUUAN")
  const compactClean = clean.replace(/[^a-z0-9]/g, '');
  for (const m of INITIAL_MEMBERS) {
    if (!m.name) continue;
    const compactName = removeVietnameseTones(m.name.toLowerCase()).replace(/[^a-z0-9]/g, '');
    const sttPadded = String(m.id).padStart(2, '0');
    if (
      compactClean.includes(`q${sttPadded}${compactName}`) ||
      compactClean.includes(`q${m.id}${compactName}`) ||
      compactClean.includes(`quy${sttPadded}${compactName}`)
    ) {
      return m.id;
    }
  }

  // TẦNG 2: Khớp theo Họ và tên đầy đủ (Không dấu, có ranh giới từ)
  // Ưu tiên tên có độ dài dài hơn trước để tránh trùng lặp
  const sortedByNameLength = [...INITIAL_MEMBERS]
    .filter(m => m.name && m.name.trim())
    .sort((a, b) => b.name.length - a.name.length);

  const fullMatches = [];
  for (const m of sortedByNameLength) {
    const fullName = removeVietnameseTones(m.name.toLowerCase()).trim().replace(/\s+/g, ' ');
    if (!fullName) continue;
    const fullRegex = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(fullName)}(?=$|[^a-z0-9])`, 'i');
    if (fullRegex.test(clean)) {
      fullMatches.push(m.id);
    }
  }
  if (fullMatches.length === 1) {
    return fullMatches[0];
  }

  const hasFundPrefix = /(?:^|[^a-z0-9])(?:q|quy|2k6)(?=$|[^a-z0-9])/i.test(clean);
  if (hasFundPrefix) {
    // TẦNG 2.5: Khớp theo cụm 2 từ cuối (Tên đệm + Tên gọi, VD: "hai anh", "quang minh", "bach chuyen")
    // Giải quyết triệt để các trường hợp trùng tên gọi cuối hoặc viết tắt không có Họ
    const twoWordMatches = [];
    for (const m of INITIAL_MEMBERS) {
      if (!m.name) continue;
      const nameParts = removeVietnameseTones(m.name.toLowerCase()).trim().split(/\s+/);
      if (nameParts.length >= 2) {
        const twoWordSuffix = `${nameParts[nameParts.length - 2]} ${nameParts[nameParts.length - 1]}`;
        const twoWordRegex = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(twoWordSuffix)}(?=$|[^a-z0-9])`, 'i');
        if (twoWordRegex.test(clean)) {
          twoWordMatches.push(m.id);
        }
      }
    }
    if (twoWordMatches.length === 1) {
      return twoWordMatches[0];
    }

    // TẦNG 3: Khớp theo Tên gọi đơn (Last Name) ĐỘC LẬP kèm tiền tố quỹ
    // Chỉ khớp khi tên gọi cuối KHÔNG nằm trong danh sách từ đồng âm/trùng tên
    // và chỉ có duy nhất 1 thành viên khớp trong câu lệnh chuyển khoản
    const singleWordMatches = [];
    for (const m of INITIAL_MEMBERS) {
      if (!m.name) continue;
      const nameParts = removeVietnameseTones(m.name.toLowerCase()).trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1];
      if (!lastName || AMBIGUOUS_SINGLE_LAST_NAMES.has(lastName)) continue;

      const wordRegex = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(lastName)}(?=$|[^a-z0-9])`, 'i');
      if (wordRegex.test(clean)) {
        singleWordMatches.push(m.id);
      }
    }
    if (singleWordMatches.length === 1) {
      return singleWordMatches[0];
    }
  }

  return null;
}

export default async function handler(req, res) {
  const rawRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_URL = rawRedisUrl ? rawRedisUrl.replace(/\/+$/, '') : '';
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
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // 1. BẢO MẬT FAIL-CLOSED: Bắt buộc phải có SEPAY_API_KEY và xác thực chống Timing Attack
  if (!SEPAY_API_KEY || !SEPAY_API_KEY.trim()) {
    console.error('[SePay Webhook] Lỗi cấu hình: Biến môi trường SEPAY_API_KEY chưa được thiết lập.');
    return res.status(500).json({
      success: false,
      message: 'Server Misconfiguration: Webhook authentication key is not configured'
    });
  }

  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^(?:Apikey|Bearer)\s+(.+)$/i);
  const providedKey = match ? match[1].trim() : authHeader.trim();

  if (!safeCompare(providedKey, SEPAY_API_KEY.trim())) {
    console.warn('[SePay Webhook] Unauthorized: Header Authorization không hợp lệ');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    // 2. KIỂM TRA SỐ TÀI KHOẢN ĐÍCH & CHIỀU GIAO DỊCH:
    // Bỏ qua nếu giao dịch thuộc số tài khoản khác hoặc là giao dịch chuyển tiền RA (transferType !== 'in')
    if (body.accountNumber && String(body.accountNumber).trim() !== EXPECTED_ACCOUNT_NO) {
      return res.status(200).json({
        success: true,
        ignored: true,
        message: 'Bỏ qua giao dịch không thuộc số tài khoản quỹ'
      });
    }

    if (
      (body.transferType && String(body.transferType).toLowerCase() !== 'in') ||
      (Number(body.amount_out) > 0 && !Number(body.amount_in) && !Number(body.transferAmount))
    ) {
      return res.status(200).json({
        success: true,
        ignored: true,
        message: 'Bỏ qua giao dịch chuyển tiền ra (transferType !== in)'
      });
    }

    const content = String(body.content || body.transaction_content || body.description || '');
    const rawAmount = Number(body.transferAmount || body.amount_in || body.amount || 0);
    const amount = Number.isFinite(rawAmount) ? Math.round(rawAmount) : 0;

    if (amount <= 0 || amount > MAX_SINGLE_TRANSFER_AMOUNT) {
      return res.status(200).json({
        success: true,
        ignored: true,
        message: 'Số tiền giao dịch không hợp lệ hoặc nằm ngoài ngưỡng cho phép'
      });
    }

    const rawTxId = String(body.id || body.referenceCode || body.reference_number || '').trim();
    // Đảm bảo mọi giao dịch hợp lệ đều có mã định danh an toàn để chống Replay Attack
    let transactionId = rawTxId;
    if (!transactionId && body.transactionDate) {
      transactionId = 'derived_' + crypto
        .createHash('sha256')
        .update(`${body.transactionDate}|${body.accountNumber || ''}|${amount}|${content.trim()}`)
        .digest('hex')
        .slice(0, 32);
    }
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing transaction identifier (id or referenceCode)'
      });
    }
    // Chuẩn hóa transactionId tránh ký tự đặc biệt làm lệch đường dẫn REST của Upstash
    const safeTxKey = /^[A-Za-z0-9._:-]{1,96}$/.test(transactionId)
      ? transactionId
      : 'hash_' + crypto.createHash('sha256').update(transactionId).digest('hex');

    const matchedId = matchMember(content);
    if (!matchedId) {
      return res.status(200).json({
        success: true,
        matchedMemberId: null,
        amountAdded: 0,
        transactionId,
        message: 'Không tìm thấy thành viên khớp với nội dung chuyển khoản'
      });
    }

    // 3. BẢO MẬT CHỐNG REPLAY ATTACK & ĐẢM BẢO TÍNH NGUYÊN TỬ (ATOMICITY)
    if (REDIS_URL && REDIS_TOKEN) {
      let saddData = null;
      try {
        const saddRes = await fetchRedis(
          `${REDIS_URL}/sadd/processed_transactions/${encodeURIComponent(safeTxKey)}`,
          REDIS_TOKEN
        );
        saddData = saddRes.ok ? await saddRes.json() : null;
        if (!saddRes.ok || !saddData || saddData.error || (saddData.result !== 0 && saddData.result !== 1)) {
          console.error('[SePay Webhook] Lỗi kiểm tra idempotency trên Redis:', saddRes.status, saddData?.error);
          return res.status(502).json({
            success: false,
            message: 'Temporary database error during idempotency check'
          });
        }
      } catch (saddErr) {
        console.error('[SePay Webhook] Không thể kết nối Redis khi kiểm tra idempotency:', saddErr);
        return res.status(502).json({
          success: false,
          message: 'Temporary database connection error during idempotency check'
        });
      }

      if (saddData.result === 0) {
        console.warn(`[Replay Attack Blocked] Mã giao dịch ${transactionId} đã được xử lý trước đó.`);
        return res.status(200).json({
          success: true,
          message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)',
          transactionId
        });
      }

      // Thực hiện cộng dồn nguyên tử HINCRBY member_balances [ID] [AMOUNT]
      try {
        const hincrRes = await fetchRedis(
          `${REDIS_URL}/hincrby/member_balances/${matchedId}/${amount}`,
          REDIS_TOKEN
        );
        const hincrData = hincrRes.ok ? await hincrRes.json() : null;

        if (!hincrRes.ok || !hincrData || hincrData.error || typeof hincrData.result !== 'number') {
          throw new Error(hincrData?.error || `Redis HINCRBY HTTP ${hincrRes.status}`);
        }
      } catch (hincrErr) {
        // Rollback khóa giao dịch nếu HINCRBY thất bại để SePay có thể retry an toàn
        await fetchRedis(
          `${REDIS_URL}/srem/processed_transactions/${encodeURIComponent(safeTxKey)}`,
          REDIS_TOKEN
        ).catch(() => {});
        console.error('[SePay Webhook] Lỗi cập nhật số dư Redis, đã rollback transaction lock:', hincrErr);
        return res.status(502).json({
          success: false,
          message: 'Temporary database error while updating member balance'
        });
      }

      console.log(`[Q - Quỹ] Cập nhật thành viên #${matchedId} +${amount} VNĐ (tx: ${transactionId})`);
    } else {
      if (fallbackProcessedTxs.has(safeTxKey)) {
        return res.status(200).json({
          success: true,
          message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)',
          transactionId
        });
      }
      fallbackProcessedTxs.add(safeTxKey);
      const cur = fallbackBalances.get(matchedId) || 0;
      fallbackBalances.set(matchedId, cur + amount);
      console.log(`[Q - Quỹ Fallback] Cập nhật thành viên #${matchedId} +${amount} VNĐ`);
    }

    return res.status(200).json({
      success: true,
      matchedMemberId: matchedId,
      amountAdded: amount,
      transactionId
    });
  } catch (err) {
    console.error('[SePay Webhook] Processing error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error'
    });
  }
}
