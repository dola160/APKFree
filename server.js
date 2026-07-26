/**
 * Web to APK — Backend build server
 * ----------------------------------------------------------------
 * Tạo APK Android THẬT (TWA - Trusted Web Activity) từ một website,
 * dùng Bubblewrap (@bubblewrap/cli) — công cụ chính thức của Google
 * Chrome team. Không giả lập bất kỳ bước nào.
 *
 * YÊU CẦU MÔI TRƯỜNG (bắt buộc, xem README.md để cài đặt):
 *  - Node.js >= 18
 *  - Java JDK 17           (biến môi trường JAVA_HOME)
 *  - Android SDK cmdline-tools + platform-tools + build-tools 34
 *    + platform android-34 (biến môi trường ANDROID_HOME)
 *  - keytool (đi kèm JDK) để tạo keystore ký APK
 *  - Gói @bubblewrap/cli (cài qua npm, script này gọi qua npx)
 *
 * LƯU Ý VỀ PHIÊN BẢN BUBBLEWRAP:
 *  Bubblewrap CLI có thể thay đổi tên cờ (flags) giữa các phiên bản.
 *  Trước khi chạy thật, hãy gõ:  npx @bubblewrap/cli --help
 *  và đối chiếu với các lệnh trong hàm runBubblewrapInit() /
 *  runBubblewrapBuild() bên dưới — chỉnh lại cờ nếu phiên bản bạn
 *  cài khác. Đây là phần duy nhất phụ thuộc bên ngoài không thể
 *  đảm bảo 100% cố định vì Bubblewrap là dự án của Google, cập nhật
 *  độc lập với công cụ này.
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const BUILDS_DIR = path.join(ROOT, 'builds');       // mỗi job 1 thư mục dự án Android
const TMP_DIR = path.join(ROOT, 'tmp');             // icon tạm + web manifest tạm, phục vụ qua HTTP cho Bubblewrap fetch
const OUT_DIR = path.join(ROOT, 'output');           // APK hoàn chỉnh, sẵn sàng tải

for (const d of [BUILDS_DIR, TMP_DIR, OUT_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

app.use(cors());
app.use('/tmp', express.static(TMP_DIR));
app.use('/frontend', express.static(path.join(ROOT, '..', 'frontend')));

const upload = multer({ dest: path.join(ROOT, 'uploads-raw') });

// ------------------------------------------------------------------
// Job store (in-memory — đủ dùng cho công cụ chạy nội bộ/1 máy)
// ------------------------------------------------------------------
const jobs = new Map();

function newJob(jobId) {
  const job = { id: jobId, stage: 'prep', status: 'running', listeners: new Set(), logs: [], result: null };
  jobs.set(jobId, job);
  return job;
}

function emit(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (payload.line) job.logs.push(payload.line);
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of job.listeners) res.write(data);
}

function setStage(jobId, stage) {
  const job = jobs.get(jobId);
  if (job) job.stage = stage;
  emit(jobId, { stage });
}

// ------------------------------------------------------------------
// Health check — frontend dùng để hiển thị "máy chủ đã sẵn sàng"
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ------------------------------------------------------------------
// SSE — log build thời gian thực
// ------------------------------------------------------------------
app.get('/api/build/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ stage: job.stage, line: '(đã kết nối luồng log)' })}\n\n`);
  job.listeners.add(res);

  if (job.status === 'success' || job.status === 'error') {
    res.write(`data: ${JSON.stringify(job.result)}\n\n`);
  }

  req.on('close', () => job.listeners.delete(res));
});

// ------------------------------------------------------------------
// Tải APK hoàn chỉnh
// ------------------------------------------------------------------
app.get('/api/build/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'success') return res.status(404).json({ error: 'Chưa có tệp APK cho job này.' });
  const { filePath, fileName } = job.result;
  res.download(filePath, fileName);
});

// ------------------------------------------------------------------
// Tiện ích
// ------------------------------------------------------------------
function isValidHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function suggestPackageId(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean).reverse();
    return (parts.join('.') || 'com.example') + '.app';
  } catch {
    return 'com.example.app';
  }
}

function run(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let stderrBuf = '';
    proc.stdout.on('data', (d) => {
      d.toString().split('\n').filter(Boolean).forEach((l) => onLine(l));
    });
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrBuf += text;
      text.split('\n').filter(Boolean).forEach((l) => onLine(l, 'warn'));
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(' ')}" thoát với mã lỗi ${code}\n${stderrBuf.slice(-800)}`));
    });
  });
}

// Sinh keystore ký APK thật bằng keytool (đi kèm JDK) nếu chưa có
async function ensureKeystore(dir, jobId) {
  const keystorePath = path.join(dir, 'android.keystore');
  if (fs.existsSync(keystorePath)) return keystorePath;
  emit(jobId, { line: 'Đang tạo khóa ký số (keystore) cho APK…' });
  await run('keytool', [
    '-genkeypair',
    '-v',
    '-keystore', keystorePath,
    '-alias', 'apkbuilder',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '9125', // ~25 năm
    '-storepass', 'apkbuilder123',
    '-keypass', 'apkbuilder123',
    '-dname', 'CN=WebToAPK, OU=Dev, O=Dev, L=HN, S=HN, C=VN',
  ], dir, (l) => emit(jobId, { line: l }));
  return keystorePath;
}

// ------------------------------------------------------------------
// Endpoint chính: nhận form, khởi chạy pipeline build thật
// ------------------------------------------------------------------
app.post('/api/build', upload.single('icon'), async (req, res) => {
  const {
    appName, appVersion, packageId, siteUrl,
    orientation, themeColor, toolbarColor, fullscreen,
    permStorage, permVibrate,
  } = req.body;

  if (!appName || !appName.trim()) return res.status(400).json({ error: 'Thiếu tên ứng dụng.' });
  if (!siteUrl || !isValidHttpUrl(siteUrl)) return res.status(400).json({ error: 'URL không hợp lệ (phải bắt đầu http:// hoặc https://).' });
  if (!req.file) return res.status(400).json({ error: 'Thiếu ảnh biểu tượng.' });

  const jobId = uuidv4();
  const job = newJob(jobId);
  const buildDir = path.join(BUILDS_DIR, jobId);
  const jobTmpDir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(jobTmpDir, { recursive: true });

  const finalPackageId = (packageId && packageId.trim()) || suggestPackageId(siteUrl);
  const version = (appVersion && appVersion.trim()) || '1.0.0';

  // Trả jobId ngay, chạy pipeline nền, tiến độ đẩy qua SSE
  res.json({ jobId });

  try {
    // 1) Lưu icon vào thư mục tĩnh để Bubblewrap/HTTP fetch được
    const ext = path.extname(req.file.originalname) || '.png';
    const iconFileName = 'icon' + ext;
    const iconPath = path.join(jobTmpDir, iconFileName);
    await fsp.rename(req.file.path, iconPath);

    const publicBase = `http://localhost:${PORT}/tmp/${jobId}`;
    const iconUrl = `${publicBase}/${iconFileName}`;

    // 2) Sinh Web App Manifest thật, trỏ đúng URL + icon người dùng cung cấp
    const webManifest = {
      name: appName.trim(),
      short_name: appName.trim().slice(0, 12),
      start_url: siteUrl,
      scope: new URL(siteUrl).origin + '/',
      display: fullscreen === 'true' ? 'fullscreen' : 'standalone',
      orientation: orientation || 'any',
      background_color: themeColor || '#146356',
      theme_color: toolbarColor || themeColor || '#146356',
      icons: [
        { src: iconUrl, sizes: '512x512', type: req.file.mimetype },
        { src: iconUrl, sizes: '192x192', type: req.file.mimetype },
      ],
    };
    const manifestPath = path.join(jobTmpDir, 'manifest.webmanifest');
    await fsp.writeFile(manifestPath, JSON.stringify(webManifest, null, 2));
    const manifestUrl = `${publicBase}/manifest.webmanifest`;

    emit(jobId, { line: `Đã tạo Web App Manifest tạm cho Bubblewrap fetch: ${manifestUrl}` });
    setStage(jobId, 'prep');

    // 3) keystore ký thật
    const keystorePath = await ensureKeystore(buildDir, jobId);

    // 4) Khởi tạo dự án Android TWA từ manifest (Bubblewrap init)
    emit(jobId, { line: 'Đang khởi tạo dự án Android (bubblewrap init)…' });
    setStage(jobId, 'pack');

    // LƯU Ý: Bubblewrap init có thể hỏi tương tác tùy phiên bản.
    // Cờ dưới đây dùng chế độ non-interactive nếu bản cài hỗ trợ.
    // Nếu bản bạn cài không nhận cờ này, hãy chạy 1 lần thủ công
    // `npx @bubblewrap/cli init --manifest=<manifestUrl>` để xem đúng
    // thứ tự câu hỏi, rồi thay bước này bằng cách "pipe" câu trả lời
    // qua stdin (xem README mục "Bubblewrap không chạy non-interactive").
    await run('npx', [
      '@bubblewrap/cli', 'init',
      `--manifest=${manifestUrl}`,
      `--directory=${buildDir}`,
    ], ROOT, (l, level) => emit(jobId, { line: l, level }));

    // 5) Ghi đè các trường quan trọng vào twa-manifest.json sinh ra,
    //    đảm bảo đúng packageId / màu / hướng màn hình / quyền người dùng chọn.
    const twaManifestPath = path.join(buildDir, 'twa-manifest.json');
    const twaManifest = JSON.parse(await fsp.readFile(twaManifestPath, 'utf-8'));
    twaManifest.packageId = finalPackageId;
    twaManifest.appVersionName = version;
    twaManifest.themeColor = themeColor || '#146356';
    twaManifest.navigationColor = toolbarColor || themeColor || '#146356';
    twaManifest.orientation = orientation || 'default';
    twaManifest.display = fullscreen === 'true' ? 'fullscreen' : 'standalone';
    twaManifest.signingKey = {
      path: keystorePath,
      alias: 'apkbuilder',
    };
    twaManifest.features = twaManifest.features || {};
    if (permStorage === 'true') twaManifest.features.storage = { enabled: true };
    if (permVibrate === 'true') twaManifest.features.vibrate = { enabled: true };
    await fsp.writeFile(twaManifestPath, JSON.stringify(twaManifest, null, 2));
    emit(jobId, { line: `Đã ghi cấu hình: packageId=${finalPackageId}, version=${version}` });

    // 6) Build + ký APK thật
    emit(jobId, { line: 'Đang biên dịch & ký APK (bubblewrap build)… việc này có thể mất vài phút.' });
    await run('npx', [
      '@bubblewrap/cli', 'build',
      '--skipPwaValidation',
    ], buildDir, (l, level) => emit(jobId, { line: l, level }));

    // 7) Bubblewrap xuất ra app-release-signed.apk trong buildDir
    const producedApk = path.join(buildDir, 'app-release-signed.apk');
    if (!fs.existsSync(producedApk)) {
      throw new Error('Không tìm thấy tệp APK sau khi build — kiểm tra log phía trên để biết bước nào lỗi.');
    }
    const safeName = appName.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `${safeName}-${version}.apk`;
    const finalPath = path.join(OUT_DIR, `${jobId}-${fileName}`);
    await fsp.copyFile(producedApk, finalPath);
    const sizeMb = ((await fsp.stat(finalPath)).size / (1024 * 1024)).toFixed(2);

    job.status = 'success';
    job.result = {
      status: 'success',
      fileName,
      sizeMb,
      packageId: finalPackageId,
      version,
      filePath: finalPath,
    };
    setStage(jobId, 'done');
    emit(jobId, { line: `✅ Hoàn tất — ${fileName} (${sizeMb} MB)`, level: 'ok' });
    emit(jobId, job.result);
  } catch (err) {
    job.status = 'error';
    job.result = { status: 'error', message: err.message };
    emit(jobId, { line: `❌ Lỗi: ${err.message}`, level: 'err' });
    emit(jobId, job.result);
  }
});

app.listen(PORT, () => {
  console.log(`Web-to-APK build server đang chạy tại http://localhost:${PORT}`);
  console.log(`Mở giao diện tại http://localhost:${PORT}/frontend/index.html`);
});
