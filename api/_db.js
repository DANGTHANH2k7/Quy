// api/_db.js
// Quản lý cơ sở dữ liệu Upstash Redis & Dữ liệu đa quỹ (Multi-Tenant)
import crypto from 'crypto';
import { INITIAL_MEMBERS } from './_members.js';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Ngân hàng phổ biến tại Việt Nam (mã BIN chuẩn Napas)
export const SUPPORTED_BANKS = [
  { code: 'MBBank', name: 'MB Bank (Quân đội)', bin: '970422' },
  { code: 'VCB', name: 'Vietcombank', bin: '970436' },
  { code: 'TCB', name: 'Techcombank', bin: '970407' },
  { code: 'ACB', name: 'ACB (Á Châu)', bin: '970416' },
  { code: 'VPB', name: 'VPBank', bin: '970432' },
  { code: 'TPB', name: 'TPBank (Tiên Phong)', bin: '970423' },
  { code: 'BIDV', name: 'BIDV', bin: '970418' },
  { code: 'CTG', name: 'VietinBank', bin: '970415' },
  { code: 'VBA', name: 'Agribank', bin: '970405' },
  { code: 'OCB', name: 'OCB (Phương Đông)', bin: '970448' },
  { code: 'VIB', name: 'VIB (Quốc tế)', bin: '970441' },
  { code: 'HDB', name: 'HDBank', bin: '970437' },
  { code: 'STB', name: 'Sacombank', bin: '970403' },
  { code: 'MSB', name: 'MSB (Hàng hải)', bin: '970426' },
  { code: 'SHB', name: 'SHB (Sài Gòn - Hà Nội)', bin: '970443' }
];

// Cấu hình Quỹ mặc định (Backward compatibility cho quỹ 2K6 hiện tại)
export const DEFAULT_FUND = {
  slug: 'default',
  name: 'Q - Quỹ 2K6',
  note: 'Tiền quà sẽ là 33k, 5 suất của các bạn nữ sẽ là 27k, 150k là tiền đi ăn. Anh em có thể Donate thêm nhé!',
  bankBin: '970422',
  bankCode: 'MBBank',
  accountNo: '88808112007999',
  accountName: 'NGUYEN DANG THANH',
  greenMin: 210000,
  yellowMin: 60000,
  prefix: 'Q',
  adminKey: 'quy2k6_admin_secret',
  sepayApiKey: process.env.SEPAY_API_KEY || ''
};

// Gọi lệnh Redis qua REST API (sử dụng POST JSON array tránh lỗi escape)
export async function redisCommand(cmd, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.warn('[DB] Upstash Redis chưa được cấu hình. Chạy chế độ fallback.');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(REDIS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([cmd, ...args])
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[DB Error] ${cmd} failed:`, errText);
      return null;
    }

    const data = await res.json();
    return data ? data.result : null;
  } catch (err) {
    console.error(`[DB Exception] ${cmd}:`, err.message);
    return null;
  }
}

// Chạy pipeline nhiều lệnh cùng lúc
export async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN || !Array.isArray(commands) || commands.length === 0) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.map(d => d.result) : [];
  } catch (err) {
    console.error('[DB Pipeline Exception]:', err.message);
    return [];
  }
}

// Chuyển đổi chuỗi tiếng Việt thành slug URL
export function slugify(str) {
  if (!str) return 'quy-' + Date.now().toString(36);
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

// Sinh mã tiền tố chuyển khoản duy nhất (3-5 ký tự chữ hoa)
export async function generateUniquePrefix(fundName) {
  // Lấy các chữ cái đầu tiên từ tên quỹ (VD: "Quỹ Lớp 12A" -> "QL12")
  let base = fundName
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Z0-9]/g, '');

  if (base.length < 2) base = 'Q';
  let candidate = base.slice(0, 4);

  // Kiểm tra bảng tra cứu tiền tố
  const existing = await redisCommand('HGET', 'prefix:index', candidate);
  if (!existing && candidate !== 'Q') {
    return candidate;
  }

  // Nếu bị trùng, thêm số ngẫu nhiên
  for (let i = 1; i <= 99; i++) {
    const testPrefix = `${candidate.slice(0, 3)}${i}`;
    const testExist = await redisCommand('HGET', 'prefix:index', testPrefix);
    if (!testExist) return testPrefix;
  }

  return 'Q' + Math.floor(100 + Math.random() * 900);
}

// Lấy thông tin đầy đủ của một quỹ kèm danh sách thành viên và số dư
export async function getFundData(slug) {
  const isDefault = !slug || slug === 'default';

  if (isDefault) {
    // Quỹ 2K6 mặc định
    let balances = {};
    const rawBalances = await redisCommand('HGETALL', 'member_balances');
    if (rawBalances) {
      if (Array.isArray(rawBalances)) {
        for (let i = 0; i < rawBalances.length; i += 2) {
          balances[Number(rawBalances[i])] = Number(rawBalances[i + 1]) || 0;
        }
      } else if (typeof rawBalances === 'object') {
        for (const [k, v] of Object.entries(rawBalances)) {
          balances[Number(k)] = Number(v) || 0;
        }
      }
    }

    const members = INITIAL_MEMBERS.map(m => ({
      ...m,
      paidAmount: Number(balances[m.id] || 0)
    }));

    return {
      ...DEFAULT_FUND,
      members,
      balances
    };
  }

  // Quỹ người dùng tạo
  const [metaRaw, membersRaw, balancesRaw] = await redisPipeline([
    ['HGETALL', `fund:${slug}`],
    ['GET', `fund:${slug}:members`],
    ['HGETALL', `fund:${slug}:balances`]
  ]);

  if (!metaRaw || (Array.isArray(metaRaw) && metaRaw.length === 0) || (typeof metaRaw === 'object' && Object.keys(metaRaw).length === 0)) {
    return null;
  }

  // Parse metadata
  const meta = {};
  if (Array.isArray(metaRaw)) {
    for (let i = 0; i < metaRaw.length; i += 2) {
      meta[metaRaw[i]] = metaRaw[i + 1];
    }
  } else if (typeof metaRaw === 'object') {
    Object.assign(meta, metaRaw);
  }

  // Parse members
  let membersList = [];
  try {
    membersList = membersRaw ? JSON.parse(membersRaw) : [];
  } catch (e) {
    membersList = [];
  }

  // Parse balances
  const balances = {};
  if (balancesRaw) {
    if (Array.isArray(balancesRaw)) {
      for (let i = 0; i < balancesRaw.length; i += 2) {
        balances[Number(balancesRaw[i])] = Number(balancesRaw[i + 1]) || 0;
      }
    } else if (typeof balancesRaw === 'object') {
      for (const [k, v] of Object.entries(balancesRaw)) {
        balances[Number(k)] = Number(v) || 0;
      }
    }
  }

  const members = membersList.map((m, idx) => ({
    id: m.id || (idx + 1),
    name: m.name || `Thành viên ${idx + 1}`,
    note: m.note || '',
    paidAmount: Number(balances[m.id || (idx + 1)] || 0)
  }));

  return {
    slug,
    name: meta.name || 'Quỹ Nhóm',
    note: meta.note || '',
    bankBin: meta.bankBin || '970422',
    bankCode: meta.bankCode || 'MBBank',
    accountNo: meta.accountNo || '',
    accountName: meta.accountName || '',
    greenMin: Number(meta.greenMin) || 210000,
    yellowMin: Number(meta.yellowMin) || 60000,
    prefix: meta.prefix || 'Q',
    adminKey: meta.adminKey || '',
    sepayApiKey: meta.sepayApiKey || '',
    createdAt: meta.createdAt || null,
    members,
    balances
  };
}

// Tra cứu slug quỹ theo mã tiền tố
export async function getSlugByPrefix(prefix) {
  if (!prefix) return null;
  const cleanPrefix = prefix.trim().toUpperCase();
  if (cleanPrefix === 'Q' || cleanPrefix === 'QUY' || cleanPrefix === '2K6') {
    return 'default';
  }
  const slug = await redisCommand('HGET', 'prefix:index', cleanPrefix);
  return slug || null;
}

