'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, VIEWS = path.join(__dirname, 'views'), PUB = path.join(__dirname, 'public');
const PG = !!process.env.DATABASE_URL;

/* ---------- database: Postgres on Render, SQLite for local testing ---------- */
let q;
if (PG) {
  const { Pool } = require('pg'), url = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: /\.render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
  q = async (sql, p = []) => { let i = 0; return (await pool.query(sql.replace(/\?/g, () => '$' + (++i)), p)).rows; };
} else {
  const { DatabaseSync } = require('node:sqlite'); fs.mkdirSync(process.env.DATA_DIR || '.data', { recursive: true });
  const sdb = new DatabaseSync(path.join(process.env.DATA_DIR || '.data', 'phibs.db'));
  q = async (sql, p = []) => sdb.prepare(sql).all(...p);
}
const AUTO = PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT', BLOB = PG ? 'BYTEA' : 'BLOB';

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG');
const refOf = n => 'PLH-' + String(n).padStart(3, '0');
const J = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
class Err extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const readBody = (req, max = 1e6) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { no(new Err(413, 'Too large.')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const readJson = async req => { try { return JSON.parse((await readBody(req)).toString() || '{}'); } catch (e) { if (e instanceof Err) throw e; throw new Err(400, 'Bad request.'); } };
const hashPw = pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, h) => { const [s, k] = String(h).split(':'); if (!s || !k) return false; const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(k, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const hits = new Map(); const limited = (key, max, ms) => { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); return a.length > max; };

/* ---------- defaults read from the page templates ---------- */
const VIEW = n => fs.readFileSync(path.join(VIEWS, n), 'utf8');
const INDEX = VIEW('index.html'), BOOKING = VIEW('booking.html'), ADMIN = VIEW('admin.html');
const FIELDS = [...INDEX.matchAll(/<(\w+) data-cms="([^"]+)" data-label="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({ key: m[2], label: m[3], def: m[4].replace(/<br>/g, '\n').replace(/&amp;/g, '&') }));
const ROOMS = [...INDEX.matchAll(/<article class="room-card">([\s\S]*?)<\/article>/g)].map(m => { const c = m[1]; return {
  name: /<h3>(.*?)<\/h3>/.exec(c)[1], tag: (/<span class="room-tag">(.*?)<\/span>/.exec(c) || [])[1] || '', desc: (/<\/h3><p>(.*?)<\/p>/.exec(c) || [])[1] || '',
  rate: Number(/<b>₦([\d,]+)<\/b>/.exec(c)[1].replace(/,/g, '')), cap: Number((/Sleeps (\d+)/.exec(c) || [0, 2])[1]), img: /<img data-img="[^"]*" src="([^"]*)"/.exec(c)[1] }; });
const SET_DEF = { email: 'info@phibluxuryhomes.com', phone1: '+234 916 233 0835', phone1_tel: '+2349162330835', phone2: '+234 816 640 4939', phone2_tel: '+2348166404939', whatsapp: '2349162330835', caution: 50000, deposit: 50, receipt_next: 1 };

const content = async () => { const o = {}; for (const r of await q('SELECT k, v FROM content')) o[r.k] = r.v; return o; };
const setContent = (k, v) => q('DELETE FROM content WHERE k = ?', [k]).then(() => v == null ? null : q('INSERT INTO content(k, v) VALUES(?, ?)', [k, String(v)]));
const settings = ov => { const s = { ...SET_DEF }; try { Object.assign(s, JSON.parse(ov.settings || '{}')); } catch (e) {} return s; };
const rooms = ov => { let o = {}; try { o = JSON.parse(ov.rooms || '{}'); } catch (e) {} return ROOMS.map(r => { const x = o[r.name] || {}, m = ov['img.room:' + r.name];
  return { name: r.name, tag: x.tag != null ? x.tag : r.tag, desc: x.desc != null ? x.desc : r.desc, rate: x.rate > 0 ? x.rate : r.rate, cap: x.cap > 0 ? x.cap : r.cap, img: m ? '/media/' + m : r.img }; }); };

/* ---------- page rendering ---------- */
function render(tpl, ov, isBooking) {
  const S = settings(ov), R = rooms(ov); let h = tpl;
  h = h.replace(/<(\w+) data-cms="([^"]+)" data-label="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, key, label, rest, inner) => ov['text.' + key] == null ? m : `<${tag} data-cms="${key}" data-label="${label}"${rest}>${esc(ov['text.' + key]).replace(/\n/g, '<br>')}</${tag}>`);
  h = h.replace(/<article class="room-card">[\s\S]*?<\/article>/g, card => { const n = /<h3>(.*?)<\/h3>/.exec(card)[1], r = R.find(x => x.name === n); if (!r) return card;
    return card.replace(/(<span class="room-tag">)(.*?)(<\/span>)/, (m, a, b, c) => a + esc(r.tag) + c).replace(/(<\/h3><p>)(.*?)(<\/p>)/, (m, a, b, c) => a + esc(r.desc) + c)
      .replace(/<b>₦[\d,]+<\/b>/, '<b>' + naira(r.rate) + '</b>').replace(/Sleeps \d+/, 'Sleeps ' + r.cap); });
  h = h.replace(/<img data-img="([^"]+)" src="([^"]*)"/g, (m, slot, src) => { const id = ov['img.' + slot]; return `<img data-img="${slot}" src="${id ? '/media/' + id : src}"`; });
  let gal = []; try { gal = JSON.parse(ov.gallery || '[]'); } catch (e) {}
  if (gal.length) h = h.replace(/(<div class="gallery" data-cms-gallery>)[\s\S]*?(<\/div>)/, (m, a, b) => a + gal.map(id => `<img src="/media/${id}" alt="Apartment photo" loading="lazy">`).join('') + b);
  const tok = [['+2349162330835', 'P1T', S.phone1_tel], ['+234 916 233 0835', 'P1', S.phone1], ['+2348166404939', 'P2T', S.phone2_tel], ['+234 816 640 4939', 'P2', S.phone2], ['2349162330835', 'WA', S.whatsapp], ['info@phibluxuryhomes.com', 'EM', S.email]];
  tok.forEach(t => { h = h.split(t[0]).join('@@' + t[1] + '@@'); }); tok.forEach(t => { h = h.split('@@' + t[1] + '@@').join(esc(t[2])); });
  if (isBooking) { const cfg = { whatsapp: S.whatsapp, email: S.email, cautionFee: Number(S.caution), depositPct: Number(S.deposit), rooms: {} };
    R.forEach(r => { cfg.rooms[r.name] = { img: r.img, tag: r.tag, rate: r.rate, cap: r.cap }; });
    h = h.replace('</head>', '<script>window.__CFG=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';</script></head>'); }
  return h;
}

/* ---------- receipts ---------- */
function receiptPage(b, ov) {
  const S = settings(ov), paid = Number(b.amount_paid) || 0, total = b.subtotal + b.caution, label = { pending: 'Awaiting payment', confirmed: 'Confirmed', paid: 'Paid', cancelled: 'Cancelled', completed: 'Completed' }[b.status] || b.status;
  const row = (a, c) => `<div class="row"><span>${a}</span><strong>${c}</strong></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${refOf(b.receipt_no)} | Phibs Luxury Homes</title><link rel="icon" href="/logo.png">
<style>body{margin:0;background:#f7f5ef;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17231f}.sheet{max-width:720px;margin:24px auto;background:#fff;border:1px solid #e7e4dc;padding:0 0 18px}
.head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:24px 30px;border-bottom:3px solid #c5a36a}.head img{height:72px}.ref{text-align:right}.ref small{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#69736d}.ref b{font:600 26px Georgia,serif;color:#183b32}
.body{padding:8px 30px}h4{margin:22px 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#69736d}.row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid #eee}.big{font-size:18px;color:#183b32}
.badge{display:inline-block;background:#183b32;color:#fff;border-radius:99px;padding:3px 12px;font-size:12px;margin-top:8px}.foot{padding:14px 30px 0;color:#69736d;font-size:13px}.btn{display:block;margin:20px auto 0;background:#183b32;color:#fff;border:0;border-radius:6px;padding:12px 22px;font:inherit;cursor:pointer}
@media print{body{background:#fff}.sheet{border:0;margin:0}.btn{display:none}.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="sheet">
<div class="head"><img src="/logo.png" alt="Phibs Luxury Homes"><div class="ref"><small>Booking receipt</small><b>${refOf(b.receipt_no)}</b></div></div><div class="body">
<span class="badge">${esc(label)}</span><h4>Guest</h4>${row('Name', esc(b.name))}${row('Email', esc(b.email))}${row('Phone', esc(b.phone))}${row('Issued', esc(new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })))}
<h4>Stay</h4>${row('Apartment', esc(b.room))}${row('Check-in', esc(b.checkin))}${row('Check-out', esc(b.checkout))}${row('Nights / Guests', b.nights + ' / ' + esc(b.guests))}
<h4>Payment summary</h4>${row('Rate per night', naira(b.rate))}${row(b.nights + ' night' + (b.nights > 1 ? 's' : ''), naira(b.subtotal))}${row('Caution fee (refundable)', naira(b.caution))}${row('Total payable before check-in', '<span class="big">' + naira(total) + '</span>')}${row(S.deposit + '% deposit to confirm booking', naira(b.deposit))}${paid ? row('Amount received', naira(paid)) + row('Balance', naira(Math.max(0, total - paid))) : ''}
</div><div class="foot">Phibs Luxury Homes, Abuja<br>${esc(S.phone1)} &middot; ${esc(S.email)}<br>Please pay only to the official Phibs Luxury Homes account shared by our team. This receipt is subject to the Booking, Cancellation &amp; Refund Policy.</div>
<button class="btn" onclick="print()">Print / Save as PDF</button></div></body></html>`;
}

/* ---------- admin session ---------- */
let SECRET = process.env.SESSION_SECRET || '';
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const makeSession = u => { const p = Buffer.from(JSON.stringify({ u, e: Date.now() + 12 * 3600e3 })).toString('base64url'); return p + '.' + sign(p); };
const sessionUser = req => { const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null; const [p, s] = m[1].split('.'); if (!p || !s || sign(p) !== s) return null; try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.e > Date.now() ? d.u : null; } catch (e) { return null; } };
const origin = req => ((req.headers['x-forwarded-proto'] || 'http').split(',')[0]) + '://' + req.headers.host;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript' };
const num = (v, d = 0) => { const n = Math.round(Number(String(v).replace(/,/g, ''))); return Number.isFinite(n) ? n : d; };
const slotOk = s => s === 'about' || s === 'founder' || s === 'gallery' || (s.startsWith('room:') && ROOMS.some(r => 'room:' + r.name === s));

async function booking(req, res) {
  if (limited('bk|' + req.socket.remoteAddress, 12, 3600e3)) throw new Err(429, 'Too many bookings from this connection. Please try again later.');
  const b = await readJson(req), ov = await content(), S = settings(ov), room = rooms(ov).find(r => r.name === b.room);
  const name = String(b.name || '').trim().slice(0, 120), email = String(b.email || '').trim().slice(0, 160), phone = String(b.phone || '').trim().slice(0, 40), msg = String(b.message || '').trim().slice(0, 1000);
  if (name.length < 2) throw new Err(400, 'Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Err(400, 'Please enter a valid email address.');
  if (phone.replace(/\D/g, '').length < 7) throw new Err(400, 'Please enter a valid phone number.');
  if (!room) throw new Err(400, 'Please choose an apartment.');
  const ci = Date.parse(b.checkin + 'T00:00:00Z'), co = Date.parse(b.checkout + 'T00:00:00Z'), nights = Math.round((co - ci) / 864e5);
  if (!(nights >= 1 && nights <= 90)) throw new Err(400, 'Please choose valid check-in and check-out dates.');
  const guests = parseInt(b.guests, 10) || 1; if (guests > room.cap) throw new Err(400, 'This apartment sleeps up to ' + room.cap + ' guests.');
  const subtotal = room.rate * nights, deposit = Math.round(subtotal * Number(S.deposit) / 100), token = crypto.randomBytes(12).toString('hex'), now = new Date().toISOString();
  for (let i = 0; i < 6; i++) {
    const n = Math.max(Number((await q('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS n FROM bookings'))[0].n), num(S.receipt_next, 1));
    try {
      await q('INSERT INTO bookings(receipt_no, token, name, email, phone, room, checkin, checkout, guests, message, nights, rate, subtotal, deposit, caution, status, amount_paid, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [n, token, name, email, phone, room.name, b.checkin, b.checkout, String(b.guests), msg, nights, room.rate, subtotal, deposit, Number(S.caution), 'pending', 0, '', now]);
      const ref = refOf(n); return J(res, 200, { booking: { ref, issued: now, name, email, phone, room: room.name, checkin: b.checkin, checkout: b.checkout, guests: String(b.guests), message: msg, money: { rate: room.rate, nights, subtotal, deposit }, url: origin(req) + '/receipt/' + ref + '?k=' + token } });
    } catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e; }
  }
  throw new Err(500, 'Could not issue a receipt number. Please try again.');
}

async function admin(req, res, p, url) {
  const m = req.method, ov = await content();
  if (p === '/api/admin/login' && m === 'POST') {
    const b = await readJson(req), u = String(b.username || '').trim().toLowerCase();
    if (limited('login|' + req.socket.remoteAddress + '|' + u, 8, 900e3)) throw new Err(429, 'Too many attempts. Wait 15 minutes and try again.');
    const a = (await q('SELECT * FROM admins WHERE username = ?', [u]))[0];
    if (!a || !checkPw(String(b.password || ''), a.pass_hash)) throw new Err(401, 'Wrong username or password.');
    res.setHeader('Set-Cookie', 'sid=' + makeSession(u) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (origin(req).startsWith('https') ? '; Secure' : '')); return J(res, 200, { ok: true });
  }
  const user = sessionUser(req); if (!user) throw new Err(401, 'Please log in.');
  if (p === '/api/admin/logout') { res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return J(res, 200, { ok: true }); }
  if (p === '/api/admin/state') {
    const gal = JSON.parse(ov.gallery || '[]'), S = settings(ov);
    return J(res, 200, { user, fields: FIELDS.map(f => ({ key: f.key, label: f.label, def: f.def, value: ov['text.' + f.key] != null ? ov['text.' + f.key] : f.def })), settings: S, rooms: rooms(ov),
      slots: { about: ov['img.about'] ? '/media/' + ov['img.about'] : null, founder: ov['img.founder'] ? '/media/' + ov['img.founder'] : null }, gallery: gal });
  }
  if (p === '/api/admin/text' && m === 'POST') { const b = await readJson(req); for (const f of FIELDS) if (b[f.key] != null) await setContent('text.' + f.key, String(b[f.key]) === f.def ? null : String(b[f.key]).slice(0, 4000)); return J(res, 200, { ok: true }); }
  if (p === '/api/admin/settings' && m === 'POST') {
    const b = await readJson(req), S = settings(ov);
    for (const k of ['email', 'phone1', 'phone1_tel', 'phone2', 'phone2_tel', 'whatsapp']) if (b[k] != null) S[k] = String(b[k]).trim().slice(0, 80);
    for (const k of ['caution', 'deposit', 'receipt_next']) if (b[k] != null) S[k] = Math.max(0, num(b[k], SET_DEF[k]));
    if (S.deposit > 100) throw new Err(400, 'Deposit cannot be more than 100%.'); await setContent('settings', JSON.stringify(S)); return J(res, 200, { ok: true });
  }
  if (p === '/api/admin/rooms' && m === 'POST') { const b = await readJson(req), o = {}; for (const r of b.rooms || []) if (ROOMS.some(x => x.name === r.name)) o[r.name] = { tag: String(r.tag || '').slice(0, 60), desc: String(r.desc || '').slice(0, 300), rate: Math.max(1, num(r.rate, 1)), cap: Math.min(12, Math.max(1, num(r.cap, 2))) }; await setContent('rooms', JSON.stringify(o)); return J(res, 200, { ok: true }); }
  if (p === '/api/admin/upload' && m === 'POST') {
    const slot = url.searchParams.get('slot') || '', mime = (req.headers['content-type'] || '').split(';')[0]; if (!slotOk(slot)) throw new Err(400, 'Unknown photo slot.'); if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Err(400, 'Use a JPG, PNG or WebP photo.');
    const buf = await readBody(req, 8e6); if (buf.length < 200) throw new Err(400, 'Empty file.');
    const id = String((await q('INSERT INTO media(mime, data, created_at) VALUES(?,?,?) RETURNING id', [mime, buf, new Date().toISOString()]))[0].id);
    if (slot === 'gallery') { const g = JSON.parse(ov.gallery || '[]'); g.push(id); await setContent('gallery', JSON.stringify(g)); }
    else { if (ov['img.' + slot]) await q('DELETE FROM media WHERE id = ?', [ov['img.' + slot]]); await setContent('img.' + slot, id); }
    return J(res, 200, { id });
  }
  if (p === '/api/admin/photo/remove' && m === 'POST') {
    const b = await readJson(req), slot = String(b.slot || ''); if (!slotOk(slot)) throw new Err(400, 'Unknown photo slot.');
    if (slot === 'gallery') { const g = JSON.parse(ov.gallery || '[]').filter(x => x !== String(b.id)); await q('DELETE FROM media WHERE id = ?', [String(b.id)]); await setContent('gallery', g.length ? JSON.stringify(g) : null); }
    else if (ov['img.' + slot]) { await q('DELETE FROM media WHERE id = ?', [ov['img.' + slot]]); await setContent('img.' + slot, null); }
    return J(res, 200, { ok: true });
  }
  if (p === '/api/admin/bookings' && m === 'GET') return J(res, 200, { bookings: (await q('SELECT * FROM bookings ORDER BY receipt_no DESC LIMIT 1000')).map(b => ({ ...b, ref: refOf(b.receipt_no), url: '/receipt/' + refOf(b.receipt_no) + '?k=' + b.token })) });
  if (p === '/api/admin/bookings.csv') {
    const rows = await q('SELECT * FROM bookings ORDER BY receipt_no'), cols = ['receipt_no', 'name', 'email', 'phone', 'room', 'checkin', 'checkout', 'guests', 'nights', 'rate', 'subtotal', 'deposit', 'caution', 'status', 'amount_paid', 'notes', 'created_at'];
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="phibs-bookings.csv"' });
    return res.end(['reference'].concat(cols.slice(1)).join(',') + '\n' + rows.map(r => [refOf(r.receipt_no)].concat(cols.slice(1).map(c => r[c])).map(cell).join(',')).join('\n'));
  }
  let mm = /^\/api\/admin\/bookings\/(\d+)$/.exec(p);
  if (mm && m === 'POST') { const b = await readJson(req); if (!['pending', 'confirmed', 'paid', 'cancelled', 'completed'].includes(b.status)) throw new Err(400, 'Unknown status.'); await q('UPDATE bookings SET status = ?, amount_paid = ?, notes = ? WHERE id = ?', [b.status, Math.max(0, num(b.amount_paid)), String(b.notes || '').slice(0, 500), Number(mm[1])]); return J(res, 200, { ok: true }); }
  if (p === '/api/admin/password' && m === 'POST') {
    const b = await readJson(req), a = (await q('SELECT * FROM admins WHERE username = ?', [user]))[0];
    if (!a || !checkPw(String(b.current || ''), a.pass_hash)) throw new Err(400, 'Your current password is not correct.'); if (String(b.next || '').length < 10) throw new Err(400, 'Use at least 10 characters for the new password.');
    await q('UPDATE admins SET pass_hash = ? WHERE username = ?', [hashPw(String(b.next)), user]); return J(res, 200, { ok: true });
  }
  throw new Err(404, 'Not found.');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    if (p === '/healthz') return J(res, 200, { ok: true });
    if (p.startsWith('/api/admin/')) return await admin(req, res, p, url);
    if (p === '/api/bookings' && req.method === 'POST') return await booking(req, res);
    if (p === '/' || p === '/index.html' || p === '/booking.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(render(p === '/booking.html' ? BOOKING : INDEX, await content(), p === '/booking.html')); }
    if (p === '/admin') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(ADMIN); }
    let mm = /^\/media\/(\d+)$/.exec(p);
    if (mm) { const r = (await q('SELECT mime, data FROM media WHERE id = ?', [Number(mm[1])]))[0]; if (!r) throw new Err(404, 'Not found.'); res.writeHead(200, { 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable' }); return res.end(Buffer.from(r.data)); }
    mm = /^\/receipt\/PLH-(\d+)$/.exec(p);
    if (mm) { const b = (await q('SELECT * FROM bookings WHERE receipt_no = ?', [Number(mm[1])]))[0], k = url.searchParams.get('k') || '';
      if (!b || k.length !== b.token.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(b.token))) throw new Err(404, 'Receipt not found.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(receiptPage(b, await content())); }
    const f = path.join(PUB, p);
    if (f.startsWith(PUB + path.sep) && MIME[path.extname(f).toLowerCase()] && fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()], 'Cache-Control': 'public, max-age=86400' }); return fs.createReadStream(f).pipe(res); }
    throw new Err(404, 'Page not found.');
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500; if (code === 500) console.error(e);
    if (res.headersSent) return res.end(); const wantsJson = (req.url || '').startsWith('/api/');
    if (wantsJson) return J(res, code, { error: code === 500 ? 'Something went wrong. Please try again.' : e.message });
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><title>' + code + '</title><body style="font:16px system-ui;padding:48px"><h1>' + (code === 404 ? 'Page not found' : 'Something went wrong') + '</h1><p><a href="/">Back to Phibs Luxury Homes</a></p>');
  }
});

(async () => {
  await q(`CREATE TABLE IF NOT EXISTS admins (id ${AUTO}, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL)`);
  await q('CREATE TABLE IF NOT EXISTS content (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  await q(`CREATE TABLE IF NOT EXISTS media (id ${AUTO}, mime TEXT NOT NULL, data ${BLOB} NOT NULL, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS bookings (id ${AUTO}, receipt_no INTEGER UNIQUE NOT NULL, token TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, room TEXT NOT NULL, checkin TEXT NOT NULL, checkout TEXT NOT NULL, guests TEXT, message TEXT, nights INTEGER NOT NULL, rate INTEGER NOT NULL, subtotal INTEGER NOT NULL, deposit INTEGER NOT NULL, caution INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', amount_paid INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL)`);
  if (!SECRET) { const r = (await q("SELECT v FROM content WHERE k = 'session_secret'"))[0]; SECRET = r ? r.v : crypto.randomBytes(32).toString('hex'); if (!r) await setContent('session_secret', SECRET); }
  if (!(await q('SELECT id FROM admins LIMIT 1')).length) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url'), u = (process.env.ADMIN_USER || 'admin').toLowerCase();
    await q('INSERT INTO admins(username, pass_hash) VALUES(?, ?)', [u, hashPw(pw)]); console.log('Created admin "' + u + '"' + (process.env.ADMIN_PASSWORD ? '' : ' with temporary password: ' + pw));
  }
  server.listen(PORT, '0.0.0.0', () => console.log('Phibs site on port ' + PORT + (PG ? ' (Postgres)' : ' (local SQLite)')));
})().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
