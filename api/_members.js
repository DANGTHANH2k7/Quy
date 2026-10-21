// api/_members.js
// ========================================================
// DANH SÁCH THÀNH VIÊN Q - QUỸ
// ========================================================
// STT (id) được đánh số tự động từ 1 đến hết danh sách:
//  - Người thứ 1 -> STT 01 (Cú pháp QR: Q 01 [TEN])
//  - Người thứ 2 -> STT 02 (Cú pháp QR: Q 02 [TEN])
// ========================================================

export const MEMBER_NAMES = [
  "Trương Hữu An",
  "Hà Duyên Hải Anh",
  "Lê Trung Anh",
  "Nguyễn Danh Bảo",
  "Lê Minh Bách Chuyên",
  "Trần Việt Dũng",
  "Lê Anh Duy",
  "Chu Thế Đạt",
  "Nguyễn Quang Đạt",
  "Lê Minh Hiếu",
  "Võ Tá Hoàng",
  "Nguyễn Tuấn Hùng",
  "Phan Đức Huy",
  "Phan Trung Kiên",
  "Nguyễn Việt Khánh",
  "Hoàng Minh Long",
  "Trương Quốc Mạnh",
  "Lê Hoàng Minh",
  "Lê Quang Minh",
  "Nguyễn Ngọc Minh",
  "Nguyễn An Nguyên",
  "Phạm Quang Nhật",
  "Trần Đức Phúc",
  "Nguyễn Ngọc Quang",
  "Trần Lê Minh Quân",
  "Cao Ngọc Trường Sơn",
  "Nguyễn Khắc Thành Tôn",
  "Lê Tuấn Tú",
  "Bùi Minh Thái",
  "Nguyễn Đăng Thành",
  "Cao Anh Vũ",
  "Bùi Đức Duẩn"
];

// Tự động sinh danh sách thành viên kèm STT (id)
export const INITIAL_MEMBERS = MEMBER_NAMES.map((name, index) => ({
  id: index + 1,
  name: name.trim()
}));
