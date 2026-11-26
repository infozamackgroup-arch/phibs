(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var naira = function (n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); };
  var num = function (v) { var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
  var STATUS = { awaiting_payment: 'Awaiting payment', confirmed: 'Reserved', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled' };
  var pill = function (s) { return '<span class="pill p-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span>'; };
  var fdate = function (s) { if (!s) return '-'; var d = new Date(s + 'T00:00:00'); return isNaN(d) ? esc(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  function api(path, body) {
    var o = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { o.method = 'POST'; o.body = JSON.stringify(body); }
    return fetch('/api/admin' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/login') { loginView(); throw new Error('Please log in again.'); }
        if (!r.ok) { var er = new Error(j.error || 'Something went wrong.'); er.clash = !!j.clash; throw er; } return j;
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
    $('#app').innerHTML = '<div class="login"><img src="phibs-logo.png" alt="Phibs Luxury Homes"><div class="card"><h2>Log in</h2><p class="muted">Phibs Luxury Homes website and bookings.</p><form id="lf"><div class="field"><label>Username</label><input id="un" autocomplete="username" autocapitalize="none" placeholder="admin" spellcheck="false"><p class="muted" style="margin:4px 0 0">Owner: leave empty or type admin. Staff: use the username you were given.</p></div><div class="field"><label>Password</label><input id="pw" type="password" autocomplete="current-password" required></div><div class="err" id="le"></div><button class="btn" style="width:100%">Log in</button></form></div></div>';
    $('#lf').onsubmit = function (e) { e.preventDefault(); api('/login', { username: $('#un').value, password: $('#pw').value }).then(function () { return api('/me'); }).then(function (d) { ME = { role: d.role, name: d.name }; start(); }).catch(function (er) { $('#le').textContent = er.message; }); };
  }

  /* ---------- shell ---------- */
  var ME = { role: 'admin', name: 'Admin' };
  var ALL_TABS = [['dash', 'Dashboard'], ['bookings', 'Bookings'], ['reservations', 'Reservations'], ['payments', 'Payments'], ['apartments', 'Apartments'], ['site', 'Website text'], ['gallery', 'Gallery'], ['enquiries', 'Enquiries'], ['staff', 'Staff'], ['old', 'Old records'], ['account', 'Account']];
  var tabs = function () { return ME.role === 'admin' ? ALL_TABS : ALL_TABS.filter(function (t) { return ['dash', 'bookings', 'reservations', 'enquiries'].indexOf(t[0]) >= 0; }); };
  function shell(active) {
    $('#app').innerHTML = '<header><div class="bar"><img src="phibs-logo.png" alt=""><b>' + (ME.role === 'admin' ? 'Admin' : esc(ME.name) + ' <span style="font-weight:400;font-size:13px;opacity:.8">(staff)</span>') + '</b><a class="btn ghost sm" href="/" target="_blank" rel="noopener" style="color:#fff;background:transparent;border-color:rgba(255,255,255,.4)">View website</a><button id="lo">Log out</button></div><nav><div>' +
      tabs().map(function (t) { return '<a href="#/' + t[0] + '" class="' + (t[0] === active ? 'on' : '') + '">' + t[1] + '</a>'; }).join('') + '</div></nav></header><main id="main"></main>';
    $('#lo').onclick = function () { api('/logout', {}).then(loginView); };
    return $('#main');
  }
  function render() {
    var name = (location.hash.replace('#/', '') || 'dash').split('/')[0]; if (!VIEWS[name] || !tabs().some(function (t) { return t[0] === name; })) name = 'dash';
    CUR = name; var el = shell(name); VIEWS[name](el);
  }
  var VIEWS = {}, CUR = 'dash';

  /* ---------- dashboard ---------- */
  VIEWS.dash = function (el) {
    api('/summary').then(function (d) {
      var row = function (b) { return '<tr class="click" data-ref="' + esc(b.ref) + '"><td><b>' + esc(b.name) + '</b><div class="muted">' + esc(b.room) + '</div></td><td>' + fdate(b.checkin) + ' to ' + fdate(b.checkout) + '</td><td>' + pill(b.status) + '</td></tr>'; };
      el.innerHTML = '<div class="head"><h1>Dashboard</h1></div>' +
        (d.persistent ? '' : '<div class="alert bad"><b>Your data is NOT being saved permanently.</b> Everything entered will be erased on the next update. In Render add a Disk with mount path <b>/var/data</b> and set <b>DATA_DIR</b> to <b>/var/data</b>.</div>') +
        '<div class="grid g4"><div class="stat"><small>Awaiting payment</small><b>' + d.awaiting + '</b></div><div class="stat"><small>Reserved</small><b>' + d.confirmed + '</b></div><div class="stat"><small>Enquiries received</small><b>' + d.enquiries + '</b></div>' + (d.collected == null ? '' : '<div class="stat"><small>Payments recorded</small><b>' + naira(d.collected) + '</b></div>') + '</div><div style="height:16px"></div>' +
        '<div class="grid g2"><div class="card scroll"><h3>Staying now</h3><table><tbody>' + (d.inHouse.length ? d.inHouse.map(row).join('') : '<tr><td class="muted">Nobody checked in right now.</td></tr>') + '</tbody></table></div>' +
        '<div class="card scroll"><h3>Coming up</h3><table><tbody>' + (d.upcoming.length ? d.upcoming.map(row).join('') : '<tr><td class="muted">No upcoming bookings.</td></tr>') + '</tbody></table></div></div>' +
        (d.legacy.length ? '<div class="card"><h3>Old system records</h3><p class="muted">' + d.legacy.map(function (t) { return esc(t.name) + ' (' + t.row_count + ')'; }).join(', ') + '. <a href="#/old">Open</a></p></div>' : '');
      $$('tr.click', el).forEach(function (tr) { tr.onclick = function () { sessionStorage.setItem('openRef', tr.getAttribute('data-ref')); location.hash = '#/bookings'; }; });
    }).catch(fail);
  };

  /* ---------- bookings ---------- */
  var BK = { list: [], rooms: [], apts: [], q: '', st: '' };
  VIEWS.bookings = function (el) {
    api('/bookings').then(function (d) {
      BK.list = d.bookings; BK.rooms = d.rooms; BK.apts = d.apts || []; drawBookings(el);
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
    var isNew = !b; b = b || { name: '', email: '', phone: '', room: BK.rooms[0] || '', checkin: '', checkout: '', guests: 2, rate: '', subtotal: '', caution: '', deposit: '', paid: 0, status: 'confirmed', notes: '', message: '' };
    var m = modal('<h2>' + (isNew ? 'Add booking' : esc(b.ref)) + '</h2>' + (isNew ? '' : '<p class="muted">Booked ' + esc((b.created_at || '').slice(0, 16)) + (b.message ? ' &middot; Guest note: ' + esc(b.message) : '') + '</p>') +
      '<form id="bf"><div class="grid g2"><div class="field"><label>Guest name</label><input name="name" value="' + esc(b.name) + '" required></div>' + (ME.role !== 'admin' && !isNew ? '' : '<div class="field"><label>Phone</label><input name="phone" value="' + esc(b.phone) + '"></div>') + '</div>' +
      '<div class="grid g2">' + (ME.role !== 'admin' && !isNew ? '' : '<div class="field"><label>Email</label><input name="email" value="' + esc(b.email) + '"></div>') + '<div class="field"><label>Apartment</label><select name="room">' + (BK.rooms.indexOf(b.room) < 0 && b.room ? '<option>' + esc(b.room) + '</option>' : '') + BK.rooms.map(function (r) { return '<option' + (r === b.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid g3"><div class="field"><label>Check-in</label><input type="date" name="checkin" value="' + esc(b.checkin) + '" required></div><div class="field"><label>Check-out</label><input type="date" name="checkout" value="' + esc(b.checkout) + '" required></div><div class="field"><label>Guests</label><input name="guests" inputmode="numeric" value="' + esc(b.guests) + '"></div></div>' +
      '<div class="grid g3"><div class="field"><label>Rate per night (₦)</label><input name="rate" inputmode="numeric" value="' + esc(b.rate) + '"></div><div class="field"><label>Stay total (₦) <span class="muted" id="nt"></span></label><input name="subtotal" inputmode="numeric" value="' + esc(b.subtotal) + '"></div><div class="field"><label>Caution fee (₦)</label><input name="caution" inputmode="numeric" value="' + esc(b.caution) + '"><p class="muted" style="margin:4px 0 0">Change it, or enter 0 to waive it.</p></div></div>' +
      (isNew ? '<div class="grid g3"><div class="field"><label>Amount paid now (₦)</label><input name="paid" inputmode="numeric" value="0"></div></div>' : '<div class="grid g3"><div class="field"><label>Paid so far</label><input value="' + naira(b.paid) + '" disabled></div></div>') +
      '<div class="grid g2"><div class="field"><label>Status</label><select name="status">' + Object.keys(STATUS).map(function (s) { return '<option value="' + s + '"' + (b.status === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('') + '</select></div><div class="field"><label>Private notes</label><input name="notes" value="' + esc(b.notes) + '" placeholder="Only visible here"></div></div>' +
      '<div class="err" id="be"></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn">' + (isNew ? 'Save booking' : 'Save changes') + '</button>' +
      (isNew ? '' : (b.phone ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + esc(String(b.phone).replace(/[^0-9]/g, '').replace(/^0/, '234')) + '">WhatsApp guest</a>' : '') + (ME.role === 'admin' ? '<button type="button" class="btn red" id="del" style="margin-left:auto">Delete</button>' : '')) + '</div></form>' + (isNew ? '' : '<div id="paybox" class="card" style="margin:18px 0 0;background:#faf8f3"><p class="muted">Loading payments...</p></div>'));
    var fv = function (n) { return $('[name=' + n + ']', m); }, subTouched = false, aptOf = function (n) { return BK.apts.filter(function (x) { return x.name === n; })[0]; };
    var nightsOf = function () { var x = fv('checkin').value, y = fv('checkout').value; var n = x && y ? Math.round((Date.parse(y) - Date.parse(x)) / 864e5) : 0; return n > 0 ? n : 0; };
    var recalc = function () { var n = nightsOf(); $('#nt', m).textContent = n ? '(' + n + ' night' + (n === 1 ? '' : 's') + ')' : ''; if (!subTouched) fv('subtotal').value = n ? n * num(fv('rate').value) : ''; };
    fv('subtotal').oninput = function () { subTouched = true; };
    fv('room').onchange = function () { var x = aptOf(this.value); if (x) { fv('rate').value = x.rate; fv('caution').value = x.caution; subTouched = false; recalc(); } };
    fv('rate').oninput = function () { subTouched = false; recalc(); };
    fv('checkin').onchange = fv('checkout').onchange = function () { subTouched = false; recalc(); };
    if (isNew) { var a0 = aptOf(fv('room').value); if (a0) { fv('rate').value = a0.rate; fv('caution').value = a0.caution; } }
    recalc(); if (!isNew) fv('subtotal').value = b.subtotal;
    $('#bf', m).onsubmit = function (e) {
      e.preventDefault(); var f = {}; $$('[name]', m).forEach(function (i) { f[i.name] = i.value; }); f.deposit = '';
      var send = function (extra) { return api(isNew ? '/bookings' : '/bookings/' + b.id, Object.assign({}, f, extra || {})); };
      send().catch(function (er) { if (er.clash && ME.role === 'admin' && confirm(er.message + '\n\nSave it anyway?')) return send({ force: true }); throw er; })
        .then(function (res) {
          var becameReserved = f.status === 'confirmed' && (isNew || b.status !== 'confirmed'), id = isNew ? null : b.id, ref = res && res.ref;
          m.close(); toast(becameReserved ? 'Saved. This booking is now a reservation.' : 'Saved'); (CUR === 'reservations' ? VIEWS.reservations : VIEWS.bookings)(el);
          if (becameReserved) api('/bookings').then(function (d) { var nb = d.bookings.filter(function (x) { return id ? x.id === id : x.ref === ref; })[0]; if (!nb) return;
            if (nb.paid > 0) return api('/bookings/' + nb.id + '/payments').then(showReceipt);
            toast('Reserved. Record the payment to issue the receipt.', true); bookingModal(nb, el); }).catch(fail);
        }).catch(function (er) { $('#be', m).textContent = er.message; });
    };
    if (!isNew) loadPay(b, m, el);
    if (!isNew && $('#del', m)) $('#del', m).onclick = function () { if (confirm('Delete booking ' + b.ref + ' permanently?')) api('/bookings/' + b.id + '/delete', {}).then(function () { m.close(); VIEWS.bookings(el); }).catch(fail); };
  }

  /* ---------- reservations ---------- */
  VIEWS.reservations = function (el) {
    api('/bookings').then(function (d) {
      BK.list = d.bookings; BK.rooms = d.rooms; BK.apts = d.apts || [];
      var rows = BK.list.filter(function (b) { return b.status === 'confirmed'; }).sort(function (x, y) { return x.checkin < y.checkin ? -1 : x.checkin > y.checkin ? 1 : 0; });
      el.innerHTML = '<div class="head"><h1>Reservations</h1></div><p class="muted" style="margin-top:-6px">Confirmed bookings waiting for check-in. A payment receipt is issued as soon as a booking becomes a reservation.</p>' +
        '<div class="card scroll"><table><thead><tr><th>Reference</th><th>Guest</th><th>Apartment</th><th>Stay</th><th class="num">Paid</th><th class="num">Balance</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (b) { var bal = Math.max(0, b.subtotal + b.caution - b.paid); return '<tr class="click" data-id="' + b.id + '"><td>' + esc(b.ref) + '</td><td><b>' + esc(b.name) + '</b><div class="muted">' + esc(b.phone) + '</div></td><td>' + esc(b.room) + '</td><td>' + fdate(b.checkin) + ' to ' + fdate(b.checkout) + '<div class="muted">' + b.nights + ' night' + (b.nights === 1 ? '' : 's') + '</div></td><td class="num">' + naira(b.paid) + '</td><td class="num">' + (bal ? '<b style="color:var(--red)">' + naira(bal) + '</b>' : 'Paid') + '</td><td class="num"><button class="btn ghost sm" data-rc="' + b.id + '">Receipt</button> <button class="btn sm" data-ci="' + b.id + '">Check in</button></td></tr>'; }).join('') : '<tr><td colspan="7" class="muted">No reservations yet. A booking appears here once it is confirmed.</td></tr>') + '</tbody></table></div>';
      $$('tr.click', el).forEach(function (tr) { tr.onclick = function () { bookingModal(BK.list.filter(function (b) { return b.id === Number(tr.getAttribute('data-id')); })[0], el); }; });
      $$('[data-rc]', el).forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); api('/bookings/' + x.getAttribute('data-rc') + '/payments').then(showReceipt).catch(fail); }; });
      $$('[data-ci]', el).forEach(function (x) { x.onclick = function (e) { e.stopPropagation(); if (confirm('Check this guest in now?')) api('/bookings/' + x.getAttribute('data-ci'), { status: 'checked_in' }).then(function () { toast('Checked in'); VIEWS.reservations(el); }).catch(fail); }; });
    }).catch(fail);
  };

  /* ---------- payments and receipt ---------- */
  var fdt = function (s) { if (!s) return ''; var d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? esc(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  function loadPay(b, m, el) {
    api('/bookings/' + b.id + '/payments').then(function (d) { drawPay(d, m, el); }).catch(function (e) { $('#paybox', m).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function drawPay(d, m, el) {
    var bk = d.booking, due = bk.subtotal + bk.caution, bal = Math.max(0, due - bk.paid), box = $('#paybox', m); if (!box) return;
    box.innerHTML = '<h3 style="margin-bottom:10px">Payments</h3>' +
      '<div class="scroll"><table><thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th><th>Received by</th><th></th></tr></thead><tbody>' +
      (d.carried > 0 ? '<tr><td colspan="2">Earlier payment (old system)</td><td class="num">' + naira(d.carried) + '</td><td></td><td></td></tr>' : '') +
      (d.payments.length ? d.payments.map(function (p) { return '<tr><td>' + fdt(p.created_at) + (p.note ? '<div class="muted">' + esc(p.note) + '</div>' : '') + '</td><td>' + esc(p.method) + '</td><td class="num">' + naira(p.amount) + '</td><td>' + esc(p.by_name) + '</td><td>' + (ME.role === 'admin' ? '<button type="button" class="btn ghost sm" data-dp="' + p.id + '">Remove</button>' : '') + '</td></tr>'; }).join('') : (d.carried > 0 ? '' : '<tr><td colspan="5" class="muted">No payment recorded yet.</td></tr>')) +
      '</tbody></table></div>' +
      '<p style="margin:12px 0 4px"><b>Total due ' + naira(due) + '</b> (stay ' + naira(bk.subtotal) + ' + refundable caution ' + naira(bk.caution) + ') &middot; <b>Paid ' + naira(bk.paid) + '</b> &middot; <b style="color:' + (bal ? 'var(--red)' : 'var(--ok)') + '">' + (bal ? 'Balance ' + naira(bal) : 'Fully paid') + '</b></p>' +
      (bk.status === 'awaiting_payment' ? '<p class="muted" style="margin:0 0 12px">To reserve: full caution fee + at least 50% of the room rate = <b>' + naira((bk.deposit || 0) + (bk.caution || 0)) + '</b>' + (bk.paid < (bk.deposit || 0) + (bk.caution || 0) ? '. Still needed: <b>' + naira((bk.deposit || 0) + (bk.caution || 0) - bk.paid) + '</b>.' : '.') + '</p>' : '') + '<form id="pf2"><div class="grid g3"><div class="field"><label>Amount received (₦)</label><input name="amount" inputmode="numeric" required placeholder="' + (bal ? bal : '') + '"></div><div class="field"><label>Paid by</label><select name="method"><option>Transfer</option><option>Cash</option><option>POS</option><option>Other</option></select></div><div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. deposit"></div></div>' +
      '<div class="err" id="pe2"></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn gold">Record payment and issue receipt</button>' + (bk.paid > 0 ? '<button type="button" class="btn ghost" id="rp">Print receipt</button>' : '') + '</div></form>';
    $('#pf2', m).onsubmit = function (e) {
      e.preventDefault(); var f = {}; $$('[name]', $('#pf2', m)).forEach(function (i) { f[i.name] = i.value; });
      api('/bookings/' + bk.id + '/payments', f).then(function (nd) { toast(bk.status !== 'confirmed' && nd.booking.status === 'confirmed' ? 'Payment recorded. Booking is now a reservation.' : 'Payment recorded'); drawPay(nd, m, el); showReceipt(nd); refreshList(el); }).catch(function (er) { $('#pe2', m).textContent = er.message; });
    };
    if ($('#rp', m)) $('#rp', m).onclick = function () { showReceipt(d); };
    $$('[data-dp]', m).forEach(function (x) { x.onclick = function () { if (confirm('Remove this payment record? The balance will go back up.')) api('/payments/' + x.getAttribute('data-dp') + '/delete', {}).then(function (nd) { drawPay(nd, m, el); refreshList(el); }).catch(fail); }; });
  }
  function refreshList(el) { api('/bookings').then(function (d) { BK.list = d.bookings; if ($('#q')) drawBookings(el); }).catch(function () {}); }
  function showReceipt(d) {
    var bk = d.booking, S = d.site, due = bk.subtotal + bk.caution, bal = Math.max(0, due - bk.paid), old = $('#rcpt'); if (old) old.remove();
    var last = d.payments.length ? d.payments[d.payments.length - 1] : null, issued = last ? fdt(last.created_at) : fdt(new Date().toISOString().slice(0, 19));
    var row = function (k, v) { return '<tr><td>' + k + '</td><td class="r">' + v + '</td></tr>'; };
    var pays = (d.carried > 0 ? '<tr><td>Earlier payment</td><td>-</td><td class="r">' + naira(d.carried) + '</td></tr>' : '') + d.payments.map(function (p) { return '<tr><td>' + fdt(p.created_at) + '</td><td>' + esc(p.method) + (p.note ? ' (' + esc(p.note) + ')' : '') + '</td><td class="r">' + naira(p.amount) + '</td></tr>'; }).join('');
    var el = document.createElement('div'); el.id = 'rcpt';
    var sig = last ? (last.by_user || last.by_name) : '', kv = function (k, v) { return '<div><small>' + k + '</small><b>' + v + '</b></div>'; };
    el.innerHTML = '<div class="rc-bar"><button class="btn" id="rcPrint">Print receipt</button><button class="btn ghost" id="rcClose">Close</button></div>' +
      '<div class="rc-paper' + (d.payments.length > 4 ? ' tight' : '') + '"><div class="rc-head"><img src="phibs-logo.png" alt="Phibs Luxury Homes"><div class="rc-co"><b>Phibs Luxury Homes</b><br>' + esc(S.address || '') + '<br>' + esc(S.city || 'Abuja') + ', Nigeria &middot; ' + esc(S.rc || '') + '<br>' + esc(S.phone1 || '') + (S.phone2 ? ' / ' + esc(S.phone2) : '') + '<br>' + esc(S.email || '') + '</div></div>' +
      '<div class="rc-title"><h1>Payment receipt</h1><div class="rc-no"><small>Receipt no.</small><b>' + esc(bk.ref) + '</b><small>' + issued + '</small></div></div>' +
      '<div class="rc-grid">' + kv('Guest', esc(bk.name)) + kv('Apartment', esc(bk.room)) + kv('Check-in', fdate(bk.checkin)) + kv('Check-out', fdate(bk.checkout)) + kv('Nights', bk.nights) + kv('Rate per night', naira(bk.rate)) + '</div>' +
      '<table class="rc-t rc-p"><thead><tr><th>Payment date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>' + (pays || '<tr><td colspan="3">No payment yet</td></tr>') + '</tbody></table>' +
      '<table class="rc-t rc-sum">' + row('Stay total', naira(bk.subtotal)) + row('Refundable caution fee', bk.caution ? naira(bk.caution) : 'Waived') + row('Total due', naira(due)) + row('Total paid', '<b>' + naira(bk.paid) + '</b>') + row('Balance', '<b>' + naira(bal) + '</b>') + '</table>' +
      '<div class="rc-sign"><div class="rc-stamp ' + (bal ? 'part' : 'full') + '">' + (bal ? 'PART PAYMENT' : 'PAID IN FULL') + '</div><div class="rc-sigbox"><div class="rc-sig">' + esc(sig) + '</div><div class="rc-line"></div><small>Staff signature' + (last && last.by_name && last.by_name !== sig ? ' &middot; ' + esc(last.by_name) : '') + '</small></div></div>' +
      '<p class="rc-foot">The caution fee is refundable after checkout, subject to our booking policy. Thank you for choosing Phibs Luxury Homes.</p></div>';
    document.body.appendChild(el); document.body.classList.add('printing'); var oldTitle = document.title; document.title = bk.ref;
    var close = function () { el.remove(); document.body.classList.remove('printing'); document.title = oldTitle; };
    $('#rcClose', el).onclick = close; $('#rcPrint', el).onclick = function () { window.print(); };
  }

  /* ---------- payment summary ---------- */
  var PS = { view: 'daily', date: '' };
  VIEWS.payments = function (el) {
    api('/payments/summary?view=' + PS.view + '&date=' + PS.date).then(function (d) {
      var fd = function (s) { return fdate(s).replace(/,/g, ''); }, label = d.view === 'daily' ? fd(d.from) : d.view === 'weekly' ? fd(d.from) + ' to ' + fd(d.to) : new Date(d.from + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      var meth = Object.keys(d.byMethod);
      el.innerHTML = '<div class="head"><h1>Payments</h1><div style="display:flex;gap:6px;flex-wrap:wrap">' + [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(function (v) { return '<button class="btn sm ' + (PS.view === v[0] ? '' : 'ghost') + '" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn ghost sm" id="pp">&larr; Previous</button><b style="flex:1;text-align:center;min-width:180px">' + label + '</b><button class="btn ghost sm" id="pn">Next &rarr;</button><input type="date" id="pd" value="' + d.from + '" style="width:auto"><button class="btn ghost sm" id="pt">Today</button></div>' +
        '<div class="grid g4"><div class="stat"><small>Total received</small><b>' + naira(d.total) + '</b></div><div class="stat"><small>Payments</small><b>' + d.count + '</b></div>' +
        meth.slice(0, 2).map(function (k) { return '<div class="stat"><small>' + esc(k) + '</small><b>' + naira(d.byMethod[k]) + '</b></div>'; }).join('') + '</div><div style="height:16px"></div>' +
        (d.view === 'daily' ? '' : '<div class="card scroll"><h3 style="margin-bottom:8px">Day by day</h3><table><thead><tr><th>Day</th><th class="num">Payments</th><th class="num">Total</th></tr></thead><tbody>' + d.days.map(function (x) { return '<tr><td>' + fd(x.date) + '</td><td class="num">' + x.count + '</td><td class="num">' + (x.total ? '<b>' + naira(x.total) + '</b>' : '-') + '</td></tr>'; }).join('') + '<tr><td><b>Total</b></td><td class="num"><b>' + d.count + '</b></td><td class="num"><b>' + naira(d.total) + '</b></td></tr></tbody></table></div>') +
        '<div class="card scroll"><h3 style="margin-bottom:8px">Payments received</h3><table><thead><tr><th>Time</th><th>Receipt no. and guest</th><th>Method</th><th>Received by</th><th class="num">Amount</th></tr></thead><tbody>' +
        (d.payments.length ? d.payments.map(function (p) { return '<tr><td>' + fdt(p.created_at) + '</td><td><b>' + esc(p.ref) + '</b> ' + esc(p.name) + '<div class="muted">' + esc(p.room) + (p.status === 'cancelled' ? ' &middot; booking cancelled' : '') + '</div></td><td>' + esc(p.method) + '</td><td>' + esc(p.by_name || '-') + '</td><td class="num">' + naira(p.amount) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="muted">No payments in this period.</td></tr>') + '</tbody></table></div>';
      var go = function (dt) { PS.date = dt; VIEWS.payments(el); };
      $$('[data-v]', el).forEach(function (b) { b.onclick = function () { PS.view = b.getAttribute('data-v'); PS.date = d.from; VIEWS.payments(el); }; });
      $('#pp').onclick = function () { go(d.prev); }; $('#pn').onclick = function () { go(d.next); }; $('#pt').onclick = function () { go(''); }; $('#pd').onchange = function () { if (this.value) go(this.value); };
    }).catch(fail);
  };

  /* ---------- staff ---------- */
  VIEWS.staff = function (el) {
    api('/staff').then(function (d) {
      el.innerHTML = '<div class="head"><h1>Staff</h1><button class="btn gold" id="add">+ Add staff</button></div><p class="muted" style="margin-top:-6px">Staff can take bookings, record payments and print receipts. They cannot change the website, prices, apartments or other staff, and they cannot delete bookings.</p>' +
        '<div class="card scroll"><table><thead><tr><th>Name</th><th>Username</th><th>Added</th><th></th></tr></thead><tbody>' +
        (d.staff.length ? d.staff.map(function (s) { return '<tr><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.username) + '</td><td>' + esc((s.created_at || '').slice(0, 10)) + '</td><td class="num"><button class="btn ghost sm" data-pw="' + s.id + '">Reset password</button> <button class="btn red sm" data-rm="' + s.id + '" data-n="' + esc(s.name) + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="4" class="muted">No staff yet. Add the first one.</td></tr>') + '</tbody></table></div>';
      $('#add').onclick = function () {
        var m = modal('<h2>Add staff</h2><form id="sf2"><div class="field"><label>Full name</label><input name="name" required></div><div class="grid g2"><div class="field"><label>Username (for logging in)</label><input name="username" autocapitalize="none" required placeholder="e.g. chioma"></div><div class="field"><label>Password (8+ characters)</label><input name="password" type="text" autocomplete="off" required></div></div><p class="muted">Give them the website address /admin, their username and this password.</p><div class="err" id="se2"></div><button class="btn">Add staff</button></form>');
        $('#sf2', m).onsubmit = function (e) { e.preventDefault(); var f = {}; $$('[name]', m).forEach(function (i) { f[i.name] = i.value; }); api('/staff', f).then(function () { m.close(); toast('Staff added'); VIEWS.staff(el); }).catch(function (er) { $('#se2', m).textContent = er.message; }); };
      };
      $$('[data-pw]', el).forEach(function (b) { b.onclick = function () { var p = prompt('New password for this staff member (8+ characters):'); if (p) api('/staff/' + b.getAttribute('data-pw') + '/password', { password: p }).then(function () { toast('Password changed'); }).catch(fail); }; });
      $$('[data-rm]', el).forEach(function (b) { b.onclick = function () { if (confirm('Delete ' + b.getAttribute('data-n') + '? They will not be able to log in again. Bookings they made are kept.')) api('/staff/' + b.getAttribute('data-rm') + '/delete', {}).then(function () { toast('Staff deleted'); VIEWS.staff(el); }).catch(fail); }; });
    }).catch(fail);
  };

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
      '<div class="field"><label>Caution fee for this apartment (₦)</label><input name="caution" inputmode="numeric" value="' + esc(a.caution == null ? '' : a.caution) + '" placeholder="Leave empty to use the standard fee"><p class="muted" style="margin:4px 0 0">Used for new bookings. Staff can still change or waive it on any booking.</p></div>' +
      '<div class="field"><label>How many of this apartment do you have?</label><input name="units" inputmode="numeric" value="' + esc(a.units || 1) + '"><p class="muted" style="margin:4px 0 0">Normally 1. Guests can book it until every unit is taken for their dates.</p></div>' +
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
    ['Contact', [['phone1', 'Business phone (also used for WhatsApp)'], ['address', 'Business address'], ['phone2', 'Second phone'], ['whatsapp', 'WhatsApp number (digits only, with country code)'], ['email', 'Email'], ['instagram', 'Instagram'], ['city', 'City'], ['rc', 'Company registration number'], ['incorporated', 'Incorporated']]],
    ['Booking page', [['booking_image:i', 'Background photo at the top of the booking page']]],
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
  api('/me').then(function (d) { if (d.in) { ME = { role: d.role, name: d.name }; start(); } else loginView(); }).catch(loginView);
})();
