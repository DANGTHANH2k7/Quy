// api/funds/create.js
// Endpoint tạo Quỹ Mới (Multi-tenant Fund Creator)
import crypto from 'crypto';
import { redisPipeline, slugify, generateUniquePrefix, SUPPORTED_BANKS } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed. Sử dụng POST để tạo quỹ.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const name = String(body.name || '').trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, message: 'Tên quỹ phải có ít nhất 2 ký tự.' });
    }

    const accountNo = String(body.accountNo || '').trim().replace(/\s+/g, '');
    if (!accountNo || accountNo.length < 5) {
      return res.status(400).json({ ok: false, message: 'Số tài khoản ngân hàng không hợp lệ.' });
    }

    const accountName = String(body.accountName || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .trim();

    if (!accountName || accountName.length < 2) {
      return res.status(400).json({ ok: false, message: 'Tên chủ tài khoản không hợp lệ.' });
    }

    const bankBin = String(body.bankBin || '970422').trim();
    const matchedBank = SUPPORTED_BANKS.find(b => b.bin === bankBin);
    const bankCode = body.bankCode || (matchedBank ? matchedBank.code : 'NGANHANG');

    const note = String(body.note || '').trim().slice(0, 1000);
    const greenMin = Math.max(0, Number(body.greenMin) || 210000);
    const yellowMin = Math.max(0, Number(body.yellowMin) || 60000);

    // Xử lý danh sách thành viên
    let rawMembers = body.members;
    if (typeof rawMembers === 'string') {
      // Phân tách nếu truyền qua dạng textarea nhiều dòng
      rawMembers = rawMembers.split('\n').map(s => s.trim()).filter(Boolean);
    }

    if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
      return res.status(400).json({ ok: false, message: 'Danh sách thành viên phải có ít nhất 1 người.' });
    }

    // Làm sạch và gán STT (id) tự động từ 1..N
    const membersList = rawMembers.slice(0, 500).map((item, idx) => {
      let memberName = typeof item === 'object' && item.name ? String(item.name) : String(item);
      // Khử các ký tự nguy hiểm / script tags
      memberName = memberName.replace(/<[^>]*>?/gm, '').trim();
      return {
        id: idx + 1,
        name: memberName || `Thành viên ${idx + 1}`,
        note: (item && item.note) ? String(item.note).slice(0, 100) : ''
      };
    });

    // Sinh slug duy nhất
    const baseSlug = slugify(name);
    const randSuffix = crypto.randomBytes(3).toString('hex');
    const slug = `${baseSlug}-${randSuffix}`;

    // Sinh mã tiền tố chuyển khoản duy nhất (VD: QL12)
    const prefix = await generateUniquePrefix(name);

    // Sinh khóa quản trị bí mật cho chủ quỹ (16 bytes hex = 32 ký tự)
    const adminKey = crypto.randomBytes(16).toString('hex');

    // Thuật toán sinh API Key 32 ký tự ngẫu nhiên cho SePay nếu chưa cung cấp
    const sepayApiKey = String(body.sepayApiKey || '').trim() || crypto.randomBytes(16).toString('hex');

    // Lưu vào Upstash Redis qua Pipeline
    const createdAt = new Date().toISOString();
    await redisPipeline([
      [
        'HSET', `fund:${slug}`,
        'name', name,
        'note', note,
        'bankBin', bankBin,
        'bankCode', bankCode,
        'accountNo', accountNo,
        'accountName', accountName,
        'greenMin', String(greenMin),
        'yellowMin', String(yellowMin),
        'prefix', prefix,
        'adminKey', adminKey,
        'sepayApiKey', sepayApiKey,
        'createdAt', createdAt
      ],
      ['SET', `fund:${slug}:members`, JSON.stringify(membersList)],
      ['SADD', 'funds:registry', slug],
      ['HSET', 'prefix:index', prefix, slug]
    ]);

    return res.status(201).json({
      ok: true,
      message: 'Tạo quỹ thành công!',
      fund: {
        slug,
        prefix,
        name,
        adminKey,
        sepayApiKey,
        shareUrl: `/f/${slug}`,
        adminUrl: `/f/${slug}?admin=${adminKey}`,
        webhookUrl: `/api/sepay-webhook?slug=${slug}`,
        totalMembers: membersList.length
      }
    });

  } catch (error) {
    console.error('[Create Fund Error]:', error);
    return res.status(500).json({ ok: false, message: 'Lỗi server khi tạo quỹ: ' + error.message });
  }
}

