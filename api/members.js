// api/members.js
import { INITIAL_MEMBERS } from './_members.js';

export default async function handler(req, res) {
  const rawRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_URL = rawRedisUrl ? rawRedisUrl.replace(/\/+$/, '') : '';
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({
      success: false,
      message: 'Method Not Allowed'
    });
  }

  const memberAmounts = {}; // id -> số tiền đã đóng

  if (REDIS_URL && REDIS_TOKEN) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const redisRes = await fetch(`${REDIS_URL}/hgetall/member_balances`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`
        }
      });

      if (!redisRes.ok) {
        const errText = await redisRes.text().catch(() => 'Unknown Redis error');
        console.error('[api/members] Upstash Redis HTTP error:', redisRes.status, errText);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({
          success: false,
          message: 'Dịch vụ cơ sở dữ liệu tạm thời gián đoạn. Vui lòng thử lại sau.'
        });
      }

      const data = await redisRes.json();
      if (!data || data.error) {
        console.error('[api/members] Upstash Redis payload error:', data?.error);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({
          success: false,
          message: 'Dịch vụ cơ sở dữ liệu tạm thời gián đoạn. Vui lòng thử lại sau.'
        });
      }

      if (data.result) {
        // Xử lý cả dạng mảng cặp [key, value] hoặc dạng object { key: value }
        if (Array.isArray(data.result)) {
          for (let i = 0; i < data.result.length; i += 2) {
            const memberId = Number(data.result[i]);
            const amt = Number(data.result[i + 1]) || 0;
            if (Number.isInteger(memberId) && memberId > 0) {
              memberAmounts[memberId] = Math.max(0, Math.round(amt));
            }
          }
        } else if (typeof data.result === 'object') {
          for (const [k, v] of Object.entries(data.result)) {
            const memberId = Number(k);
            const amt = Number(v) || 0;
            if (Number.isInteger(memberId) && memberId > 0) {
              memberAmounts[memberId] = Math.max(0, Math.round(amt));
            }
          }
        }
      }
    } catch (err) {
      console.error('[api/members] Upstash Redis connection error:', err);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({
        success: false,
        message: 'Không thể kết nối cơ sở dữ liệu. Đang giữ nguyên dữ liệu đệm phía trình duyệt.'
      });
    } finally {
      clearTimeout(timeout);
    }
  } else {
    console.warn('[api/members] UPSTASH_REDIS_REST_URL hoặc TOKEN chưa được cấu hình. Đang chạy chế độ local fallback.');
  }

  // Khởi tạo danh sách thành viên kèm số tiền nộp tích lũy
  const members = INITIAL_MEMBERS.map(m => {
    const paidAmount = Math.max(0, Math.round(Number(memberAmounts[m.id] || 0)));
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

  // Cache tại Vercel Edge 5s (stale-while-revalidate 10s) để bảo vệ hạn mức Upstash Redis
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');

  return res.status(200).json({
    success: true,
    projectName: 'Q - Quỹ',
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
