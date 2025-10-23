(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const qs = new URLSearchParams(location.search);
    const emailQS = (qs.get('email') || '').trim();

    const btnOpen = document.getElementById('menu-profile');
    const form = document.getElementById('frm-profile');
    const panelProfile = document.getElementById('panel-profile');

    const btnVerify = document.getElementById('menu-verify');
    const panelVerify = document.getElementById('panel-verify');
    const verifyText = document.getElementById('verify-status-text');
    const frmVerify = document.getElementById('frm-verify');
    const loaiGiayTo = document.getElementById('loaiGiayTo');
    const fileInput = document.getElementById('fileMinhChung');
    const previewImg = document.getElementById('verify-preview');

  const btnPost = document.getElementById('menu-post');
    const panelPost = document.getElementById('panel-post');
    const postGuard = document.getElementById('post-guard');
    const btnFeedback = document.getElementById('menu-feedback');
    const panelFeedback = document.getElementById('panel-feedback');
  const btnNoti = document.getElementById('menu-noti');
  const panelNoti = document.getElementById('panel-noti');

    // New: create room + utilities
    const frmRoom = document.getElementById('frm-room');
    const roomTitle = document.getElementById('room-title');
    const roomDesc = document.getElementById('room-desc');
    const roomDiaChi = document.getElementById('room-diachi');
    const roomPhuongXa = document.getElementById('room-phuongxa');
    const roomQuanHuyen = document.getElementById('room-quanhuyen');
    const roomThanhPho = document.getElementById('room-thanhpho');
    const roomDienTich = document.getElementById('room-dientich');
    const roomGia = document.getElementById('room-gia');
    const roomSoNguoiToiDa = document.getElementById('room-songuoitoida');
    const roomMapUrl = document.getElementById('room-mapurl');
    const tienIchList = document.getElementById('tienich-list');
    const roomSelect = document.getElementById('post-room-select');

    // Existing: image upload
    const frmPost = document.getElementById('frm-post');
    const postPhongId = document.getElementById('post-phongId');
    const postFiles = document.getElementById('post-files');
    const postGallery = document.getElementById('post-gallery');

  if (!btnOpen || !form || !panelProfile) return;

    const el = {
      email: document.getElementById('email'),
      hoTen: document.getElementById('hoTen'),
      soDienThoai: document.getElementById('soDienThoai'),
      diaChiLienHe: document.getElementById('diaChiLienHe'),
    };

    const overlay = document.getElementById('hop-thong-bao-nen');
    const overlayMsg = document.getElementById('hop-thong-bao-noi-dung');
    const overlayClose = document.getElementById('hop-thong-bao-dong');
    if (overlayClose) overlayClose.addEventListener('click', () => (overlay.style.display = 'none'));
    function showMsg(msg) {
      if (!overlay || !overlayMsg) return alert(msg);
      overlayMsg.textContent = msg;
      overlay.style.display = 'flex';
    }
    async function readJsonOrThrow(resp) {
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      const text = await resp.text();
      let json;
      if (!ct.includes('application/json')) throw new Error(text.slice(0, 200));
      try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
      if (!resp.ok || !json.success) throw new Error(json.message || 'Lỗi máy chủ');
      return json;
    }
    function showPanel(which) {
      panelProfile.style.display = (which === 'profile') ? 'block' : 'none';
      if (panelVerify) panelVerify.style.display = (which === 'verify') ? 'block' : 'none';
      if (panelPost) panelPost.style.display = (which === 'post') ? 'block' : 'none';
      if (panelManage) panelManage.style.display = (which === 'manage') ? 'block' : 'none';
      if (panelFeedback) panelFeedback.style.display = (which === 'feedback') ? 'block' : 'none';
      if (panelNoti) panelNoti.style.display = (which === 'noti') ? 'block' : 'none';
      // Active state: top menu
      document.querySelectorAll('.menu .menu-item').forEach(b => b.classList.remove('active'));
      const map = { profile: 'menu-profile', verify: 'menu-verify', post: 'menu-post', manage: 'menu-manage', feedback: 'menu-feedback', noti: 'menu-noti' };
      document.getElementById(map[which])?.classList.add('active');
      // Active state: bottom nav
      document.querySelectorAll('.bottom-nav [data-menu]').forEach(b => b.classList.toggle('active', b.getAttribute('data-menu') === which));
      // Close drawer if open (mobile UX)
      closeDrawer();
    }

    async function loadProfile() {
      if (!emailQS) { showMsg('Thiếu email. Vui lòng đăng nhập lại.'); return; }
      try {
        const resp = await fetch(`/api/chutro/profile?email=${encodeURIComponent(emailQS)}`, { headers: { Accept: 'application/json' } });
        const json = await readJsonOrThrow(resp);
        const d = json.data || {};
        el.email.value = d.Email || emailQS;
        el.hoTen.value = d.HoTen || '';
        el.soDienThoai.value = d.SoDienThoai || '';
        el.diaChiLienHe.value = d.DiaChiLienHe || '';
        showPanel('profile');
      } catch (e) { console.error(e); showMsg(e.message || 'Lỗi tải hồ sơ'); }
    }

    async function saveProfile(e) {
      e.preventDefault();
      const payload = {
        email: el.email.value.trim(),
        hoTen: el.hoTen.value.trim(),
        soDienThoai: el.soDienThoai.value.trim(),
        diaChiLienHe: el.diaChiLienHe.value.trim(),
      };
      if (!payload.email) return showMsg('Thiếu email');
      try {
        const resp = await fetch('/api/chutro/profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        await readJsonOrThrow(resp);
        showMsg('Cập nhật hồ sơ thành công');
      } catch (e2) { console.error(e2); showMsg(e2.message || 'Lỗi lưu hồ sơ'); }
    }

    // New: track verified state
    let isVerified = false;

    // Xác thực: tải trạng thái
    async function loadVerifyStatus() {
      if (!emailQS || !verifyText) return;
      try {
        const json = await fetch(`/api/chutro/verify-status?email=${encodeURIComponent(emailQS)}`).then(readJsonOrThrow);
        const st = json.data || {};
        const mapSt = { 0: 'Chờ duyệt', 1: 'Đã duyệt', 2: 'Đã từ chối' };
        const lr = st.lastRequest;
        // Tính verified hợp lệ: cờ trong bảng hoặc yêu cầu gần nhất đã được duyệt
        const verifiedNow = !!st.verified || (!!lr && lr.TrangThai === 1);
        let text = verifiedNow ? 'ĐÃ XÁC THỰC' : (lr ? mapSt[lr.TrangThai] : 'Chưa gửi yêu cầu');
        if (st.verified && st.verifiedAt) {
          const at = new Date(st.verifiedAt);
          if (!isNaN(at.getTime())) {
            text += ` (${at.toLocaleString('vi-VN')})`;
          }
        }
        // New: set verified flag if system marks verified or last request approved
        isVerified = verifiedNow;

        // Update UI text
        verifyText.textContent = isVerified
          ? `Trạng thái: ${text}. Bạn đã được xác thực, không cần gửi lại yêu cầu.`
          : `Trạng thái: ${text}`;

        // New: enable/disable form based on verified state
        if (frmVerify) {
          const ctrls = frmVerify.querySelectorAll('input, select, button[type="submit"]');
          ctrls.forEach(el => { el.disabled = isVerified; });
          // Hide preview image if disabled
          if (isVerified && previewImg) previewImg.style.display = 'none';
        }

        // Hiển thị/ẩn guard đăng bài dựa trên trạng thái đã tính
        if (postGuard) postGuard.style.display = isVerified ? 'none' : 'block';
      } catch (e) {
        verifyText.textContent = 'Trạng thái: lỗi tải';
      }
    }

    // Gửi yêu cầu xác thực
    frmVerify?.addEventListener('submit', async (e) => {
      e.preventDefault();
      // New: block resubmission if already verified
      if (isVerified) {
        showMsg('Bạn đã được xác thực. Không cần gửi lại yêu cầu.');
        return;
      }
      if (!emailQS) return showMsg('Thiếu email');
      const f = fileInput?.files?.[0];
      if (!f) return showMsg('Vui lòng chọn tệp minh chứng');
      try {
        const base64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('Không đọc được tệp'));
          r.readAsDataURL(f);
        });
        const payload = { email: emailQS, loaiGiayTo: loaiGiayTo.value, fileBase64: base64 };
        await fetch('/api/chutro/verify-request', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        }).then(readJsonOrThrow);
        showMsg('Đã gửi yêu cầu xác thực. Vui lòng chờ duyệt.');
        loadVerifyStatus();
      } catch (err) {
        showMsg(err.message || 'Lỗi gửi yêu cầu');
      }
    });

    // Preview selected verification image
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) { if (previewImg) previewImg.style.display = 'none'; return; }
      const r = new FileReader();
      r.onload = () => {
        if (previewImg) {
          previewImg.src = String(r.result);
          previewImg.style.display = 'block';
        }
      };
      r.readAsDataURL(f);
    });

    // Helpers for image upload
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Không đọc được tệp'));
        r.readAsDataURL(file);
      });
    }

    async function loadGallery() {
      if (!postGallery) return;
      postGallery.innerHTML = '';
      const id = Number(postPhongId?.value || 0);
      if (!id) return;
      try {
        const json = await fetch(`/api/rooms/${id}/images`).then(resp => resp.json());
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải ảnh');
        (json.data || []).forEach(img => {
          const el = document.createElement('img');
          el.src = img.url;
          el.alt = `Anh ${img.id}`;
          el.style.cssText = 'width:160px;height:120px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15)';
          postGallery.appendChild(el);
        });
      } catch (e) {
        postGallery.innerHTML = `<div>${e.message || 'Không tải được ảnh'}</div>`;
      }
    }

    // Upload multiple images for a room
    frmPost?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!postFiles?.files?.length) return showMsg('Hãy chọn ít nhất 1 ảnh');
      const pid = Number(postPhongId?.value || 0);
      if (!pid) return showMsg('Thiếu PhongId');

      try {
        const files = Array.from(postFiles.files);
        const arr = await Promise.all(files.map(fileToBase64));
        const resp = await fetch(`/api/rooms/${pid}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ filesBase64: arr })
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Tải ảnh thất bại');
        showMsg(`Đã tải ${json.data.length} ảnh`);
        postFiles.value = '';
        loadGallery();
      } catch (err) {
        showMsg(err.message || 'Lỗi tải ảnh');
      }
    });

    // Reload gallery when PhongId changes
    postPhongId?.addEventListener('change', loadGallery);

    // New: load tiện ích into checklist
    async function loadTienIch() {
      if (!tienIchList) return;
      try {
        const resp = await fetch('/api/tienich', { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải tiện ích');
        tienIchList.innerHTML = '';
        (json.data || []).forEach(ti => {
          const id = `ti-${ti.TienIchId}`;
          const wrap = document.createElement('label');
          wrap.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;';
          wrap.innerHTML = `<input type="checkbox" value="${ti.TienIchId}" id="${id}"><span>${ti.TenTienIch}</span>`;
          tienIchList.appendChild(wrap);
        });
      } catch (e) {
        tienIchList.innerHTML = `<em>${e.message || 'Không tải được tiện ích'}</em>`;
      }
    }

    // New: load my rooms to selector
    async function loadMyRooms() {
      if (!roomSelect) return;
      roomSelect.innerHTML = '<option value="">Đang tải...</option>';
      try {
        const resp = await fetch(`/api/chutro/rooms?email=${encodeURIComponent(emailQS)}`);
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải phòng');
        const arr = json.data || [];
        roomSelect.innerHTML = '<option value="">-- Chọn phòng --</option>';
        arr.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.PhongId;
          // Thêm tên tiện ích vào option nếu có
          const ti = r.TienIch ? ` [${r.TienIch}]` : '';
          opt.textContent = `#${r.PhongId} - ${r.TieuDe}${ti}`;
          roomSelect.appendChild(opt);
        });
        // Auto-select first room
        if (arr.length > 0) {
          roomSelect.value = String(arr[0].PhongId);
          if (postPhongId) postPhongId.value = String(arr[0].PhongId);
          loadGallery();
        }
      } catch (e) {
        roomSelect.innerHTML = `<option value="">${e.message || 'Không tải được danh sách phòng'}</option>`;
      }
    }

    // Sync select -> input + gallery
    roomSelect?.addEventListener('change', () => {
      if (!postPhongId) return;
      postPhongId.value = roomSelect.value || '';
      loadGallery();
    });

    // New: create room submit
    frmRoom?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!emailQS) return showMsg('Thiếu email');

      const payload = {
        email: emailQS,
        tieuDe: roomTitle?.value?.trim(),
        moTa: roomDesc?.value?.trim(),
        // Không cần gửi vị trí, backend sẽ tự gán
        dienTichM2: roomDienTich?.value ? Number(roomDienTich.value) : null,
        giaCoBan: roomGia?.value ? Number(roomGia.value) : null,
        soNguoiToiDa: roomSoNguoiToiDa?.value ? Number(roomSoNguoiToiDa.value) : null,
        tienIchIds: Array.from(tienIchList?.querySelectorAll('input[type=checkbox]:checked') || []).map(i => Number(i.value)),
        mapUrl: roomMapUrl?.value?.trim() || null
      };
      // BỎ kiểm tra địa chỉ
      if (!payload.tieuDe || payload.giaCoBan == null) {
        showMsg('Vui lòng nhập đủ Tiêu đề và Giá cơ bản'); return;
      }

      try {
        const resp = await fetch('/api/chutro/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tạo phòng');
        const id = json.data?.PhongId;
        const names = (json.data?.TienIch || []).join(', ');
        showMsg(`Tạo phòng thành công. PhongId: ${id}${names ? ` | Tiện ích: ${names}` : ''}`);
        if (postPhongId) postPhongId.value = String(id);
        // refresh selector and select this room
        await loadMyRooms();
        if (roomSelect) roomSelect.value = String(id);
        loadGallery();
      } catch (err) {
        showMsg(err.message || 'Lỗi tạo phòng');
      }
    });

    // Đăng bài: chỉ cho xem panel nếu đã xác thực (guard text hiển thị nếu chưa)
    async function openPostPanel() {
      await loadVerifyStatus();
      showPanel('post');
      if (postGuard && postGuard.style.display === 'none') {
        await Promise.all([loadTienIch(), loadMyRooms()]);
      }
    }

    // ------------ Manage: Rent requests ------------
    const btnManage = document.getElementById('menu-manage');
    const panelManage = document.getElementById('panel-manage');
  const rrList = document.getElementById('rr-list');
    const frmPayment = document.getElementById('frm-payment');
    const payContract = document.getElementById('pay-contract');
    const payMonth = document.getElementById('pay-month');
    const payAmount = document.getElementById('pay-amount');
  const payHistory = document.getElementById('pay-history');
  const payElectric = document.getElementById('pay-electric');
  const payWater = document.getElementById('pay-water');
  const payNote = document.getElementById('pay-note');
  const manageRooms = document.getElementById('manage-rooms');
  const manageTab = document.getElementById('manage-tab'); // fallback select (ẩn)
  const manageTabbar = document.getElementById('manage-tabbar'); // tabbar mới
    const tabRequests = document.getElementById('tab-requests');
    const tabPayments = document.getElementById('tab-payments');
    const tabRooms = document.getElementById('tab-rooms');

  // Edit room modal elements
  const editModal = document.getElementById('edit-modal-backdrop');
  const editForm = document.getElementById('frm-edit-room');
  const editRoomId = document.getElementById('edit-room-id');
  const editTitle = document.getElementById('edit-title');
  const editPrice = document.getElementById('edit-price');
  const editArea = document.getElementById('edit-area');
  const editMax = document.getElementById('edit-max');
  const editMap = document.getElementById('edit-map');
  const editDesc = document.getElementById('edit-desc');
  const editCancel = document.getElementById('edit-cancel');
  const editTiList = document.getElementById('edit-tienich-list');
  const editFiles = document.getElementById('edit-files');
  const editGallery = document.getElementById('edit-gallery');

    function showManageTab(which) {
      const w = which || (manageTabbar?.querySelector('.tab-item.active')?.dataset.tab || manageTab?.value || 'requests');
      if (tabRequests) tabRequests.style.display = (w === 'requests') ? 'block' : 'none';
      if (tabPayments) tabPayments.style.display = (w === 'payments') ? 'block' : 'none';
      if (tabRooms) tabRooms.style.display = (w === 'rooms') ? 'block' : 'none';

      if (w === 'requests') loadRentRequests();
      else if (w === 'payments') loadActiveContracts();
      else if (w === 'rooms') loadRoomsManage();
    }

    // Fallback select change
    manageTab?.addEventListener('change', () => {
      // đồng bộ với tabbar
      const val = manageTab.value;
      if (manageTabbar) {
        manageTabbar.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === val));
      }
      showManageTab(val);
    });

    // Tabbar click
    manageTabbar?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab-item');
      if (!btn) return;
      const sel = btn.dataset.tab;
      manageTabbar.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b === btn));
      if (manageTab) manageTab.value = sel; // đồng bộ fallback
      showManageTab(sel);
    });

    async function loadRentRequests() {
      if (!rrList) return;
      if (!emailQS) { rrList.innerHTML = '<em>Thiếu email</em>'; return; }
      try {
        rrList.innerHTML = '<em>Đang tải...</em>';
        const resp = await fetch(`/api/chutro/rent-requests?email=${encodeURIComponent(emailQS)}`, { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
        const arr = json.data || [];
        if (!arr.length) { rrList.innerHTML = '<em>Không có yêu cầu chờ duyệt.</em>'; return; }
        const rows = arr.map(r => `
          <tr>
            <td>#${r.HopDongId}</td>
            <td>#${r.PhongId} - ${r.TieuDe}</td>
            <td>${r.SV_HoTen || '(Chưa cập nhật)'}<br><small>${r.SV_Email || ''}</small></td>
            <td>${(r.GiaThueThang || r.DeXuatGia || 0).toLocaleString('vi-VN')}</td>
            <td>
              <button class="btn btn-success btn-sm" data-action="approve" data-id="${r.HopDongId}">Duyệt</button>
              <button class="btn btn-danger btn-sm" data-action="reject" data-id="${r.HopDongId}">Từ chối</button>
            </td>
          </tr>
        `).join('');
        rrList.innerHTML = `
          <table class="table">
            <thead><tr><th>Yêu cầu</th><th>Phòng</th><th>Sinh viên</th><th>Giá</th><th>Thao tác</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      } catch (e) {
        rrList.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải yêu cầu'}</span>`;
      }
    }

    rrList?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-id'));
      const act = btn.getAttribute('data-action');
      if (!id) return;
      try {
        if (act === 'approve') {
          await fetch(`/api/chutro/rent-requests/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(r => r.json()).then(j => { if (!j.success) throw new Error(j.message); });
          showMsg('Đã duyệt yêu cầu.');
        } else if (act === 'reject') {
          await fetch(`/api/chutro/rent-requests/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(r => r.json()).then(j => { if (!j.success) throw new Error(j.message); });
          showMsg('Đã từ chối yêu cầu.');
        }
        await Promise.all([loadRentRequests(), loadActiveContracts()]);
      } catch (e) {
        showMsg(e.message || 'Lỗi thao tác');
      }
    });

    // ------------ Manage: Active contracts + Payments ------------
    async function loadActiveContracts() {
      if (!payContract || !manageRooms) return;
      if (!emailQS) return;
      try {
        payContract.innerHTML = '<option value="">Đang tải...</option>';
        const resp = await fetch(`/api/chutro/contracts?email=${encodeURIComponent(emailQS)}`);
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
        const arr = json.data || [];
        payContract.innerHTML = '<option value="">-- Chọn hợp đồng/phòng --</option>';
        arr.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.HopDongId;
          opt.textContent = `HD#${c.HopDongId} - #${c.PhongId} ${c.TieuDe} (${Number(c.GiaThueThang || c.GiaCoBan || 0).toLocaleString('vi-VN')}đ)`;
          payContract.appendChild(opt);
        });
        // Auto-select first contract (nếu có) và tải rates + history
        const firstReal = payContract.querySelector('option[value]:not([value=""])');
        if (firstReal) {
          payContract.value = firstReal.value;
          // fetch rates + history, không phụ thuộc sự kiện change của người dùng
          try { await fetchRatesAndHistory(firstReal.value); } catch {}
        } else {
          if (payHistory) payHistory.innerHTML = '<em>Chưa có hợp đồng hiệu lực</em>';
        }
      } catch (e) {
        payContract.innerHTML = `<option value="">${e.message || 'Lỗi tải'}</option>`;
        manageRooms.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải'}</span>`;
      }
    }

    async function loadPaymentHistory(contractId) {
      if (!payHistory || !contractId) { if (payHistory) payHistory.innerHTML = ''; return; }
      try {
        payHistory.innerHTML = '<em>Đang tải lịch sử...</em>';
        const json = await fetch(`/api/contracts/${contractId}/payments`).then(r => r.json());
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
        const arr = json.data || [];
        if (!arr.length) { payHistory.innerHTML = '<em>Chưa có bản ghi tiền trọ.</em>'; return; }
        const rows = arr.map(p => {
          const d = new Date(p.ThangTinh);
          const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          return `
            <tr>
              <td>${ym}</td>
              <td>${Number(p.SoTien).toLocaleString('vi-VN')}đ</td>
              <td>${p.SoDien ?? '—'}</td>
              <td>${p.SoNuoc ?? '—'}</td>
              <td>${p.GhiChu ? String(p.GhiChu).replace(/</g,'&lt;') : '—'}</td>
            </tr>`;
        }).join('');
        payHistory.innerHTML = `
          <table class="table">
            <thead><tr><th>Tháng</th><th>Số tiền</th><th>Số điện</th><th>Số nước</th><th>Ghi chú</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      } catch (e) {
        payHistory.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải lịch sử'}</span>`;
      }
    }

    // Auto-calc payment: fetch rates for selected contract and compute as user types
    let currentRates = null; // { base, dien, nuoc, rac, mang }

    function computeAutoAmount() {
      if (!payAmount) return;
      const e = Number(payElectric?.value || 0) || 0;
      const w = Number(payWater?.value || 0) || 0;
      const r = currentRates || { base: 0, dien: 0, nuoc: 0, rac: 0, mang: 0 };
      // Tổng = tiền nhà cơ bản + (điện*kWh*đơn giá điện) + (nước*m3*đơn giá nước) + rác + mạng
      const total = Number(r.base || 0) + e * Number(r.dien || 0) + w * Number(r.nuoc || 0) + Number(r.rac || 0) + Number(r.mang || 0);
      payAmount.value = String(Math.max(0, Math.round(total)));
    }

    async function fetchRatesAndHistory(contractId) {
      currentRates = null;
      await loadPaymentHistory(contractId);
      if (!contractId) return;
      try {
        const resp = await fetch(`/api/contracts/${contractId}/rates`, { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải biểu phí');
        currentRates = json.data || null;
        computeAutoAmount();
      } catch (e) {
        // Không chặn quy trình nếu lỗi, chỉ không tự tính
        currentRates = null;
      }
    }

    payContract?.addEventListener('change', () => fetchRatesAndHistory(payContract.value));
    payElectric?.addEventListener('input', computeAutoAmount);
    payWater?.addEventListener('input', computeAutoAmount);

    frmPayment?.addEventListener('submit', async (e) => {
      e.preventDefault();
  const cid = Number(payContract?.value || 0);
      const month = (payMonth?.value || '').trim(); // yyyy-mm
      const amount = Number(payAmount?.value || 0);
      const soDien = payElectric?.value?.trim();
      const soNuoc = payWater?.value?.trim();
      const ghiChu = payNote?.value?.trim();
      if (!cid) return showMsg('Vui lòng chọn hợp đồng/phòng');
      if (!month) return showMsg('Vui lòng chọn tháng');
      if (!(amount >= 0)) return showMsg('Số tiền không hợp lệ');
      try {
        const resp = await fetch(`/api/contracts/${cid}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ month, amount, soDien, soNuoc, ghiChu })
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lưu tiền trọ thất bại');
        showMsg('Đã lưu tiền trọ');
        await loadPaymentHistory(cid);
      } catch (e2) {
        showMsg(e2.message || 'Lỗi lưu tiền trọ');
      }
    });

    // NEW: load both rented and vacant rooms
    async function loadRoomsManage() {
      if (!manageRooms) return;
      if (!emailQS) { manageRooms.innerHTML = '<em>Thiếu email</em>'; return; }
      try {
        manageRooms.innerHTML = '<em>Đang tải...</em>';
        const resp = await fetch(`/api/chutro/rooms?email=${encodeURIComponent(emailQS)}`);
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
        const arr = json.data || [];
        if (!arr.length) { manageRooms.innerHTML = '<em>Bạn chưa có phòng nào.</em>'; return; }

        const rows = arr.map(r => {
          const status = r.DaCoNguoiThue ? '<span style="color:#16a34a;font-weight:600">Đang thuê</span>'
                                         : '<span style="color:#b91c1c;font-weight:600">Chưa thuê</span>';
          const tenant = r.DaCoNguoiThue ? (r.TenantHoTen || r.TenantEmail || '(Không rõ)') : '';
          const hd = r.HopDongIdHienTai ? `HD#${r.HopDongIdHienTai}${tenant ? ' • ' + tenant : ''}` : '';
          const editBtn = `<button data-action="edit" data-room-id="${r.PhongId}" class="btn btn-secondary btn-sm">Sửa</button>`;
          const act = r.HopDongIdHienTai
            ? `${editBtn} <button data-action="evict" data-contract-id="${r.HopDongIdHienTai}" data-room-id="${r.PhongId}" class="btn btn-danger btn-sm">Đuổi</button>`
            : `${editBtn}`;
          return `
            <tr>
              <td>#${r.PhongId}</td>
              <td>${r.TieuDe}</td>
              <td>${Number(r.GiaCoBan || 0).toLocaleString('vi-VN')}đ</td>
              <td>${status}</td>
              <td>${hd}</td>
              <td>${act}</td>
            </tr>
          `;
        }).join('');

        manageRooms.innerHTML = `
          <table class="table">
            <thead>
              <tr><th>Phòng</th><th>Tiêu đề</th><th>Giá</th><th>Trạng thái</th><th>Hợp đồng/Người thuê</th><th>Thao tác</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      } catch (e) {
        manageRooms.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải danh sách phòng'}</span>`;
      }
    }

    // Open edit modal and load current room details
    async function openEditModal(roomId) {
      if (!emailQS) return showMsg('Thiếu email');
      try {
        const url = `/api/chutro/rooms/${encodeURIComponent(roomId)}?email=${encodeURIComponent(emailQS)}`;
        const json = await fetch(url, { headers: { Accept: 'application/json' } }).then(r => r.json());
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải chi tiết phòng');
        const r = json.data || {};
        if (editRoomId) editRoomId.value = roomId;
        if (editTitle) editTitle.value = r.TieuDe || '';
        if (editPrice) editPrice.value = r.GiaCoBan ?? '';
        if (editArea) editArea.value = r.DienTichM2 ?? '';
        if (editMax) editMax.value = r.SoNguoiToiDa ?? '';
        if (editMap) editMap.value = r.LinkMap || '';
        if (editDesc) editDesc.value = r.MoTa || '';
        // tiện ích
        await loadEditTienIch(r.TienIchIds || []);
        // ảnh
        await loadEditGallery(roomId);
        if (editModal) editModal.style.display = 'flex';
      } catch (e) {
        showMsg(e.message || 'Lỗi tải chi tiết phòng');
      }
    }

    async function loadEditTienIch(selectedIds) {
      if (!editTiList) return;
      try {
        const resp = await fetch('/api/tienich', { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải tiện ích');
        const set = new Set(Array.isArray(selectedIds) ? selectedIds.map(Number) : []);
        editTiList.innerHTML = '';
        (json.data || []).forEach(ti => {
          const wrap = document.createElement('label');
          wrap.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;';
          const checked = set.has(Number(ti.TienIchId)) ? 'checked' : '';
          wrap.innerHTML = `<input type="checkbox" value="${ti.TienIchId}" ${checked}><span>${ti.TenTienIch}</span>`;
          editTiList.appendChild(wrap);
        });
      } catch (e) {
        editTiList.innerHTML = `<em>${e.message || 'Không tải được tiện ích'}</em>`;
      }
    }

    async function loadEditGallery(roomId) {
      if (!editGallery) return;
      editGallery.innerHTML = '<em>Đang tải ảnh...</em>';
      try {
        const json = await fetch(`/api/rooms/${roomId}/images`).then(r => r.json());
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải ảnh');
        const arr = json.data || [];
        if (!arr.length) { editGallery.innerHTML = '<em>Chưa có ảnh</em>'; return; }
        editGallery.innerHTML = '';
        arr.forEach(img => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative';
          wrap.innerHTML = `
            <img src="${img.url}" alt="img" style="width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb"/>
            <button type="button" class="btn btn-danger btn-sm" data-act="del-img" data-id="${img.id}" style="position:absolute;top:4px;right:4px;padding:4px 8px">Xóa</button>
          `;
          editGallery.appendChild(wrap);
        });
      } catch (e) {
        editGallery.innerHTML = `<em>${e.message || 'Không tải được ảnh'}</em>`;
      }
    }

    // Open Manage panel
    async function openManagePanel() {
      showPanel('manage');
      // đảm bảo tab đầu tiên được active
      if (manageTabbar) {
        const first = manageTabbar.querySelector('.tab-item');
        manageTabbar.querySelectorAll('.tab-item').forEach((b,i) => b.classList.toggle('active', i===0));
        if (manageTab) manageTab.value = first?.dataset.tab || 'requests';
      }
      showManageTab(manageTabbar?.querySelector('.tab-item.active')?.dataset.tab || manageTab?.value || 'requests');
      // auto pick first contract to show history when on payments tab
      await (manageTab?.value === 'payments' ? loadActiveContracts() : Promise.resolve());
      const first = payContract?.querySelector('option[value]:not([value=""])');
      if (first && (manageTab?.value === 'payments')) { payContract.value = first.value; fetchRatesAndHistory(first.value); }
    }

    // Lắng nghe nút Đuổi
    manageRooms?.addEventListener('click', async (ev) => {
      const editBtn = ev.target.closest('button[data-action="edit"]');
      if (editBtn) { openEditModal(Number(editBtn.getAttribute('data-room-id'))); return; }

      const btn = ev.target.closest('button[data-action="evict"]');
      if (btn) {
        const cid = Number(btn.getAttribute('data-contract-id') || 0);
        const rid = Number(btn.getAttribute('data-room-id') || 0);
        if (!cid) return showMsg('Thiếu hợp đồng');
        if (!confirm(`Xác nhận xóa hợp đồng HD#${cid} và cho phòng #${rid} về trạng thái trống?`)) return;
        try {
          const resp = await fetch(`/api/chutro/contracts/${cid}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
          const json = await resp.json();
          if (!json?.success) throw new Error(json?.message || 'Thao tác thất bại');
          showMsg('Đã xóa hợp đồng và cập nhật phòng trống');
          await Promise.all([loadRoomsManage(), loadActiveContracts()]);
        } catch (e) {
          showMsg(e.message || 'Lỗi thao tác');
        }
      }
    });

    // Close modal
    editCancel?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });

    // Submit edit
    editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!emailQS) return showMsg('Thiếu email');
      const rid = Number(editRoomId?.value || 0);
      if (!rid) return showMsg('Thiếu PhongId');
      const payload = {
        email: emailQS,
        tieuDe: editTitle?.value?.trim(),
        moTa: editDesc?.value?.trim(),
        giaCoBan: editPrice?.value ? Number(editPrice.value) : null,
        dienTichM2: editArea?.value ? Number(editArea.value) : null,
        soNguoiToiDa: editMax?.value ? Number(editMax.value) : null,
        mapUrl: editMap?.value?.trim() || null,
        tienIchIds: Array.from(editTiList?.querySelectorAll('input[type=checkbox]:checked') || []).map(i => Number(i.value))
      };
      try {
        const resp = await fetch(`/api/chutro/rooms/${rid}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lưu thất bại');
        if (editModal) editModal.style.display = 'none';
        await loadRoomsManage();
        showMsg('Đã cập nhật phòng');
      } catch (err) {
        showMsg(err.message || 'Lưu thất bại');
      }
    });

    // Upload images in edit modal
    editFiles?.addEventListener('change', async () => {
      const rid = Number(editRoomId?.value || 0);
      if (!rid) return;
      const files = Array.from(editFiles.files || []);
      if (!files.length) return;
      try {
        const base64s = await Promise.all(files.map(fileToBase64));
        const resp = await fetch(`/api/rooms/${rid}/images`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ filesBase64: base64s })
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Tải ảnh thất bại');
        editFiles.value = '';
        await loadEditGallery(rid);
      } catch (e) { showMsg(e.message || 'Tải ảnh thất bại'); }
    });

    // Delete image from edit gallery
    editGallery?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act="del-img"]');
      if (!btn) return;
      const id = Number(btn.getAttribute('data-id') || 0);
      if (!id) return;
      if (!confirm('Xóa ảnh này?')) return;
      try {
        const resp = await fetch(`/api/rooms/images/${id}?email=${encodeURIComponent(emailQS)}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Xóa ảnh thất bại');
        await loadEditGallery(Number(editRoomId?.value || 0));
      } catch (e) { showMsg(e.message || 'Xóa ảnh thất bại'); }
    });

    // Bind menu (top)
    btnOpen.addEventListener('click', loadProfile);
    form.addEventListener('submit', saveProfile);
    btnVerify?.addEventListener('click', async () => {
      await loadVerifyStatus();
      // Optional: remind when opening the tab
      // if (isVerified) showMsg('Bạn đã được xác thực. Không cần gửi lại yêu cầu.');
      showPanel('verify');
    });
    btnPost?.addEventListener('click', openPostPanel);
    btnManage?.addEventListener('click', openManagePanel);
    btnFeedback?.addEventListener('click', () => showPanel('feedback'));
  btnNoti?.addEventListener('click', () => { showPanel('noti'); loadNotifications(); });

    // Đăng xuất
    const btnLogout = document.getElementById('menu-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => { window.location.href = '/'; });

    // Bind bottom navigation (mobile)
    const bottomNav = document.querySelector('.bottom-nav');
    bottomNav?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-menu]');
      if (!btn) return;
      const act = btn.getAttribute('data-menu');
      if (act === 'profile') { await loadProfile(); return; }
      if (act === 'verify') { await loadVerifyStatus(); showPanel('verify'); return; }
      if (act === 'post') { await openPostPanel(); return; }
      if (act === 'manage') { await openManagePanel(); return; }
      if (act === 'feedback') { showPanel('feedback'); return; }
      if (act === 'noti') { showPanel('noti'); loadNotifications?.(); return; }
      if (act === 'logout') { window.location.href = '/'; return; }
    });

    // --- Drawer (hamburger) for mobile ---
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const menuEl = document.querySelector('.menu');

    function openDrawer() {
      if (!menuEl) return;
      menuEl.classList.add('open');
      if (drawerOverlay) {
        drawerOverlay.hidden = false;
      }
      if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'true');
      // Prevent background scroll if desired (optional)
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      if (!menuEl) return;
      menuEl.classList.remove('open');
      if (drawerOverlay) {
        drawerOverlay.hidden = true;
      }
      if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    function toggleDrawer() {
      if (!menuEl) return;
      if (menuEl.classList.contains('open')) closeDrawer(); else openDrawer();
    }
    hamburgerBtn?.addEventListener('click', toggleDrawer);
    drawerOverlay?.addEventListener('click', closeDrawer);
    // Close drawer when a menu item is tapped
    document.querySelector('.menu')?.addEventListener('click', (e) => {
      const isItem = e.target.closest('.menu-item');
      if (isItem) closeDrawer();
    });
    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    // Link quay lại (giữ nguyên)
    const backLink = document.querySelector('.switch a');
    if (backLink) backLink.href = emailQS ? `/chutro?email=${encodeURIComponent(emailQS)}` : '/chutro';

      // ---------- Feedback form ----------
      const frmFeedback = document.getElementById('frm-feedback');
      const fbType = document.getElementById('fb-type');
      const fbTitle = document.getElementById('fb-title');
      const fbContent = document.getElementById('fb-content');
      frmFeedback?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!emailQS) return showMsg('Thiếu email. Vui lòng đăng nhập lại.');
        const payload = {
          email: emailQS,
          loai: fbType?.value || 'gopy',
          tieuDe: fbTitle?.value?.trim(),
          noiDung: fbContent?.value?.trim()
        };
        if (!payload.tieuDe || !payload.noiDung) return showMsg('Vui lòng nhập đủ Tiêu đề và Nội dung');
        try {
          const resp = await fetch('/api/feedback', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await resp.json();
          if (!json?.success) throw new Error(json?.message || 'Gửi phản hồi thất bại');
          showMsg('Đã gửi phản hồi đến Admin');
          fbTitle.value = '';
          fbContent.value = '';
        } catch (err) {
          showMsg(err.message || 'Gửi phản hồi thất bại');
        }
      });

      // ---------- Notifications ----------
      const notiTypeSel = document.getElementById('noti-type');
      const notiUnreadChk = document.getElementById('noti-unread');
      const notiRefreshBtn = document.getElementById('noti-refresh');
      const notiTbody = document.querySelector('#noti-table tbody');

      async function loadNotifications() {
        if (!panelNoti || !notiTbody) return;
        if (!emailQS) { notiTbody.innerHTML = '<tr><td colspan="5">Thiếu email</td></tr>'; return; }
        const type = notiTypeSel?.value || 'all';
        const onlyUnread = notiUnreadChk?.checked ? '1' : '0';
        notiTbody.innerHTML = '<tr><td colspan="5">Đang tải...</td></tr>';
        try {
          const url = `/api/notifications?email=${encodeURIComponent(emailQS)}&type=${encodeURIComponent(type)}&onlyUnread=${onlyUnread}`;
          const json = await fetch(url, { headers: { Accept: 'application/json' } }).then(r => r.json());
          if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
          const arr = json.data || [];
          if (!arr.length) { notiTbody.innerHTML = '<tr><td colspan="5"><em>Không có thông báo</em></td></tr>'; return; }
          notiTbody.innerHTML = '';
          arr.forEach(n => {
            const tr = document.createElement('tr');
                const act = n.DaDoc 
                  ? '<em>Đã đọc</em>' 
                  : `<button class="btn btn-sm" data-act="read" data-id="${n.ThongBaoId}">Đánh dấu đã đọc</button>`;
            tr.innerHTML = `
              <td>${n.ThongBaoId}</td>
              <td>${n.Loai}</td>
              <td>${n.TieuDe || ''}</td>
              <td>${n.NoiDung || ''}</td>
              <td>${act}</td>
            `;
            notiTbody.appendChild(tr);
          });
        } catch (e) {
          notiTbody.innerHTML = `<tr><td colspan="5">${e.message || 'Lỗi tải'}</td></tr>`;
        }
      }

      notiTypeSel?.addEventListener('change', loadNotifications);
      notiUnreadChk?.addEventListener('change', loadNotifications);
      notiRefreshBtn?.addEventListener('click', loadNotifications);
      document.getElementById('noti-table')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act="read"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        try {
          const resp = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email: emailQS })
          });
          const json = await resp.json();
          if (!json?.success) throw new Error(json?.message || 'Lỗi thao tác');
          loadNotifications();
        } catch (err) {
          showMsg(err.message || 'Lỗi thao tác');
        }
      });
  });
})();
