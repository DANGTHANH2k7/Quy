// api/funds/qr.js
// Endpoint sinh mã VietQR phía Server (Server-Authoritative VietQR Generation)
// Ngăn chặn hoàn toàn việc tráo đổi STK hoặc tiêm mã độc tại Client
import crypto from 'crypto';
import { getFundData } from '../_db.js';

function removeVietnameseTones(str) {
  if (!str) return '';
  return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let slug = req.query.slug;
    if (!slug) {
      const urlParts = (req.url || '').split('?')[0].split('/');
      // /api/funds/:slug/qr
      const qrIdx = urlParts.indexOf('qr');
      if (qrIdx > 0) {
        slug = urlParts[qrIdx - 1];
      }
    }
    if (!slug || slug === 'qr' || slug === 'undefined') {
      slug = req.query.f || 'default';
    }

    const memberId = Number(req.query.memberId || (req.body && req.body.memberId)) || 1;
    const amount = Math.max(0, Number(req.query.amount || (req.body && req.body.amount)) || 0);

    // 1. Lấy dữ liệu quỹ chuẩn từ Server Database
    const fund = await getFundData(slug);
    if (!fund) {
      return res.status(404).json({ ok: false, message: `Không tìm thấy quỹ: ${slug}` });
    }

    // 2. Tìm thành viên tương ứng
    const members = fund.members || [];
    const member = members.find(m => Number(m.id) === memberId) || { id: memberId, name: `Thành viên ${memberId}` };

    const stt = String(member.id).padStart(2, '0');
    const nameClean = removeVietnameseTones(member.name || '').toUpperCase().trim();
    const prefix = (fund.prefix || 'Q').trim().toUpperCase();

    // 3. Chuẩn hóa nội dung chuyển khoản: [PREFIX] [STT] [TEN]
    const memo = nameClean ? `${prefix} ${stt} ${nameClean}` : `${prefix} ${stt}`;

    // 4. Sinh URL ảnh VietQR chuẩn
    let qrUrl = `https://img.vietqr.io/image/${fund.bankBin}-${fund.accountNo}-compact2.png?addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(fund.accountName)}`;
    if (amount > 0) {
      qrUrl += `&amount=${amount}`;
    }

    // 5. Ký chữ ký bảo mật HMAC để client xác thực tính toàn vẹn
    const secret = process.env.SEPAY_API_KEY || 'q_quy_secure_salt_2026';
    const hmacPayload = `${fund.bankBin}:${fund.accountNo}:${fund.accountName}:${memo}:${amount}`;
    const signature = crypto.createHmac('sha256', secret).update(hmacPayload).digest('hex');

    return res.status(200).json({
      ok: true,
      qrUrl,
      memo,
      bankBin: fund.bankBin,
      bankCode: fund.bankCode,
      accountNo: fund.accountNo,
      accountName: fund.accountName,
      amount,
      memberId: member.id,
      memberName: member.name,
      memberStt: stt,
      signature
    });

  } catch (error) {
    console.error('[QR Generation Error]:', error);
    return res.status(500).json({ ok: false, message: 'Lỗi server sinh mã QR: ' + error.message });
  }
}

