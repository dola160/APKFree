# Hướng dẫn tạo WebAPK thật — không lỗi

## Vì sao cần các bước này?
APK là gói đã biên dịch + ký số theo chuẩn Android. Trình duyệt không thể tự
tạo ra file này một cách hợp lệ. Hai cách dưới đây dùng đúng công cụ chính
thống (Chrome / Google) nên APK tạo ra **không bao giờ bị lỗi "phân tích cú
pháp gói"**.

---

## CÁCH 1: WebAPK thật qua Chrome (miễn phí, nhanh nhất)

1. Thay icon thật vào thư mục `icons/` (kích thước 192x192, 512x512, và bản
   maskable 512x512 — có thể tạo nhanh tại https://maskable.app/editor).
2. Sửa `manifest.json`: đổi `name`, `short_name`, màu sắc theo ý bạn.
3. Đưa 3 file (`index.html`, `manifest.json`, `sw.js`) + thư mục `icons/`
   lên **hosting có HTTPS** (bắt buộc — không chạy được ở `file://`).
   Gợi ý miễn phí: GitHub Pages, Netlify, Vercel, Firebase Hosting.
4. Mở link đó bằng **Chrome trên điện thoại Android**.
5. Chạm menu ⋮ → **"Thêm vào Màn hình chính"** (hoặc nút "Cài đặt" tự hiện
   trong trang).
6. Chrome tự động sinh WebAPK thật, ký sẵn, cài như app — **100% không lỗi**.

---

## CÁCH 2: Build file .apk tải về trực tiếp — PWABuilder

Dùng khi bạn cần file `.apk` để gửi/tải xuống, không phụ thuộc việc người
dùng tự bấm "Thêm vào màn hình chính".

1. Deploy 3 file trên lên hosting HTTPS (giống bước 3 ở Cách 1).
2. Vào https://www.pwabuilder.com
3. Dán URL trang web của bạn vào ô tìm kiếm → bấm **Start**.
4. PWABuilder sẽ quét `manifest.json` và `sw.js` — sửa các cảnh báo (nếu có,
   thường là thiếu icon hoặc thiếu trường trong manifest).
5. Vào tab **Android** → bấm **Generate Package**.
6. Chọn kiểu gói:
   - **Signed APK** — dùng khoá do PWABuilder tự tạo, cài trực tiếp được.
   - **Google Play (AAB)** — nếu định đăng lên Play Store.
7. Tải file `.zip` về → giải nén ra sẽ có file `.apk` **đã ký sẵn hợp lệ**.
8. Cài trực tiếp file `.apk` đó trên điện thoại (nhớ bật "Cài đặt từ nguồn
   không xác định" nếu Android hỏi).

> File từ PWABuilder được build bằng Android SDK + Gradle thật (thông qua
> Bubblewrap của Google), có chữ ký hợp lệ — nên không gặp lỗi "Đã xảy ra
> sự cố khi phân tích cú pháp gói".

---

## Lỗi "Đã xảy ra sự cố khi phân tích cú pháp gói" xảy ra khi nào?
- File `.apk` bị tải thiếu/hỏng dữ liệu.
- File không phải APK thật (bị đổi đuôi từ .zip, .txt...).
- APK không có chữ ký hoặc chữ ký sai định dạng.
- Kiến trúc CPU không khớp máy (hiếm gặp).

→ Dùng đúng 2 cách trên (Chrome hoặc PWABuilder) sẽ tránh được hoàn toàn.
