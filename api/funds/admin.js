// api/funds/admin.js
// Endpoint quản trị quỹ (Chỉ dành cho chủ quỹ có adminKey)
import { getFundData, redisCommand, redisPipeline, SUPPORTED_BANKS } from '../_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let slug = req.query.slug || body.slug;
    if (!slug) {
      const urlParts = (req.url || '').split('?')[0].split('/');
      const adminIdx = urlParts.indexOf('admin');
      if (adminIdx > 0) slug = urlParts[adminIdx - 1];
    }
    if (!slug || slug === 'admin') slug = 'default';

    const fund = await getFundData(slug);
    if (!fund) {
      return res.status(404).json({ ok: false, message: 'Không tìm thấy quỹ.' });
    }

    // Xác thực adminKey
    const providedKey = req.headers['x-admin-key'] || body.adminKey || req.query.admin;
    if (!fund.adminKey || !providedKey || String(providedKey).trim() !== String(fund.adminKey).trim()) {
      return res.status(401).json({ ok: false, message: 'Sai mã quản trị (adminKey) hoặc không có quyền truy cập.' });
    }

    const action = body.action;

    // 1. Đánh dấu nộp tiền mặt (Mark paid / Offline payment)
    if (action === 'mark_paid') {
      const memberId = Number(body.memberId);
      const amount = Number(body.amount) || 0;
      const isSet = body.mode === 'set'; // true nếu muốn gán thẳng số tiền, false là cộng dồn

      if (!memberId) {
        return res.status(400).json({ ok: false, message: 'Thiếu ID thành viên.' });
      }

      const balanceKey = slug === 'default' ? 'member_balances' : `fund:${slug}:balances`;

      let newBalance = amount;
      if (isSet) {
        await redisCommand('HSET', balanceKey, String(memberId), String(amount));
      } else {
        const resIncr = await redisCommand('HINCRBY', balanceKey, String(memberId), String(amount));
        newBalance = Number(resIncr) || amount;
      }

      return res.status(200).json({
        ok: true,
        message: `Đã cập nhật số dư cho thành viên #${memberId}!`,
        memberId,
        newBalance
      });
    }

    // 2. Cập nhật thông tin Quỹ (Tên, Ghi chú, Mốc tiền, STK)
    if (action === 'update_fund') {
      const metaKey = slug === 'default' ? 'fund:default' : `fund:${slug}`;
      const updates = [];

      if (body.name) updates.push('name', String(body.name).trim().slice(0, 100));
      if (typeof body.note === 'string') updates.push('note', String(body.note).trim().slice(0, 1000));
      if (body.greenMin) updates.push('greenMin', String(Math.max(0, Number(body.greenMin))));
      if (body.yellowMin) updates.push('yellowMin', String(Math.max(0, Number(body.yellowMin))));
      if (typeof body.sepayApiKey === 'string') updates.push('sepayApiKey', String(body.sepayApiKey).trim());
      if (body.accountNo) updates.push('accountNo', String(body.accountNo).trim().replace(/\s+/g, ''));
      if (body.accountName) updates.push('accountName', String(body.accountName).trim().toUpperCase());
      if (body.bankBin) {
        const bin = String(body.bankBin).trim();
        const matched = SUPPORTED_BANKS.find(b => b.bin === bin);
        updates.push('bankBin', bin);
        if (matched) updates.push('bankCode', matched.code);
      }

      if (updates.length > 0) {
        await redisCommand('HSET', metaKey, ...updates);
      }

      return res.status(200).json({
        ok: true,
        message: 'Cập nhật thông tin quỹ thành công!'
      });
    }

    // 3. Thêm thành viên mới
    if (action === 'add_member') {
      const name = String(body.name || '').replace(/<[^>]*>?/gm, '').trim();
      if (!name) {
        return res.status(400).json({ ok: false, message: 'Tên thành viên không được để trống.' });
      }
      const note = String(body.note || '').slice(0, 100);

      const membersList = (fund.members || []).map(m => ({ id: m.id, name: m.name, note: m.note || '' }));
      const maxId = membersList.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
      const newMember = { id: maxId + 1, name, note };
      membersList.push(newMember);

      const membersKey = slug === 'default' ? 'fund:default:members' : `fund:${slug}:members`;
      await redisCommand('SET', membersKey, JSON.stringify(membersList));

      return res.status(200).json({
        ok: true,
        message: `Đã thêm thành viên: ${name}!`,
        member: newMember,
        members: membersList
      });
    }

    // 4. Sửa thành viên (Tên, Ghi chú)
    if (action === 'edit_member') {
      const id = Number(body.id);
      const name = String(body.name || '').replace(/<[^>]*>?/gm, '').trim();
      if (!id || !name) {
        return res.status(400).json({ ok: false, message: 'ID và Tên không hợp lệ.' });
      }
      const note = String(body.note || '').slice(0, 100);

      const membersList = (fund.members || []).map(m => ({ id: m.id, name: m.name, note: m.note || '' }));
      const target = membersList.find(m => m.id === id);
      if (!target) {
        return res.status(404).json({ ok: false, message: 'Không tìm thấy thành viên.' });
      }
      target.name = name;
      target.note = note;

      const membersKey = slug === 'default' ? 'fund:default:members' : `fund:${slug}:members`;
      await redisCommand('SET', membersKey, JSON.stringify(membersList));

      return res.status(200).json({
        ok: true,
        message: `Đã cập nhật thành viên #${id}!`,
        member: target,
        members: membersList
      });
    }

    // 5. Xóa thành viên
    if (action === 'delete_member') {
      const id = Number(body.id);
      if (!id) {
        return res.status(400).json({ ok: false, message: 'Thiếu ID thành viên cần xóa.' });
      }

      let membersList = (fund.members || []).map(m => ({ id: m.id, name: m.name, note: m.note || '' }));
      membersList = membersList.filter(m => m.id !== id);

      const membersKey = slug === 'default' ? 'fund:default:members' : `fund:${slug}:members`;
      await redisCommand('SET', membersKey, JSON.stringify(membersList));

      return res.status(200).json({
        ok: true,
        message: `Đã xóa thành viên #${id}!`,
        members: membersList
      });
    }

    // 6. Cập nhật hàng loạt danh sách thành viên
    if (action === 'update_members') {
      const rawList = body.members;
      if (!Array.isArray(rawList)) {
        return res.status(400).json({ ok: false, message: 'Danh sách thành viên không hợp lệ.' });
      }

      const membersList = rawList.map((item, idx) => ({
        id: item.id || (idx + 1),
        name: String(item.name || item).replace(/<[^>]*>?/gm, '').trim() || `Thành viên ${idx + 1}`,
        note: String(item.note || '').slice(0, 100)
      }));

      const membersKey = slug === 'default' ? 'fund:default:members' : `fund:${slug}:members`;
      await redisCommand('SET', membersKey, JSON.stringify(membersList));

      return res.status(200).json({
        ok: true,
        message: 'Cập nhật danh sách thành viên thành công!',
        totalMembers: membersList.length
      });
    }

    return res.status(400).json({ ok: false, message: 'Hành động không hợp lệ.' });

  } catch (error) {
    console.error('[Admin Error]:', error);
    return res.status(500).json({ ok: false, message: 'Lỗi server quản trị: ' + error.message });
  }
}

