let express, sql, cors;
try {
    express = require('express');
    sql = require('mssql');
    cors = require('cors');
} catch (err) {
    console.error('Thiếu các module cần thiết. Cài đặt bằng: npm install express mssql cors dotenv --save');
    console.error('Chi tiết lỗi:', err.stack || err.message || err);
    process.exit(1);
}

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình phục vụ file tĩnh từ thư mục gốc và /public
// Thêm static riêng cho uploads (cache 7 ngày)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (/\.(png|jpe?g)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
    }
}));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
// Thêm route rõ ràng cho trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Trang đăng nhập
});
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html')); // Trang chính mới
});
app.use(cors());
// Tăng giới hạn kích thước body lên 100MB cho JSON và form
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Trang theo vai trò
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/sinhvien', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sinhvien.html'));
});
app.get('/chutro', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chutro.html'));
});

// ---------- Utility: Resolve map short links to an embeddable Google Maps iframe src ----------
async function followRedirects(urlStr, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        let current = urlStr;
        let count = 0;
        const doReq = () => {
            if (count > maxRedirects) return resolve(current);
            count++;
            let u;
            try { u = new URL(current); } catch (e) { return resolve(current); }
            const mod = u.protocol === 'http:' ? http : https;
            const opts = {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'text/html,application/xhtml+xml'
                }
            };
            const req = mod.request(u, opts, (res) => {
                const status = res.statusCode || 0;
                // Some providers send HTML with JS redirect; best-effort: use Location for 3xx
                if (status >= 300 && status < 400 && res.headers.location) {
                    try {
                        const next = new URL(res.headers.location, u);
                        current = next.toString();
                        // Consume and follow
                        res.resume();
                        return doReq();
                    } catch {
                        // fallthrough
                    }
                }
                // Done; final URL
                res.resume();
                resolve(current);
            });
            req.on('error', () => resolve(current));
            req.end();
        };
        doReq();
    });
}

function buildGoogleEmbedFromUrl(finalUrl) {
    try {
        const u = new URL(finalUrl);
        if (!/google\./i.test(u.hostname)) return null;
        // Already embed src
        if (/\/maps\/embed\//i.test(u.pathname)) return u.toString();
        // q parameter
        let q = u.searchParams.get('q');
        if (!q) {
            // /@lat,lng,zoom
            const mAt = u.pathname.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
            if (mAt) q = `${mAt[1]},${mAt[2]}`;
        }
        if (!q) {
            // try !3d lat !4d lng in data params
            const full = `${u.pathname}${u.search}`;
            const m34 = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
            if (m34) q = `${m34[1]},${m34[2]}`;
        }
        if (q) return `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`;
        return null;
    } catch {
        return null;
    }
}

app.get('/api/map/resolve', async (req, res) => {
    const raw = String(req.query.u || '').trim();
    if (!raw) return res.status(400).json({ success: false, message: 'Thiếu URL' });
    try {
        const host = (() => { try { return new URL(raw).hostname; } catch { return ''; } })();
        let finalUrl = raw;
        if (/^(maps\.app\.goo\.gl|goo\.gl)$/i.test(host) || /goo\.gl\/maps/i.test(raw)) {
            finalUrl = await followRedirects(raw, 5);
        }
        // If final is a Google Maps page, try to build embed src
        const iframeSrc = buildGoogleEmbedFromUrl(finalUrl);
        if (iframeSrc) return res.json({ success: true, iframeSrc });
        return res.json({ success: false, openInNewTab: true, url: finalUrl });
    } catch (e) {
        res.json({ success: false, message: e.message || 'Không thể xử lý', openInNewTab: true, url: raw });
    }
});

// ------------------ Cấu hình kết nối SQL Server ------------------
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || '1433'),
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

let pool = null;

sql.connect(dbConfig).then(poolInstance => {
    pool = poolInstance;
    console.log('✅ Kết nối SQL Server thành công');
    // Seed default admin
    seedAdminDefault().catch(err => console.error('❌ Seed admin lỗi:', err.message || err));
    // Ensure schemas ready (tránh lỗi cột thiếu)
    ensureChuTroSchema().catch(err => console.error('❌ Ensure ChuTro schema lỗi:', err.message || err));
    ensureXacThucSchema().catch(err => console.error('❌ Ensure XacThuc schema lỗi:', err.message || err));
    ensureAnhPhongSchema().catch(err => console.error('❌ Ensure AnhPhong schema lỗi:', err.message || err));
    ensureTienThueThangSchema().catch(err => console.error('❌ Ensure TienThueThang schema lỗi:', err.message || err));
    ensureThongBaoReplySchema().catch(err => console.error('❌ Ensure ThongBao reply schema lỗi:', err.message || err));
    pool.on('error', err => {
        console.error('⚠️  Lỗi pool SQL:', err.message || err);
        pool = null;
    });
}).catch(err => {
    console.error('❌ Lỗi kết nối SQL Server:', err.message || err);
});

// ------------------ Hàm kiểm tra kết nối ------------------
function checkPool(res) {
    if (!pool || !pool.connected) {
        res.status(500).json({ success: false, message: 'Chưa kết nối đến cơ sở dữ liệu' });
        return false;
    }
    return true;
}

// ------------------ API kiểm tra trạng thái ------------------
app.get('/api/status', (req, res) => {
    res.json({ connected: !!(pool && pool.connected) });
});

// ------------------ Map vai trò ------------------
function mapVaiTroTextToId(vai_tro) {
    if (!vai_tro) return 2; // mặc định người dùng
    const key = String(vai_tro).trim().toLowerCase();
    if (key === 'admin') return 1;
    if (key === 'Chủ Trọ' || key === 'nguoi dung' || key === 'user') return 2;
    if (key === 'Sinh Viên' || key === 'sinh vien' || key === 'student') return 3;
    return 2;
}
// Chuẩn hóa chuỗi để so khớp không dấu
function norm(s) {
    return (s || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}
// Xác định đường dẫn trang chủ theo vai trò
function getRedirectByRole(vaiTroId, tenVaiTro) {
    const n = norm(tenVaiTro);
    if (n.includes('admin')) return '/admin';
    if (n.includes('sinh vien') || n === 'sinhvien') return '/sinhvien';
    if (n.includes('chu tro') || n === 'chutro' || n.includes('chu nha')) return '/chutro';
    switch (Number(vaiTroId)) {
        case 1: return '/admin';
        case 3: return '/sinhvien';
        case 4: return '/chutro';
        default: return '/home'; // Mặc định quay về trang home
    }
}

// ------------------ API lấy vai trò ------------------
app.get('/api/vaitro', async (req, res) => {
    if (!checkPool(res)) return;
    try {
        const result = await pool.request()
            .query('SELECT VaiTroId, TenVaiTro FROM VaiTro ORDER BY VaiTroId');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('❌ Lỗi lấy VaiTro:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API đăng nhập ------------------
app.post('/api/dangnhap', async (req, res) => {
    if (!checkPool(res)) return;
    const { gmail, matkhau } = req.body;
    const email = (gmail || '').trim();
    const pwd = (matkhau || '').trim();

    if (!email || !pwd) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập gmail và mật khẩu' });
    }
    if (email.length > 255) {
        return res.status(400).json({ success: false, message: 'Email quá dài (tối đa 255 ký tự)' });
    }
    if (pwd.length < 6 || pwd.length > 50) {
        return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 đến 50 ký tự' });
    }

    try {
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .query(`
                SELECT tk.TaiKhoanId, tk.Email, tk.VaiTroId, tk.TrangThai, vt.TenVaiTro
                FROM TaiKhoan tk
                JOIN VaiTro vt ON vt.VaiTroId = tk.VaiTroId
                WHERE tk.Email = @Email AND tk.MatKhau = @MatKhau
            `);

        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            // Chặn đăng nhập nếu tài khoản không ở trạng thái kích hoạt (1)
            if (Number(row.TrangThai) !== 1) {
                // Quy ước: 1 = kích hoạt, 2 = bị khóa (các trạng thái khác coi như không hợp lệ)
                const msg = Number(row.TrangThai) === 2
                    ? 'Tài khoản của bạn đang bị khóa. Vui lòng liên hệ quản trị viên.'
                    : 'Tài khoản chưa được kích hoạt hoặc không hợp lệ.';
                return res.status(403).json({ success: false, message: msg });
            }
            const redirect = getRedirectByRole(row.VaiTroId, row.TenVaiTro);
            res.status(200).json({
                success: true,
                message: 'Đăng nhập thành công',
                redirect: `${redirect}?email=${encodeURIComponent(row.Email)}`,
                role: { id: row.VaiTroId, name: row.TenVaiTro }
            });
        } else {
            res.status(401).json({ success: false, message: 'Gmail hoặc mật khẩu không đúng' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
});

// ------------------ API đăng ký ------------------
app.post('/api/dangki', async (req, res) => {
    if (!checkPool(res)) return;
    const { gmail, matkhau, vai_tro, vai_tro_id } = req.body;
    const email = (gmail || '').trim();
    const pwd = (matkhau || '').trim();
    let vaiTroId = Number.parseInt(vai_tro_id, 10);
    if (Number.isNaN(vaiTroId)) vaiTroId = mapVaiTroTextToId(vai_tro);

    const trangThai = 1; // kích hoạt

    if (!email || !pwd) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập gmail và mật khẩu' });
    }
    if (email.length > 255) {
        return res.status(400).json({ success: false, message: 'Email quá dài (tối đa 255 ký tự)' });
    }
    if (pwd.length < 6 || pwd.length > 50) {
        return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 đến 50 ký tự' });
    }

    try {
        // Không cho đăng ký vai trò Admin (Admin là tài khoản được cấp)
        try {
            const vt = await pool.request()
                .input('Id', sql.Int, vaiTroId)
                .query('SELECT TenVaiTro FROM dbo.VaiTro WHERE VaiTroId = @Id');
            const ten = (vt.recordset[0]?.TenVaiTro || String(vai_tro || '')).toString().toLowerCase();
            if (ten.includes('admin')) {
                return res.status(403).json({
                    success: false,
                    message: 'Admin là tài khoản được cấp, không được đăng ký'
                });
            }
        } catch (e) {
            // Nếu không tra được tên vai trò, vẫn tiếp tục các bước khác; Admin vẫn sẽ được seed sẵn
        }

        const checkResult = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query('SELECT 1 AS existsFlag FROM TaiKhoan WHERE Email = @Email');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'Email đã tồn tại' });
        }

        await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .input('VaiTroId', sql.Int, vaiTroId)
            .input('TrangThai', sql.Int, trangThai)
            .query(`
                INSERT INTO TaiKhoan (Email, MatKhau, VaiTroId, TrangThai)
                VALUES (@Email, @MatKhau, @VaiTroId, @TrangThai)
            `);

        res.status(201).json({ success: true, message: 'Đăng ký thành công', redirect: '/' });
    } catch (err) {
        console.error('❌ Lỗi khi đăng ký:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server', error: err.message });
    }
});

// ------------------ API xem hồ sơ từ TaiKhoan ------------------
app.get('/api/profile/:email', async (req, res) => {
    if (!checkPool(res)) return;
    const email = req.params.email;

    try {
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`
                SELECT TaiKhoanId, Email, VaiTroId, TrangThai
                FROM TaiKhoan
                WHERE Email = @Email
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset[0] });
        } else {
            res.json({ success: false, message: 'Không tìm thấy người dùng' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
});

// ------------------ API hồ sơ sinh viên ------------------
app.get('/api/sinhvien/profile', async (req, res) => {
    if (!checkPool(res)) return;
    const email = req.query.email;
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });

    try {
        // Lấy metadata cột của bảng SinhVien (nếu có)
        const meta = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SinhVien'
        `);
        const cols = new Set(meta.recordset.map(r => r.COLUMN_NAME));
        const hasTable = meta.recordset.length > 0;

        const hasHoTen = cols.has('HoTen');
        const sdtCol = cols.has('SoDienThoai') ? 'SoDienThoai' : (cols.has('SDT') ? 'SDT' : null);
        const truongCol = cols.has('Truong') ? 'Truong' : (cols.has('TruongHoc') ? 'TruongHoc' : null);
        const diaChiCol = cols.has('DiaChi') ? 'DiaChi' : (cols.has('DiaChiLienHe') ? 'DiaChiLienHe' : null);

        const selectParts = [
            'tk.Email',
            hasTable ? 'sv.SinhVienId' : 'CAST(NULL AS BIGINT) AS SinhVienId',
            hasHoTen ? 'sv.HoTen AS HoTen' : 'CAST(NULL AS NVARCHAR(150)) AS HoTen',
            sdtCol ? `sv.${sdtCol} AS SoDienThoai` : 'CAST(NULL AS NVARCHAR(20)) AS SoDienThoai',
            truongCol ? `sv.${truongCol} AS Truong` : 'CAST(NULL AS NVARCHAR(150)) AS Truong',
            diaChiCol ? `sv.${diaChiCol} AS DiaChi` : 'CAST(NULL AS NVARCHAR(255)) AS DiaChi'
        ].join(', ');

        const fromJoin = hasTable
            ? 'FROM TaiKhoan tk LEFT JOIN SinhVien sv ON sv.SinhVienId = tk.TaiKhoanId'
            : 'FROM TaiKhoan tk';

        const sqlText = `
            SELECT ${selectParts}
            ${fromJoin}
            WHERE tk.Email = @Email
        `;

        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(sqlText);

        if (result.recordset.length > 0) {
            const data = result.recordset[0];
            return res.json({ success: true, data });
        } else {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
    } catch (err) {
        console.error('❌ Lỗi lấy hồ sơ sinh viên:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API cập nhật hồ sơ sinh viên ------------------
app.post('/api/sinhvien/profile', async (req, res) => {
    if (!checkPool(res)) return;
    const { email, hoTen = '', soDienThoai, truong, diaChi } = req.body;

    try {
        // Lấy TaiKhoanId theo email
        const tk = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Tạo bảng nếu chưa có (đúng schema: HoTen NOT NULL, có DiaChi)
        await pool.request().query(`
IF OBJECT_ID(N'dbo.SinhVien', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SinhVien (
        SinhVienId BIGINT NOT NULL PRIMARY KEY,
        HoTen NVARCHAR(150) NOT NULL,
        SoDienThoai NVARCHAR(20) NULL,
        Truong NVARCHAR(150) NULL,
        DiaChi NVARCHAR(255) NULL
    );
END
IF COL_LENGTH('dbo.SinhVien','DiaChi') IS NULL
BEGIN
    ALTER TABLE dbo.SinhVien ADD DiaChi NVARCHAR(255) NULL;
END
        `);

        // Đọc metadata để cập nhật theo cột hiện có
        const meta = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SinhVien'
        `);
        const cols = new Set(meta.recordset.map(r => r.COLUMN_NAME));
        const hasHoTen = cols.has('HoTen');
        const sdtCol = cols.has('SoDienThoai') ? 'SoDienThoai' : (cols.has('SDT') ? 'SDT' : null);
        const truongCol = cols.has('Truong') ? 'Truong' : (cols.has('TruongHoc') ? 'TruongHoc' : null);
        const diaChiCol = cols.has('DiaChi') ? 'DiaChi' : (cols.has('DiaChiLienHe') ? 'DiaChiLienHe' : null);

        const sets = [];
        if (hasHoTen && hoTen !== undefined && hoTen !== null && hoTen !== '') sets.push('HoTen = @HoTen');
        if (sdtCol && soDienThoai) sets.push(`${sdtCol} = @SoDienThoai`);
        if (truongCol && truong) sets.push(`${truongCol} = @Truong`);
        if (diaChiCol && diaChi) sets.push(`${diaChiCol} = @DiaChi`);

        // Luôn chèn HoTen (non-null) khi INSERT để thỏa NOT NULL
        const insertCols = ['SinhVienId'];
        const insertVals = ['@SinhVienId'];
        if (hasHoTen) { insertCols.push('HoTen'); insertVals.push('@HoTenInsert'); }
        if (sdtCol && soDienThoai) { insertCols.push(sdtCol); insertVals.push('@SoDienThoai'); }
        if (truongCol && truong) { insertCols.push(truongCol); insertVals.push('@Truong'); }
        if (diaChiCol && diaChi) { insertCols.push(diaChiCol); insertVals.push('@DiaChi'); }

        const upsertSql = `
IF EXISTS (SELECT 1 FROM dbo.SinhVien WHERE SinhVienId = @SinhVienId)
BEGIN
    ${sets.length ? `UPDATE dbo.SinhVien SET ${sets.join(', ')} WHERE SinhVienId = @SinhVienId;` : '/* Không có cột để cập nhật */'}
END
ELSE
BEGIN
    INSERT INTO dbo.SinhVien (${insertCols.join(', ')})
    VALUES (${insertVals.join(', ')});
END
        `;

        await pool.request()
            .input('SinhVienId', sql.BigInt, taiKhoanId)
            .input('HoTen', sql.NVarChar, hoTen || null)   // dùng cho UPDATE nếu có
            .input('HoTenInsert', sql.NVarChar, (hoTen || '').toString()) // luôn non-null khi INSERT
            .input('SoDienThoai', sql.NVarChar, soDienThoai || null)
            .input('Truong', sql.NVarChar, truong || null)
            .input('DiaChi', sql.NVarChar, diaChi || null)
            .query(upsertSql);

        res.json({ success: true, message: 'Cập nhật hồ sơ thành công' });
    } catch (err) {
        console.error('❌ Lỗi cập nhật hồ sơ sinh viên:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API cập nhật hồ sơ chủ trọ ------------------
app.post('/api/chutro/profile', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const b = req.body || {};
    const email = (b.email || '').trim();
    const hoTen = (b.hoTen || '').trim();
    const soDienThoai = (b.soDienThoai || '').trim();
    const diaChiLienHe = (b.diaChiLienHe || '').trim();
    // DaXacThuc là BIT: nhận true/false/'1'/'0'/'on'...
    const daXacThucRaw = b.daXacThuc;
    const daXacThuc =
        daXacThucRaw === true ||
        daXacThucRaw === 1 ||
        daXacThucRaw === '1' ||
        (typeof daXacThucRaw === 'string' && daXacThucRaw.toLowerCase() === 'true') ||
        (typeof daXacThucRaw === 'string' && daXacThucRaw.toLowerCase() === 'on');
    const ngayXacThucStr = (b.ngayXacThuc || '').trim();
    const ngayXacThuc = ngayXacThucStr ? new Date(ngayXacThucStr) : null;
    const setVerifiedAtNow = daXacThuc && !ngayXacThuc; // nếu xác thực mà chưa có ngày -> dùng thời gian thực

    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    if (hoTen.length > 150) return res.status(400).json({ success: false, message: 'Họ tên quá dài' });
    if (soDienThoai.length > 20) return res.status(400).json({ success: false, message: 'Số điện thoại quá dài' });
    if (diaChiLienHe.length > 255) return res.status(400).json({ success: false, message: 'Địa chỉ liên hệ quá dài' });
    if (ngayXacThuc && isNaN(ngayXacThuc.getTime())) return res.status(400).json({ success: false, message: 'Ngày xác thực không hợp lệ' });

    try {
        // Lấy TaiKhoanId theo email
        const tk = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Tạo bảng ChuTro đúng schema nếu chưa tồn tại (BIT + DATETIME2(3))
        await pool.request().query(`
IF OBJECT_ID(N'dbo.ChuTro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChuTro (
        ChuTroId BIGINT NOT NULL PRIMARY KEY,
        HoTen NVARCHAR(150) NOT NULL,
        SoDienThoai NVARCHAR(20) NULL,
        DiaChiLienHe NVARCHAR(255) NULL,
        DaXacThuc BIT NULL CONSTRAINT DF_ChuTro_DaXacThuc DEFAULT (0),
        NgayXacThuc DATETIME2(3) NULL
    );
END
        `);

        await pool.request()
            .input('ChuTroId', sql.BigInt, taiKhoanId)
            .input('HoTen', sql.NVarChar, (hoTen || '').toString()) // luôn non-null
            .input('SoDienThoai', sql.NVarChar, soDienThoai || null)
            .input('DiaChiLienHe', sql.NVarChar, diaChiLienHe || null)
            .input('DaXacThuc', sql.Bit, !!daXacThuc)
            .input('NgayXacThuc', sql.DateTime2, ngayXacThuc || null)
            .input('SetVerifiedAtNow', sql.Bit, setVerifiedAtNow ? 1 : 0)
            .query(`
MERGE dbo.ChuTro AS target
USING (SELECT @ChuTroId AS ChuTroId) AS src
ON (target.ChuTroId = src.ChuTroId)
WHEN MATCHED THEN
    UPDATE SET HoTen = @HoTen,
               SoDienThoai = @SoDienThoai,
               DiaChiLienHe = @DiaChiLienHe,
               DaXacThuc = @DaXacThuc,
               NgayXacThuc = CASE WHEN @SetVerifiedAtNow = 1 THEN SYSDATETIME() ELSE @NgayXacThuc END
WHEN NOT MATCHED THEN
    INSERT (ChuTroId, HoTen, SoDienThoai, DiaChiLienHe, DaXacThuc, NgayXacThuc)
    VALUES (@ChuTroId, @HoTen, @SoDienThoai, @DiaChiLienHe, @DaXacThuc, @NgayXacThuc);
            `);

        res.json({ success: true, message: 'Cập nhật hồ sơ chủ trọ thành công' });
    } catch (err) {
        console.error('❌ Lỗi cập nhật hồ sơ chủ trọ:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API hồ sơ chủ trọ (GET) ------------------
app.get('/api/chutro/profile', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });

    try {
        const rs = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`
                SELECT tk.TaiKhoanId, tk.Email,
                       ct.ChuTroId, ct.HoTen, ct.SoDienThoai, ct.DiaChiLienHe, ct.DaXacThuc, ct.NgayXacThuc
                FROM dbo.TaiKhoan tk
                LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = tk.TaiKhoanId
                WHERE tk.Email = @Email
            `);

        if (rs.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }

        const r = rs.recordset[0];
        // DaXacThuc (bit) sẽ được mssql map về boolean
        res.json({
            success: true,
            data: {
                Email: r.Email,
                HoTen: r.HoTen || '',
                SoDienThoai: r.SoDienThoai || '',
                DiaChiLienHe: r.DiaChiLienHe || '',
                DaXacThuc: r.DaXacThuc ?? false,
                NgayXacThuc: r.NgayXacThuc || null
            }
        });
    } catch (err) {
        console.error('❌ Lỗi lấy hồ sơ chủ trọ:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Chủ trọ - kiểm tra trạng thái xác thực ------------------
app.get('/api/chutro/verify-status', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        const ct = await pool.request().input('Id', sql.BigInt, taiKhoanId)
            .query(`SELECT DaXacThuc, NgayXacThuc FROM dbo.ChuTro WHERE ChuTroId = @Id`);
        const verified = ct.recordset.length ? !!ct.recordset[0].DaXacThuc : false;
        const verifiedAt = ct.recordset.length ? ct.recordset[0].NgayXacThuc : null;

        const lastReq = await pool.request().input('Id', sql.BigInt, taiKhoanId).query(`
            SELECT TOP (1) XacThucId, LoaiGiayTo, TrangThai, NgayNop, DuongDanTep
            FROM dbo.YeuCauXacThucChuTro
            WHERE ChuTroId = @Id
            ORDER BY XacThucId DESC
        `);

        const last = lastReq.recordset[0] || null;
        if (last) {
            last.ImageUrl = last.DuongDanTep || `/api/admin/verify-requests/${last.XacThucId}/image`;
        }

        res.json({
            success: true,
            data: {
                verified,
                verifiedAt,
                lastRequest: last
            }
        });
    } catch (err) {
        console.error('❌ verify-status:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Chủ trọ - gửi yêu cầu xác thực ------------------
app.post('/api/chutro/verify-request', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const { email, loaiGiayTo, fileBase64 } = req.body || {};
    if (!email || !loaiGiayTo || !fileBase64) {
        return res.status(400).json({ success: false, message: 'Thiếu email/loại giấy tờ/tệp' });
    }
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Chuẩn hóa base64, lấy mime/đuôi tệp
        const raw64 = String(fileBase64);
        const headerMatch = raw64.match(/^data:([^;,]+).*;base64,/i);
        const mimeHeader = (headerMatch?.[1] || '').toLowerCase();
        const clean64 = raw64.replace(/^data:.*;base64,/, '');
        let buf;
        try { buf = Buffer.from(clean64, 'base64'); } catch { return res.status(400).json({ success: false, message: 'Tệp không hợp lệ' }); }
        if (!buf || buf.length === 0) return res.status(400).json({ success: false, message: 'Tệp rỗng' });
        if (buf.length > 100 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Ảnh quá lớn (tối đa 100MB)' });

        // Chỉ chấp nhận ảnh JPG/PNG. Kiểm tra MIME header và magic bytes.
        const isJpegMagic = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPngMagic = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
        const extFromHeader = /image\/jpeg/.test(mimeHeader) ? 'jpg' : (/image\/png/.test(mimeHeader) ? 'png' : null);
        const extFromMagic = isJpegMagic ? 'jpg' : (isPngMagic ? 'png' : null);
        const finalExt = extFromHeader || extFromMagic;
        if (!finalExt) {
            return res.status(400).json({ success: false, message: 'Chỉ chấp nhận ảnh JPG/PNG' });
        }

        // Ghi file ra đĩa và lưu đường dẫn
        const dir = path.join(__dirname, 'uploads', 'verify');
        await fs.promises.mkdir(dir, { recursive: true });
        const filename = `${taiKhoanId}-${Date.now()}.${finalExt}`;
        const absPath = path.join(dir, filename);
        await fs.promises.writeFile(absPath, buf);
        const relPath = `/uploads/verify/${filename}`;

        // Đảm bảo bản ghi ChuTro tồn tại
        await pool.request()
            .input('Id', sql.BigInt, taiKhoanId)
            .query(`
IF NOT EXISTS (SELECT 1 FROM dbo.ChuTro WHERE ChuTroId = @Id)
BEGIN
    INSERT INTO dbo.ChuTro (ChuTroId, HoTen, DaXacThuc) VALUES (@Id, N'', 0);
END
        `);

        // Lưu yêu cầu + đường dẫn file + ngày nộp, cập nhật trạng thái chủ trọ
        const req1 = pool.request();
        req1.input('Id', sql.BigInt, taiKhoanId);
        req1.input('Loai', sql.NVarChar, loaiGiayTo.toString().slice(0, 100));
        req1.input('Anh', sql.VarBinary(sql.MAX), buf);
        req1.input('Path', sql.NVarChar, relPath);
        await req1.query(`
INSERT INTO dbo.YeuCauXacThucChuTro (ChuTroId, LoaiGiayTo, AnhMinhChung, TrangThai, DuyetBoi, NgayNop, DuongDanTep)
VALUES (@Id, @Loai, @Anh, 0, NULL, SYSDATETIME(), @Path);

UPDATE dbo.ChuTro
SET DaXacThuc = 0,
    NgayXacThuc = NULL
WHERE ChuTroId = @Id;
        `);

        res.json({ success: true, message: 'Đã gửi yêu cầu xác thực. Vui lòng chờ Admin duyệt.' });
    } catch (err) {
        console.error('❌ verify-request:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ ADMIN APIs ------------------

// List landlord verification requests (status: 0=pending, 1=approved, 2=rejected)
app.get('/api/admin/verify-requests', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const status = Number.parseInt(req.query.status ?? '0', 10);
    try {
        const rs = await pool.request()
            .input('Status', sql.TinyInt, Number.isNaN(status) ? 0 : status)
            .query(`
                SELECT 
                    x.XacThucId,
                    x.ChuTroId,
                    x.LoaiGiayTo,
                    x.TrangThai,
                    x.DuyetBoi,
                    x.NgayNop,
                    x.DuongDanTep,
                    COALESCE(x.DuongDanTep, CONCAT('/api/admin/verify-requests/', x.XacThucId, '/image')) AS ImageUrl,
                    ct.HoTen,
                    ct.DiaChiLienHe,
                    ct.DaXacThuc,
                    ct.NgayXacThuc,
                    tk.Email AS ChuTroEmail
                FROM dbo.YeuCauXacThucChuTro AS x
                JOIN dbo.ChuTro AS ct ON ct.ChuTroId = x.ChuTroId
                JOIN dbo.TaiKhoan AS tk ON tk.TaiKhoanId = x.ChuTroId
                WHERE x.TrangThai = @Status
                ORDER BY x.XacThucId DESC
            `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ Lỗi list verify-requests:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Helper: resolve admin id by email or fallback to first Admin role
async function getAdminId(adminEmail) {
    const q = adminEmail
        ? `
            SELECT TaiKhoanId FROM dbo.TaiKhoan
            WHERE Email = @Email
          `
        : `
            SELECT TOP (1) tk.TaiKhoanId
            FROM dbo.TaiKhoan tk
            JOIN dbo.VaiTro vt ON vt.VaiTroId = tk.VaiTroId
            WHERE vt.TenVaiTro = N'Admin'
            ORDER BY tk.TaiKhoanId
          `;
    const req = pool.request();
    if (adminEmail) req.input('Email', sql.NVarChar, adminEmail);
    const rs = await req.query(q);
    return rs.recordset[0]?.TaiKhoanId || null;
}

// Approve landlord verification
app.post('/api/admin/verify-requests/:id/approve', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const id = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(400).json({ success: false, message: 'Không xác định được admin' });

        const getReq = await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`SELECT XacThucId, ChuTroId, TrangThai FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id`);
        if (getReq.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

        const chuTroId = getReq.recordset[0].ChuTroId;

        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('AdminId', sql.BigInt, adminId)
            .query(`
                UPDATE dbo.YeuCauXacThucChuTro
                SET TrangThai = 1, DuyetBoi = @AdminId
                WHERE XacThucId = @Id;

                UPDATE dbo.ChuTro
                SET DaXacThuc = 1, NgayXacThuc = SYSDATETIME()
                WHERE ChuTroId = (SELECT ChuTroId FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id);
            `);

        // Gửi thông báo tới chủ trọ
        await pool.request()
            .input('ChuTroId', sql.BigInt, chuTroId)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@ChuTroId, N'XacThuc', N'Kết quả xác thực', N'Yêu cầu xác thực đã được phê duyệt.', 0);
            `);

        res.json({ success: true, message: 'Đã phê duyệt' });
    } catch (err) {
        console.error('❌ Approve verify error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Reject landlord verification
app.post('/api/admin/verify-requests/:id/reject', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const id = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    const reason = (req.body?.reason || 'Hồ sơ chưa hợp lệ.').toString().slice(0, 500);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(400).json({ success: false, message: 'Không xác định được admin' });

        const getReq = await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`SELECT XacThucId, ChuTroId, TrangThai FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id`);
        if (getReq.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

        const chuTroId = getReq.recordset[0].ChuTroId;

        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('AdminId', sql.BigInt, adminId)
            .query(`
                UPDATE dbo.YeuCauXacThucChuTro
                SET TrangThai = 2, DuyetBoi = @AdminId
                WHERE XacThucId = @Id;

                UPDATE dbo.ChuTro
                SET DaXacThuc = 0, NgayXacThuc = NULL
                WHERE ChuTroId = (SELECT ChuTroId FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id);
            `);

        // Gửi thông báo tới chủ trọ
        await pool.request()
            .input('ChuTroId', sql.BigInt, chuTroId)
            .input('Msg', sql.NVarChar, reason)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@ChuTroId, N'XacThuc', N'Kết quả xác thực', @Msg, 0);
            `);

        res.json({ success: true, message: 'Đã từ chối' });
    } catch (err) {
        console.error('❌ Reject verify error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// List accounts (role: all|student|landlord)
app.get('/api/admin/accounts', async (req, res) => {
    if (!checkPool(res)) return;
    const role = (req.query.role || 'all').toLowerCase();
    try {
        let where = '';
        if (role === 'student') where = 'WHERE vt.TenVaiTro = N\'Sinh Viên\'';
        else if (role === 'landlord') where = 'WHERE vt.TenVaiTro = N\'Chủ Trọ\'';

        const rs = await pool.request().query(`
            SELECT tk.TaiKhoanId, tk.Email, tk.TrangThai, vt.TenVaiTro,
                   sv.HoTen AS SV_HoTen, sv.Truong, sv.SoDienThoai AS SV_SDT,
                   ct.HoTen AS CT_HoTen,
                   /* Verified logic: true nếu ct.DaXacThuc = 1 HOẶC đã có yêu cầu được duyệt */
                   CAST(CASE WHEN ISNULL(ct.DaXacThuc, 0) = 1 OR EXISTS (
                        SELECT 1 FROM dbo.YeuCauXacThucChuTro x
                        WHERE x.ChuTroId = ct.ChuTroId AND x.TrangThai = 1
                   ) THEN 1 ELSE 0 END AS BIT) AS DaXacThuc,
                   ct.SoDienThoai AS CT_SDT
            FROM dbo.TaiKhoan tk
            JOIN dbo.VaiTro vt ON vt.VaiTroId = tk.VaiTroId
            LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = tk.TaiKhoanId
            LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = tk.TaiKhoanId
            ${where}
            ORDER BY tk.TaiKhoanId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ Lỗi list accounts:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Ban account
app.post('/api/admin/accounts/:id/ban', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const reason = (req.body?.reason || 'Tài khoản vi phạm.').toString().slice(0, 500);
    try {
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`UPDATE dbo.TaiKhoan SET TrangThai = 2 WHERE TaiKhoanId = @Id`);
        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('Msg', sql.NVarChar, reason)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@Id, N'Ban', N'Tài khoản bị khóa', @Msg, 0);
            `);
        res.json({ success: true, message: 'Đã khóa tài khoản' });
    } catch (err) {
        console.error('❌ Ban account error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Unban account
app.post('/api/admin/accounts/:id/unban', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    try {
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`UPDATE dbo.TaiKhoan SET TrangThai = 1 WHERE TaiKhoanId = @Id`);
        // Gửi thông báo mở khóa tới tài khoản
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@Id, N'Unban', N'Tài khoản đã mở khóa', N'Tài khoản của bạn đã được mở khóa.', 0);
            `);
        res.json({ success: true, message: 'Đã mở khóa tài khoản' });
    } catch (err) {
        console.error('❌ Unban account error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Tiện ích: danh sách ------------------
app.get('/api/tienich', async (req, res) => {
    if (!checkPool(res)) return;
    try {
        // Nếu bảng không tồn tại, trả về mảng rỗng để UI vẫn hiển thị
        const exist = await pool.request().query(`SELECT CASE WHEN OBJECT_ID(N'dbo.TienIch','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTI`);
        if (!exist.recordset[0]?.HasTI) {
            return res.json({ success: true, data: [] });
        }
        const rs = await pool.request().query(`
            SELECT TienIchId, TenTienIch, MoTa
            FROM dbo.TienIch
            ORDER BY TenTienIch
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/tienich:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: danh sách theo chủ trọ ------------------
app.get('/api/chutro/rooms', async (req, res) => {
    if (!checkPool(res)) return;
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        // Kiểm tra bảng tiện ích có tồn tại không
        const tiMeta = await pool.request().query(`
            SELECT CASE WHEN OBJECT_ID(N'dbo.TienIch','U') IS NOT NULL AND OBJECT_ID(N'dbo.Phong_TienIch','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTI;
        `);
        const hasTI = !!(tiMeta.recordset[0]?.HasTI);
        const tiSelect = hasTI
            ? `STUFF((
                    SELECT N', ' + ti.TenTienIch
                    FROM dbo.Phong_TienIch pti
                    JOIN dbo.TienIch ti ON ti.TienIchId = pti.TienIchId
                    WHERE pti.PhongId = p.PhongId
                    FOR XML PATH(N''), TYPE
               ).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') AS TienIch`
            : `CAST(NULL AS NVARCHAR(MAX)) AS TienIch`;

        // Tra cứu cột Phong để tránh select các cột không tồn tại (ví dụ: DiaChi, LinkMap)
        const metaPhong = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Phong'
        `);
        const pcols = new Set(metaPhong.recordset.map(r => r.COLUMN_NAME));
        const diaChiExpr = pcols.has('DiaChi') ? 'p.DiaChi' : `CAST(NULL AS NVARCHAR(255)) AS DiaChi`;
        const linkMapExpr = pcols.has('LinkMap') ? 'p.LinkMap' : `CAST(NULL AS NVARCHAR(255)) AS LinkMap`;

        const q = `
            SELECT 
                p.PhongId, p.TieuDe, p.TrangThai, p.GiaCoBan, ${diaChiExpr}, ${linkMapExpr},
                ${tiSelect},
                hd.HopDongId AS HopDongIdHienTai,
                sv.HoTen AS TenantHoTen,
                tkSV.Email AS TenantEmail,
                CASE WHEN hd.HopDongId IS NOT NULL THEN 1 ELSE 0 END AS DaCoNguoiThue
            FROM dbo.Phong AS p
            LEFT JOIN dbo.HopDong hd ON hd.PhongId = p.PhongId AND hd.TrangThai = 0
            LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = hd.SinhVienId
            LEFT JOIN dbo.TaiKhoan tkSV ON tkSV.TaiKhoanId = hd.SinhVienId
            WHERE p.ChuTroId = @Id
            ORDER BY p.PhongId DESC`;
        const rs = await pool.request().input('Id', sql.BigInt, chuTroId).query(q);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/chutro/rooms:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: chi tiết theo PhongId (của chủ trọ) ------------------
app.get('/api/chutro/rooms/:id', async (req, res) => {
    if (!checkPool(res)) return;
    const roomId = Number.parseInt(req.params.id, 10);
    const email = (req.query.email || '').trim();
    if (!Number.isInteger(roomId) || roomId <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        const own = await pool.request().input('Id', sql.BigInt, roomId).input('Chu', sql.BigInt, chuTroId)
            .query(`SELECT 1 FROM dbo.Phong WHERE PhongId = @Id AND ChuTroId = @Chu`);
        if (!own.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng của bạn' });

        const meta = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Phong'
        `);
        const c = new Set(meta.recordset.map(r => r.COLUMN_NAME));
        const selectCols = [
            'p.PhongId',
            c.has('TieuDe') ? 'p.TieuDe' : `CAST(NULL AS NVARCHAR(150)) AS TieuDe`,
            c.has('MoTa') ? 'p.MoTa' : `CAST(NULL AS NVARCHAR(MAX)) AS MoTa`,
            c.has('GiaCoBan') ? 'p.GiaCoBan' : `CAST(NULL AS DECIMAL(12,2)) AS GiaCoBan`,
            c.has('DienTichM2') ? 'p.DienTichM2' : `CAST(NULL AS DECIMAL(12,2)) AS DienTichM2`,
            c.has('SoNguoiToiDa') ? 'p.SoNguoiToiDa' : `CAST(NULL AS INT) AS SoNguoiToiDa`,
            c.has('LinkMap') ? 'p.LinkMap' : `CAST(NULL AS NVARCHAR(255)) AS LinkMap`,
            c.has('DiaChi') ? 'p.DiaChi' : `CAST(NULL AS NVARCHAR(255)) AS DiaChi`,
            c.has('PhuongXa') ? 'p.PhuongXa' : `CAST(NULL AS NVARCHAR(100)) AS PhuongXa`,
            c.has('QuanHuyen') ? 'p.QuanHuyen' : `CAST(NULL AS NVARCHAR(100)) AS QuanHuyen`,
            c.has('ThanhPho') ? 'p.ThanhPho' : `CAST(NULL AS NVARCHAR(100)) AS ThanhPho`
        ];
        const q = `SELECT ${selectCols.join(', ')} FROM dbo.Phong p WHERE p.PhongId = @Id`;
        const rs = await pool.request().input('Id', sql.BigInt, roomId).query(q);

        // Thêm danh sách tiện ích (IDs) nếu bảng tồn tại
        let tiIds = [];
        try {
            const ex = await pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.TienIch','U') IS NOT NULL AND OBJECT_ID(N'dbo.Phong_TienIch','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTI");
            if (ex.recordset[0]?.HasTI) {
                const rsTi = await pool.request().input('Id', sql.BigInt, roomId)
                    .query('SELECT TienIchId FROM dbo.Phong_TienIch WHERE PhongId = @Id');
                tiIds = rsTi.recordset.map(r => r.TienIchId);
            }
        } catch {}

        const data = rs.recordset[0];
        if (data) data.TienIchIds = tiIds;
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ GET /api/chutro/rooms/:id:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: cập nhật theo PhongId (của chủ trọ) ------------------
app.put('/api/chutro/rooms/:id', async (req, res) => {
    if (!checkPool(res)) return;
    const roomId = Number.parseInt(req.params.id, 10);
    const b = req.body || {};
    const email = (b.email || '').trim();
    if (!Number.isInteger(roomId) || roomId <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        const own = await pool.request().input('Id', sql.BigInt, roomId).input('Chu', sql.BigInt, chuTroId)
            .query(`SELECT 1 FROM dbo.Phong WHERE PhongId = @Id AND ChuTroId = @Chu`);
        if (!own.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng của bạn' });

        const meta = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Phong'
        `);
        const c = new Set(meta.recordset.map(r => r.COLUMN_NAME));

        const fields = [];
        const reqUp = pool.request().input('Id', sql.BigInt, roomId);
        const add = (col, param, type, val) => { fields.push(`${col} = ${param}`); reqUp.input(param.slice(1), type, val); };

        if (b.tieuDe != null && c.has('TieuDe')) add('TieuDe', '@TieuDe', sql.NVarChar, String(b.tieuDe).slice(0,150));
        if (b.moTa != null && c.has('MoTa')) add('MoTa', '@MoTa', sql.NVarChar(sql.MAX), String(b.moTa));
        if (b.giaCoBan != null && c.has('GiaCoBan')) add('GiaCoBan', '@GiaCoBan', sql.Decimal(12,2), Number(b.giaCoBan));
        if (b.dienTichM2 != null && c.has('DienTichM2')) add('DienTichM2', '@DienTichM2', sql.Decimal(12,2), Number(b.dienTichM2));
        if (b.soNguoiToiDa != null && c.has('SoNguoiToiDa')) add('SoNguoiToiDa', '@SoNguoiToiDa', sql.Int, Number(b.soNguoiToiDa));
        const linkMap = (b.mapUrl || b.linkMap || b.LinkMap);
        if (linkMap != null && c.has('LinkMap')) add('LinkMap', '@LinkMap', sql.NVarChar, String(linkMap).slice(0,255));
        if (b.diaChi != null && c.has('DiaChi')) add('DiaChi', '@DiaChi', sql.NVarChar, String(b.diaChi).slice(0,255));
        if (b.phuongXa != null && c.has('PhuongXa')) add('PhuongXa', '@PhuongXa', sql.NVarChar, String(b.phuongXa).slice(0,100));
        if (b.quanHuyen != null && c.has('QuanHuyen')) add('QuanHuyen', '@QuanHuyen', sql.NVarChar, String(b.quanHuyen).slice(0,100));
        if (b.thanhPho != null && c.has('ThanhPho')) add('ThanhPho', '@ThanhPho', sql.NVarChar, String(b.thanhPho).slice(0,100));

        if (!fields.length) return res.status(400).json({ success: false, message: 'Không có trường nào để cập nhật' });

        const upSql = `UPDATE dbo.Phong SET ${fields.join(', ')} WHERE PhongId = @Id;`;
        await reqUp.query(upSql);

        // Cập nhật tiện ích nếu được gửi lên
        const tiList = Array.isArray(b.tienIchIds) ? b.tienIchIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : null;
        if (tiList) {
            // Tạo bảng nếu chưa có
            await pool.request().query(`
IF OBJECT_ID(N'dbo.Phong_TienIch', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Phong_TienIch(
        PhongId BIGINT NOT NULL,
        TienIchId INT NOT NULL
    );
    CREATE INDEX IX_Phong_TienIch_Phong ON dbo.Phong_TienIch(PhongId);
END`);
            // Xóa tiện ích cũ và chèn mới
            await pool.request().input('Id', sql.BigInt, roomId).query('DELETE FROM dbo.Phong_TienIch WHERE PhongId = @Id');
            for (const id of tiList) {
                await pool.request().input('Pid', sql.BigInt, roomId).input('Tid', sql.Int, id)
                    .query('INSERT INTO dbo.Phong_TienIch (PhongId, TienIchId) VALUES (@Pid, @Tid)');
            }
        }

        // trả lại chi tiết mới
        const detail = await pool.request().input('Id', sql.BigInt, roomId).query(`SELECT TOP 1 * FROM dbo.Phong WHERE PhongId = @Id`);
        res.json({ success: true, message: 'Cập nhật phòng thành công', data: detail.recordset[0] });
    } catch (err) {
        console.error('❌ PUT /api/chutro/rooms/:id:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Ảnh phòng: xóa ảnh theo AnhPhongId (chủ trọ) ------------------
app.delete('/api/rooms/images/:imgId', async (req, res) => {
    if (!checkPool(res)) return;
    const imgId = Number.parseInt(req.params.imgId, 10);
    const email = (req.body?.email || req.query?.email || '').trim();
    if (!Number.isInteger(imgId) || imgId <= 0) return res.status(400).json({ success: false, message: 'Ảnh không hợp lệ' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const uid = tk.recordset[0].TaiKhoanId;

        const own = await pool.request().input('ImgId', sql.BigInt, imgId).input('Uid', sql.BigInt, uid).query(`
            SELECT 1
            FROM dbo.AnhPhong ap
            JOIN dbo.Phong p ON p.PhongId = ap.PhongId
            WHERE ap.AnhPhongId = @ImgId AND p.ChuTroId = @Uid
        `);
        if (!own.recordset.length) return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa ảnh này' });

        await pool.request().input('Id', sql.BigInt, imgId).query('DELETE FROM dbo.AnhPhong WHERE AnhPhongId = @Id');
        res.json({ success: true, message: 'Đã xóa ảnh' });
    } catch (err) {
        console.error('❌ DELETE /api/rooms/images/:imgId:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: tạo mới ------------------
app.post('/api/chutro/rooms', async (req, res) => {
    if (!checkPool(res)) return;

    const b = req.body || {};
    const email = (b.email || '').trim();
    const tieuDe = (b.tieuDe || '').toString().slice(0, 150);
    const moTa = (b.moTa ?? '').toString();
    const diaChi = (b.diaChi || '').toString().slice(0, 255); // có thể rỗng
    const phuongXa = (b.phuongXa || '').toString().slice(0, 100) || null;
    const quanHuyen = (b.quanHuyen || '').toString().slice(0, 100) || null;
    const thanhPho = (b.thanhPho || '').toString().slice(0, 100) || null;
    const dienTichM2 = (b.dienTichM2 == null || b.dienTichM2 === '') ? null : Number(b.dienTichM2);
    const giaCoBan = (b.giaCoBan == null || b.giaCoBan === '') ? null : Number(b.giaCoBan);
    const soNguoiToiDa = (b.soNguoiToiDa == null || b.soNguoiToiDa === '') ? null : Number(b.soNguoiToiDa);
    const tienIchIds = Array.isArray(b.tienIchIds) ? b.tienIchIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    const linkMap = (b.mapUrl || b.linkMap || b.LinkMap || '').toString().slice(0, 255) || null;

    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    // BỎ YÊU CẦU địa chỉ: chỉ còn tiêu đề + giá
    if (!tieuDe || giaCoBan == null) {
        return res.status(400).json({ success: false, message: 'Thiếu Tiêu đề/Giá cơ bản' });
    }

    try {
        // Lấy chủ trọ id
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        // Đảm bảo ChuTro tồn tại
        await pool.request()
            .input('Id', sql.BigInt, chuTroId)
            .query(`
IF NOT EXISTS (SELECT 1 FROM dbo.ChuTro WHERE ChuTroId = @Id)
BEGIN
    INSERT INTO dbo.ChuTro (ChuTroId, HoTen, DaXacThuc) VALUES (@Id, N'', 0);
END
            `);

        // Lấy địa chỉ liên hệ để làm mặc định nếu người dùng không nhập
        const ctInfo = await pool.request()
            .input('Id', sql.BigInt, chuTroId)
            .query(`SELECT DiaChiLienHe FROM dbo.ChuTro WHERE ChuTroId = @Id`);
        const diaChiSave = (diaChi && diaChi.trim()) ? diaChi : (ctInfo.recordset[0]?.DiaChiLienHe || 'Chưa cập nhật');

        // Tra cứu cột tồn tại để build INSERT tương thích các schema khác nhau
        const meta = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Phong'
        `);
        const cols = new Set(meta.recordset.map(r => r.COLUMN_NAME));

        const insertCols = ['ChuTroId', 'TieuDe'];
        const insertVals = ['@ChuTroId', '@TieuDe'];
        const reqIns = pool.request();
        reqIns.input('ChuTroId', sql.BigInt, chuTroId);
        reqIns.input('TieuDe', sql.NVarChar, tieuDe);

        // Tùy cột có trong DB mà thêm
        if (cols.has('MoTa')) { insertCols.push('MoTa'); insertVals.push('@MoTa'); reqIns.input('MoTa', sql.NVarChar(sql.MAX), moTa || null); }
        if (cols.has('DiaChi')) { insertCols.push('DiaChi'); insertVals.push('@DiaChi'); reqIns.input('DiaChi', sql.NVarChar, diaChiSave); }
        if (cols.has('PhuongXa')) { insertCols.push('PhuongXa'); insertVals.push('@PhuongXa'); reqIns.input('PhuongXa', sql.NVarChar, phuongXa); }
        if (cols.has('QuanHuyen')) { insertCols.push('QuanHuyen'); insertVals.push('@QuanHuyen'); reqIns.input('QuanHuyen', sql.NVarChar, quanHuyen); }
        if (cols.has('ThanhPho')) { insertCols.push('ThanhPho'); insertVals.push('@ThanhPho'); reqIns.input('ThanhPho', sql.NVarChar, thanhPho); }
        if (cols.has('LinkMap')) { insertCols.push('LinkMap'); insertVals.push('@LinkMap'); reqIns.input('LinkMap', sql.NVarChar, linkMap); }
        if (cols.has('DienTichM2')) { insertCols.push('DienTichM2'); insertVals.push('@DienTichM2'); reqIns.input('DienTichM2', sql.Decimal(12, 2), dienTichM2); }
        if (cols.has('GiaCoBan')) { insertCols.push('GiaCoBan'); insertVals.push('@GiaCoBan'); reqIns.input('GiaCoBan', sql.Decimal(12, 2), giaCoBan); }
        if (cols.has('SoNguoiToiDa')) { insertCols.push('SoNguoiToiDa'); insertVals.push('@SoNguoiToiDa'); reqIns.input('SoNguoiToiDa', sql.Int, soNguoiToiDa); }
        if (cols.has('TrangThai')) { insertCols.push('TrangThai'); insertVals.push('0'); } // mặc định trống

        const insSql = `
            INSERT INTO dbo.Phong (${insertCols.join(', ')})
            OUTPUT INSERTED.PhongId
            VALUES (${insertVals.join(', ')});
        `;
        const ins = await reqIns.query(insSql);
        const phongId = ins.recordset[0]?.PhongId;

        // Bảng tiện ích (nếu có id được gửi)
        let tiNames = [];
        if (phongId && tienIchIds.length) {
            // Tạo bảng liên kết nếu chưa có (an toàn)
            await pool.request().query(`
IF OBJECT_ID(N'dbo.Phong_TienIch', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Phong_TienIch(
        PhongId BIGINT NOT NULL,
        TienIchId INT NOT NULL
    );
    CREATE INDEX IX_Phong_TienIch_Phong ON dbo.Phong_TienIch(PhongId);
END`);

            // Chèn các tiện ích
            for (const id of tienIchIds) {
                await pool.request()
                    .input('PhongId', sql.BigInt, phongId)
                    .input('TienIchId', sql.Int, id)
                    .query('INSERT INTO dbo.Phong_TienIch (PhongId, TienIchId) VALUES (@PhongId, @TienIchId)');
            }
            // Lấy tên tiện ích vừa gán
            const inList = tienIchIds.map(n => Number(n)).filter(n => Number.isFinite(n));
            if (inList.length) {
                const rsTi = await pool.request().query(`SELECT TenTienIch FROM dbo.TienIch WHERE TienIchId IN (${inList.join(',')})`);
                tiNames = rsTi.recordset.map(r => r.TenTienIch);
            }
        }

        res.status(201).json({ success: true, message: 'Tạo phòng thành công', data: { PhongId: phongId, TienIch: tiNames } });
    } catch (err) {
        console.error('❌ POST /api/chutro/rooms:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Ảnh phòng: danh sách theo PhongId ------------------
app.get('/api/rooms/:id/images', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    try {
        await ensureAnhPhongSchema();
        const rs = await pool.request().input('Id', sql.BigInt, id).query(`
            SELECT AnhPhongId
            FROM dbo.AnhPhong
            WHERE PhongId = @Id
            ORDER BY AnhPhongId DESC
        `);
        const data = rs.recordset.map(r => ({
            id: r.AnhPhongId,
            url: `/api/rooms/images/${r.AnhPhongId}`
        }));
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ GET /api/rooms/:id/images:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Ảnh phòng: tải nhiều ảnh lên ------------------
app.post('/api/rooms/:id/images', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const filesBase64 = Array.isArray(req.body?.filesBase64) ? req.body.filesBase64 : [];
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    if (!filesBase64.length) return res.status(400).json({ success: false, message: 'Thiếu danh sách ảnh' });

    try {
        await ensureAnhPhongSchema();

        // Kiểm tra phòng có tồn tại
        const p = await pool.request().input('Id', sql.BigInt, id).query(`SELECT 1 FROM dbo.Phong WHERE PhongId = @Id`);
        if (!p.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });

        // Parse và chèn từng ảnh
        const maxPerImage = 15 * 1024 * 1024; // 15MB/ảnh
        const inserted = [];
        for (const raw of filesBase64) {
            const s = String(raw || '');
            const clean = s.replace(/^data:.*;base64,/, '');
            let buf;
            try { buf = Buffer.from(clean, 'base64'); } catch { continue; }
            if (!buf || buf.length === 0 || buf.length > maxPerImage) continue;

            // Magic bytes JPG/PNG
            const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
            const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
            if (!isJpeg && !isPng) continue;

            const q = await pool.request()
                .input('Pid', sql.BigInt, id)
                .input('Anh', sql.VarBinary(sql.MAX), buf)
                .query(`
                    INSERT INTO dbo.AnhPhong (PhongId, Anh)
                    OUTPUT INSERTED.AnhPhongId
                    VALUES (@Pid, @Anh)
                `);
            const newId = q.recordset[0]?.AnhPhongId;
            if (newId) inserted.push({ id: newId, url: `/api/rooms/images/${newId}` });
        }

        if (!inserted.length) return res.status(400).json({ success: false, message: 'Không có ảnh hợp lệ để tải lên' });
        res.status(201).json({ success: true, data: inserted });
    } catch (err) {
        console.error('❌ POST /api/rooms/:id/images:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Ảnh phòng: stream ảnh theo AnhPhongId ------------------
app.get('/api/rooms/images/:imgId', async (req, res) => {
    if (!checkPool(res)) return;
    const imgId = Number.parseInt(req.params.imgId, 10);
    if (!Number.isInteger(imgId) || imgId <= 0) return res.status(400).json({ success: false, message: 'Ảnh không hợp lệ' });
    try {
        const rs = await pool.request().input('Id', sql.BigInt, imgId)
            .query(`SELECT TOP (1) Anh FROM dbo.AnhPhong WHERE AnhPhongId = @Id`);
        if (!rs.recordset.length) return res.status(404).send('Not Found');
        const buf = rs.recordset[0].Anh;
        if (!Buffer.isBuffer(buf)) return res.status(500).send('Invalid data');

        // Đoán content-type
        const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
        const mime = isJpeg ? 'image/jpeg' : (isPng ? 'image/png' : 'application/octet-stream');

        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.end(buf);
    } catch (err) {
        console.error('❌ GET /api/rooms/images/:imgId:', err.message || err);
        res.status(500).send('Server error');
    }
});

// ------------------ Sinh viên: tìm chủ trọ theo địa chỉ ------------------
app.get('/api/search/landlords', async (req, res) => {
    if (!checkPool(res)) return;
    const q = (req.query.query || '').toString().trim();
    if (!q) return res.status(400).json({ success: false, message: 'Thiếu từ khóa' });
    try {
        const like = `%${q}%`;
        const rs = await pool.request()
            .input('Like', sql.NVarChar, like)
            .query(`
SELECT
    ct.ChuTroId,
    ct.HoTen,
    tk.Email,
    ct.SoDienThoai,
    ct.DiaChiLienHe,
    /* Trả về BIT để client nhận boolean */
    CAST(CASE WHEN ct.DaXacThuc = 1 OR EXISTS (
        SELECT 1 FROM dbo.YeuCauXacThucChuTro x
        WHERE x.ChuTroId = ct.ChuTroId AND x.TrangThai = 1
    ) THEN 1 ELSE 0 END AS BIT) AS DaXacThuc,
    /* Thêm số phòng và số phòng trống cho UI sinhvien.js */
    (SELECT COUNT(*) FROM dbo.Phong p WHERE p.ChuTroId = ct.ChuTroId) AS SoPhong,
    (SELECT COUNT(*) FROM dbo.Phong p
       WHERE p.ChuTroId = ct.ChuTroId
         AND NOT EXISTS (
             SELECT 1 FROM dbo.HopDong h
             WHERE h.PhongId = p.PhongId AND h.TrangThai = 0
         )
    ) AS SoPhongTrong
FROM dbo.ChuTro ct
JOIN dbo.TaiKhoan tk ON tk.TaiKhoanId = ct.ChuTroId
WHERE ct.DiaChiLienHe LIKE @Like
   OR ct.HoTen LIKE @Like
   OR tk.Email LIKE @Like
ORDER BY ct.HoTen
            `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/search/landlords:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Sinh viên: xem phòng theo chủ trọ ------------------
app.get('/api/landlords/:id/rooms', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'ChuTroId không hợp lệ' });
    try {
        // Thông tin chủ trọ (+ verified hợp lệ, kiểu BIT)
        const ct = await pool.request().input('Id', sql.BigInt, id).query(`
SELECT ct.ChuTroId, ct.HoTen, tk.Email, ct.SoDienThoai, ct.DiaChiLienHe,
       CAST(CASE WHEN ct.DaXacThuc = 1 OR EXISTS (
           SELECT 1 FROM dbo.YeuCauXacThucChuTro x WHERE x.ChuTroId = ct.ChuTroId AND x.TrangThai = 1
       ) THEN 1 ELSE 0 END AS BIT) AS DaXacThuc
FROM dbo.ChuTro ct
JOIN dbo.TaiKhoan tk ON tk.TaiKhoanId = ct.ChuTroId
WHERE ct.ChuTroId = @Id
        `);
        if (!ct.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy chủ trọ' });

        // Kiểm tra bảng tiện ích tồn tại để tránh lỗi khi DB chưa có
        const tiMeta2 = await pool.request().query(`
            SELECT CASE WHEN OBJECT_ID(N'dbo.TienIch','U') IS NOT NULL AND OBJECT_ID(N'dbo.Phong_TienIch','U') IS NOT NULL THEN 1 ELSE 0 END AS HasTI;
        `);
        const hasTI2 = !!(tiMeta2.recordset[0]?.HasTI);
        const tiSelect2 = hasTI2
            ? `STUFF((
                    SELECT N', ' + ti.TenTienIch
                    FROM dbo.Phong_TienIch pti
                    JOIN dbo.TienIch ti ON ti.TienIchId = pti.TienIchId
                    WHERE pti.PhongId = p.PhongId
                    FOR XML PATH(N''), TYPE
               ).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') AS TienIch`
            : `CAST(NULL AS NVARCHAR(MAX)) AS TienIch`;

        // Tra cứu cột Phong để an toàn với các schema thiếu cột địa chỉ/LinkMap
        const metaPhong2 = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Phong'
        `);
        const pcols2 = new Set(metaPhong2.recordset.map(r => r.COLUMN_NAME));
        const diaChi2 = pcols2.has('DiaChi') ? 'p.DiaChi' : `CAST(NULL AS NVARCHAR(255)) AS DiaChi`;
        const phuongXa2 = pcols2.has('PhuongXa') ? 'p.PhuongXa' : `CAST(NULL AS NVARCHAR(100)) AS PhuongXa`;
        const quanHuyen2 = pcols2.has('QuanHuyen') ? 'p.QuanHuyen' : `CAST(NULL AS NVARCHAR(100)) AS QuanHuyen`;
        const thanhPho2 = pcols2.has('ThanhPho') ? 'p.ThanhPho' : `CAST(NULL AS NVARCHAR(100)) AS ThanhPho`;
        const linkMap2 = pcols2.has('LinkMap') ? 'p.LinkMap' : `CAST(NULL AS NVARCHAR(255)) AS LinkMap`;

        const roomsSql = `
SELECT
    p.PhongId,
    p.TieuDe,
    p.MoTa,
    ${diaChi2}, ${phuongXa2}, ${quanHuyen2}, ${thanhPho2},
    p.DienTichM2, p.GiaCoBan, p.SoNguoiToiDa,
    p.TrangThai,
    ${linkMap2},
    CASE WHEN EXISTS (
        SELECT 1 FROM dbo.HopDong h WHERE h.PhongId = p.PhongId AND h.TrangThai = 0
    ) THEN 1 ELSE 0 END AS DaCoNguoiThue,
    ${tiSelect2},
    STUFF((
        SELECT N',' + CONVERT(NVARCHAR(20), ap.AnhPhongId)
        FROM dbo.AnhPhong ap
        WHERE ap.PhongId = p.PhongId
        ORDER BY ap.AnhPhongId DESC
        FOR XML PATH(N''), TYPE
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') AS AnhList
FROM dbo.Phong p
WHERE p.ChuTroId = @Id
ORDER BY p.PhongId DESC`;
        const rooms = await pool.request().input('Id', sql.BigInt, id).query(roomsSql);

        // NEW: map CSV -> Images URLs (tối đa 8 ảnh) và loại bỏ AnhList
        const roomRows = (rooms.recordset || []).map(r => {
            const ids = String(r.AnhList || '').split(',').map(s => s.trim()).filter(Boolean);
            r.Images = ids.slice(0, 8).map(id => `/api/rooms/images/${id}`);
            delete r.AnhList;
            return r;
        });

        res.json({
            success: true,
            data: {
                landlord: ct.recordset[0],
                rooms: roomRows
            }
        });
    } catch (err) {
        console.error('❌ GET /api/landlords/:id/rooms:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Sinh viên: thuê phòng trọ (chỉ khi phòng đang trống)
app.post('/api/rooms/:id/rent', async (req, res) => {
    if (!checkPool(res)) return;
    const roomId = Number.parseInt(req.params.id, 10);
    const email = (req.body?.email || '').trim();
    if (!Number.isInteger(roomId) || roomId <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email sinh viên' });

    try {
        // Lấy thông tin phòng
        const r = await pool.request().input('Id', sql.BigInt, roomId).query(`
            SELECT PhongId, ChuTroId, GiaCoBan FROM dbo.Phong WHERE PhongId = @Id
        `);
        if (!r.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        const room = r.recordset[0];

        // Kiểm tra phòng đã có hợp đồng hiệu lực?
        const busy = await pool.request().input('Id', sql.BigInt, roomId).query(`
            SELECT 1 FROM dbo.HopDong WHERE PhongId = @Id AND TrangThai = 0
        `);
        if (busy.recordset.length) return res.status(409).json({ success: false, message: 'Phòng đã có người thuê' });

        // Lấy SinhVienId theo email
        const sv = await pool.request().input('Email', sql.NVarChar, email).query(`
            SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email
        `);
        if (!sv.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản sinh viên' });
        const sinhVienId = sv.recordset[0].TaiKhoanId;

        // Đảm bảo có bản ghi SinhVien (FK HopDong -> SinhVien)
        await ensureSinhVienBasic(sinhVienId);

        // Tạo hợp đồng + cập nhật trạng thái phòng trong 1 transaction
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const reqTx = new sql.Request(tx);
            reqTx.input('PhongId', sql.BigInt, roomId);
            reqTx.input('SinhVienId', sql.BigInt, sinhVienId);
            reqTx.input('ChuTroId', sql.BigInt, room.ChuTroId);
            reqTx.input('NgayBatDau', sql.Date, new Date());
            reqTx.input('Gia', sql.Decimal(12, 2), room.GiaCoBan);

            const ins = await reqTx.query(`
INSERT INTO dbo.HopDong (PhongId, SinhVienId, ChuTroId, NgayBatDau, NgayKetThuc, GiaThueThang, TienDien, TienNuoc, TienRac, TienMang, TrangThai)
OUTPUT INSERTED.HopDongId
VALUES (@PhongId, @SinhVienId, @ChuTroId, @NgayBatDau, NULL, @Gia, NULL, NULL, NULL, NULL, 0);

UPDATE dbo.Phong
SET TrangThai = 1 -- 1: đã có người thuê
WHERE PhongId = @PhongId;
            `);

            const hopDongId = ins.recordset[0]?.HopDongId;
            await tx.commit();

            // Gửi thông báo cho chủ trọ: phòng đã được thuê (tạo hợp đồng ngay)
            try {
                await pool.request()
                    .input('TaiKhoanId', sql.BigInt, room.ChuTroId)
                    .input('Loai', sql.NVarChar, 'Thue')
                    .input('TieuDe', sql.NVarChar, 'Phòng đã được thuê')
                    .input('NoiDung', sql.NVarChar, `Sinh viên ${email} đã thuê phòng #${roomId}. Hợp đồng #${hopDongId}`)
                    .query(`
                        INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                        VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
                    `);
            } catch (e) {
                console.warn('⚠️ Không thể ghi ThongBao Thue:', e.message || e);
            }

            return res.status(201).json({ success: true, message: 'Thuê phòng thành công', data: { HopDongId: hopDongId } });
        } catch (e) {
            await tx.rollback();
            throw e;
        }
    } catch (err) {
        console.error('❌ POST /api/rooms/:id/rent:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ========== STUDENT: gửi yêu cầu thuê (HopDong.TrangThai = 3 - chờ duyệt) ==========
app.post('/api/rooms/:id/request-rent', async (req, res) => {
    if (!checkPool(res)) return;
    const roomId = Number.parseInt(req.params.id, 10);
    const b = req.body || {};
    const email = (b.email || '').trim();

    // REQUIRE both dates
    if (!b.startDate) return res.status(400).json({ success: false, message: 'Thiếu ngày bắt đầu' });
    if (!b.endDate) return res.status(400).json({ success: false, message: 'Thiếu ngày kết thúc' });

    const startDate = new Date(b.startDate);
    const endDate = new Date(b.endDate);
    if (isNaN(startDate.getTime())) return res.status(400).json({ success: false, message: 'Ngày bắt đầu không hợp lệ' });
    if (isNaN(endDate.getTime())) return res.status(400).json({ success: false, message: 'Ngày kết thúc không hợp lệ' });
    if (endDate < startDate) return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' });

    const feeNum = (v) => (v == null || v === '' ? null : Number(v));
    const giaInput = b.giaThueThang;

    if (!Number.isInteger(roomId) || roomId <= 0) return res.status(400).json({ success: false, message: 'PhongId không hợp lệ' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email sinh viên' });

    try {
        const roomRs = await pool.request().input('Id', sql.BigInt, roomId)
            .query(`SELECT PhongId, ChuTroId, GiaCoBan FROM dbo.Phong WHERE PhongId = @Id`);
        if (!roomRs.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        const room = roomRs.recordset[0];

        // Không cho gửi nếu phòng đã có hợp đồng hiệu lực
        const busy = await pool.request().input('Id', sql.BigInt, roomId)
            .query(`SELECT 1 FROM dbo.HopDong WHERE PhongId = @Id AND TrangThai = 0`);
        if (busy.recordset.length) return res.status(409).json({ success: false, message: 'Phòng đã có người thuê' });

        const sv = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!sv.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản sinh viên' });
        const sinhVienId = sv.recordset[0].TaiKhoanId;

        await ensureSinhVienBasic(sinhVienId);

        const giaThue = (giaInput == null || giaInput === '' || Number.isNaN(Number(giaInput)))
            ? Number(room.GiaCoBan)
            : Number(giaInput);

        const reqIns = pool.request();
        reqIns.input('PhongId', sql.BigInt, roomId);
        reqIns.input('SinhVienId', sql.BigInt, sinhVienId);
        reqIns.input('ChuTroId', sql.BigInt, room.ChuTroId);
        reqIns.input('NgayBatDau', sql.Date, startDate);
        reqIns.input('NgayKetThuc', sql.Date, endDate);
        reqIns.input('Gia', sql.Decimal(12, 2), giaThue);
        reqIns.input('TienDien', sql.Decimal(12, 2), feeNum(b.tienDien));
        reqIns.input('TienNuoc', sql.Decimal(12, 2), feeNum(b.tienNuoc));
        reqIns.input('TienRac',  sql.Decimal(12, 2), feeNum(b.tienRac));
        reqIns.input('TienMang', sql.Decimal(12, 2), feeNum(b.tienMang));

        const ins = await reqIns.query(`
INSERT INTO dbo.HopDong
    (PhongId, SinhVienId, ChuTroId, NgayBatDau, NgayKetThuc, GiaThueThang, TienDien, TienNuoc, TienRac, TienMang, TrangThai)
OUTPUT INSERTED.HopDongId
VALUES
    (@PhongId, @SinhVienId, @ChuTroId, @NgayBatDau, @NgayKetThuc, @Gia, @TienDien, @TienNuoc, @TienRac, @TienMang, 3);
        `);

        const hopDongId = ins.recordset[0]?.HopDongId;
        // Gửi thông báo cho chủ trọ: có yêu cầu thuê mới
        try {
            await pool.request()
                .input('TaiKhoanId', sql.BigInt, room.ChuTroId)
                .input('Loai', sql.NVarChar, 'YeuCauThue')
                .input('TieuDe', sql.NVarChar, 'Yêu cầu thuê mới')
                .input('NoiDung', sql.NVarChar, `Sinh viên ${email} đã gửi yêu cầu thuê phòng #${roomId}. HĐ tạm: #${hopDongId}`)
                .query(`
                    INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                    VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
                `);
        } catch (e) {
            console.warn('⚠️ Không thể ghi ThongBao YeuCauThue:', e.message || e);
        }
        return res.status(201).json({ success: true, message: 'Đã gửi yêu cầu thuê. Vui lòng chờ chủ trọ xác nhận.', data: { HopDongId: hopDongId } });
    } catch (err) {
        console.error('❌ POST /api/rooms/:id/request-rent:', err.message || err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ ADMIN - danh sách hợp đồng đang hiệu lực ------------------
app.get('/api/admin/contracts/active', async (req, res) => {
    if (!checkPool(res)) return;
    try {
        const rs = await pool.request().query(`
            SELECT h.HopDongId, h.PhongId, h.GiaThueThang, h.NgayBatDau, h.NgayKetThuc, h.TrangThai,
                   sv.HoTen AS SV_HoTen, tk.Email AS SV_Email,
                   ct.HoTen AS CT_HoTen, ct.Email AS CT_Email
            FROM dbo.HopDong h
            JOIN dbo.Phong p ON p.PhongId = h.PhongId
            JOIN dbo.TaiKhoan tk ON tk.TaiKhoanId = h.SinhVienId
            LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = h.SinhVienId
            LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = p.ChuTroId
            WHERE h.TrangThai = 0
            ORDER BY h.HopDongId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/admin/contracts/active:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ SINH VIÊN - hợp đồng đang hiệu lực của tôi ------------------
app.get('/api/sinhvien/contracts', async (req, res) => {
    if (!checkPool(res)) return;
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        // Xác định SinhVienId theo email (trùng TaiKhoanId)
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const sinhVienId = tk.recordset[0].TaiKhoanId;

        // Tra cứu metadata cột để tránh lỗi "Invalid column name" trên các DB khác schema
        const metaHopDong = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'HopDong'
        `);
        const metaPhong = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Phong'
        `);
        const hcols = new Set(metaHopDong.recordset.map(r => r.COLUMN_NAME));
        const pcols = new Set(metaPhong.recordset.map(r => r.COLUMN_NAME));

        // Các cột có thể thiếu ở HopDong: TienDien, TienNuoc, TienRac, TienMang
        const hTienDien = hcols.has('TienDien') ? 'h.TienDien' : 'CAST(NULL AS DECIMAL(12,2)) AS TienDien';
        const hTienNuoc = hcols.has('TienNuoc') ? 'h.TienNuoc' : 'CAST(NULL AS DECIMAL(12,2)) AS TienNuoc';
        const hTienRac  = hcols.has('TienRac')  ? 'h.TienRac'  : 'CAST(NULL AS DECIMAL(12,2)) AS TienRac';
        const hTienMang = hcols.has('TienMang') ? 'h.TienMang' : 'CAST(NULL AS DECIMAL(12,2)) AS TienMang';
        const hGia      = hcols.has('GiaThueThang') ? 'h.GiaThueThang' : 'CAST(NULL AS DECIMAL(12,2)) AS GiaThueThang';

        // Cột có thể thiếu ở Phong: DiaChi
        const pDiaChi = pcols.has('DiaChi') ? 'p.DiaChi' : 'CAST(NULL AS NVARCHAR(255)) AS DiaChi';

        const sqlText = `
            SELECT h.HopDongId, h.PhongId, h.NgayBatDau, h.NgayKetThuc,
                   ${hGia}, ${hTienDien}, ${hTienNuoc}, ${hTienRac}, ${hTienMang},
                   p.TieuDe, ${pDiaChi},
                   ct.HoTen AS CT_HoTen, tkCT.Email AS CT_Email, ct.SoDienThoai AS CT_SDT
            FROM dbo.HopDong h
            JOIN dbo.Phong p ON p.PhongId = h.PhongId
            JOIN dbo.ChuTro ct ON ct.ChuTroId = p.ChuTroId
            JOIN dbo.TaiKhoan tkCT ON tkCT.TaiKhoanId = p.ChuTroId
            WHERE h.SinhVienId = @SinhVienId AND h.TrangThai = 0
            ORDER BY h.HopDongId DESC`;

        const rs = await pool.request().input('SinhVienId', sql.BigInt, sinhVienId).query(sqlText);
        return res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/sinhvien/contracts:', err.message || err);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ========== SINH VIÊN: rời trọ (xóa hợp đồng của chính mình) ==========
app.post('/api/sinhvien/contracts/:id/leave', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const email = String(req.body?.email || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id hợp đồng' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email sinh viên' });
    try {
        // Resolve student id
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản sinh viên' });
        const sinhVienId = tk.recordset[0].TaiKhoanId;

        // Check contract ownership and status
        const rs = await pool.request().input('Id', sql.BigInt, id).query(`
            SELECT HopDongId, PhongId, SinhVienId, ChuTroId, TrangThai
            FROM dbo.HopDong
            WHERE HopDongId = @Id
        `);
        if (!rs.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng' });
        const row = rs.recordset[0];
        if (row.SinhVienId !== sinhVienId) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền rời hợp đồng này' });
        }

        // Allow leaving if active (0) or pending (3)
        if (row.TrangThai !== 0 && row.TrangThai !== 3) {
            return res.status(409).json({ success: false, message: 'Hợp đồng không ở trạng thái có thể rời' });
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const reqTx = new sql.Request(tx);
            reqTx.input('Id', sql.BigInt, id);
            reqTx.input('PhongId', sql.BigInt, row.PhongId);

            // Xóa lịch sử tiền trọ (nếu có) rồi xóa hợp đồng; trả phòng về trạng thái trống
            await reqTx.query(`
                DELETE FROM dbo.TienThueThang WHERE HopDongId = @Id;
                DELETE FROM dbo.HopDong WHERE HopDongId = @Id;
                UPDATE dbo.Phong SET TrangThai = 0 WHERE PhongId = @PhongId;
            `);
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            throw e;
        }

        // Gửi thông báo cho chủ trọ
        try {
            await pool.request()
                .input('TaiKhoanId', sql.BigInt, row.ChuTroId)
                .input('Loai', sql.NVarChar, 'Thue')
                .input('TieuDe', sql.NVarChar, 'Sinh viên rời trọ')
                .input('NoiDung', sql.NVarChar, `Sinh viên ${email} đã rời phòng #${row.PhongId}. Hợp đồng #${id} đã được xóa.`)
                .query(`
                    INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                    VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
                `);
        } catch (e) {
            console.warn('⚠️ Không thể ghi ThongBao rời trọ:', e.message || e);
        }

        return res.json({ success: true, message: 'Đã rời trọ và xóa hợp đồng' });
    } catch (err) {
        console.error('❌ POST /api/sinhvien/contracts/:id/leave:', err.message || err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ========== ADMIN: kết thúc hợp đồng (đuổi sinh viên) ==========
// Ghi chú: chỉ admin mới có quyền này
app.post('/api/admin/contracts/:id/terminate', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(400).json({ success: false, message: 'Không xác định được admin' });

        const getHd = await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`SELECT HopDongId, PhongId, TrangThai FROM dbo.HopDong WHERE HopDongId = @Id`);
        if (getHd.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng' });

        const row = getHd.recordset[0];
        if (row.TrangThai !== 0) {
            return res.status(409).json({ success: false, message: 'Hợp đồng không đang hiệu lực' });
        }

        // Cập nhật trạng thái hợp đồng và phòng
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`
UPDATE dbo.HopDong
SET TrangThai = 1 -- 1: đã kết thúc
WHERE HopDongId = @Id;

UPDATE dbo.Phong
SET TrangThai = 0 -- 0: trống
WHERE PhongId = (SELECT PhongId FROM dbo.HopDong WHERE HopDongId = @Id);
            `);

        res.json({ success: true, message: 'Đã kết thúc hợp đồng' });
    } catch (err) {
        console.error('❌ DELETE /api/admin/contracts/:id:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ========== ADMIN: tạo hợp đồng tay (cho thuê dài hạn) ==========
// Ghi chú: chỉ admin mới có quyền này
app.post('/api/admin/contracts/manual', async (req, res) => {
    if (!checkPool(res)) return;
    const b = req.body || {};
    const phongId = Number.parseInt(b.phongId, 10);
    const chuTroId = Number.parseInt(b.chuTroId, 10);
    const sinhVienId = Number.parseInt(b.sinhVienId, 10);
    const giaThueThang = b.giaThueThang;
    const startDate = b.startDate ? new Date(b.startDate) : null;
    const endDate = b.endDate ? new Date(b.endDate) : null;

    if (!phongId || !chuTroId || !sinhVienId) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin phòng/chủ trọ/sinh viên' });
    }
    if (isNaN(startDate?.getTime()) || isNaN(endDate?.getTime())) {
        return res.status(400).json({ success: false, message: 'Ngày bắt đầu hoặc kết thúc không hợp lệ' });
    }
    if (endDate < startDate) {
        return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' });
    }

    try {
        // Kiểm tra phòng có tồn tại và đang trống không
        const p = await pool.request().input('Id', sql.BigInt, phongId)
            .query(`SELECT PhongId, ChuTroId, TrangThai FROM dbo.Phong WHERE PhongId = @Id`);
        if (!p.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        if (p.recordset[0].TrangThai !== 0) {
            return res.status(409).json({ success: false, message: 'Phòng này hiện đang có người thuê' });
        }

        // Tạo hợp đồng mới
        const ins = await pool.request()
            .input('PhongId', sql.BigInt, phongId)
            .input('SinhVienId', sql.BigInt, sinhVienId)
            .input('ChuTroId', sql.BigInt, chuTroId)
            .input('NgayBatDau', sql.Date, startDate)
            .input('NgayKetThuc', sql.Date, endDate)
            .input('GiaThueThang', sql.Decimal(12, 2), giaThueThang)
            .query(`
INSERT INTO dbo.HopDong (PhongId, SinhVienId, ChuTroId, NgayBatDau, NgayKetThuc, GiaThueThang, TrangThai)
VALUES (@PhongId, @SinhVienId, @ChuTroId, @NgayBatDau, @NgayKetThuc, @GiaThueThang, 0);
            `);

        res.status(201).json({ success: true, message: 'Tạo hợp đồng tay thành công' });
    } catch (err) {
        console.error('❌ POST /api/admin/contracts/manual:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ CHỦ TRỌ - quản lý yêu cầu thuê (TrangThai=3) ------------------
// Danh sách yêu cầu chờ duyệt theo email chủ trọ
app.get('/api/chutro/rent-requests', async (req, res) => {
    if (!checkPool(res)) return;
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        // Lấy ChuTroId theo email
        const ct = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId AS ChuTroId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!ct.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = ct.recordset[0].ChuTroId;

        const rs = await pool.request()
            .input('ChuTroId', sql.BigInt, chuTroId)
            .query(`
                SELECT h.HopDongId, h.PhongId, h.GiaThueThang, h.NgayBatDau, h.NgayKetThuc,
                       p.TieuDe,
                       sv.HoTen AS SV_HoTen, tkSV.Email AS SV_Email
                FROM dbo.HopDong h
                JOIN dbo.Phong p ON p.PhongId = h.PhongId
                LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = h.SinhVienId
                LEFT JOIN dbo.TaiKhoan tkSV ON tkSV.TaiKhoanId = h.SinhVienId
                WHERE h.ChuTroId = @ChuTroId AND h.TrangThai = 3
                ORDER BY h.HopDongId DESC
            `);
        return res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/chutro/rent-requests:', err.message || err);
        return res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Duyệt yêu cầu -> chuyển HopDong.TrangThai = 0 (hiệu lực) và đánh dấu phòng đã thuê
app.post('/api/chutro/rent-requests/:id/approve', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const h = await pool.request().input('Id', sql.BigInt, id)
            .query(`
                SELECT hd.HopDongId, hd.PhongId, hd.SinhVienId, hd.TrangThai, p.TieuDe
                FROM dbo.HopDong hd
                JOIN dbo.Phong p ON p.PhongId = hd.PhongId
                WHERE hd.HopDongId = @Id
            `);
        if (!h.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });
        const row = h.recordset[0];
        if (row.TrangThai !== 3) return res.status(409).json({ success: false, message: 'Yêu cầu không ở trạng thái chờ duyệt' });

        // Không cho duyệt nếu phòng đã có hợp đồng hiệu lực
        const existsActive = await pool.request().input('PhongId', sql.BigInt, row.PhongId)
            .query(`SELECT 1 AS HasActive FROM dbo.HopDong WHERE PhongId = @PhongId AND TrangThai = 0`);
        if (existsActive.recordset.length) {
            return res.status(409).json({ success: false, message: 'Phòng đã có hợp đồng hiệu lực' });
        }

        await pool.request().input('Id', sql.BigInt, id)
            .query(`
                UPDATE dbo.HopDong SET TrangThai = 0 WHERE HopDongId = @Id; -- hiệu lực
                UPDATE dbo.Phong
                SET TrangThai = 1 -- đã có người thuê
                WHERE PhongId = (SELECT PhongId FROM dbo.HopDong WHERE HopDongId = @Id);
            `);
        // Thông báo cho sinh viên: yêu cầu thuê đã được duyệt
        try {
            await pool.request()
                .input('TaiKhoanId', sql.BigInt, h.recordset[0].SinhVienId)
                .input('Loai', sql.NVarChar, 'YeuCauThue')
                .input('TieuDe', sql.NVarChar, 'Yêu cầu thuê đã được duyệt')
                .input('NoiDung', sql.NVarChar, `Phòng #${h.recordset[0].PhongId} - ${h.recordset[0].TieuDe || ''} đã được duyệt. Hợp đồng #${id} có hiệu lực.`)
                .query(`
                    INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                    VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
                `);
        } catch (e) {
            console.warn('⚠️ Không thể ghi ThongBao duyệt yêu cầu thuê:', e.message || e);
        }
        res.json({ success: true, message: 'Đã duyệt yêu cầu' });
    } catch (err) {
        console.error('❌ POST /api/chutro/rent-requests/:id/approve:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Từ chối yêu cầu -> TrangThai = 2
app.post('/api/chutro/rent-requests/:id/reject', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const h = await pool.request().input('Id', sql.BigInt, id)
            .query(`
                SELECT hd.HopDongId, hd.PhongId, hd.SinhVienId, hd.TrangThai, p.TieuDe
                FROM dbo.HopDong hd
                JOIN dbo.Phong p ON p.PhongId = hd.PhongId
                WHERE hd.HopDongId = @Id
            `);
        if (!h.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });
        if (h.recordset[0].TrangThai !== 3) return res.status(409).json({ success: false, message: 'Yêu cầu không ở trạng thái chờ duyệt' });
        await pool.request().input('Id', sql.BigInt, id).query(`UPDATE dbo.HopDong SET TrangThai = 2 WHERE HopDongId = @Id`);
        // Thông báo cho sinh viên: yêu cầu thuê bị từ chối
        try {
            await pool.request()
                .input('TaiKhoanId', sql.BigInt, h.recordset[0].SinhVienId)
                .input('Loai', sql.NVarChar, 'YeuCauThue')
                .input('TieuDe', sql.NVarChar, 'Yêu cầu thuê bị từ chối')
                .input('NoiDung', sql.NVarChar, `Phòng #${h.recordset[0].PhongId} - ${h.recordset[0].TieuDe || ''} đã bị từ chối. Hợp đồng tạm #${id}.`)
                .query(`
                    INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                    VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
                `);
        } catch (e) {
            console.warn('⚠️ Không thể ghi ThongBao từ chối yêu cầu thuê:', e.message || e);
        }
        res.json({ success: true, message: 'Đã từ chối yêu cầu' });
    } catch (err) {
        console.error('❌ POST /api/chutro/rent-requests/:id/reject:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ CHỦ TRỌ - hợp đồng đang hiệu lực của tôi ------------------
app.get('/api/chutro/contracts', async (req, res) => {
    if (!checkPool(res)) return;
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const ct = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId AS ChuTroId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!ct.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = ct.recordset[0].ChuTroId;

        const rs = await pool.request().input('ChuTroId', sql.BigInt, chuTroId).query(`
            SELECT h.HopDongId, h.PhongId, h.GiaThueThang, p.TieuDe, p.GiaCoBan
            FROM dbo.HopDong h
            JOIN dbo.Phong p ON p.PhongId = h.PhongId
            WHERE h.ChuTroId = @ChuTroId AND h.TrangThai = 0
            ORDER BY h.HopDongId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/chutro/contracts:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Lịch sử tiền trọ của 1 hợp đồng
app.get('/api/contracts/:id/payments', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id hợp đồng' });
    try {
        await ensureTienThueThangSchema();
        const rs = await pool.request().input('HopDongId', sql.BigInt, id).query(`
            SELECT TienThueThangId, HopDongId, ThangTinh, SoTien, SoDien, SoNuoc, GhiChu
            FROM dbo.TienThueThang
            WHERE HopDongId = @HopDongId
            ORDER BY ThangTinh DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/contracts/:id/payments:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Lấy thông số tính tiền (giá thuê và các loại phí) của 1 hợp đồng
app.get('/api/contracts/:id/rates', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id hợp đồng' });
    try {
        // Tra cứu metadata cột để an toàn với các schema khác nhau
        const metaHopDong = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'HopDong'
        `);
        const hcols = new Set(metaHopDong.recordset.map(r => r.COLUMN_NAME));

        const selGia   = hcols.has('GiaThueThang') ? 'h.GiaThueThang' : 'CAST(NULL AS DECIMAL(12,2)) AS GiaThueThang';
        const selDien  = hcols.has('TienDien') ? 'h.TienDien' : 'CAST(NULL AS DECIMAL(12,2)) AS TienDien';
        const selNuoc  = hcols.has('TienNuoc') ? 'h.TienNuoc' : 'CAST(NULL AS DECIMAL(12,2)) AS TienNuoc';
        const selRac   = hcols.has('TienRac') ? 'h.TienRac' : 'CAST(NULL AS DECIMAL(12,2)) AS TienRac';
        const selMang  = hcols.has('TienMang') ? 'h.TienMang' : 'CAST(NULL AS DECIMAL(12,2)) AS TienMang';

        const rs = await pool.request().input('Id', sql.BigInt, id).query(`
            SELECT ${selGia}, ${selDien}, ${selNuoc}, ${selRac}, ${selMang}, p.GiaCoBan
            FROM dbo.HopDong h
            JOIN dbo.Phong p ON p.PhongId = h.PhongId
            WHERE h.HopDongId = @Id
        `);
        if (!rs.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng' });
        const r = rs.recordset[0];
        const base = (r.GiaThueThang != null && !Number.isNaN(Number(r.GiaThueThang)))
            ? Number(r.GiaThueThang)
            : Number(r.GiaCoBan || 0);
        const data = {
            base, // tiền nhà cơ bản theo hợp đồng (fallback theo phòng)
            dien: Number(r.TienDien || 0),
            nuoc: Number(r.TienNuoc || 0),
            rac: Number(r.TienRac || 0),
            mang: Number(r.TienMang || 0),
            phongGiaCoBan: Number(r.GiaCoBan || 0),
            giaThueThang: r.GiaThueThang != null ? Number(r.GiaThueThang) : null
        };
        res.json({ success: true, data });
    } catch (err) {
        console.error('❌ GET /api/contracts/:id/rates:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Thêm/cập nhật tiền trọ cho 1 tháng (upsert theo unique HopDongId+ThangTinh)
app.post('/api/contracts/:id/payments', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const body = req.body || {};
    const month = String(body.month || '').trim(); // yyyy-mm
    const amount = Number(body.amount);
    const soDien = (body.soDien == null || body.soDien === '') ? null : Number.parseInt(body.soDien, 10);
    const soNuoc = (body.soNuoc == null || body.soNuoc === '') ? null : Number.parseInt(body.soNuoc, 10);
    const ghiChu = (body.ghiChu == null || body.ghiChu === '') ? null : String(body.ghiChu);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id hợp đồng' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, message: 'Tháng không hợp lệ (yyyy-mm)' });
    if (!Number.isFinite(amount)) return res.status(400).json({ success: false, message: 'Số tiền không hợp lệ' });
    try {
        await ensureTienThueThangSchema();
        const thang = new Date(`${month}-01T00:00:00.000Z`);
        const reqDb = pool.request()
            .input('HopDongId', sql.BigInt, id)
            .input('ThangTinh', sql.Date, thang)
            .input('SoTien', sql.Decimal(12, 2), amount)
            .input('SoDien', sql.Int, soDien)
            .input('SoNuoc', sql.Int, soNuoc)
            .input('GhiChu', sql.NVarChar(sql.MAX), ghiChu);

        // Thử update trước
        const up = await reqDb.query(`
            UPDATE dbo.TienThueThang
            SET SoTien = @SoTien,
                SoDien = @SoDien,
                SoNuoc = @SoNuoc,
                GhiChu = @GhiChu
            WHERE HopDongId = @HopDongId AND ThangTinh = @ThangTinh;
            SELECT @@ROWCOUNT AS Affected;
        `);
        const affected = up.recordset?.[0]?.Affected || 0;
        if (!affected) {
            await pool.request()
                .input('HopDongId', sql.BigInt, id)
                .input('ThangTinh', sql.Date, thang)
                .input('SoTien', sql.Decimal(12, 2), amount)
                .input('SoDien', sql.Int, soDien)
                .input('SoNuoc', sql.Int, soNuoc)
                .input('GhiChu', sql.NVarChar(sql.MAX), ghiChu)
                .query(`
                    INSERT INTO dbo.TienThueThang (HopDongId, ThangTinh, SoTien, SoDien, SoNuoc, GhiChu)
                    VALUES (@HopDongId, @ThangTinh, @SoTien, @SoDien, @SoNuoc, @GhiChu);
                `);
        }
        res.status(201).json({ success: true, message: 'Đã lưu tiền trọ' });
    } catch (err) {
        console.error('❌ POST /api/contracts/:id/payments:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// CHỦ TRỌ: kết thúc hợp đồng của mình (đuổi)
app.delete('/api/chutro/contracts/:id', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const getHd = await pool.request().input('Id', sql.BigInt, id)
            .query(`SELECT HopDongId, PhongId, TrangThai FROM dbo.HopDong WHERE HopDongId = @Id`);
        if (!getHd.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng' });
        const row = getHd.recordset[0];
        if (row.TrangThai !== 0) return res.status(409).json({ success: false, message: 'Hợp đồng không đang hiệu lực' });

        await pool.request().input('Id', sql.BigInt, id).query(`
            UPDATE dbo.HopDong SET TrangThai = 1 WHERE HopDongId = @Id; -- kết thúc
            UPDATE dbo.Phong SET TrangThai = 0 WHERE PhongId = (SELECT PhongId FROM dbo.HopDong WHERE HopDongId = @Id); -- trống
        `);
        res.json({ success: true, message: 'Đã kết thúc hợp đồng' });
    } catch (err) {
        console.error('❌ DELETE /api/chutro/contracts/:id:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// List rooms with pagination
app.get('/api/rooms', async (req, res) => {
    if (!checkPool(res)) return;
    const page = Math.max(1, Number.parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;

    try {
        const result = await pool.request()
            .input('Offset', sql.Int, offset)
            .input('PageSize', sql.Int, pageSize)
            .query(`
                SELECT 
                    p.PhongId, p.TieuDe, p.GiaCoBan, p.DiaChi, p.TrangThai,
                    ct.HoTen AS ChuTroHoTen, ct.Email AS ChuTroEmail,
                    sv.HoTen AS SinhVienHoTen, tkSV.Email AS SinhVienEmail
                FROM dbo.Phong p
                LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = p.ChuTroId
                LEFT JOIN dbo.HopDong hd ON hd.PhongId = p.PhongId AND hd.TrangThai = 0
                LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = hd.SinhVienId
                LEFT JOIN dbo.TaiKhoan tkSV ON tkSV.TaiKhoanId = hd.SinhVienId
                ORDER BY p.PhongId
                OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
            `);

        const totalCountRs = await pool.request()
            .query(`SELECT COUNT(*) AS TotalCount FROM dbo.Phong`);
        const totalCount = totalCountRs.recordset[0]?.TotalCount || 0;

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                totalCount,
                page,
                pageSize,
                totalPages: Math.ceil(totalCount / pageSize)
            }
        });
    } catch (err) {
        console.error('❌ GET /api/rooms:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ================= FEEDBACK to ADMIN =================
// Gửi phản hồi của người dùng (sinh viên/chủ trọ) tới Admin
app.post('/api/feedback', async (req, res) => {
    if (!checkPool(res)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim();
    const loai = String(b.loai || 'gopy').slice(0, 50);
    const tieuDe = String(b.tieuDe || '').slice(0, 200);
    const noiDung = String(b.noiDung || '').slice(0, 1000);

    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email người gửi' });
    if (!tieuDe) return res.status(400).json({ success: false, message: 'Thiếu tiêu đề' });
    if (!noiDung) return res.status(400).json({ success: false, message: 'Thiếu nội dung' });
    try {
        // Resolve admin recipient
        const adminId = await getAdminId(null);
        if (!adminId) return res.status(500).json({ success: false, message: 'Chưa tìm thấy tài khoản Admin' });

        // Optional: ensure sender exists
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản người gửi' });

        const payloadNoiDung = `[from: ${email}] ${noiDung}`;
        await pool.request()
            .input('TaiKhoanId', sql.BigInt, adminId)
            .input('Loai', sql.NVarChar, loai)
            .input('TieuDe', sql.NVarChar, tieuDe)
            .input('NoiDung', sql.NVarChar, payloadNoiDung)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
            `);
        res.status(201).json({ success: true, message: 'Đã gửi phản hồi tới Admin' });
    } catch (err) {
        console.error('❌ POST /api/feedback:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Admin xem danh sách phản hồi (từ bảng ThongBao gửi đến admin)
app.get('/api/admin/feedback', async (req, res) => {
    if (!checkPool(res)) return;
    const type = String(req.query.type || 'all').trim().toLowerCase();
    try {
        await ensureThongBaoReplySchema();
        const adminId = await getAdminId(null);
        if (!adminId) return res.status(500).json({ success: false, message: 'Không tìm thấy Admin' });

        let where = 'tb.TaiKhoanId = @AdminId';
        if (type !== 'all') where += ' AND tb.Loai = @Type';

        const reqDb = pool.request().input('AdminId', sql.BigInt, adminId);
        if (type !== 'all') reqDb.input('Type', sql.NVarChar, type);
        // Lấy Email người gửi từ chuỗi [from: email] nếu có
        const rs = await reqDb.query(`
            SELECT tb.ThongBaoId, tb.Loai, tb.TieuDe, tb.NoiDung,
                   CAST(tb.DaDoc AS BIT) AS DaDoc,
                   CAST(ISNULL(tb.DaTraLoi, 0) AS BIT) AS DaTraLoi,
                   tb.ReplyAt,
                   CASE WHEN CHARINDEX('[from:', tb.NoiDung) > 0 THEN
                        LTRIM(RTRIM(SUBSTRING(tb.NoiDung,
                            CHARINDEX('[from:', tb.NoiDung) + 6,
                            CHARINDEX(']', tb.NoiDung + ']') - (CHARINDEX('[from:', tb.NoiDung) + 6)
                        )))
                   ELSE NULL END AS SenderEmail
            FROM dbo.ThongBao tb
            WHERE ${where}
            ORDER BY tb.ThongBaoId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/admin/feedback:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Admin trả lời một phản hồi (gửi thông báo lại cho người gửi)
app.post('/api/admin/feedback/:id/reply', async (req, res) => {
    if (!checkPool(res)) return;
    const fbId = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    const message = (req.body?.message || '').toString().trim();
    if (!fbId) return res.status(400).json({ success: false, message: 'Thiếu ID phản hồi' });
    if (!message) return res.status(400).json({ success: false, message: 'Thiếu nội dung phản hồi' });
    if (message.length > 1000) return res.status(400).json({ success: false, message: 'Nội dung quá dài (tối đa 1000 ký tự)' });
    try {
        await ensureThongBaoReplySchema();
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(500).json({ success: false, message: 'Không xác định được Admin' });

        // Lấy nội dung feedback và trích email người gửi từ chuỗi [from: email]
        const fb = await pool.request()
            .input('Id', sql.BigInt, fbId)
            .query('SELECT ThongBaoId, NoiDung FROM dbo.ThongBao WHERE ThongBaoId = @Id');
        if (!fb.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phản hồi' });
        const noiDung = String(fb.recordset[0].NoiDung || '');
        const match = noiDung.match(/\[from:\s*([^\]]+)\]/i);
        const senderEmail = match ? match[1].trim() : null;
        if (!senderEmail) return res.status(404).json({ success: false, message: 'Không xác định được email người gửi' });

        // Resolve người nhận (người gửi ban đầu)
        const tk = await pool.request()
            .input('Email', sql.NVarChar, senderEmail)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Người nhận không còn tồn tại' });
        const userId = tk.recordset[0].TaiKhoanId;

        // Gửi thông báo trả lời
        await pool.request()
            .input('TaiKhoanId', sql.BigInt, userId)
            .input('Loai', sql.NVarChar, 'FeedbackReply')
            .input('TieuDe', sql.NVarChar, 'Phản hồi từ Admin')
            .input('NoiDung', sql.NVarChar, message)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
            `);

        // Đánh dấu bản ghi phản hồi gốc là đã trả lời
        await pool.request()
            .input('Id', sql.BigInt, fbId)
            .query(`UPDATE dbo.ThongBao SET DaTraLoi = 1, ReplyAt = SYSDATETIME() WHERE ThongBaoId = @Id`);

        return res.status(201).json({ success: true, message: 'Đã gửi phản hồi' });
    } catch (err) {
        console.error('❌ POST /api/admin/feedback/:id/reply:', err.message || err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Fallback endpoint: allow replying with ID in request body
app.post('/api/admin/feedback/reply', async (req, res) => {
    if (!checkPool(res)) return;
    const fbId = Number.parseInt(req.body?.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    const message = (req.body?.message || '').toString().trim();
    if (!fbId) return res.status(400).json({ success: false, message: 'Thiếu ID phản hồi' });
    if (!message) return res.status(400).json({ success: false, message: 'Thiếu nội dung phản hồi' });
    if (message.length > 1000) return res.status(400).json({ success: false, message: 'Nội dung quá dài (tối đa 1000 ký tự)' });
    try {
        await ensureThongBaoReplySchema();
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(500).json({ success: false, message: 'Không xác định được Admin' });
        const fb = await pool.request()
            .input('Id', sql.BigInt, fbId)
            .query('SELECT ThongBaoId, NoiDung FROM dbo.ThongBao WHERE ThongBaoId = @Id');
        if (!fb.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy phản hồi' });
        const noiDung = String(fb.recordset[0].NoiDung || '');
        const match = noiDung.match(/\[from:\s*([^\]]+)\]/i);
        const senderEmail = match ? match[1].trim() : null;
        if (!senderEmail) return res.status(404).json({ success: false, message: 'Không xác định được email người gửi' });
        const tk = await pool.request().input('Email', sql.NVarChar, senderEmail)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Người nhận không còn tồn tại' });
        const userId = tk.recordset[0].TaiKhoanId;
        await pool.request()
            .input('TaiKhoanId', sql.BigInt, userId)
            .input('Loai', sql.NVarChar, 'FeedbackReply')
            .input('TieuDe', sql.NVarChar, 'Phản hồi từ Admin')
            .input('NoiDung', sql.NVarChar, message)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@TaiKhoanId, @Loai, @TieuDe, @NoiDung, 0);
            `);
        await pool.request().input('Id', sql.BigInt, fbId)
            .query(`UPDATE dbo.ThongBao SET DaTraLoi = 1, ReplyAt = SYSDATETIME() WHERE ThongBaoId = @Id`);
        return res.status(201).json({ success: true, message: 'Đã gửi phản hồi' });
    } catch (err) {
        console.error('❌ POST /api/admin/feedback/reply:', err.message || err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ================= NOTIFICATIONS (Generic for users) =================
// List notifications for a user by email
app.get('/api/notifications', async (req, res) => {
    if (!checkPool(res)) return;
    const email = String(req.query.email || '').trim();
    const type = String(req.query.type || 'all').trim().toLowerCase();
    const onlyUnread = String(req.query.onlyUnread || '0') === '1';
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const id = tk.recordset[0].TaiKhoanId;

        let where = 'tb.TaiKhoanId = @Id';
        if (type !== 'all') where += ' AND tb.Loai = @Type';
        if (onlyUnread) where += ' AND tb.DaDoc = 0';
        const reqDb = pool.request().input('Id', sql.BigInt, id);
        if (type !== 'all') reqDb.input('Type', sql.NVarChar, type);
        const rs = await reqDb.query(`
            SELECT tb.ThongBaoId, tb.Loai, tb.TieuDe, tb.NoiDung, CAST(tb.DaDoc AS BIT) AS DaDoc
            FROM dbo.ThongBao tb
            WHERE ${where}
            ORDER BY tb.ThongBaoId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/notifications:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Mark one notification as read (requires email ownership check)
app.post('/api/notifications/:id/read', async (req, res) => {
    if (!checkPool(res)) return;
    const notiId = Number.parseInt(req.params.id, 10);
    const email = String(req.body?.email || req.query?.email || '').trim();
    if (!notiId) return res.status(400).json({ success: false, message: 'Thiếu ThongBaoId' });
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query('SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email');
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const id = tk.recordset[0].TaiKhoanId;

        const up = await pool.request()
            .input('Id', sql.BigInt, notiId)
            .input('Owner', sql.BigInt, id)
            .query(`UPDATE dbo.ThongBao SET DaDoc = 1 WHERE ThongBaoId = @Id AND TaiKhoanId = @Owner; SELECT @@ROWCOUNT AS Affected;`);
        const affected = up.recordset?.[0]?.Affected || 0;
        if (!affected) return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo hoặc không thuộc quyền sở hữu' });
        res.json({ success: true, message: 'Đã đánh dấu đã đọc' });
    } catch (err) {
        console.error('❌ POST /api/notifications/:id/read:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// JSON 404 for any unknown /api route
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'API không tồn tại' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Lỗi không xác định:', err.message || err);
    res.status(500).json({ success: false, message: 'Lỗi không xác định', error: err.message });
});

// Tạo tài khoản admin mặc định nếu chưa có
async function seedAdminDefault() {
    if (!pool || !pool.connected) return;
    const email = 'admin@gmail.com';
    const pwd = '06022004';
    try {
        await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .query(`
DECLARE @AdminId TINYINT;

IF NOT EXISTS (SELECT 1 FROM dbo.VaiTro WHERE TenVaiTro = N'Admin')
BEGIN
    INSERT INTO dbo.VaiTro (TenVaiTro) VALUES (N'Admin');
END

SELECT @AdminId = VaiTroId FROM dbo.VaiTro WHERE TenVaiTro = N'Admin';

IF EXISTS (SELECT 1 FROM dbo.TaiKhoan WHERE Email = @Email)
BEGIN
    UPDATE dbo.TaiKhoan
    SET MatKhau = @MatKhau, VaiTroId = @AdminId, TrangThai = 1
    WHERE Email = @Email;
END
ELSE
BEGIN
    INSERT INTO dbo.TaiKhoan (Email, MatKhau, VaiTroId, TrangThai)
    VALUES (@Email, @MatKhau, @AdminId, 1);
END
            `);
        console.log('✅ Seed admin: admin@gmail.com/06022004');
    } catch (e) {
        console.error('❌ Seed admin thất bại:', e.message || e);
    }
}

// ------------------ Helpers: ensure schemas ------------------
async function ensureChuTroSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.ChuTro', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.ChuTro', N'DaXacThuc') IS NULL
        ALTER TABLE dbo.ChuTro ADD DaXacThuc BIT NULL CONSTRAINT DF_ChuTro_DaXacThuc DEFAULT (0);
       IF COL_LENGTH(N'dbo.ChuTro', N'NgayXacThuc') IS NULL
        ALTER TABLE dbo.ChuTro ADD NgayXacThuc DATETIME2(3) NULL;
END
    `);
}

async function ensureXacThucSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.YeuCauXacThucChuTro', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.YeuCauXacThucChuTro', N'NgayNop') IS NULL
        ALTER TABLE dbo.YeuCauXacThucChuTro ADD NgayNop DATETIME2(3) NULL;
    IF COL_LENGTH(N'dbo.YeuCauXacThucChuTro', N'DuongDanTep') IS NULL
        ALTER TABLE dbo.YeuCauXacThucChuTro ADD DuongDanTep NVARCHAR(400) NULL;
END
    `);
}

async function ensureAnhPhongSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.AnhPhong', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AnhPhong (
        AnhPhongId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PhongId BIGINT NOT NULL,
        Anh VARBINARY(MAX) NOT NULL
    );
    CREATE INDEX IX_AnhPhong_Phong ON dbo.AnhPhong(PhongId);
END
    `);
}

// Ensure thêm các cột SoDien/SoNuoc/GhiChu cho bảng TienThueThang nếu thiếu
async function ensureTienThueThangSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.TienThueThang', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.TienThueThang', N'SoDien') IS NULL
        ALTER TABLE dbo.TienThueThang ADD SoDien INT NULL;
    IF COL_LENGTH(N'dbo.TienThueThang', N'SoNuoc') IS NULL
        ALTER TABLE dbo.TienThueThang ADD SoNuoc INT NULL;
    IF COL_LENGTH(N'dbo.TienThueThang', N'GhiChu') IS NULL
        ALTER TABLE dbo.TienThueThang ADD GhiChu NVARCHAR(MAX) NULL;
END
    `);
}

// Ensure ThongBao has reply status columns
async function ensureThongBaoReplySchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.ThongBao', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.ThongBao', N'DaTraLoi') IS NULL
        ALTER TABLE dbo.ThongBao ADD DaTraLoi BIT NULL CONSTRAINT DF_ThongBao_DaTraLoi DEFAULT(0);
    IF COL_LENGTH(N'dbo.ThongBao', N'ReplyAt') IS NULL
        ALTER TABLE dbo.ThongBao ADD ReplyAt DATETIME2(3) NULL;
END
    `);
}

// Helper: đảm bảo có bản ghi SinhVien cơ bản
async function ensureSinhVienBasic(taiKhoanId) {
    if (!pool || !pool.connected) return;
    await pool.request()
        .input('Id', sql.BigInt, taiKhoanId)
        .query(`
IF OBJECT_ID(N'dbo.SinhVien', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SinhVien (
        SinhVienId BIGINT NOT NULL PRIMARY KEY,
        HoTen NVARCHAR(150) NOT NULL,
        SoDienThoai NVARCHAR(20) NULL,
        Truong NVARCHAR(150) NULL,
        DiaChi NVARCHAR(255) NULL
    );
END
IF NOT EXISTS (SELECT 1 FROM dbo.SinhVien WHERE SinhVienId = @Id)
BEGIN
    INSERT INTO dbo.SinhVien (SinhVienId, HoTen) VALUES (@Id, N'');
END
        `);
}

// ------------------ Khởi động server ------------------
app.listen(port, () => {
    console.log(`🚀 Server chạy tại http://localhost:${port}`);
});

