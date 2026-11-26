(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var naira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  var STATUS = { awaiting_payment: 'Awaiting payment', confirmed: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled' };
  var pill = function (s) { return '<span class="pill p-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span>'; };
  var fdate = function (s) { if (!s) return '-'; var d = new Date(s + 'T00:00:00'); return isNaN(d) ? esc(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  function api(path, body) {
    var o = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { o.method = 'POST'; o.body = JSON.stringify(body); }
    return fetch('/api/admin' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/login') { loginView(); throw new Error('Please log in again.'); }
        if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j;
      });
    });
  }
  var toastT; function toast(m, bad) { var t = $('#toast'); t.textContent = m; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3500); }
  function fail(e) { toast(e.message || 'Something went wrong.', true); }
  function modal(html) {
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = '<div class="modal"><div class="top"><span></span><button class="x" aria-label="Close">&times;</button></div>' + html + '</div>';
    document.body.appendChild(bg); var close = function () { bg.remove(); }; bg.close = close;
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); }); $('.x', bg).onclick = close; return bg;
  }

  /* image upload: shrinks the photo in the browser first so uploads stay fast on phones */
  function pickImages(multiple) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp'; inp.multiple = !!multiple;
      inp.onchange = function () { resolve([].slice.call(inp.files)); }; inp.click();
    });
  }
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1800, s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { reject(new Error('That file is not a usable image.')); }; img.src = u;
    });
  }
  function uploadFiles(files) { return files.reduce(function (p, f) { return p.then(function (urls) { return shrink(f).then(function (d) { return api('/upload', { data: d }); }).then(function (r) { urls.push(r.url); return urls; }); }); }, Promise.resolve([])); }

  /* ---------- login ---------- */
  function loginView() {
    $('#app').innerHTML = '<div class="login"><img src="phibs-logo.png" alt="Phibs Luxury Homes"><div class="card"><h2>Admin login</h2><p class="muted">Phibs Luxury Homes website and bookings.</p><form id="lf"><div class="field"><label>Password</label><input id="pw" type="password" autocomplete="current-password" required></div><div class="err" id="le"></div><button class="btn" style="width:100%">Log in</button></form></div></div>';
    $('#lf').onsubmit = function (e) { e.preventDefault(); api('/login', { password: $('#pw').value }).then(start).catch(function (er) { $('#le').textContent = er.message; }); };
  }

  /* ---------- shell ---------- */
  var TABS = [['dash', 'Dashboard'], ['bookings', 'Bookings'], ['apartments', 'Apartments'], ['site', 'Website text'], ['gallery', 'Gallery'], ['enquiries', 'Enquiries'], ['old', 'Old records'], ['account', 'Account']];
  function shell(active) {
    $('#app').innerHTML = '<header><div class="bar"><img src="phibs-logo.png" alt=""><b>Admin</b><a class="btn ghost sm" href="/" target="_blank" rel="noopener" style="color:#fff;background:transparent;border-color:rgba(255,255,255,.4)">View website</a><button id="lo">Log out</button></div><nav><div>' +
      TABS.map(function (t) { return '<a href="#/' + t[0] + '" class="' + (t[0] === active ? 'on' : '') + '">' + t[1] + '</a>'; }).join('') + '</div></nav></header><main id="main"></main>';
    $('#lo').onclick = function () { api('/logout', {}).then(loginView); };
    return $('#main');
  }
  function render() {
    var name = (location.hash.replace('#/', '') || 'dash').split('/')[0]; if (!VIEWS[name]) name = 'dash';
    var el = shell(name); VIEWS[name](el);
  }
  var VIEWS = {};

  /* ---------- dashboard ---------- */
  VIEWS.dash = function (el) {
    api('/summary').then(function (d) {
      var row = function (b) { return '<tr class="click" data-ref="' + esc(b.ref) + '"><td><b>' + esc(b.name) + '</b><div class="muted">' + esc(b.room) + '</div></td><td>' + fdate(b.checkin) + ' to ' + fdate(b.checkout) + '</td><td>' + pill(b.status) + '</td></tr>'; };
      el.innerHTML = '<div class="head"><h1>Dashboard</h1></div>' +
        (d.persistent ? '' : '<div class="alert bad"><b>Your data is NOT being saved permanently.</b> Everything entered will be erased on the next update. In Render add a Disk with mount path <b>/var/data</b> and set <b>DATA_DIR</b> to <b>/var/data</b>.</div>') +
        '<div class="grid g4"><div class="stat"><small>Awaiting payment</small><b>' + d.awaiting + '</b></div><div class="stat"><small>Confirmed</small><b>' + d.confirmed + '</b></div><div class="stat"><small>Enquiries received</small><b>' + d.enquiries + '</b></div><div class="stat"><small>Payments recorded</small><b>' + naira(d.collected) + '</b></div></div><div style="height:16px"></div>' +
        '<div class="grid g2"><div class="card scroll"><h3>Staying now</h3><table><tbody>' + (d.inHouse.length ? d.inHouse.map(row).join('') : '<tr><td class="muted">Nobody checked in right now.</td></tr>') + '</tbody></table></div>' +
        '<div class="card scroll"><h3>Coming up</h3><table><tbody>' + (d.upcoming.length ? d.upcoming.map(row).join('') : '<tr><td class="muted">No upcoming bookings.</td></tr>') + '</tbody></table></div></div>' +
        (d.legacy.length ? '<div class="card"><h3>Old system records</h3><p class="muted">' + d.legacy.map(function (t) { return esc(t.name) + ' (' + t.row_count + ')'; }).join(', ') + '. <a href="#/old">Open</a></p></div>' : '');
      $$('tr.click', el).forEach(function (tr) { tr.onclick = function () { sessionStorage.setItem('openRef', tr.getAttribute('data-ref')); location.hash = '#/bookings'; }; });
    }).catch(fail);
  };

  /* ---------- bookings ---------- */
  var BK = { list: [], rooms: [], q: '', st: '' };
  VIEWS.bookings = function (el) {
    api('/bookings').then(function (d) {
      BK.list = d.bookings; BK.rooms = d.rooms; drawBookings(el);
      var ref = sessionStorage.getItem('openRef'); if (ref) { sessionStorage.removeItem('openRef'); var b = BK.list.filter(function (x) { return x.ref === ref; })[0]; if (b) bookingModal(b, el); }
    }).catch(fail);
  };
  function overlaps(b) { return BK.list.some(function (o) { return o.id !== b.id && o.room === b.room && o.status !== 'cancelled' && b.status !== 'cancelled' && o.checkin < b.checkout && b.checkin < o.checkout; }); }
  function drawBookings(el) {
    var q = BK.q.toLowerCase(), rows = BK.list.filter(function (b) { return (!BK.st || b.status === BK.st) && (!q || (b.ref + ' ' + b.name + ' ' + b.email + ' ' + b.phone + ' ' + b.room).toLowerCase().indexOf(q) >= 0); });
    el.innerHTML = '<div class="head"><h1>Bookings</h1><div><a class="btn ghost" href="/api/admin/bookings.csv">Download Excel (CSV)</a> <button class="btn gold" id="add">+ Add booking</button></div></div>' +
      '<div class="card"><div class="grid g3"><div class="field" style="margin:0"><input id="q" placeholder="Search name, phone, reference" value="' + esc(BK.q) + '"></div><div class="field" style="margin:0"><select id="st"><option value="">All statuses</option>' + Object.keys(STATUS).map(function (s) { return '<option value="' + s + '"' + (BK.st === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select></div><div class="muted" style="align-self:center">' + rows.length + ' of ' + BK.list.length + ' bookings</div></div></div>' +
      '<div class="card scroll"><table><thead><tr><th>Reference</th><th>Guest</th><th>Apartment</th><th>Stay</th><th class="num">Total</th><th class="num">Paid</th><th>Status</th></tr></thead><tbody>' +
      (rows.length ? rows.slice(0, 300).map(function (b) { return '<tr class="click" data-id="' + b.id + '"><td>' + esc(b.ref) + '<div class="muted">' + esc((b.created_at || '').slice(0, 10)) + (b.source && b.source !== 'website' ? ' &middot; ' + esc(b.source) : '') + '</div></td><td><b>' + esc(b.name) + '</b><div class="muted">' + esc(b.phone) + '</div></td><td>' + esc(b.room) + (overlaps(b) ? '<div class="pill p-cancelled">Dates overlap</div>' : '') + '</td><td>' + fdate(b.checkin) + ' to ' + fdate(b.checkout) + '<div class="muted">' + b.nights + ' night' + (b.nights > 1 ? 's' : '') + '</div></td><td class="num">' + naira(b.subtotal + b.caution) + '</td><td class="num">' + naira(b.paid) + '</td><td>' + pill(b.status) + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="muted">No bookings found.</td></tr>') + '</tbody></table></div>';
    $('#q').oninput = function () { BK.q = this.value; var pos = this.selectionStart; drawBookings(el); var n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#st').onchange = function () { BK.st = this.value; drawBookings(el); };
    $('#add').onclick = function () { bookingModal(null, el); };
    $$('tr.click', el).forEach(function (tr) { tr.onclick = function () { bookingModal(BK.list.filter(function (b) { return b.id === Number(tr.getAttribute('data-id')); })[0], el); }; });
  }
  function bookingModal(b, el) {
    var isNew = !b; b = b || { name: '', email: '', phone: '', room: BK.rooms[0] || '', checkin: '', checkout: '', guests: 2, rate: '', subtotal: '', caution: 50000, deposit: '', paid: 0, status: 'confirmed', notes: '', message: '' };
    var m = modal('<h2>' + (isNew ? 'Add booking' : esc(b.ref)) + '</h2>' + (isNew ? '' : '<p class="muted">Booked ' + esc((b.created_at || '').slice(0, 16)) + (b.message ? ' &middot; Guest note: ' + esc(b.message) : '') + '</p>') +
      '<form id="bf"><div class="grid g2"><div class="field"><label>Guest name</label><input name="name" value="' + esc(b.name) + '" required></div><div class="field"><label>Phone</label><input name="phone" value="' + esc(b.phone) + '"></div></div>' +
      '<div class="grid g2"><div class="field"><label>Email</label><input name="email" value="' + esc(b.email) + '"></div><div class="field"><label>Apartment</label><select name="room">' + (BK.rooms.indexOf(b.room) < 0 && b.room ? '<option>' + esc(b.room) + '</option>' : '') + BK.rooms.map(function (r) { return '<option' + (r === b.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid g3"><div class="field"><label>Check-in</label><input type="date" name="checkin" value="' + esc(b.checkin) + '" required></div><div class="field"><label>Check-out</label><input type="date" name="checkout" value="' + esc(b.checkout) + '" required></div><div class="field"><label>Guests</label><input name="guests" inputmode="numeric" value="' + esc(b.guests) + '"></div></div>' +
      '<div class="grid g3"><div class="field"><label>Stay total (₦)</label><input name="subtotal" inputmode="numeric" value="' + esc(b.subtotal) + '" placeholder="Auto from rate"></div><div class="field"><label>Caution fee (₦)</label><input name="caution" inputmode="numeric" value="' + esc(b.caution) + '"></div><div class="field"><label>Amount paid so far (₦)</label><input name="paid" inputmode="numeric" value="' + esc(b.paid) + '"></div></div>' +
      '<div class="grid g2"><div class="field"><label>Status</label><select name="status">' + Object.keys(STATUS).map(function (s) { return '<option value="' + s + '"' + (b.status === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select></div><div class="field"><label>Private notes</label><input name="notes" value="' + esc(b.notes) + '" placeholder="Only visible here"></div></div>' +
      '<div class="err" id="be"></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn">' + (isNew ? 'Save booking' : 'Save changes') + '</button>' +
      (isNew ? '' : (b.phone ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + esc(String(b.phone).replace(/[^0-9]/g, '').replace(/^0/, '234')) + '">WhatsApp guest</a>' : '') + '<button type="button" class="btn red" id="del" style="margin-left:auto">Delete</button>') + '</div></form>');
    $('#bf', m).onsubmit = function (e) {
      e.preventDefault(); var f = {}; $$('[name]', m).forEach(function (i) { f[i.name] = i.value; });
      if (!isNew) { f.rate = b.rate; if (String(f.subtotal) === String(b.subtotal) && (f.checkin !== b.checkin || f.checkout !== b.checkout)) f.subtotal = ''; }
      api(isNew ? '/bookings' : '/bookings/' + b.id, f).then(function () { m.close(); toast('Saved'); VIEWS.bookings(el); }).catch(function (er) { $('#be', m).textContent = er.message; });
    };
    if (!isNew) $('#del', m).onclick = function () { if (confirm('Delete booking ' + b.ref + ' permanently?')) api('/bookings/' + b.id + '/delete', {}).then(function () { m.close(); VIEWS.bookings(el); }).catch(fail); };
  }

  /* ---------- apartments ---------- */
  VIEWS.apartments = function (el) {
    api('/apartments').then(function (d) {
      el.innerHTML = '<div class="head"><h1>Apartments</h1><button class="btn gold" id="add">+ Add apartment</button></div><p class="muted">These appear on the website and in the booking page. Changing a rate here changes it everywhere.</p>' +
        d.apartments.map(function (a, i) { return '<div class="card apt"><img src="' + esc(a.photos[0] || '') + '" alt=""><div><h3>' + esc(a.name) + (a.active ? '' : ' <span class="pill p-cancelled">Hidden</span>') + '</h3><div class="muted">' + naira(a.rate) + ' / night &middot; sleeps ' + a.capacity + ' &middot; ' + a.photos.length + ' photos</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" data-mv="up" data-i="' + a.id + '"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button><button class="btn ghost sm" data-mv="down" data-i="' + a.id + '"' + (i === d.apartments.length - 1 ? ' disabled' : '') + '>&darr;</button><button class="btn sm" data-ed="' + a.id + '">Edit</button></div></div>'; }).join('');
      $('#add').onclick = function () { aptModal(null, el); };
      $$('[data-ed]', el).forEach(function (b) { b.onclick = function () { aptModal(d.apartments.filter(function (a) { return a.id === Number(b.getAttribute('data-ed')); })[0], el); }; });
      $$('[data-mv]', el).forEach(function (b) { b.onclick = function () { api('/apartments/' + b.getAttribute('data-i') + '/move', { dir: b.getAttribute('data-mv') }).then(function () { VIEWS.apartments(el); }).catch(fail); }; });
    }).catch(fail);
  };
  function aptModal(a, el) {
    var isNew = !a; a = a || { name: '', tagline: '', description: '', rate: '', capacity: 2, amenities: ['Wifi', 'TV'], photos: [], active: true };
    var photos = a.photos.slice(), m = modal('<h2>' + (isNew ? 'Add apartment' : 'Edit ' + esc(a.name)) + '</h2><form id="af"><div class="grid g2"><div class="field"><label>Name</label><input name="name" value="' + esc(a.name) + '" required></div><div class="field"><label>Short tag (shown on the photo)</label><input name="tagline" value="' + esc(a.tagline) + '" placeholder="e.g. Premium stay"></div></div>' +
      '<div class="field"><label>Description</label><textarea name="description">' + esc(a.description) + '</textarea></div>' +
      '<div class="grid g3"><div class="field"><label>Price per night (₦)</label><input name="rate" inputmode="numeric" value="' + esc(a.rate) + '" required></div><div class="field"><label>Sleeps (guests)</label><input name="capacity" inputmode="numeric" value="' + esc(a.capacity) + '"></div><div class="field"><label>Show on website</label><select name="active"><option value="1"' + (a.active ? ' selected' : '') + '>Yes</option><option value="0"' + (a.active ? '' : ' selected') + '>No (hidden)</option></select></div></div>' +
      '<div class="field"><label>Amenities (separate with commas)</label><input name="amenities" value="' + esc(a.amenities.join(', ')) + '"></div>' +
      '<div class="field"><label>Photos (the first one is the cover)</label><div class="photos" id="ph"></div><p><button type="button" class="btn ghost sm" id="up">+ Add photos</button> <span class="muted" id="upn"></span></p></div>' +
      '<div class="err" id="ae"></div><div style="display:flex;gap:10px"><button class="btn">' + (isNew ? 'Add apartment' : 'Save changes') + '</button>' + (isNew ? '' : '<button type="button" class="btn red" id="del" style="margin-left:auto">Delete</button>') + '</div></form>');
    function drawPhotos() {
      $('#ph', m).innerHTML = photos.map(function (u, i) { return '<div class="ph"><img src="' + esc(u) + '" alt=""><button type="button" class="x" data-rm="' + i + '" aria-label="Remove">&times;</button>' + (i === 0 ? '<span class="cv">Cover</span>' : '<button type="button" class="mk" data-cv="' + i + '">Make cover</button>') + '</div>'; }).join('') || '<p class="muted">No photos yet.</p>';
      $$('[data-rm]', m).forEach(function (b) { b.onclick = function () { photos.splice(Number(b.getAttribute('data-rm')), 1); drawPhotos(); }; });
      $$('[data-cv]', m).forEach(function (b) { b.onclick = function () { var i = Number(b.getAttribute('data-cv')); photos.unshift(photos.splice(i, 1)[0]); drawPhotos(); }; });
    }
    drawPhotos();
    $('#up', m).onclick = function () { pickImages(true).then(function (fs) { if (!fs.length) return; $('#upn', m).textContent = 'Uploading ' + fs.length + '...'; return uploadFiles(fs).then(function (urls) { photos = photos.concat(urls); $('#upn', m).textContent = ''; drawPhotos(); }); }).catch(function (e) { $('#upn', m).textContent = ''; fail(e); }); };
    $('#af', m).onsubmit = function (e) {
      e.preventDefault(); var f = {}; $$('[name]', m).forEach(function (i) { f[i.name] = i.value; }); f.active = f.active === '1'; f.photos = photos;
      api(isNew ? '/apartments' : '/apartments/' + a.id, f).then(function () { m.close(); toast('Saved'); VIEWS.apartments(el); }).catch(function (er) { $('#ae', m).textContent = er.message; });
    };
    if (!isNew) $('#del', m).onclick = function () { if (confirm('Delete ' + a.name + '? Existing bookings are kept. To just hide it from the website, choose "No (hidden)" instead.')) api('/apartments/' + a.id + '/delete', {}).then(function () { m.close(); VIEWS.apartments(el); }).catch(fail); };
  }

  /* ---------- website text ---------- */
  var FIELDS = [
    ['Contact', [['phone1', 'Business phone (also used for WhatsApp)'], ['phone2', 'Second phone'], ['whatsapp', 'WhatsApp number (digits only, with country code)'], ['email', 'Email'], ['instagram', 'Instagram'], ['city', 'City'], ['rc', 'Company registration number'], ['incorporated', 'Incorporated']]],
    ['Bookings', [['caution_fee', 'Caution fee (₦)'], ['deposit_pct', 'Deposit to confirm (% of stay)']]],
    ['Home page', [['hero_title', 'Main headline'], ['hero_text:t', 'Intro text under the headline']]],
    ['About us', [['about_title', 'Heading'], ['about_p1:t', 'Paragraph 1'], ['about_p2:t', 'Paragraph 2'], ['about_image:i', 'About photo']]],
    ['Founder', [['founder_name', 'Name'], ['founder_role', 'Title'], ['founder_bio:t', 'About the founder'], ['founder_photo:i', 'Founder photo']]]
  ];
  VIEWS.site = function (el) {
    api('/site').then(function (d) {
      var S = d.site;
      el.innerHTML = '<div class="head"><h1>Website text</h1></div><form id="sf">' + FIELDS.map(function (g) {
        return '<div class="card"><h3 style="margin-bottom:14px">' + g[0] + '</h3><div class="grid g2">' + g[1].map(function (f) {
          var k = f[0].split(':')[0], t = f[0].split(':')[1];
          if (t === 'i') return '<div class="field"><label>' + f[1] + '</label><img id="im_' + k + '" src="' + esc(S[k]) + '" style="max-width:200px;max-height:130px;display:block;border-radius:6px;margin-bottom:8px"><input type="hidden" name="' + k + '" value="' + esc(S[k]) + '"><button type="button" class="btn ghost sm" data-img="' + k + '">Change photo</button></div>';
          if (t === 't') return '<div class="field" style="grid-column:1/-1"><label>' + f[1] + '</label><textarea name="' + k + '">' + esc(S[k]) + '</textarea></div>';
          return '<div class="field"><label>' + f[1] + '</label><input name="' + k + '" value="' + esc(S[k]) + '"></div>';
        }).join('') + '</div></div>';
      }).join('') + '<button class="btn">Save changes</button></form>';
      $$('[data-img]', el).forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-img'); pickImages(false).then(function (fs) { if (fs.length) return uploadFiles(fs).then(function (u) { $('[name=' + k + ']', el).value = u[0]; $('#im_' + k).src = u[0]; toast('Photo ready. Press Save changes.'); }); }).catch(fail); }; });
      $('#sf').onsubmit = function (e) { e.preventDefault(); var f = {}; $$('[name]', el).forEach(function (i) { f[i.name] = i.value; }); api('/site', f).then(function () { toast('Saved. The website is updated.'); }).catch(fail); };
    }).catch(fail);
  };

  /* ---------- gallery ---------- */
  VIEWS.gallery = function (el) {
    api('/gallery').then(function (d) {
      el.innerHTML = '<div class="head"><h1>Gallery</h1><button class="btn gold" id="add">+ Add photos</button></div><p class="muted">Photos shown in the "A glimpse inside" section of the home page.</p><div class="card"><div class="photos">' + (d.gallery.map(function (g) { return '<div class="ph"><img src="' + esc(g.url) + '" alt=""><button class="x" data-rm="' + g.id + '" aria-label="Remove">&times;</button></div>'; }).join('') || '<p class="muted">No photos yet.</p>') + '</div></div>';
      $('#add').onclick = function () { pickImages(true).then(function (fs) { if (!fs.length) return; toast('Uploading...'); return uploadFiles(fs).then(function (urls) { return urls.reduce(function (p, u) { return p.then(function () { return api('/gallery', { url: u }); }); }, Promise.resolve()); }).then(function () { VIEWS.gallery(el); }); }).catch(fail); };
      $$('[data-rm]', el).forEach(function (b) { b.onclick = function () { if (confirm('Remove this photo from the gallery?')) api('/gallery/' + b.getAttribute('data-rm') + '/delete', {}).then(function () { VIEWS.gallery(el); }).catch(fail); }; });
    }).catch(fail);
  };

  /* ---------- enquiries ---------- */
  VIEWS.enquiries = function (el) {
    api('/enquiries').then(function (d) {
      el.innerHTML = '<div class="head"><h1>Enquiries</h1></div><p class="muted">Messages sent from the enquiry form on the home page.</p><div class="card scroll"><table><thead><tr><th>Received</th><th>Guest</th><th>Apartment</th><th>Dates</th><th>Message</th><th></th></tr></thead><tbody>' +
        (d.enquiries.length ? d.enquiries.map(function (q) { return '<tr><td>' + esc((q.created_at || '').slice(0, 16)) + '</td><td><b>' + esc(q.name) + '</b><div class="muted">' + esc(q.email) + '</div></td><td>' + esc(q.room) + '<div class="muted">' + esc(q.guests) + ' guests</div></td><td>' + fdate(q.checkin) + ' to ' + fdate(q.checkout) + '</td><td>' + esc(q.message) + '<div class="muted">via ' + esc(q.via) + '</div></td><td><button class="btn ghost sm" data-del="' + q.id + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="muted">No enquiries yet.</td></tr>') + '</tbody></table></div>';
      $$('[data-del]', el).forEach(function (b) { b.onclick = function () { api('/enquiries/' + b.getAttribute('data-del') + '/delete', {}).then(function () { VIEWS.enquiries(el); }).catch(fail); }; });
    }).catch(fail);
  };

  /* ---------- old system records ---------- */
  var OLD = { table: '', offset: 0, q: '' };
  VIEWS.old = function (el) {
    api('/legacy').then(function (d) {
      el.innerHTML = '<div class="head"><h1>Old system records</h1></div><div class="card"><h3>Load the old bookings file</h3><p class="muted">Choose the file <b>phibs-old-bookings.json</b> you were given. Every old booking, guest and payment is added to the Bookings list. Loading it twice is safe: bookings already added are skipped.</p><button class="btn gold" id="lf">Choose file and load</button> <span id="lfn" class="muted"></span></div><div class="card"><h3>Bring over the old booking dashboard</h3>' +
        (d.configured ? '<p>The old database is connected. Importing copies every table into this site. Nothing is changed in the old system, and you can import again later to refresh.</p><button class="btn gold" id="imp">Import everything from the old system</button> <span id="impn" class="muted"></span>' : '<div class="alert warn">Not connected yet. In Render go to <b>Environment</b>, add a variable named <b>DATABASE_URL</b> with the connection link the old developer gave you, then save and wait for the redeploy.</div>') + '</div>' +
        (d.tables.length ? '<div class="card"><h3>Imported tables</h3><div class="grid g3">' + d.tables.map(function (t) { return '<div class="stat"><small>' + esc(t.name) + '</small><b>' + t.row_count + '</b><div style="margin-top:8px"><button class="btn sm" data-v="' + esc(t.name) + '">View</button> <button class="btn ghost sm" data-c="' + esc(t.name) + '">Turn into bookings</button></div></div>'; }).join('') + '</div></div>' : '') + '<div id="rows"></div>';
      $('#lf').onclick = function () { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.onchange = function () { var f = inp.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { var data; try { data = JSON.parse(rd.result); } catch (e) { return fail(new Error('That file could not be read.')); } $('#lfn').textContent = 'Loading...'; api('/legacy/load', { bookings: data }).then(function (r) { $('#lfn').textContent = ''; toast(r.added + ' bookings added' + (r.skipped ? ', ' + r.skipped + ' already there or skipped' : '') + '.'); }).catch(function (e) { $('#lfn').textContent = ''; fail(e); }); }; rd.readAsText(f); }; inp.click(); };
      var imp = $('#imp'); if (imp) imp.onclick = function () { imp.disabled = true; $('#impn').textContent = 'Importing, please wait...'; api('/legacy/import', {}).then(function (r) { toast('Imported ' + r.tables.length + ' tables'); VIEWS.old(el); }).catch(function (e) { imp.disabled = false; $('#impn').textContent = ''; fail(e); }); };
      $$('[data-v]', el).forEach(function (b) { b.onclick = function () { OLD.table = b.getAttribute('data-v'); OLD.offset = 0; OLD.q = ''; drawOld(); }; });
      $$('[data-c]', el).forEach(function (b) { b.onclick = function () { if (!confirm('Copy the rows of "' + b.getAttribute('data-c') + '" into the Bookings list? Rows already copied are skipped.')) return; api('/legacy/convert', { table: b.getAttribute('data-c') }).then(function (r) { toast(r.added + ' bookings added' + (r.skipped ? ', ' + r.skipped + ' skipped' : '')); }).catch(fail); }; });
      if (OLD.table && d.tables.some(function (t) { return t.name === OLD.table; })) drawOld();
    }).catch(fail);
  };
  function drawOld() {
    var box = $('#rows'); if (!box) return;
    api('/legacy?table=' + encodeURIComponent(OLD.table) + '&offset=' + OLD.offset + '&q=' + encodeURIComponent(OLD.q)).then(function (d) {
      var cols = d.table.cols;
      box.innerHTML = '<div class="card"><div class="head"><h3>' + esc(OLD.table) + ' (' + d.total + ' rows)</h3><div><a class="btn ghost sm" href="/api/admin/legacy.csv?table=' + encodeURIComponent(OLD.table) + '">Download as CSV</a></div></div><div class="field"><input id="oq" placeholder="Search these records" value="' + esc(OLD.q) + '"></div><div class="scroll"><table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c]; return '<td>' + esc(v && typeof v === 'object' ? JSON.stringify(v) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div><p style="display:flex;gap:10px;align-items:center"><button class="btn ghost sm" id="pv"' + (OLD.offset ? '' : ' disabled') + '>Previous</button><span class="muted">' + (d.total ? OLD.offset + 1 : 0) + ' to ' + Math.min(OLD.offset + 50, d.total) + ' of ' + d.total + '</span><button class="btn ghost sm" id="nx"' + (OLD.offset + 50 < d.total ? '' : ' disabled') + '>Next</button></p></div>';
      $('#pv').onclick = function () { OLD.offset = Math.max(0, OLD.offset - 50); drawOld(); }; $('#nx').onclick = function () { OLD.offset += 50; drawOld(); };
      var t; $('#oq').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { OLD.q = v; OLD.offset = 0; drawOld(); var n = $('#oq'); n.focus(); n.setSelectionRange(v.length, v.length); }, 400); };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(fail);
  }

  /* ---------- account ---------- */
  VIEWS.account = function (el) {
    el.innerHTML = '<div class="head"><h1>Account</h1></div><div class="card"><h3 style="margin-bottom:12px">Change password</h3><form id="pf" style="max-width:380px"><div class="field"><label>Current password</label><input type="password" name="o" autocomplete="off" required></div><div class="field"><label>New password (at least 8 characters)</label><input type="password" name="n" autocomplete="new-password" minlength="8" required></div><div class="err" id="pe"></div><button class="btn">Change password</button></form></div>' +
      '<div class="card"><h3>Backup</h3><p class="muted">Download a copy of all bookings and website content. Keep it somewhere safe. Photos you uploaded are stored separately on the server disk.</p><a class="btn ghost" href="/api/admin/backup">Download backup</a></div>';
    $('#pf').onsubmit = function (e) { e.preventDefault(); api('/password', { old_password: $('[name=o]', el).value, new_password: $('[name=n]', el).value }).then(function () { toast('Password changed'); $('#pf').reset(); }).catch(function (er) { $('#pe').textContent = er.message; }); };
  };

  function start() { render(); }
  window.addEventListener('hashchange', function () { if ($('#main')) render(); });
  api('/me').then(function (d) { if (d.admin) start(); else loginView(); }).catch(loginView);
})();
