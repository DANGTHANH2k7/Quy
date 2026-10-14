# Q - Quỹ 📊💳

Hệ thống quản lý và theo dõi thu chi / đóng quỹ tự động chuyên nghiệp, tích hợp tạo mã VietQR động theo từng thành viên, bảo mật Webhook ngân hàng SePay cấp độ cao và hỗ trợ cộng dồn số tiền không giới hạn.

---

## ✨ Tính năng nổi bật

- **Đổi màu theo mốc tiền tùy biến (Dynamic Color Rules)**:
  - 🟢 **Xanh lá**: Đạt chỉ tiêu / Vượt mức (Mặc định: $\ge 210.000$ đ).
  - 🟡 **Vàng**: Đã đóng một phần (Mặc định: $\ge 60.000$ đ).
  - 🔴 **Đỏ**: Chưa đạt mức tối thiểu (Mặc định: $< 60.000$ đ).
  - *Cho phép người dùng bấm ⚙️ **Chỉnh sửa mốc màu** ngay trên giao diện để tự điều chỉnh các mốc tiền này theo nhu cầu thực tế (lưu trực tiếp vào `localStorage`).*
- **Cộng dồn số tiền không giới hạn**: Thành viên có thể chuyển tiền nhiều lần với số tiền tùy ý; hệ thống sử dụng lệnh nguyên tử `HINCRBY` trong Redis để cộng dồn chính xác, không bao giờ lo sai lệch.
- **Bảo mật Webhook cấp ngân hàng**:
  - **Xác thực Header bí mật**: Chỉ tiếp nhận webhook khi có header `Authorization: Apikey <SECRET>`.
  - **Chống Timing Attack**: So sánh token bằng hàm hằng số thời gian `crypto.timingSafeEqual`.
  - **Chống Replay Attack**: Kiểm tra tính duy nhất của mã giao dịch ngân hàng (`processed_transactions`), bắn lại gói tin cũ sẽ bị từ chối ngay lập tức.
- **Tạo mã VietQR động**: Tự động sinh mã QR chuyển khoản theo từng thành viên kèm cú pháp nội dung chính xác (`Q [STT] [TÊN]`). Hỗ trợ tải mã QR về điện thoại.
- **Cập nhật tức thì (0ms latency)**: Tải dữ liệu từ cache cục bộ `localStorage` ngay khi mở trang, đồng thời tự động đồng bộ ngầm mỗi 3 giây qua Vercel Serverless Function.
- **Sao chép báo cáo Zalo**: Một chạm để copy danh sách tiến độ thu quỹ định dạng sẵn kèm emoji để dán vào Zalo / Messenger.

---

## 🛠 Công nghệ sử dụng

- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism), Vanilla JavaScript (ES6+), Zero-Build.
- **Backend**: Node.js Serverless Functions (Vercel), Zero-Dependency (dùng native `fetch` của Node.js).
- **Cơ sở dữ liệu**: Upstash Redis / Vercel KV (REST API).
- **Cổng thanh toán & QR**: VietQR API, SePay Webhook.

---

## 🚀 Hướng dẫn cài đặt & Triển khai từ A - Z

### Bước 1: Tạo Database Upstash Redis (Miễn phí)
1. Đăng ký tài khoản tại [console.upstash.com](https://console.upstash.com).
2. Tạo 1 database Redis mới (chọn Region `ap-southeast-1` Singapore để có tốc độ nhanh nhất về Việt Nam).
3. Tại trang tổng quan database, cuộn xuống phần **REST API** và sao chép 2 giá trị:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### Bước 2: Cấu hình Biến Môi Trường (Environment Variables)
Sao chép file mẫu `.env.example` thành `.env.local` để chạy thử:
```bash
cp .env.example .env.local
```
Điền các giá trị vào file `.env.local`:
```ini
SEPAY_API_KEY=tao_mot_chuoi_ngau_nhien_dai_tren_32_ky_tu
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```

### Bước 3: Cấu hình Danh Sách Thành Viên & Ngân Hàng
- Mở [api/members.js](file:///Users/dangthanh/Downloads/gioitre-2k6-fund/api/members.js) và [api/sepay-webhook.js](file:///Users/dangthanh/Downloads/gioitre-2k6-fund/api/sepay-webhook.js) để cập nhật danh sách thành viên `INITIAL_MEMBERS`.
- Cập nhật số tài khoản nhận tiền `BANK_CONFIG` trong [public/index.html](file:///Users/dangthanh/Downloads/gioitre-2k6-fund/public/index.html).

### Bước 4: Triển khai lên Vercel
1. Đẩy code lên GitHub.
2. Truy cập [vercel.com](https://vercel.com) $\to$ **Add New Project** $\to$ Chọn repository này.
3. Trong phần **Environment Variables**, thêm 3 biến:
   - `SEPAY_API_KEY`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Bấm **Deploy**.

### Bước 5: Cấu hình Webhook trên SePay
1. Đăng nhập [my.sepay.vn](https://my.sepay.vn) $\to$ vào mục **Cấu hình Webhook**.
2. Thêm Webhook mới:
   - **URL Webhook:** `https://ten-mien-cua-ban.vercel.app/api/sepay-webhook`
   - **Phương thức:** `POST`
   - **Kiểu dữ liệu:** `JSON`
   - **API Key:** Điền đúng chuỗi `SEPAY_API_KEY` bạn đã cài đặt ở Bước 2.
3. Bấm **Lưu** và thực hiện chuyển khoản thử để tận hưởng tính năng gạch nợ tự động!

---

## 🔒 Bản quyền & Mẫu giao diện
Dự án được thiết kế dưới dạng Template mở mã nguồn sạch, tối ưu bảo mật và sẵn sàng sử dụng cho các hội nhóm, lớp học hoặc tổ chức sự kiện.
