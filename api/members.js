// api/members.js
// Endpoint tương thích ngược cho danh sách thành viên và số dư
import { getFundData } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const slug = req.query.slug || req.query.fund || 'default';
    const fund = await getFundData(slug);

    if (!fund) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy quỹ.' });
    }

    const members = fund.members || [];
    const totalMembers = members.length;
    const contributingMembers = members.filter(m => Number(m.paidAmount || 0) > 0).length;
    const totalCollected = members.reduce((sum, m) => sum + Number(m.paidAmount || 0), 0);

    return res.status(200).json({
      success: true,
      projectName: fund.name || 'Q - Quỹ',
      serverTime: new Date().toISOString(),
      fund: {
        slug: fund.slug,
        prefix: fund.prefix,
        name: fund.name,
        note: fund.note,
        greenMin: fund.greenMin,
        yellowMin: fund.yellowMin
      },
      bank: {
        bin: fund.bankBin,
        code: fund.bankCode,
        name: fund.bankCode,
        accountNo: fund.accountNo,
        accountName: fund.accountName,
        suggestedAmount: fund.greenMin
      },
      stats: {
        totalMembers,
        contributingMembers,
        unpaidMembers: totalMembers - contributingMembers,
        totalCollected
      },
      members
    });
  } catch (error) {
    console.error('[API Members Error]:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server: ' + error.message });
  }
}
