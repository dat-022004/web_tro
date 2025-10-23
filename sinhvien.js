(() => {
  document.addEventListener('DOMContentLoaded', () => {
    // Admin contact config (có thể chỉnh sửa nhanh tại đây)
    const ADMIN_CONTACT = {
      hoTen: 'Quản trị viên',
      sdt: '0921224974',
      zalo: 'https://zalo.me/0921224974',
      fb: 'https://www.facebook.com/share/1N48br4N8F/?mibextid=wwXIfr',
      email: 'admin@gmail.com'
    };

    const qs = new URLSearchParams(location.search);
    const emailQS = (qs.get('email') || '').trim();

    const btnProfile = document.getElementById('menu-profile');
    const btnSearch = document.getElementById('menu-search');
    const panelProfile = document.getElementById('panel-profile');
    const panelSearch = document.getElementById('panel-search');
    const btnRented = document.getElementById('menu-rented');
    const btnNoti = document.getElementById('menu-noti');
    const panelRented = document.getElementById('panel-rented');
    const panelNoti = document.getElementById('panel-noti');
    const btnFeedback = document.getElementById('menu-feedback');
    const panelFeedback = document.getElementById('panel-feedback');

    // Profile elements
    const frmProfile = document.getElementById('frm-profile');
    const ipEmail = document.getElementById('email');
    const ipHoTen = document.getElementById('hoTen');
    const ipSDT = document.getElementById('soDienThoai');
    const ipTruong = document.getElementById('truong');

    const frmSearch = document.getElementById('frm-search');
    const qAddress = document.getElementById('q-address');
    const searchResults = document.getElementById('search-results');
    const landlordRooms = document.getElementById('landlord-rooms');

    const overlay = document.getElementById('hop-thong-bao-nen');
    const overlayMsg = document.getElementById('hop-thong-bao-noi-dung');
    document.getElementById('hop-thong-bao-dong')?.addEventListener('click', () => overlay && (overlay.style.display = 'none'));
    function showMsg(msg) {
      if (!overlay || !overlayMsg) return alert(msg);
      overlayMsg.textContent = msg;
      overlay.style.display = 'flex';
    }

    // Populate support footer
    try {
      const nm = document.getElementById('sf-name');
      const ph = document.getElementById('sf-phone');
      const zl = document.getElementById('sf-zalo');
      const fb = document.getElementById('sf-fb');
      if (nm) nm.textContent = ADMIN_CONTACT.hoTen || 'Quản trị viên';
      if (ph) { ph.textContent = ADMIN_CONTACT.sdt || '—'; ph.href = ADMIN_CONTACT.sdt ? `tel:${ADMIN_CONTACT.sdt}` : '#'; }
      if (zl) { zl.href = ADMIN_CONTACT.zalo || '#'; zl.target = '_blank'; zl.rel = 'noopener'; }
      if (fb) { fb.href = ADMIN_CONTACT.fb || '#'; fb.target = '_blank'; fb.rel = 'noopener'; }
    } catch {}

    // NEW: helper gọi điện
    function dialNumber(raw) {
      const ph = String(raw || '').replace(/[^\d+]/g, '');
      if (!ph) return showMsg('Số điện thoại không hợp lệ hoặc chưa được cung cấp');
      window.location.href = `tel:${ph}`;
    }

    // NEW: chọn cách liên hệ (Zalo hoặc gọi sim)
    function openContactOptions(rawPhone, displayName) {
      const ph = String(rawPhone || '').replace(/[^\d+]/g, '');
      if (!overlay || !overlayMsg) {
        // Fallback: nếu không có overlay thì mở tel trực tiếp
        return dialNumber(ph);
      }
      const zaloUrl = ph ? `https://zalo.me/${ph.replace(/^\+?84/, '0')}` : '#';
      const nameSafe = displayName ? String(displayName).replace(/</g,'&lt;').replace(/>/g,'&gt;') : 'chủ trọ';
      overlayMsg.innerHTML = `
        <div class="contact-modal">
          <div class="contact-header">
            <div class="contact-icon">📞</div>
            <div>
              <div class="contact-title">Liên hệ</div>
              <div class="contact-sub">Chọn phương thức liên hệ với <strong>${nameSafe}</strong></div>
            </div>
          </div>
          <div class="contact-actions">
            <a class="btn btn-zalo" href="${zaloUrl}" target="_blank" rel="noopener" ${ph?'':'aria-disabled="true"'}>Zalo</a>
            <a class="btn btn-call" href="tel:${ph}" ${ph?'':'aria-disabled="true"'}>Gọi</a>
          </div>
          <div class="contact-footer"><button type="button" class="btn btn-secondary" id="ct-close">Đóng</button></div>
        </div>`;
      overlay.style.display = 'flex';
      // Tùy biến nút đóng riêng cho modal đẹp hơn
      const defClose = document.getElementById('hop-thong-bao-dong');
      if (defClose) defClose.style.display = 'none';
      document.getElementById('ct-close')?.addEventListener('click', () => {
        overlay.style.display = 'none';
        if (defClose) defClose.style.display = '';
      });
    }

    // ===== Drawer/Hamburger (mobile) placed BEFORE any showPanel calls =====
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

    let currentLandlordId = null;

    function showPanel(which) {
      if (panelProfile) panelProfile.style.display = which === 'profile' ? 'block' : 'none';
      if (panelSearch) panelSearch.style.display = which === 'search' ? 'block' : 'none';
      if (panelRented) panelRented.style.display = which === 'rented' ? 'block' : 'none';
      if (panelFeedback) panelFeedback.style.display = which === 'feedback' ? 'block' : 'none';
      if (panelNoti) panelNoti.style.display = which === 'noti' ? 'block' : 'none';
      document.querySelectorAll('.menu .menu-item').forEach(b => b.classList.remove('active'));
      const map = { profile: btnProfile, search: btnSearch, rented: btnRented, feedback: btnFeedback, noti: btnNoti };
      map[which]?.classList.add('active');
      closeDrawer();
    }

    // Load/save profile
    async function loadProfile() {
      if (!emailQS) { showMsg('Thiếu email. Vui lòng đăng nhập lại.'); return; }
      try {
        const j = await fetch(`/api/sinhvien/profile?email=${encodeURIComponent(emailQS)}`, { headers: { Accept: 'application/json' } }).then(r => r.json());
        if (!j?.success) throw new Error(j?.message || 'Lỗi tải hồ sơ');
        const d = j.data || {};
        if (ipEmail) ipEmail.value = d.Email || emailQS;
        if (ipHoTen) ipHoTen.value = d.HoTen || '';
        if (ipSDT) ipSDT.value = d.SoDienThoai || '';
        if (ipTruong) ipTruong.value = d.Truong || '';
        showPanel('profile');
      } catch (err) {
        showMsg(err.message || 'Lỗi tải hồ sơ');
      }
    }

    frmProfile?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const payload = {
          email: ipEmail?.value?.trim() || emailQS,
          hoTen: ipHoTen?.value?.trim() || '',
          soDienThoai: ipSDT?.value?.trim() || '',
          truong: ipTruong?.value?.trim() || ''
        };
        const j = await fetch('/api/sinhvien/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
        if (!j?.success) throw new Error(j?.message || 'Lỗi lưu hồ sơ');
        showMsg('Cập nhật hồ sơ thành công');
      } catch (err) {
        showMsg(err.message || 'Lỗi lưu hồ sơ');
      }
    });

    function renderLandlords(list) {
      if (!searchResults) return;
      if (!Array.isArray(list) || list.length === 0) {
        searchResults.innerHTML = '<em>Không tìm thấy chủ trọ phù hợp.</em>';
        return;
      }
      searchResults.classList.add('cards-grid');
      searchResults.innerHTML = list.map(r => `
<div class="room-card landlord-mini">
  <div class="body">
    <h5 class="title">${r.HoTen || '(Không tên)'}</h5>
    <div class="meta">${r.Email || ''}${r.SoDienThoai ? ' • ' + r.SoDienThoai : ''}</div>
    <div class="meta">${r.DiaChiLienHe || ''}</div>
    <div class="meta">${r.DaXacThuc ? 'Đã xác thực' : 'Chưa xác thực'}</div>
    <div class="actions">
      <button class="btn btn-primary" type="button" data-act="view-rooms" data-id="${r.ChuTroId}">XEM PHÒNG</button>
    </div>
  </div>
</div>`).join('');
    }

    // NEW: mở form nhập hợp đồng và gửi yêu cầu thuê
    function openRentDialog(phongId, defaultPrice) {
      if (!overlay || !overlayMsg) return alert('Không thể mở biểu mẫu');
      overlayMsg.innerHTML = `
        <form id="rent-form">
          <div class="form-group"><label>Ngày bắt đầu</label><input type="date" id="rf-start" required></div>
          <div class="form-group"><label>Ngày kết thúc</label><input type="date" id="rf-end" required></div>
          <div class="form-row" style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="form-group" style="flex:1"><label>Giá thuê/tháng</label><input type="number" step="0.01" id="rf-gia" value="${defaultPrice ?? ''}" required></div>
            <div class="form-group" style="flex:1"><label>Tiền điện</label><input type="number" step="0.01" id="rf-dien"></div>
            <div class="form-group" style="flex:1"><label>Tiền nước</label><input type="number" step="0.01" id="rf-nuoc"></div>
          </div>
          <div class="form-row" style="display:flex;gap:8px;flex-wrap:wrap">
            <div class="form-group" style="flex:1"><label>Tiền rác</label><input type="number" step="0.01" id="rf-rac"></div>
            <div class="form-group" style="flex:1"><label>Tiền mạng</label><input type="number" step="0.01" id="rf-mang"></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="submit" class="btn" id="rf-submit">Gửi yêu cầu</button>
          </div>
        </form>
      `;
      overlay.style.display = 'flex';

      const form = overlayMsg.querySelector('#rent-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!emailQS) return showMsg('Thiếu email. Vui lòng đăng nhập lại.');
        const sd = overlayMsg.querySelector('#rf-start').value;
        const ed = overlayMsg.querySelector('#rf-end').value;
        if (!sd || !ed) return showMsg('Vui lòng nhập đủ ngày bắt đầu và kết thúc');
        if (new Date(ed) < new Date(sd)) return showMsg('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');

        const payload = {
          email: emailQS,
          startDate: sd,
          endDate: ed,
          giaThueThang: overlayMsg.querySelector('#rf-gia').value,
          tienDien: overlayMsg.querySelector('#rf-dien').value,
          tienNuoc: overlayMsg.querySelector('#rf-nuoc').value,
          tienRac:  overlayMsg.querySelector('#rf-rac').value,
          tienMang: overlayMsg.querySelector('#rf-mang').value
        };
        try {
          const resp = await fetch(`/api/rooms/${encodeURIComponent(phongId)}/request-rent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await resp.json();
          if (!json?.success) throw new Error(json?.message || 'Gửi yêu cầu thất bại');
          showMsg('Đã gửi yêu cầu thuê. Vui lòng chờ chủ trọ xác nhận.');
          if (currentLandlordId) {
            const r2 = await fetch(`/api/landlords/${encodeURIComponent(currentLandlordId)}/rooms`, { headers: { Accept: 'application/json' } });
            const j2 = await r2.json();
            if (j2?.success) renderRooms(j2.data);
          }
        } catch (err) {
          showMsg(err.message || 'Gửi yêu cầu thất bại');
        }
      });
    }

    function renderRooms(payload) {
      if (!landlordRooms) return;
      const ct = payload?.landlord || {};
      const rooms = payload?.rooms || [];
      currentLandlordId = ct.ChuTroId || null;
      landlordRooms.setAttribute('data-chutro-id', currentLandlordId ? String(currentLandlordId) : '');

      const header = `
<div class="card" style="margin:8px 0">
  <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
    <div>
      <strong>Chủ trọ:</strong> ${ct.HoTen || ''} • ${ct.Email || ''} • ${ct.SoDienThoai || ''}<br>
      <strong>Liên hệ:</strong> ${ct.DiaChiLienHe || ''} • ${ct.DaXacThuc ? 'Đã xác thực' : 'Chưa xác thực'}
    </div>
    ${ct.SoDienThoai ? `<button class="btn" type="button" data-act="call" data-phone="${ct.SoDienThoai}">LIÊN HỆ</button>` : ''}
  </div>
</div>`;
      if (!rooms.length) {
        landlordRooms.innerHTML = header + '<em>Chủ trọ chưa đăng phòng nào.</em>';
        return;
      }
      const cards = rooms.map(p => {
        const daThue = !!p.DaCoNguoiThue || p.TrangThai === 1;
        const rentBtn = !daThue ? `<button type="button" data-act="rent" data-id="${p.PhongId}" data-price="${p.GiaCoBan ?? ''}">Thuê</button>` : '';
        // Map: use LinkMap from API directly per requirement
        const mapUrl = p.LinkMap ? String(p.LinkMap) : '';

        // Ảnh: dựng gallery theo số lượng (mosaic)
        const imgs = Array.isArray(p.Images) ? p.Images.filter(Boolean) : [];
        const n = imgs.length;
        let galleryClass = 'gallery--n1';
        if (n === 2) galleryClass = 'gallery--n2';
        else if (n === 3) galleryClass = 'gallery--n3';
        else if (n === 4) galleryClass = 'gallery--n4';
        else if (n === 5) galleryClass = 'gallery--n5';
        else if (n >= 6) galleryClass = 'gallery--n6plus';

        const imgHtml = n
          ? imgs.slice(0, Math.max(5, Math.min(n, 6)))
              .map(u => `<img src="${u}" data-full="${u}" alt="Ảnh phòng" loading="lazy" />`).join('')
          : '<div class="gallery-empty">Chưa có ảnh</div>';

        const cover = imgs[0] || null;
        const priceStr = (p.GiaCoBan != null) ? Number(p.GiaCoBan).toLocaleString('vi-VN') + ' VND' : '—';
        return `
<div class="room-card">
  <div class="left">
    <div class="thumb">
      ${cover ? `<img src="${cover}" data-full="${cover}" data-images='${JSON.stringify(imgs)}' data-index="0" alt="Ảnh phòng" loading="lazy" />` : `<div class="gallery-empty" style="position:absolute;inset:0">Chưa có ảnh</div>`}
    </div>
    <div class="status-box ${daThue ? 'busy' : 'empty'}">${daThue ? 'ĐÃ CÓ NGƯỜI THUÊ' : 'ĐANG TRỐNG'}</div>
  </div>
  <div class="body">
    <h4 class="title">#${p.PhongId} - ${p.TieuDe || ''}</h4>
    <div class="price">${priceStr}</div>
    <div class="meta">Diện tích: ${p.DienTichM2 ?? '—'} • Tối đa: ${p.SoNguoiToiDa ?? '—'}</div>
    <div class="meta">${[p.PhuongXa, p.QuanHuyen, p.ThanhPho].filter(Boolean).join(', ')}</div>
    ${p.MoTa ? `<div class="desc">${String(p.MoTa).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
    <div class="icons">${imgs.length ? `📷 ${imgs.length}` : ''}</div>
    <div class="actions">
      ${mapUrl ? `<button class="btn btn-outline btn-sm" type="button" data-act="map" data-map="${String(mapUrl).replace(/"/g,'&quot;')}">CHỈ ĐƯỜNG</button>` : ''}
      ${rentBtn ? rentBtn.replace('<button', '<button class="btn btn-primary"') : ''}
    </div>
  </div>
</div>`;
      }).join('');

      landlordRooms.innerHTML = header + `<div class="cards-grid">${cards}</div>`;
    }

    // NEW: click thumbnail -> phóng to trong overlay
    // Lightbox: xem gallery nhiều ảnh, có next/prev
    function openLightbox(imgList, startIndex=0) {
      if (!overlay || !overlayMsg) { if (imgList?.[startIndex]) window.open(imgList[startIndex], '_blank'); return; }
      const images = Array.isArray(imgList) ? imgList.filter(Boolean) : [];
      if (!images.length) return;
      let idx = Math.max(0, Math.min(startIndex, images.length-1));
      overlayMsg.innerHTML = `
        <div class="lightbox">
          <div class="viewport" id="lb-vp">
            <img id="lb-img" src="${images[idx]}" alt="Ảnh phòng" />
            ${images.length>1?'<div class="nav prev" id="lb-prev">‹</div><div class="nav next" id="lb-next">›</div>':''}
          </div>
          <div class="counter" id="lb-counter">${idx+1} / ${images.length}</div>
        </div>`;
      overlay.style.display = 'flex';

      const imgEl = document.getElementById('lb-img');
      const counter = document.getElementById('lb-counter');
      function render() {
        imgEl.src = images[idx];
        if (counter) counter.textContent = `${idx+1} / ${images.length}`;
      }
      function next(){ idx = (idx+1) % images.length; render(); }
      function prev(){ idx = (idx-1+images.length) % images.length; render(); }
      document.getElementById('lb-next')?.addEventListener('click', next);
      document.getElementById('lb-prev')?.addEventListener('click', prev);
      // keyboard
      const keyHandler = (ev)=>{ if(ev.key==='ArrowRight') next(); else if(ev.key==='ArrowLeft') prev(); else if(ev.key==='Escape'){ overlay.style.display='none'; document.removeEventListener('keydown', keyHandler);} };
      document.addEventListener('keydown', keyHandler);
      // swipe
      let sx=0, sy=0;
      const vp = document.getElementById('lb-vp');
      vp?.addEventListener('touchstart', (e)=>{ const t=e.touches[0]; sx=t.clientX; sy=t.clientY; });
      vp?.addEventListener('touchend', (e)=>{ const t=e.changedTouches[0]; const dx=t.clientX-sx; const dy=t.clientY-sy; if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)) { dx<0?next():prev(); } });
    }

    landlordRooms?.addEventListener('click', (e) => {
      const img = e.target.closest('img[data-full]');
      if (!img) return;
      const listAttr = img.getAttribute('data-images');
      let list = [];
      try { list = JSON.parse(listAttr || '[]'); } catch {}
      if (!Array.isArray(list) || !list.length) list = [img.getAttribute('data-full')];
      const start = Number(img.getAttribute('data-index') || '0') || 0;
      openLightbox(list, start);
    });

    // Open map: open LinkMap URL directly in a new tab
    async function openMap(mapVal) {
      if (!mapVal) return;
      const url = String(mapVal).trim();
      if (!url) return;
      window.open(url, '_blank', 'noopener');
    }

    frmSearch?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = qAddress?.value?.trim();
      if (!q) return showMsg('Nhập địa chỉ cần tìm');
      try {
        const resp = await fetch(`/api/search/landlords?query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tìm kiếm');
        renderLandlords(json.data || []);
        if (landlordRooms) landlordRooms.innerHTML = '';
      } catch (err) {
        showMsg(err.message || 'Lỗi tìm kiếm');
      }
    });

    searchResults?.addEventListener('click', async (e) => {
      // NEW: liên hệ từ danh sách chủ trọ (Zalo hoặc gọi)
      const callBtn = e.target.closest('button[data-act="call"]');
      if (callBtn) { openContactOptions(callBtn.getAttribute('data-phone')); return; }

      const btn = e.target.closest('button[data-act="view-rooms"]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      try {
        const resp = await fetch(`/api/landlords/${encodeURIComponent(id)}/rooms`, { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải phòng');
        renderRooms(json.data);
      } catch (err) {
        showMsg(err.message || 'Lỗi tải phòng');
      }
    });

    landlordRooms?.addEventListener('click', async (e) => {
      const btnCall = e.target.closest('button[data-act="call"]');
      if (btnCall) { openContactOptions(btnCall.getAttribute('data-phone')); return; }

      const mapBtn = e.target.closest('button[data-act="map"]');
      if (mapBtn) { openMap(mapBtn.getAttribute('data-map')); return; }

      const btn = e.target.closest('button[data-act="rent"]');
      if (!btn) return;
      const pid = btn.getAttribute('data-id');
      const price = btn.getAttribute('data-price');
      openRentDialog(pid, price);
    });

    // ====== Trọ đã thuê ======
    const rentedList = document.getElementById('rented-list');

    async function loadMyContracts() {
      if (!panelRented || !rentedList) return;
      if (!emailQS) { rentedList.innerHTML = '<em>Thiếu email. Vui lòng đăng nhập lại.</em>'; return; }
      try {
        rentedList.innerHTML = '<em>Đang tải...</em>';
        const resp = await fetch(`/api/sinhvien/contracts?email=${encodeURIComponent(emailQS)}`, { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải');
        const arr = json.data || [];
        if (!arr.length) { rentedList.innerHTML = '<em>Bạn chưa có hợp đồng đang hiệu lực.</em>'; return; }
        const header = `
          <thead>
            <tr>
              <th>HĐ</th>
              <th>Phòng</th>
              <th>Địa chỉ</th>
              <th>Thời gian</th>
              <th>Giá/tháng</th>
              <th>Phí</th>
              <th>Chủ trọ</th>
              <th>Lịch sử tiền trọ</th>
              <th>Thao tác</th>
            </tr>
          </thead>`;
        const rows = arr.map(c => {
          const ngay = `${(c.NgayBatDau||'').slice(0,10)} → ${(c.NgayKetThuc||'').slice(0,10)}`;
          const gia = Number(c.GiaThueThang||0).toLocaleString('vi-VN') + 'đ';
          const chips = [
            c.TienDien!=null?`<span class='chip'>điện <strong>${c.TienDien}</strong></span>`:'',
            c.TienNuoc!=null?`<span class='chip'>nước <strong>${c.TienNuoc}</strong></span>`:'',
            c.TienRac!=null?`<span class='chip'>rác <strong>${c.TienRac}</strong></span>`:'',
            c.TienMang!=null?`<span class='chip'>mạng <strong>${c.TienMang}</strong></span>`:'',
          ].filter(Boolean).join(' ');
          const callBtn = c.CT_SDT ? `<button type="button" class="btn btn-secondary btn-sm" data-act="call" data-phone="${c.CT_SDT}">Liên hệ</button>` : '';
          const leaveBtn = `<button type="button" class="btn btn-danger btn-sm" data-act="leave" data-id="${c.HopDongId}">Rời trọ</button>`;
          return `
            <tr>
              <td>HD#${c.HopDongId}</td>
              <td>#${c.PhongId} - ${c.TieuDe||''}</td>
              <td>${c.DiaChi||''}</td>
              <td>${ngay}</td>
              <td style="white-space:nowrap"><span class='chip money'>${gia}</span></td>
              <td>${chips?`<div class='chips'>${chips}</div>`:'—'}</td>
              <td>${c.CT_HoTen||''}<br><span class="contract-meta">${c.CT_Email||''}${c.CT_SDT?(' • '+c.CT_SDT):''}</span></td>
              <td id="sv-pay-${c.HopDongId}"><em>Đang tải...</em></td>
              <td style="display:flex;gap:6px;justify-content:flex-end">${callBtn}${leaveBtn}</td>
            </tr>`;
        }).join('');
        rentedList.innerHTML = `
          <div style="overflow:auto">
            <table class="table table-compact table-striped">
              ${header}
              <tbody>${rows}</tbody>
            </table>
          </div>`;

        // nạp lịch sử tiền trọ cho từng hợp đồng
        await Promise.all(arr.map(async c => {
          try {
            const payDiv = document.getElementById(`sv-pay-${c.HopDongId}`);
            if (!payDiv) return;
            const j = await fetch(`/api/contracts/${c.HopDongId}/payments`).then(r => r.json());
            if (!j?.success) throw new Error(j?.message || 'Lỗi tải');
            const rows = (j.data || []).map(p => {
              const d = new Date(p.ThangTinh);
              const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
              return `<span class='chip money clickable' data-act="pay-detail" data-id="${c.HopDongId}" data-ym="${ym}">${ym}: ${Number(p.SoTien).toLocaleString('vi-VN')}đ</span>`;
            }).join(' ');
            payDiv.innerHTML = rows ? `<div class='chips'>${rows}</div>` : '<em>Chưa có bản ghi tiền trọ.</em>';
          } catch (e) {
            const payDiv = document.getElementById(`sv-pay-${c.HopDongId}`);
            if (payDiv) payDiv.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải tiền trọ'}</span>`;
          }
        }));
      } catch (e) {
        rentedList.innerHTML = `<span style="color:#b91c1c">${e.message || 'Lỗi tải'}</span>`;
      }
    }

    // Call landlord (chọn Zalo hoặc gọi) hoặc mở xác nhận rời trọ
    panelRented?.addEventListener('click', async (e) => {
      const callBtn = e.target.closest('button[data-act="call"]');
      if (callBtn) { openContactOptions(callBtn.getAttribute('data-phone')); return; }
      const chip = e.target.closest('span.chip[data-act="pay-detail"]');
      if (chip) {
        const hopDongId = chip.getAttribute('data-id');
        const ym = chip.getAttribute('data-ym');
        try {
          const j = await fetch(`/api/contracts/${encodeURIComponent(hopDongId)}/payments`).then(r => r.json());
          if (!j?.success) throw new Error(j?.message || 'Lỗi tải');
          const rec = (j.data||[]).find(p => {
            const d = new Date(p.ThangTinh); const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; return k===ym;
          });
          if (!overlay || !overlayMsg) { alert(rec?`${ym}\nSố tiền: ${Number(rec.SoTien).toLocaleString('vi-VN')}đ\nSố điện: ${rec.SoDien??'—'}\nSố nước: ${rec.SoNuoc??'—'}\nGhi chú: ${rec.GhiChu||'—'}`:'Không có dữ liệu'); return; }
          if (!rec) { overlayMsg.textContent = 'Không có dữ liệu'; overlay.style.display = 'flex'; return; }
          overlayMsg.innerHTML = `
            <div class="card" style="padding:16px;min-width:280px">
              <h4 style="margin:0 0 8px">Chi tiết tiền trọ tháng ${ym}</h4>
              <div class="kv" style="margin-top:6px">
                <div class="k">Số tiền</div><div class="v"><span class="chip money">${Number(rec.SoTien).toLocaleString('vi-VN')}đ</span></div>
                <div class="k">Số điện</div><div class="v">${rec.SoDien ?? '—'}</div>
                <div class="k">Số nước</div><div class="v">${rec.SoNuoc ?? '—'}</div>
                <div class="k">Ghi chú</div><div class="v">${rec.GhiChu ? String(rec.GhiChu).replace(/</g,'&lt;') : '—'}</div>
              </div>
              <div style="text-align:right;margin-top:10px"><button type="button" class="btn btn-secondary" id="pay-close">Đóng</button></div>
            </div>`;
          overlay.style.display = 'flex';
          document.getElementById('pay-close')?.addEventListener('click', ()=> overlay.style.display='none');
        } catch (err) {
          showMsg(err.message || 'Lỗi tải chi tiết');
        }
        return;
      }

      const btnLeave = e.target.closest('button[data-act="leave"]');
      if (btnLeave) {
        const id = btnLeave.getAttribute('data-id');
        const room = btnLeave.getAttribute('data-room') || '';
        if (!id) return;
        if (!emailQS) return showMsg('Thiếu email. Vui lòng đăng nhập lại.');

        if (!overlay || !overlayMsg) {
          if (confirm('Bạn chắc chắn muốn rời trọ? Hợp đồng sẽ bị xóa.')) await doLeave(id, '');
          return;
        }

        overlayMsg.innerHTML = `
          <form id="leave-form" style="min-width:280px">
            <h4 style="margin:0 0 8px">Xác nhận rời trọ</h4>
            <div class="contract-meta" style="margin-bottom:6px">HĐ #${id}${room?` • Phòng #${room}`:''}</div>
            <div class="form-group"><label>Lý do rời (tùy chọn)</label><textarea id="lv-reason" rows="3" placeholder="Ví dụ: chuyển nơi ở mới..."></textarea></div>
            <label style="display:flex;gap:8px;align-items:center;margin:6px 0 12px"><input type="checkbox" id="lv-confirm"> Tôi xác nhận muốn rời trọ và xóa hợp đồng</label>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button type="button" id="lv-cancel" class="btn btn-secondary">Hủy</button>
              <button type="submit" class="btn btn-danger">Rời trọ</button>
            </div>
          </form>`;
        overlay.style.display = 'flex';
        document.getElementById('lv-cancel')?.addEventListener('click', () => overlay.style.display = 'none');
        overlayMsg.querySelector('#leave-form')?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (!document.getElementById('lv-confirm')?.checked) { alert('Vui lòng tick xác nhận.'); return; }
          const reason = overlayMsg.querySelector('#lv-reason')?.value || '';
          await doLeave(id, reason);
        });
        return;
      }
    });

    async function doLeave(id, reason='') {
      try {
        const resp = await fetch(`/api/sinhvien/contracts/${encodeURIComponent(id)}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: emailQS, reason })
        });
        const j = await resp.json();
        if (!j?.success) throw new Error(j?.message || 'Thao tác thất bại');
        if (overlay) overlay.style.display = 'none';
        await loadMyContracts();
        showMsg('Bạn đã rời trọ. Chủ trọ sẽ nhận được thông báo.');
      } catch (err) {
        showMsg(err.message || 'Không thể rời trọ');
      }
    }

    // Mặc định mở tab Tìm phòng
    btnSearch?.addEventListener('click', () => { showPanel('search'); qAddress?.focus(); });
    btnRented?.addEventListener('click', () => { showPanel('rented'); loadMyContracts(); });
    btnProfile?.addEventListener('click', loadProfile);
    btnNoti?.addEventListener('click', () => { showPanel('noti'); loadNotifications(); });
    btnFeedback?.addEventListener('click', () => showPanel('feedback'));
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
        const list = json.data || [];
        if (!list.length) { notiTbody.innerHTML = '<tr><td colspan="5">Không có thông báo</td></tr>'; return; }
        notiTbody.innerHTML = list.map(n => {
          const id = n.ThongBaoId ?? n.Id ?? '';
          const type = n.Loai ?? n.Type ?? '';
          const title = n.TieuDe ?? n.Title ?? '';
          const body = n.NoiDung ?? n.Message ?? '';
          const read = !!(n.DaDoc ?? n.Read);
          const btn = read 
            ? '<em>Đã đọc</em>' 
            : `<button type="button" class="btn btn-sm" data-act="read" data-id="${id}">Đánh dấu đã đọc</button>`;
          return `<tr><td>${id}</td><td>${type}</td><td>${title}</td><td>${body}</td><td>${btn}</td></tr>`;
        }).join('');
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

    showPanel('search');

    // Đăng xuất
    document.getElementById('menu-logout')?.addEventListener('click', ()=>{ window.location.href = '/'; });
  });
})();
