// api/members.js
import { INITIAL_MEMBERS } from './_members.js';

export default async function handler(req, res) {
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const memberAmounts = {}; // id -> số tiền đã đóng
  let debug = { db: 'upstash_redis' };

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const redisRes = await fetch(`${REDIS_URL}/hgetall/member_balances`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`
        }
      });
      clearTimeout(timeout);

      if (redisRes.ok) {
        const data = await redisRes.json();
        if (data && data.result) {
          // Xử lý cả dạng mảng cặp [key, value] hoặc dạng object { key: value }
          if (Array.isArray(data.result)) {
            for (let i = 0; i < data.result.length; i += 2) {
              const memberId = Number(data.result[i]);
              const amt = Number(data.result[i + 1]) || 0;
              memberAmounts[memberId] = amt;
            }
          } else if (typeof data.result === 'object') {
            for (const [k, v] of Object.entries(data.result)) {
              memberAmounts[Number(k)] = Number(v) || 0;
            }
          }
        }
      } else {
        debug.error = await redisRes.text();
      }
    } catch (err) {
      debug.catch = err.message;
    }
  } else {
    debug.warning = 'UPSTASH_REDIS_REST_URL hoặc TOKEN chưa được cấu hình. Đang chạy chế độ local fallback.';
  }

  // Khởi tạo danh sách thành viên kèm số tiền nộp tích lũy
  const members = INITIAL_MEMBERS.map(m => {
    const paidAmount = Number(memberAmounts[m.id] || 0);
    return {
      ...m,
      paidAmount,
      // Cung cấp trường status tương thích ngược
      status: paidAmount > 0 ? 'Đã đóng' : 'Chưa đóng'
    };
  });

  const totalMembers = members.length;
  const contributingMembers = members.filter(m => m.paidAmount > 0).length;
  const totalCollected = members.reduce((sum, m) => sum + m.paidAmount, 0);

  return res.status(200).json({
    success: true,
    projectName: 'Q - Quỹ',
    serverTime: new Date().toISOString(),
    debug,
    bank: {
      bin: '970422',
      code: 'MB',
      name: 'MBBank',
      accountNo: '88808112007999',
      accountName: 'NGUYEN DANG THANH',
      suggestedAmount: 210000
    },
    stats: {
      totalMembers,
      contributingMembers,
      unpaidMembers: totalMembers - contributingMembers,
      totalCollected
    },
    members
  });
}
