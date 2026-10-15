# Q - Quỹ 📊💳

> **Hệ thống theo dõi thu chi & quản lý đóng quỹ tự động chuyên nghiệp**, tích hợp tạo mã VietQR động theo từng thành viên, tiếp nhận biến động số dư ngân hàng tức thì qua SePay Webhook, bảo mật ngân hàng chuẩn mực và đồng bộ dữ liệu thời gian thực với Vercel Serverless & Upstash Redis.

---

## ✨ Tính năng nổi bật

- 🔄 **Cộng dồn số tiền nguyên tử (Atomic Accumulation)**:
  - Thành viên có thể chuyển khoản nhiều lần với bất kỳ số tiền nào.
  - Sử dụng lệnh nguyên tử `HINCRBY` trong Redis ($O(1)$) để cộng dồn chính xác tuyệt đối, triệt tiêu hoàn toàn nguy cơ tranh chấp dữ liệu (Race Condition).
- 🎯 **Phân loại trạng thái & Đổi màu theo mốc tiền**:
  - 🟢 **Xanh lá (Đạt mốc / Đi ăn)**: Đóng từ mức chỉ tiêu trở lên ($\ge 210.000$ đ / theo cấu hình).
  - 🟡 **Vàng (Một phần / Tiền quà)**: Đã đóng một phần tiền ($\ge 60.000$ đ / theo cấu hình).
  - 🔴 **Đỏ (Chưa đủ)**: Chưa đóng hoặc đóng chưa đủ mức tối thiểu ($< 60.000$ đ).
- 🧠 **Thuật toán khớp giao dịch 3 tầng (Smart 3-Tier Matcher)**:
  - **Tầng 1 (Ưu tiên số 1 tuyệt đối)**: Khớp theo số thứ tự (STT) kết hợp tiền tố quỹ (bắt chuẩn các mẫu: `Q 01`, `Q30`, `QUY 30`, `2K6 30`, `Q_01`, `Q-01`,...).
  - **Tầng 2**: Khớp theo Họ và tên đầy đủ không dấu (tự động chuẩn hóa unicode tiếng Việt, ưu tiên tên dài hơn để tránh trùng lặp).
  - **Tầng 3**: Khớp theo Tên gọi (Last Name) độc lập có ranh giới từ (Word Boundary) kèm tiền tố quỹ, chống nhận diện nhầm từ các chữ lân cận (ví dụ: tên "An" không bị nhận nhầm khi nằm trong họ tên "Đăng Thành").
- 🔐 **Bảo mật Webhook cấp ngân hàng**:
  - **Xác thực bí mật kép**: Hỗ trợ tiếp nhận xác thực qua header `Authorization: Apikey <SECRET>` hoặc `Bearer <SECRET>`.
  - **Chống tấn công thời gian (Timing Attack)**: So sánh token bằng thuật toán thời gian hằng số `crypto.timingSafeEqual`.
  - **Chống gửi lại gói tin (Replay Attack / Idempotency)**: Lưu và kiểm tra tính duy nhất của mã giao dịch ngân hàng (`processed_transactions`) trong Redis Set.
- 📲 **Tạo mã VietQR động theo từng thành viên**:
  - Tự động sinh mã VietQR chuẩn NAPAS kèm sẵn số tài khoản, tên chủ thẻ và nội dung chuyển khoản định danh (`Q [STT] [TÊN]`).
  - Cho phép tùy chọn số tiền gán vào QR (Tự nhập trên app, Mức 60k, Mức 210k).
  - Hỗ trợ tải trực tiếp ảnh mã QR chất lượng cao về điện thoại / máy tính.
- ⚡ **Tốc độ phản hồi cực nhanh (Zero-Latency & Zero-Build)**:
  - Giao diện tải tức thì 0ms từ bộ nhớ đệm `localStorage` ngay khi mở trang.
  - Tự động đồng bộ ngầm mỗi 3 giây với máy chủ để cập nhật biến động mới nhất.
  - Thiết kế thuần HTML5/CSS3/Vanilla JS (ES6+), không cần bước build phức tạp.
- 📝 **Ghi chú & Tùy biến thông minh**:
  - **Ghi chú chung của quỹ (`FUND_NOTE`)**: Hiển thị nổi bật trên đầu trang và tự động nhúng vào nội dung báo cáo.
  - **Ghi chú riêng từng thành viên (`MEMBER_NOTES`)**: Thêm ghi chú đặc thù cho từng STT (ví dụ: "Thủ quỹ", "Nộp tiền mặt",...).
- 📋 **Báo cáo Zalo / Messenger 1-Chạm**: Tự động tổng hợp danh sách tiến độ, số tiền đã thu, tỷ lệ hoàn thành kèm emoji định dạng sẵn để gửi ngay vào nhóm chat.
- 🎉 **Hiệu ứng pháo hoa chúc mừng (Confetti)**: Kích hoạt hoạt ảnh ăn mừng rực rỡ khi 100% thành viên đạt chỉ tiêu.

---

## 🏗 Cấu trúc thư mục

```text
Q-Quy/
├── api/
│   ├── _members.js       # Danh sách họ tên thành viên tập trung (Single Source of Truth)
│   ├── members.js        # Serverless Function: Lấy danh sách & số dư thành viên từ Redis
│   └── sepay-webhook.js  # Serverless Function: Tiếp nhận & xác thực Webhook SePay, ghi nhận tiền
├── public/
│   └── index.html        # Giao diện người dùng Glassmorphism hiện đại, Zero-Build
├── .env.example          # File mẫu cấu hình biến môi trường
├── package.json          # Cấu hình dự án (ES Module)
├── vercel.json           # Cấu hình routing của Vercel
└── README.md             # Hướng dẫn chi tiết dự án
```

---

## 🛠 Công nghệ sử dụng

- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism, Flexbox/Grid, Dark/Light accents), Vanilla JavaScript (ES6+), VietQR API.
- **Backend**: Node.js Serverless Functions (chạy trên hạ tầng toàn cầu Vercel Edge/Serverless), Zero-Dependency (sử dụng Native `fetch` và Native `crypto`).
- **Cơ sở dữ liệu**: Upstash Redis (REST API O(1), bền vững, miễn phí 10.000 lệnh/ngày).
- **Cổng thanh toán & Tích hợp**: SePay Webhook (bắt biến động số dư Vietcombank, Techcombank, MBBank, ACB, BIDV, v.v.).

---

## 🚀 Hướng dẫn cài đặt & Triển khai từ A - Z

### Bước 1: Tạo Database Upstash Redis (Hoàn toàn miễn phí)

1. Đăng ký tài khoản tại [console.upstash.com](https://console.upstash.com).
2. Tạo 1 database Redis mới:
   - **Name**: `q-quy-db`
   - **Type**: Regional
   - **Region**: Chọn `ap-southeast-1` (Singapore) để có độ trễ thấp nhất về Việt Nam.
3. Trong giao diện Database, cuộn xuống mục **REST API** và sao chép 2 giá trị:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

### Bước 2: Cấu hình Biến môi trường

Tạo file `.env.local` từ file mẫu:
```bash
cp .env.example .env.local
```

Cập nhật các thông số vào file `.env.local`:
```ini
# Khóa bí mật webhook (tự tạo một chuỗi ngẫu nhiên dài từ 32 ký tự trở lên)
SEPAY_API_KEY=your_super_secret_api_key_at_least_32_characters

# Thông tin Upstash Redis REST API
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

---

### Bước 3: Cấu hình Danh sách Thành viên & Ngân hàng

#### 1. Cập nhật danh sách thành viên:
Mở file [api/_members.js](file:///Users/dangthanh/Downloads/Q-Quy/api/_members.js) và sửa lại mảng `MEMBER_NAMES`. STT của thành viên sẽ được tự động đánh số tăng dần từ `1` đến hết:
```javascript
export const MEMBER_NAMES = [
  "Trương Hữu An",       // STT: 01 (Cú pháp: Q 01 TRUONG HUU AN)
  "Hà Duyên Hải Anh",    // STT: 02 (Cú pháp: Q 02 HA DUYEN HAI ANH)
  // ... thêm các thành viên khác
];
```
*(Tùy chọn: Đồng bộ danh sách tên vào mảng `MEMBER_NAMES` trong [public/index.html](file:///Users/dangthanh/Downloads/Q-Quy/public/index.html) để hiển thị chuẩn khi mở file tĩnh offline).*

#### 2. Cập nhật thông tin nhận tiền:
Mở [api/members.js](file:///Users/dangthanh/Downloads/Q-Quy/api/members.js) và [public/index.html](file:///Users/dangthanh/Downloads/Q-Quy/public/index.html), tìm `BANK_CONFIG` và thay bằng thông tin tài khoản của bạn:
```javascript
const BANK_CONFIG = {
  bin: '970422',                   // Mã BIN ngân hàng (970422 là MBBank)
  accountNo: '88808112007999',     // Số tài khoản nhận tiền
  accountName: 'NGUYEN DANG THANH',// Tên chủ tài khoản (VIẾT HOA KHÔNG DẤU)
  suggestedAmount: 210000          // Số tiền gợi ý mặc định
};
```

#### 3. Tùy chỉnh thông báo và ghi chú quỹ:
Trong [public/index.html](file:///Users/dangthanh/Downloads/Q-Quy/public/index.html):
- `FUND_NOTE`: Nội dung lưu ý chung của quỹ (để chuỗi rỗng `""` nếu muốn ẩn).
- `MEMBER_NOTES`: Ghi chú riêng cho từng thành viên theo STT (ví dụ: `{ 1: "Đã nộp tiền mặt", 30: "Thủ quỹ" }`).

---

### Bước 4: Triển khai lên Vercel

1. Đẩy mã nguồn dự án lên kho chứa GitHub cá nhân.
2. Truy cập [vercel.com](https://vercel.com) $\to$ Chọn **Add New Project** $\to$ Chọn repository vừa tạo.
3. Trong mục **Environment Variables**, thêm đủ 3 biến:
   - `SEPAY_API_KEY`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Bấm **Deploy**. Sau khi hoàn tất, Vercel sẽ cấp cho bạn đường dẫn trang web có dạng:
   `https://ten-du-an-cua-ban.vercel.app`

---

### Bước 5: Cấu hình Webhook trên SePay

1. Đăng nhập vào trang quản trị [my.sepay.vn](https://my.sepay.vn).
2. Vào mục **Tích hợp Webhook** $\to$ Chọn **Thêm Webhook**:
   - **Tên Webhook**: `Webhook Q - Quỹ`
   - **URL Webhook**: `https://ten-du-an-cua-ban.vercel.app/api/sepay-webhook`
   - **Phương thức gửi**: `POST`
   - **Kiểu dữ liệu**: `JSON`
   - **API Key**: Điền chính xác chuỗi `SEPAY_API_KEY` đã đặt ở Bước 2.
3. Bấm **Lưu Webhook**.
4. Thực hiện thử một giao dịch chuyển khoản nhỏ kèm đúng cú pháp `Q [STT] [TÊN]` để kiểm tra hệ thống gạch nợ tự động!

---

## 💻 Chạy thử nghiệm tại máy cá nhân (Local Development)

Dự án sử dụng cơ chế Serverless Functions của Vercel, vì vậy bạn có thể chạy mô phỏng toàn bộ hệ thống cục bộ:

1. **Cài đặt Vercel CLI (nếu chưa có)**:
   ```bash
   npm install -g vercel
   ```

2. **Khởi chạy môi trường Dev**:
   ```bash
   vercel dev
   ```
   Mở trình duyệt tại `http://localhost:3000` để xem giao diện và kiểm tra API.

3. **Thử nghiệm giả lập Webhook SePay (Gửi tiền test)**:
   Mở một cửa sổ Terminal mới và chạy lệnh cURL sau để kiểm tra quá trình ghi nhận tiền tự động vào Redis:
   ```bash
   curl -X POST http://localhost:3000/api/sepay-webhook \
     -H "Content-Type: application/json" \
     -H "Authorization: Apikey your_super_secret_api_key_at_least_32_characters" \
     -d '{
       "id": "TEST_TX_001",
       "content": "Q 01 NGUYEN VAN A DONG TIEN",
       "transferAmount": 210000
     }'
   ```
   Khi gửi thành công, thành viên STT 01 sẽ lập tức được cộng dồn 210.000 đ và đổi màu xanh trên giao diện.

---

## 🛡️ Cơ chế an toàn & Khuyến nghị vận hành

> [!TIP]
> - **Cú pháp chuyển tiền chuẩn**: Khuyến khích thành viên luôn quét mã QR trực tiếp từ giao diện để ứng dụng ngân hàng tự điền đúng số tài khoản và cú pháp `Q [STT] [TÊN]`.
> - **Lệnh nguyên tử Redis**: Hệ thống sử dụng Hash `member_balances` với field là STT của thành viên (`id`), giúp bạn dễ dàng xem hoặc điều chỉnh số dư trực tiếp qua giao diện Upstash Data Browser nếu có giao dịch chuyển nhầm hoặc nộp tiền mặt.
> - **Chống trùng lặp giao dịch**: Bất kỳ giao dịch nào gửi lại trùng `id` giao dịch ngân hàng sẽ được hệ thống từ chối ghi nhận lần 2 và phản hồi idempotency an toàn.

---

## 📄 Bản quyền & Đóng góp

Dự án được phát triển dưới dạng mã nguồn mở miễn phí, tối ưu sạch sẽ, nhẹ và bảo mật cao. Thích hợp sử dụng cho lớp học, câu lạc bộ, công ty hoặc các sự kiện hội nhóm!
