(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const qs = new URLSearchParams(location.search);
    const emailQS = (qs.get('email') || 'admin@gmail.com').trim();

    const emailEl = document.getElementById('admin-email');
    if (emailEl) emailEl.textContent = emailQS;

    // ===== Drawer/Hamburger (mobile) =====
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const menuEl = document.querySelector('.menu');
    function openDrawer() {
      if (!menuEl) return;
      menuEl.classList.add('open');
      if (drawerOverlay) drawerOverlay.hidden = false;
      hamburgerBtn?.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      if (!menuEl) return;
      menuEl.classList.remove('open');
      if (drawerOverlay) drawerOverlay.hidden = true;
      hamburgerBtn?.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    function toggleDrawer() { if (menuEl?.classList.contains('open')) closeDrawer(); else openDrawer(); }
    hamburgerBtn?.addEventListener('click', toggleDrawer);
    drawerOverlay?.addEventListener('click', closeDrawer);
    document.querySelector('.menu')?.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) closeDrawer(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

    // Panel toggling
    const panels = ['panel-dashboard', 'panel-verify', 'panel-accounts', 'panel-noti'];
    const menuMap = {
      'menu-dashboard': 'panel-dashboard',
      'menu-verify': 'panel-verify',
      'menu-accounts': 'panel-accounts',
      'menu-noti': 'panel-noti'
    };
    function showPanel(id) {
      panels.forEach(pid => {
        const el = document.getElementById(pid);
        if (el) el.style.display = (pid === id) ? 'block' : 'none';
      });
      document.querySelectorAll('.menu .menu-item').forEach(b => b.classList.remove('active'));
      Object.entries(menuMap).forEach(([mid, pid]) => {
        if (pid === id) document.getElementById(mid)?.classList.add('active');
      });
      // close drawer when navigating
      closeDrawer();
    }

    // Overlay
    const overlay = document.getElementById('hop-thong-bao-nen');
    const overlayMsg = document.getElementById('hop-thong-bao-noi-dung');
    document.getElementById('hop-thong-bao-dong')?.addEventListener('click', () => overlay.style.display = 'none');

    // NEW: ensure overlay does not block clicks initially and allow backdrop-click to close
    if (overlay) {
      overlay.style.display = 'none';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    }

    function toast(msg) {
      if (!overlay || !overlayMsg) return alert(msg);
      overlayMsg.textContent = msg;
      overlay.style.display = 'flex';
    }
    // New: preview image in overlay
    function previewImage(url) {
      if (!url) return;
      if (!overlay || !overlayMsg) { window.open(url, '_blank'); return; }
      overlayMsg.innerHTML = '';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Ảnh minh chứng';
      img.style.maxWidth = '90vw';
      img.style.maxHeight = '85vh';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 8px 30px rgba(0,0,0,.35)';
      overlayMsg.appendChild(img);
      overlay.style.display = 'flex';
    }
    // New: build URL from DuongDanTep (filename) when ImageUrl is absent
    const VERIFY_IMG_BASE = '/uploads/verify/'; // chỉnh theo đường dẫn static thực tế của bạn
    function resolveVerifyImageUrl(r) {
      const v = r?.ImageUrl || r?.DuongDanTep;
      if (!v) return null;
      if (/^https?:\/\//i.test(v)) return v;      // absolute URL
      if (v.startsWith('/')) return v;            // already rooted path
      return VERIFY_IMG_BASE + encodeURIComponent(v); // filename -> join base
    }

    async function readJsonOrThrow(resp) {
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      const txt = await resp.text();
      if (!ct.includes('application/json')) throw new Error(txt.slice(0, 200));
      let json; try { json = JSON.parse(txt); } catch { throw new Error(txt.slice(0, 200)); }
      if (!resp.ok || !json.success) throw new Error(json.message || 'Lỗi máy chủ');
      return json;
    }

    // VERIFY: load + actions
    const verifyStatusSel = document.getElementById('verify-status');
    const verifyTbody = document.querySelector('#verify-table tbody');
    async function loadVerify() {
      if (!verifyTbody) return;
      verifyTbody.innerHTML = '<tr><td colspan="8">Đang tải...</td></tr>';
      try {
        const st = verifyStatusSel?.value || '0';
        const json = await fetch(`/api/admin/verify-requests?status=${encodeURIComponent(st)}`).then(readJsonOrThrow);
        verifyTbody.innerHTML = '';
        json.data.forEach(r => {
          const tr = document.createElement('tr');
          // changed: compute URL from ImageUrl or DuongDanTep
          const url = resolveVerifyImageUrl(r);
          const imgCell = url
            ? `<button class="btn btn-outline btn-sm" data-act="preview" data-url="${url}">Xem ảnh</button>`
            : '<em>—</em>';
          const ngay = r.NgayXacThuc ? new Date(r.NgayXacThuc).toLocaleString('vi-VN') : '';
       const actions = (st === '0')
        ? `<button class="btn btn-success btn-sm" data-act="approve" data-id="${r.XacThucId}">Duyệt</button>
          <button class="btn btn-danger btn-sm" data-act="reject" data-id="${r.XacThucId}">Từ chối</button>`
            : '<em>—</em>';
          tr.innerHTML = `
            <td>${r.XacThucId}</td>
            <td>${r.ChuTroEmail}</td>
            <td>${r.HoTen || ''}</td>
            <td>${r.LoaiGiayTo}</td>
            <td>${imgCell}</td>
            <td>${r.DaXacThuc ? 'Có' : 'Chưa'}</td>
            <td>${ngay}</td>
            <td>${actions}</td>`;
          verifyTbody.appendChild(tr);
        });
      } catch (e) {
        verifyTbody.innerHTML = `<tr><td colspan="8">${e.message || 'Lỗi tải danh sách'}</td></tr>`;
      }
    }
    verifyStatusSel?.addEventListener('change', loadVerify);
    verifyTbody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');

      // New: handle preview click
      if (act === 'preview') {
        const url = btn.getAttribute('data-url');
        previewImage(url);
        return;
      }

      try {
        if (act === 'approve') {
          await fetch(`/api/admin/verify-requests/${id}/approve`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: emailQS })
          }).then(readJsonOrThrow);
          toast('Đã phê duyệt');
        } else if (act === 'reject') {
          const reason = prompt('Lý do từ chối:', 'Giấy tờ chưa hợp lệ');
          await fetch(`/api/admin/verify-requests/${id}/reject`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: emailQS, reason })
          }).then(readJsonOrThrow);
          toast('Đã từ chối');
        }
        loadVerify();
      } catch (err) {
        toast(err.message || 'Lỗi thao tác');
      }
    });

    // ACCOUNTS: load + actions
    const accRoleSel = document.getElementById('acc-role');
    const accTbody = document.querySelector('#accounts-table tbody');
    async function loadAccounts() {
      if (!accTbody) return;
      accTbody.innerHTML = '<tr><td colspan="6">Đang tải...</td></tr>';
      try {
        const role = accRoleSel?.value || 'all';
        const json = await fetch(`/api/admin/accounts?role=${encodeURIComponent(role)}`).then(readJsonOrThrow);
        accTbody.innerHTML = '';
        json.data.forEach(a => {
          const info = a.TenVaiTro?.toLowerCase().includes('sinh') ?
              `${a.SV_HoTen || ''} - ${a.Truong || ''} - ${a.SV_SDT || ''}` :
              `${a.Ct_HoTen || a.CT_HoTen || ''} - ${a.CT_SDT || ''} - ${a.DaXacThuc ? 'Đã xác thực' : 'Chưa'}`;
          const actionBtn = (a.TrangThai === 2)
            ? `<button class="btn btn-success btn-sm" data-act="unban" data-id="${a.TaiKhoanId}">Mở khóa</button>`
            : `<button class="btn btn-danger btn-sm" data-act="ban" data-id="${a.TaiKhoanId}">Khóa</button>`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${a.TaiKhoanId}</td>
            <td>${a.Email}</td>
            <td>${a.TenVaiTro}</td>
            <td>${a.TrangThai}</td>
            <td>${info}</td>
            <td>${actionBtn}</td>`;
          accTbody.appendChild(tr);
        });
      } catch (e) {
        accTbody.innerHTML = `<tr><td colspan="6">${e.message || 'Lỗi tải danh sách'}</td></tr>`;
      }
    }
    accRoleSel?.addEventListener('change', loadAccounts);
    accTbody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return;
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      try {
        if (act === 'ban') {
          const reason = prompt('Lý do khóa tài khoản:', 'Vi phạm nội quy');
          await fetch(`/api/admin/accounts/${id}/ban`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
          }).then(readJsonOrThrow);
          toast('Đã khóa tài khoản');
        } else if (act === 'unban') {
          await fetch(`/api/admin/accounts/${id}/unban`, {
            method: 'POST'
          }).then(readJsonOrThrow);
          toast('Đã mở khóa tài khoản');
        }
        loadAccounts();
      } catch (err) {
        toast(err.message || 'Lỗi thao tác');
      }
    });

    // FEEDBACK: load
    const fbTypeSel = document.getElementById('fb-type');
    const fbTbody = document.querySelector('#feedback-table tbody');
    async function loadFeedback() {
      if (!fbTbody) return;
      fbTbody.innerHTML = '<tr><td colspan="6">Đang tải...</td></tr>';
      try {
        const type = fbTypeSel?.value || 'all';
        const json = await fetch(`/api/admin/feedback?type=${encodeURIComponent(type)}`).then(readJsonOrThrow);
        fbTbody.innerHTML = '';
        json.data.forEach(f => {
          const tr = document.createElement('tr');
          const email = f.SenderEmail || '—';
          const replied = !!f.DaTraLoi;
          const actions = replied
            ? `<span class="badge-g">Đã trả lời</span>`
            : (email !== '—'
                ? `<button class="btn btn-sm" data-act="reply" data-id="${f.ThongBaoId}" data-email="${email}">Trả lời</button>`
                : '<em>—</em>');
          tr.innerHTML = `
            <td>${f.ThongBaoId}</td>
            <td>${email}</td>
            <td>${f.Loai}</td>
            <td>${f.TieuDe}</td>
            <td>${f.NoiDung}</td>
            <td>${actions}</td>`;
          fbTbody.appendChild(tr);
        });
      } catch (e) {
        fbTbody.innerHTML = `<tr><td colspan="6">${e.message || 'Lỗi tải danh sách'}</td></tr>`;
      }
    }
    fbTypeSel?.addEventListener('change', loadFeedback);

    // Reply handler: open overlay with a small form
    fbTbody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act="reply"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const targetEmail = btn.getAttribute('data-email');
      if (!overlay || !overlayMsg) return alert('Không thể mở form trả lời');
      overlayMsg.innerHTML = `
        <form id="reply-form" style="min-width:320px;text-align:left">
          <h4 style="margin:0 0 8px">Trả lời phản hồi</h4>
          <div class="contract-meta" style="margin-bottom:6px">Tới: <strong>${targetEmail}</strong></div>
          <div class="form-group"><label>Nội dung</label><textarea id="rp-content" rows="4" maxlength="1000" placeholder="Nhập nội dung trả lời"></textarea></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" class="btn btn-secondary" id="rp-cancel">Hủy</button>
            <button type="submit" class="btn btn-primary">Gửi</button>
          </div>
        </form>`;
      overlay.style.display = 'flex';
      document.getElementById('rp-cancel')?.addEventListener('click', ()=> overlay.style.display='none');
      overlayMsg.querySelector('#reply-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const message = overlayMsg.querySelector('#rp-content')?.value?.trim();
        if (!message) { toast('Vui lòng nhập nội dung'); return; }
        try {
          await fetch(`/api/admin/feedback/${encodeURIComponent(id)}/reply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminEmail: emailQS, message })
          }).then(readJsonOrThrow);
          overlay.style.display = 'none';
          toast('Đã gửi phản hồi');
          loadFeedback();
        } catch (err) {
          toast(err.message || 'Lỗi gửi phản hồi');
        }
      });
    });

    // Menu bindings
    document.getElementById('menu-dashboard')?.addEventListener('click', () => showPanel('panel-dashboard'));
    document.getElementById('menu-verify')?.addEventListener('click', () => { showPanel('panel-verify'); loadVerify(); });
    document.getElementById('menu-accounts')?.addEventListener('click', () => { showPanel('panel-accounts'); loadAccounts(); });
    document.getElementById('menu-noti')?.addEventListener('click', () => { showPanel('panel-noti'); loadFeedback(); });
    // Wire the extra menu item so it responds to clicks
    document.getElementById('menu-rooms')?.addEventListener('click', () => {
      // Tạm thời điều hướng về trang Tổng quan (hoặc thay bằng panel quản lý phòng khi sẵn sàng)
      const target = 'panel-dashboard';
      // reuse existing showPanel
      const panels = ['panel-dashboard', 'panel-verify', 'panel-accounts', 'panel-noti'];
      const menuMap = {
        'menu-dashboard': 'panel-dashboard',
        'menu-verify': 'panel-verify',
        'menu-accounts': 'panel-accounts',
        'menu-noti': 'panel-noti'
      };
      panels.forEach(pid => {
        const el = document.getElementById(pid);
        if (el) el.style.display = (pid === target) ? 'block' : 'none';
      });
      document.querySelectorAll('.menu .menu-item').forEach(b => b.classList.remove('active'));
      document.getElementById('menu-dashboard')?.classList.add('active');
    });

    // Default panel
    showPanel('panel-dashboard');

    // Logout
    document.getElementById('menu-logout')?.addEventListener('click', () => { window.location.href = '/'; });
  });
})();
