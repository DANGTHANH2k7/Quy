// api/funds/detail.js
// Endpoint lấy chi tiết quỹ, danh sách thành viên và số dư (kèm kiểm tra quyền Admin)
import { getFundData } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  try {
    let slug = req.query.slug;
    if (!slug) {
      // Parse từ URL nếu query chưa có (ví dụ /api/funds/lop-12a)
      const urlParts = (req.url || '').split('?')[0].split('/');
      slug = urlParts[urlParts.length - 1] || 'default';
    }

    if (slug === 'detail' || slug === 'undefined' || !slug) {
      slug = req.query.f || 'default';
    }

    const fund = await getFundData(slug);
    if (!fund) {
      return res.status(404).json({ ok: false, message: `Không tìm thấy quỹ với mã: ${slug}` });
    }

    // Kiểm tra quyền Admin của người gọi
    const providedKey = req.query.admin || req.headers['x-admin-key'] || '';
    const isAdmin = Boolean(fund.adminKey && providedKey && String(providedKey).trim() === String(fund.adminKey).trim());

    // Tính toán số liệu thống kê KPIs
    const members = fund.members || [];
    let totalCollected = 0;
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;
    let contributingCount = 0;

    members.forEach(m => {
      const amt = Number(m.paidAmount || 0);
      totalCollected += amt;
      if (amt > 0) contributingCount++;

      if (amt >= fund.greenMin) {
        greenCount++;
      } else if (amt >= fund.yellowMin) {
        yellowCount++;
      } else {
        redCount++;
      }
    });

    // Ẩn adminKey nếu không phải là Admin
    const safeFund = {
      slug: fund.slug,
      name: fund.name,
      note: fund.note,
      bankBin: fund.bankBin,
      bankCode: fund.bankCode,
      accountNo: fund.accountNo,
      accountName: fund.accountName,
      greenMin: fund.greenMin,
      yellowMin: fund.yellowMin,
      prefix: fund.prefix,
      createdAt: fund.createdAt,
      members,
      isAdmin,
      stats: {
        totalMembers: members.length,
        totalCollected,
        greenCount,
        yellowCount,
        redCount,
        contributingCount,
        percentGreen: members.length > 0 ? Number(((greenCount / members.length) * 100).toFixed(1)) : 0
      }
    };

    if (isAdmin) {
      safeFund.adminKey = fund.adminKey;
      safeFund.sepayApiKey = fund.sepayApiKey || '';
    }

    return res.status(200).json({
      ok: true,
      fund: safeFund
    });

  } catch (error) {
    console.error('[Fund Detail Error]:', error);
    return res.status(500).json({ ok: false, message: 'Lỗi server: ' + error.message });
  }
}

