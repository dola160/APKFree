# APKFree
APK1
# Web → APK — Đóng gói website thành ứng dụng Android thật

Công cụ gồm 2 phần:
- `frontend/index.html` — giao diện nhập liệu, xem trước, console build trực tiếp.
- `backend/server.js` — máy chủ Node.js thật, gọi **Bubblewrap** (công cụ chính thức của Google Chrome team) để tạo ra APK **TWA** (Trusted Web Activity) có chữ ký hợp lệ, cài được trên Android 8.0 trở lên.

Không có bước nào bị giả lập: APK sinh ra là tệp thật, do Android SDK biên dịch và `keytool` ký số thật.

---

## 1. Cài đặt môi trường (bắt buộc, làm 1 lần)

| Thành phần | Vì sao cần | Cách cài nhanh |
|---|---|---|
| Node.js ≥ 18 | Chạy server + Bubblewrap CLI | https://nodejs.org |
| Java JDK 17 | Biên dịch Android, `keytool` ký APK | `sudo apt install openjdk-17-jdk` (Linux) / `brew install openjdk@17` (Mac) |
| Android SDK cmdline-tools | `aapt2`, `d8`, `apksigner`, `zipalign` — công cụ đóng gói/ký APK thật | Tải "Command line tools" tại https://developer.android.com/studio#command-tools |
| Android SDK Platform 34 + Build-Tools | Bubblewrap cần để build | `sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"` |

Thiết lập biến môi trường (thêm vào `~/.bashrc` hoặc `~/.zshrc`):
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

Kiểm tra:
```bash
java -version        # phải ra 17.x
keytool -help         # phải chạy được, không lỗi "not found"
echo $ANDROID_HOME     # phải có đường dẫn
sdkmanager --list      # phải liệt kê được gói SDK
```

---

## 2. Cài dự án

```bash
cd backend
npm install
```

Bubblewrap CLI sẽ được gọi qua `npx @bubblewrap/cli` (không cần cài global). Lần chạy đầu tiên `npx` sẽ tự tải Bubblewrap về — cần internet.

---

## 3. Chạy máy chủ build

```bash
cd backend
node server.js
```

Sẽ thấy:
```
Web-to-APK build server đang chạy tại http://localhost:3000
Mở giao diện tại http://localhost:3000/frontend/index.html
```

Mở trình duyệt tới địa chỉ trên (hoặc mở trực tiếp file `frontend/index.html`, giao diện đã cấu hình sẵn gọi về `http://localhost:3000`).

---

## 4. Dùng công cụ

1. Điền tên ứng dụng, phiên bản, URL, tải icon 512×512.
2. Chọn hướng màn hình, màu, quyền cần dùng.
3. Bấm **TẠO ỨNG DỤNG APK** — console bên phải hiển thị log build **thật** lấy trực tiếp từ tiến trình Bubblewrap/Gradle (không phải log giả).
4. Khi xong, bấm **TẢI XUỐNG TỆP APK** để tải file `.apk` thật về máy — cài trực tiếp trên điện thoại Android (cần bật "Cài từ nguồn không xác định" vì đây là APK tự ký, không qua Play Store).

---

## 5. Về chữ ký APK (quan trọng)

Server tự tạo một **keystore ký thật** bằng `keytool` (`backend/builds/<job>/android.keystore`, mật khẩu mặc định `apkbuilder123` — đặt trong `server.js`, hàm `ensureKeystore`). Chữ ký này hợp lệ để **cài đặt và chạy** APK.

Nếu bạn định phát hành lên Google Play, cần:
- Đổi mật khẩu keystore mặc định thành mật khẩu riêng, giữ bí mật.
- Dùng **cùng một keystore** cho mọi bản cập nhật sau này của cùng một ứng dụng (đổi keystore giữa các bản = Android coi là ứng dụng khác, không cập nhật được).

---

## 6. Nếu Bubblewrap của bạn không hỗ trợ cờ non-interactive

Bubblewrap CLI đôi khi hỏi tương tác (xác nhận tên gói, đường dẫn keystore...) tùy phiên bản. Trước khi chạy qua server, hãy tự tay chạy 1 lần:

```bash
npx @bubblewrap/cli init --manifest=<url-manifest-mẫu> --directory=/tmp/test-build
```

Xem đúng thứ tự các câu hỏi được in ra, rồi mở `backend/server.js`, tìm hàm `run()` gọi `bubblewrap init` — thêm các câu trả lời vào qua `proc.stdin.write(...)` theo đúng thứ tự đó (đã để sẵn ghi chú `LƯU Ý VỀ PHIÊN BẢN BUBBLEWRAP` ở đầu file). Đây là phần duy nhất có thể lệch nhỏ giữa các phiên bản Bubblewrap khác nhau — kiến trúc tổng thể (form → manifest → build → APK ký thật → tải xuống) không đổi.

---

## 7. Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `keytool: command not found` | Chưa cài JDK hoặc chưa thêm vào PATH | Cài JDK 17, kiểm tra `JAVA_HOME/bin` có trong PATH |
| `ANDROID_HOME is not set` | Chưa cấu hình biến môi trường | Xem mục 1 |
| Build treo lâu ở bước `bubblewrap build` | Lần đầu Gradle tải dependency từ internet | Chờ — các lần build sau sẽ nhanh hơn nhờ cache Gradle |
| Icon hiển thị mờ/vỡ trong app | Icon nhỏ hơn 512×512 | Tải icon đúng khuyến nghị 512×512px |
