/* Phibs Luxury Homes: website + owner admin.
   Zero-dependency Node server (Node 22.5+). The optional "pg" package is only used for the one-off
   import of the old booking system. Data lives in SQLite inside DATA_DIR (use a Render persistent disk). */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
let PERSISTENT = false;
try { PERSISTENT = !!process.env.DATA_DIR && fs.statSync(DATA_DIR).dev !== fs.statSync(__dirname).dev; } catch {}
console.log('Data folder: ' + DATA_DIR + (PERSISTENT ? ' (separate disk: data is kept)' : ' (NOT a persistent disk: data is erased on every deploy)'));

const db = new DatabaseSync(path.join(DATA_DIR, 'phibs.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS apartments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tagline TEXT DEFAULT '', description TEXT DEFAULT '',
  rate INTEGER NOT NULL DEFAULT 0, capacity INTEGER NOT NULL DEFAULT 2, amenities TEXT DEFAULT '[]', photos TEXT DEFAULT '[]', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, caption TEXT DEFAULT '', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT, email TEXT, phone TEXT, room TEXT, checkin TEXT, checkout TEXT, guests INTEGER DEFAULT 1, nights INTEGER DEFAULT 1,
  rate INTEGER DEFAULT 0, subtotal INTEGER DEFAULT 0, caution INTEGER DEFAULT 0, deposit INTEGER DEFAULT 0, paid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'awaiting_payment', message TEXT DEFAULT '', notes TEXT DEFAULT '', source TEXT DEFAULT 'website');
CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT, email TEXT, room TEXT, checkin TEXT, checkout TEXT, guests TEXT, message TEXT, via TEXT);
CREATE TABLE IF NOT EXISTS legacy_tables (name TEXT PRIMARY KEY, cols TEXT NOT NULL, row_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS legacy_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS legacy_tbl ON legacy_rows(tbl);
CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT DEFAULT 'Transfer', note TEXT DEFAULT '', by_name TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pay_bk ON payments(booking_id);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), action TEXT, detail TEXT);
`);
try { db.exec('ALTER TABLE apartments ADD COLUMN units INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE apartments ADD COLUMN caution INTEGER'); } catch {}
try { db.exec("ALTER TABLE payments ADD COLUMN by_user TEXT DEFAULT ''"); } catch {}
const run = (sql, ...a) => db.prepare(sql).run(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const audit = (action, detail) => { try { run('INSERT INTO audit(action,detail) VALUES(?,?)', action, String(detail || '').slice(0, 300)); } catch {} };

/* ---------- defaults (seeded once, then edited from the admin page) ---------- */
const AMEN = ['Wifi', 'TV', 'Minibar', 'Balcony', 'Pool', 'Driver'];
const DEFAULT_SITE = {
  phone1: '+234 916 233 0835', phone2: '+234 816 640 4939', whatsapp: '2349162330835', email: 'info@phibluxuryhomes.com',
  instagram: '@phibs_luxury_homess', rc: 'RC9372447', city: 'Abuja', incorporated: 'June 2022',
  address: '548, Cluster 5, River Park Estate, Lugbe, FCT', booking_image: '/phibs-lounge.jpg',
  caution_fee: 50000, deposit_pct: 50,
  hero_title: 'Your home away from home in Abuja.',
  hero_text: 'Furnished shortlet apartments in Abuja where you can unwind, recharge and feel at home, with the space and privacy of your own place.',
  about_title: 'Home-like comfort, wherever you travel.',
  about_p1: 'Phibs Luxury Homes is a Nigerian company offering furnished shortlet apartments and luxury homes for rent in Abuja. Established in Nigeria and incorporated in June 2022, we exist to give guests a calm, comfortable and private place to stay, whether for business, a short getaway or an extended visit.',
  about_p2: 'Every apartment is prepared with care, and our team is on hand from your first enquiry to checkout, so you can settle in and feel at home.',
  about_image: '/phibs%20room%206.jpeg',
  founder_name: 'Phibian Otache', founder_role: 'Founder & CEO, Phibs Luxury Homes',
  founder_bio: 'Phibian founded Phibs Luxury Homes with a clear goal: to give guests a place that feels like home, comfortable, private and carefully looked after. He leads the company with a focus on quality spaces and warm, dependable service for every guest.',
  founder_photo: '/phibs-founder.jpg'
};
const DEFAULT_APTS = [
  ['Phibs Cozy Single', 'Cosy & comfortable', 'A welcoming personal space for guests who value comfort and simplicity.', 65000, 2, ['/phibs%20room%202.jpeg']],
  ['Phibs Prestige Suite', 'Refined comfort', 'A more spacious setting for guests looking for an elevated stay.', 75000, 2, [1, 2, 3, 4, 5].map(i => `/phibs-prestige-${i}.jpg`)],
  ['Phibs Diamond Suite', 'A little more luxury', 'Enjoy a polished, relaxing atmosphere with room to settle in.', 85000, 2, [1, 2, 3, 4, 5, 6].map(i => `/phibs-diamond-${i}.jpg`)],
  ['Phibs Platinum Suite', 'Premium stay', 'A premium option for guests seeking a special stay experience.', 100000, 4, ['/phibs%20room%205.jpeg']]
];
const DEFAULT_GALLERY = ['/phibs%20room%202.jpeg', '/phibs%20room%203.jpeg', '/phibs%20room%205.jpeg', '/phibs%20room%206.jpeg'];
if (!get("SELECT 1 FROM settings WHERE key='seeded'")) {
  for (const [k, v] of Object.entries(DEFAULT_SITE)) run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', k, JSON.stringify(v));
  DEFAULT_APTS.forEach((a, i) => run('INSERT INTO apartments(name,tagline,description,rate,capacity,amenities,photos,sort) VALUES(?,?,?,?,?,?,?,?)',
    a[0], a[1], a[2], a[3], a[4], JSON.stringify(AMEN), JSON.stringify(a[5]), i));
  DEFAULT_GALLERY.forEach((u, i) => run('INSERT INTO gallery(url,sort) VALUES(?,?)', u, i));
  run("INSERT INTO settings(key,value) VALUES('seeded','true')");
}
const getSite = () => { const o = { ...DEFAULT_SITE }; for (const r of all('SELECT key,value FROM settings')) if (r.key in DEFAULT_SITE) { try { o[r.key] = JSON.parse(r.value); } catch {} } return o; };
const setSetting = (k, v) => run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, JSON.stringify(v));
const aptOut = a => ({ id: a.id, name: a.name, tagline: a.tagline, description: a.description, rate: a.rate, capacity: a.capacity, amenities: JSON.parse(a.amenities || '[]'), photos: JSON.parse(a.photos || '[]'), active: !!a.active, sort: a.sort, units: a.units || 1, caution: a.caution == null ? null : a.caution, caution_fee: a.caution == null ? getSite().caution_fee : a.caution });

/* ---------- security helpers ---------- */
const keyFile = path.join(DATA_DIR, 'secret.key');
let SECRET; try { SECRET = fs.readFileSync(keyFile); } catch { SECRET = crypto.randomBytes(32); fs.writeFileSync(keyFile, SECRET, { mode: 0o600 }); }
const hashPw = (pw) => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => { try { const [s, h] = String(stored).split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch { return false; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
(function bootstrapAdmin() { // ADMIN_PASSWORD from Render is applied whenever it changes
  let env = String(process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
  if (!env) { if (!get("SELECT 1 FROM settings WHERE key='admin_hash'")) { env = crypto.randomBytes(9).toString('base64url'); console.log('No ADMIN_PASSWORD set. Temporary admin password: ' + env); } else return; }
  const cur = get("SELECT value FROM settings WHERE key='admin_env_hash'");
  if (!cur || JSON.parse(cur.value) !== sha(env) || !get("SELECT 1 FROM settings WHERE key='admin_hash'")) { setSetting('admin_hash', hashPw(env)); setSetting('admin_env_hash', sha(env)); console.log('Admin password set from ADMIN_PASSWORD (username: admin)'); }
})();
const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = (t) => { try { const [b, s] = String(t).split('.'); const ok = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); if (s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null; const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; } };
const adminVer = () => sha(JSON.parse(get("SELECT value FROM settings WHERE key='admin_hash'").value)).slice(0, 12);
const cookieOf = (req) => { const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
const who = (req) => { const p = verify(cookieOf(req)); if (!p) return null;
  if (p.role === 'staff') { const st = get('SELECT * FROM staff WHERE id=?', Number(p.id)); return st && p.v === sha(st.hash).slice(0, 12) ? { role: 'staff', id: st.id, name: st.name, username: st.username } : null; }
  return p.v === adminVer() ? { role: 'admin', name: 'Admin', username: 'admin' } : null; };
const priv = (w, b) => w.role === 'admin' ? b : { ...b, phone: '', email: '' };
const isAdmin = (req) => { const w = who(req); return !!w && w.role === 'admin'; };
const buckets = new Map();
const limit = (key, max, windowMs) => { const now = Date.now(); const b = (buckets.get(key) || []).filter(t => now - t < windowMs); if (b.length >= max) { buckets.set(key, b); return false; } b.push(now); buckets.set(key, b); return true; };
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/* ---------- utilities ---------- */
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const J = (res, s, o) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const str = (v, n = 500) => String(v == null ? '' : v).trim().slice(0, n);
const int = (v, d = 0) => { const n = Math.round(Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''))); return Number.isFinite(n) ? n : d; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const lagosToday = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
const newRef = () => { let n = 0; for (const r of all("SELECT ref FROM bookings WHERE ref LIKE 'PLH-%'")) { const k = parseInt(String(r.ref).slice(4), 10); if (k > n) n = k; } return 'PLH-' + String(n + 1).padStart(3, '0'); };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const HOLD = "(status IN ('confirmed','checked_in') OR (status='awaiting_payment' AND (source<>'website' OR created_at > datetime('now','-1 day'))))";
const taken = (room, ci, co, ex) => get('SELECT COUNT(*) c FROM bookings WHERE room=? AND checkin<? AND checkout>? AND id<>? AND ' + HOLD, room, co, ci, ex || 0).c;
const isFree = (apt, ci, co, ex) => taken(apt.name, ci, co, ex) < (apt.units || 1);
const freeFrom = (apt, today) => { if (isFree(apt, today, addDays(today, 1))) return null;
  for (const r of all('SELECT DISTINCT checkout d FROM bookings WHERE room=? AND checkout>? AND ' + HOLD + ' ORDER BY checkout LIMIT 60', apt.name, today)) if (isFree(apt, r.d, addDays(r.d, 1))) return r.d; return null; };
const nowLagos = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const METHODS = ['Transfer', 'Cash', 'POS', 'Other'];
const readBody = (req, max) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > max) { reject(new HttpError(413, 'That file is too large.')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new HttpError(400, 'Bad request.')); } });
  req.on('error', reject);
});
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => '﻿' + [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\r\n');

/* ---------- routes ---------- */
const routes = [];
const route = (method, re, auth, fn) => routes.push({ method, re, auth, fn });
const bookingOut = (b) => ({ ...b });

// public
route('GET', /^\/api\/site$/, false, ({ res }) => J(res, 200, {
  site: getSite(), apartments: all('SELECT * FROM apartments WHERE active=1 ORDER BY sort,id').map(a => { const t = lagosToday(), free = isFree(a, t, addDays(t, 1)); return { ...aptOut(a), available_now: free, free_from: free ? null : freeFrom(a, t) }; }), gallery: all('SELECT id,url,caption FROM gallery ORDER BY sort,id')
}));
route('GET', /^\/api\/availability$/, false, ({ req, res, url }) => {
  if (!limit('av|' + ipOf(req), 120, 600e3)) throw new HttpError(429, 'Too many requests.');
  const ci = str(url.searchParams.get('checkin'), 10), co = str(url.searchParams.get('checkout'), 10);
  if (!isDate(ci) || !isDate(co) || co <= ci) throw new HttpError(400, 'Choose valid dates.');
  const out = {}; for (const a of all('SELECT * FROM apartments WHERE active=1')) out[a.name] = isFree(a, ci, co);
  J(res, 200, { available: out });
});
route('POST', /^\/api\/bookings$/, false, ({ req, res, body }) => {
  if (!limit('bk|' + ipOf(req), 12, 3600e3)) throw new HttpError(429, 'Too many bookings from this device. Please call us.');
  const site = getSite(), apt = get('SELECT * FROM apartments WHERE name=? AND active=1', str(body.room, 120));
  const name = str(body.name, 120), email = str(body.email, 160), phone = str(body.phone, 40), ci = str(body.checkin, 10), co = str(body.checkout, 10);
  if (!apt || !name || !email || !phone || !isDate(ci) || !isDate(co) || co <= ci) throw new HttpError(400, 'Please check the booking details.');
  if (ci < lagosToday()) throw new HttpError(400, 'Check-in cannot be in the past.');
  if (!isFree(apt, ci, co)) throw new HttpError(409, apt.name + ' is not available for those dates. Please choose different dates or another apartment.');
  const guests = Math.min(Math.max(int(body.guests, 1), 1), apt.capacity), nights = daysBetween(ci, co), subtotal = nights * apt.rate;
  const caution = apt.caution == null ? site.caution_fee : apt.caution, deposit = Math.round(subtotal * site.deposit_pct / 100);
  const ref = newRef();
  run('INSERT INTO bookings(ref,name,email,phone,room,checkin,checkout,guests,nights,rate,subtotal,caution,deposit,message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ref, name, email, phone, apt.name, ci, co, guests, nights, apt.rate, subtotal, caution, deposit, str(body.message, 1000));
  audit('booking.new', ref + ' ' + apt.name);
  J(res, 200, { ref, nights, rate: apt.rate, subtotal, deposit, caution, guests });
});
route('POST', /^\/api\/enquiries$/, false, ({ req, res, body }) => {
  if (!limit('eq|' + ipOf(req), 20, 3600e3)) throw new HttpError(429, 'Too many requests.');
  run('INSERT INTO enquiries(name,email,room,checkin,checkout,guests,message,via) VALUES(?,?,?,?,?,?,?,?)', str(body.name, 120), str(body.email, 160), str(body.room, 120), str(body.checkin, 10), str(body.checkout, 10), str(body.guests, 10), str(body.message, 1000), str(body.via, 20));
  J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/login$/, false, ({ req, res, body }) => {
  const key = 'login|' + ipOf(req); if (!limit(key, 8, 900e3)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  const pw = String(body.password || ''), un = str(body.username, 40).toLowerCase().replace(/\s+/g, ''); let payload;
  if (!un || un === 'admin') {
    const h = JSON.parse(get("SELECT value FROM settings WHERE key='admin_hash'").value);
    if (!(checkPw(pw, h) || checkPw(pw.trim(), h))) { audit('login.fail', ipOf(req)); throw new HttpError(401, un ? 'Wrong username or password.' : 'Wrong password.'); }
    payload = { exp: Date.now() + 12 * 3600e3, v: adminVer() };
  } else {
    const st = get('SELECT * FROM staff WHERE username=?', un);
    if (!st || !(checkPw(pw, st.hash) || checkPw(pw.trim(), st.hash))) { audit('login.fail', ipOf(req) + ' ' + un); throw new HttpError(401, 'Wrong username or password.'); }
    payload = { exp: Date.now() + 12 * 3600e3, role: 'staff', id: st.id, v: sha(st.hash).slice(0, 12) };
  }
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/logout$/, false, ({ res }) => { res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); J(res, 200, { ok: true }); });
route('GET', /^\/api\/admin\/me$/, false, ({ req, res }) => { const w = who(req); J(res, 200, { in: !!w, role: w && w.role, name: w && w.name, persistent: PERSISTENT, dir: w && w.role === 'admin' ? DATA_DIR : undefined }); });

// admin: summary + site
route('GET', /^\/api\/admin\/summary$/, true, ({ res, w }) => {
  const today = lagosToday(), c = (sql, ...a) => get(sql, ...a).c;
  J(res, 200, {
    persistent: PERSISTENT,
    awaiting: c("SELECT COUNT(*) c FROM bookings WHERE status='awaiting_payment'"), confirmed: c("SELECT COUNT(*) c FROM bookings WHERE status='confirmed'"),
    upcoming: all("SELECT * FROM bookings WHERE checkin>=? AND status IN ('confirmed','awaiting_payment') ORDER BY checkin LIMIT 8", today),
    inHouse: all("SELECT * FROM bookings WHERE checkin<=? AND checkout>? AND status IN ('confirmed','checked_in')", today, today),
    enquiries: c('SELECT COUNT(*) c FROM enquiries'), total: c("SELECT COUNT(*) c FROM bookings WHERE status<>'cancelled'"),
    collected: w.role === 'admin' ? get("SELECT COALESCE(SUM(paid),0) s FROM bookings WHERE status<>'cancelled'").s : null, role: w.role, name: w.name,
    legacy: w.role === 'admin' ? all('SELECT name,row_count FROM legacy_tables ORDER BY name') : []
  });
});
route('GET', /^\/api\/admin\/site$/, 'admin', ({ res }) => J(res, 200, { site: getSite() }));
route('POST', /^\/api\/admin\/site$/, 'admin', ({ res, body }) => {
  for (const k of Object.keys(DEFAULT_SITE)) {
    if (!(k in body)) continue;
    const num = typeof DEFAULT_SITE[k] === 'number'; setSetting(k, num ? Math.max(0, int(body[k])) : str(body[k], k.startsWith('about_p') || k === 'founder_bio' || k === 'hero_text' ? 1500 : 300));
  }
  audit('site.update', Object.keys(body).join(',')); J(res, 200, { site: getSite() });
});
route('POST', /^\/api\/admin\/password$/, 'admin', ({ res, body }) => {
  const h = JSON.parse(get("SELECT value FROM settings WHERE key='admin_hash'").value), np = String(body.new_password || '');
  if (!checkPw(String(body.old_password || ''), h)) throw new HttpError(400, 'Current password is wrong.');
  if (np.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  setSetting('admin_hash', hashPw(np)); audit('password.change', ''); // other sessions end; sign this one in again
  const secure = '';
  res.setHeader('Set-Cookie', `sid=${sign({ exp: Date.now() + 12 * 3600e3, v: adminVer() })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  J(res, 200, { ok: true });
});

// admin: images
const sniff = (b) => b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'png' : (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') ? 'webp' : null;
route('POST', /^\/api\/admin\/upload$/, 'admin', ({ res, body }) => {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/s.exec(String(body.data || '')); if (!m) throw new HttpError(400, 'Choose an image file.');
  const buf = Buffer.from(m[1], 'base64'), ext = sniff(buf); if (!ext) throw new HttpError(400, 'Only JPG, PNG or WebP images are allowed.');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'Image is too large (max 8 MB).');
  const name = crypto.randomBytes(10).toString('hex') + '.' + ext; fs.writeFileSync(path.join(UPLOADS, name), buf);
  audit('upload', name); J(res, 200, { url: '/uploads/' + name });
});

// admin: apartments
const aptFields = (b) => ({
  name: str(b.name, 120), tagline: str(b.tagline, 120), description: str(b.description, 600), rate: Math.max(0, int(b.rate)), capacity: Math.min(20, Math.max(1, int(b.capacity, 2))),
  amenities: JSON.stringify((Array.isArray(b.amenities) ? b.amenities : String(b.amenities || '').split(',')).map(x => str(x, 40)).filter(Boolean).slice(0, 20)),
  photos: JSON.stringify((Array.isArray(b.photos) ? b.photos : []).map(x => str(x, 300)).filter(x => /^\/[A-Za-z0-9._%\-\/]+$/.test(x)).slice(0, 30)), active: b.active === false || b.active === 0 ? 0 : 1, units: Math.min(50, Math.max(1, int(b.units, 1))), caution: b.caution === '' || b.caution == null ? null : Math.max(0, int(b.caution))
});
route('GET', /^\/api\/admin\/apartments$/, 'admin', ({ res }) => J(res, 200, { apartments: all('SELECT * FROM apartments ORDER BY sort,id').map(aptOut) }));
route('POST', /^\/api\/admin\/apartments$/, 'admin', ({ res, body }) => {
  const f = aptFields(body); if (!f.name) throw new HttpError(400, 'Enter the apartment name.');
  if (get('SELECT 1 FROM apartments WHERE name=?', f.name)) throw new HttpError(400, 'An apartment with that name already exists.');
  const sort = (get('SELECT COALESCE(MAX(sort),0)+1 s FROM apartments').s);
  const r = run('INSERT INTO apartments(name,tagline,description,rate,capacity,amenities,photos,active,sort,units,caution) VALUES(?,?,?,?,?,?,?,?,?,?,?)', f.name, f.tagline, f.description, f.rate, f.capacity, f.amenities, f.photos, f.active, sort, f.units, f.caution);
  audit('apartment.add', f.name); J(res, 200, { id: Number(r.lastInsertRowid) });
});
route('POST', /^\/api\/admin\/apartments\/(\d+)$/, 'admin', ({ res, body, m }) => {
  const id = Number(m[1]), cur = get('SELECT * FROM apartments WHERE id=?', id); if (!cur) throw new HttpError(404, 'Not found');
  const f = aptFields(body); if (!f.name) throw new HttpError(400, 'Enter the apartment name.');
  if (get('SELECT 1 FROM apartments WHERE name=? AND id<>?', f.name, id)) throw new HttpError(400, 'Another apartment already uses that name.');
  run('UPDATE apartments SET name=?,tagline=?,description=?,rate=?,capacity=?,amenities=?,photos=?,active=?,units=?,caution=? WHERE id=?', f.name, f.tagline, f.description, f.rate, f.capacity, f.amenities, f.photos, f.active, f.units, f.caution, id);
  if (cur.name !== f.name) run('UPDATE bookings SET room=? WHERE room=?', f.name, cur.name);
  audit('apartment.update', f.name); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/apartments\/(\d+)\/move$/, 'admin', ({ res, body, m }) => {
  const id = Number(m[1]), list = all('SELECT id FROM apartments ORDER BY sort,id').map(x => x.id), i = list.indexOf(id), j = i + (body.dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return J(res, 200, { ok: true });
  [list[i], list[j]] = [list[j], list[i]]; list.forEach((x, k) => run('UPDATE apartments SET sort=? WHERE id=?', k, x)); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/apartments\/(\d+)\/delete$/, 'admin', ({ res, m }) => { run('DELETE FROM apartments WHERE id=?', Number(m[1])); audit('apartment.delete', m[1]); J(res, 200, { ok: true }); });

// admin: gallery
route('GET', /^\/api\/admin\/gallery$/, 'admin', ({ res }) => J(res, 200, { gallery: all('SELECT id,url,caption FROM gallery ORDER BY sort,id') }));
route('POST', /^\/api\/admin\/gallery$/, 'admin', ({ res, body }) => {
  const url = str(body.url, 300); if (!/^\/[A-Za-z0-9._%\-\/]+$/.test(url)) throw new HttpError(400, 'Upload a photo first.');
  run('INSERT INTO gallery(url,caption,sort) VALUES(?,?,?)', url, str(body.caption, 120), get('SELECT COALESCE(MAX(sort),0)+1 s FROM gallery').s); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/gallery\/(\d+)\/delete$/, 'admin', ({ res, m }) => { run('DELETE FROM gallery WHERE id=?', Number(m[1])); J(res, 200, { ok: true }); });

// admin: bookings
const STATUSES = ['awaiting_payment', 'confirmed', 'checked_in', 'completed', 'cancelled'];
const BK_COLS = ['ref', 'created_at', 'name', 'email', 'phone', 'room', 'checkin', 'checkout', 'nights', 'guests', 'rate', 'subtotal', 'caution', 'deposit', 'paid', 'status', 'source', 'message', 'notes'];
route('GET', /^\/api\/admin\/bookings$/, true, ({ res, w }) => J(res, 200, { bookings: all('SELECT * FROM bookings ORDER BY created_at DESC, id DESC LIMIT 5000').map(b => priv(w, b)), rooms: all('SELECT name FROM apartments ORDER BY sort,id').map(a => a.name), apts: all('SELECT name,rate,caution FROM apartments ORDER BY sort,id').map(a => ({ name: a.name, rate: a.rate, caution: a.caution == null ? getSite().caution_fee : a.caution })) }));
route('GET', /^\/api\/admin\/bookings\.csv$/, 'admin', ({ res }) => {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="phibs-bookings.csv"', 'Cache-Control': 'no-store' });
  res.end(toCsv(BK_COLS, all('SELECT * FROM bookings ORDER BY checkin DESC')));
});
const bkFields = (b, base) => {
  const ci = str(b.checkin, 10), co = str(b.checkout, 10);
  if (!str(b.name, 120) || !isDate(ci) || !isDate(co) || co <= ci) throw new HttpError(400, 'Enter the guest name and valid dates.');
  const opt = (v, d) => (v === '' || v == null) ? d : int(v, d);
  const nights = daysBetween(ci, co), rate = opt(b.rate, base ? base.rate : 0), subtotal = b.subtotal === '' || b.subtotal == null ? nights * rate : int(b.subtotal);
  return {
    name: str(b.name, 120), email: str(b.email, 160), phone: str(b.phone, 40), room: str(b.room, 120), checkin: ci, checkout: co, guests: Math.max(1, int(b.guests, 1)), nights, rate, subtotal,
    caution: Math.max(0, opt(b.caution, base ? base.caution : getSite().caution_fee)), deposit: Math.max(0, opt(b.deposit, Math.round(subtotal * getSite().deposit_pct / 100))), paid: Math.max(0, int(b.paid)),
    status: STATUSES.includes(b.status) ? b.status : 'awaiting_payment', notes: str(b.notes, 1000), message: str(b.message, 1000)
  };
};
const HOLDS = ['awaiting_payment', 'confirmed', 'checked_in'];
const checkClash = (f, body, w, ex) => { const apt = get('SELECT * FROM apartments WHERE name=?', f.room);
  if (apt && HOLDS.includes(f.status) && !isFree(apt, f.checkin, f.checkout, ex) && !(w.role === 'admin' && body.force)) { const e = new HttpError(409, f.room + ' is already booked for some of those dates.'); e.clash = true; throw e; } };
route('POST', /^\/api\/admin\/bookings$/, true, ({ res, body, w }) => {
  const apt = get('SELECT rate,caution FROM apartments WHERE name=?', str(body.room, 120)); if (apt && (body.rate == null || body.rate === '')) body.rate = apt.rate; if (apt && apt.caution != null && (body.caution == null || body.caution === '')) body.caution = apt.caution;
  const f = bkFields(body); checkClash(f, body, w, 0); const ref = newRef(), by = w.role === 'admin' ? 'admin' : w.name;
  const r = run('INSERT INTO bookings(ref,name,email,phone,room,checkin,checkout,guests,nights,rate,subtotal,caution,deposit,paid,status,notes,message,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ref, f.name, f.email, f.phone, f.room, f.checkin, f.checkout, f.guests, f.nights, f.rate, f.subtotal, f.caution, f.deposit, f.paid, f.status, f.notes, f.message, 'added by ' + by);
  if (f.paid > 0) run('INSERT INTO payments(booking_id,amount,method,note,by_name,by_user,created_at) VALUES(?,?,?,?,?,?,?)', Number(r.lastInsertRowid), f.paid, METHODS.includes(body.method) ? body.method : 'Transfer', 'Paid when booking was made', by, w.username || 'admin', nowLagos());
  audit('booking.add', ref); J(res, 200, { ref });
});
route('POST', /^\/api\/admin\/bookings\/(\d+)$/, true, ({ res, body, m, w }) => {
  const id = Number(m[1]), cur = get('SELECT * FROM bookings WHERE id=?', id); if (!cur) throw new HttpError(404, 'Not found');
  const f = bkFields({ ...cur, ...body, paid: cur.paid, ...(w.role === 'admin' ? {} : { phone: cur.phone, email: cur.email }) }, cur); checkClash(f, body, w, id);
  run('UPDATE bookings SET name=?,email=?,phone=?,room=?,checkin=?,checkout=?,guests=?,nights=?,rate=?,subtotal=?,caution=?,deposit=?,paid=?,status=?,notes=?,message=? WHERE id=?',
    f.name, f.email, f.phone, f.room, f.checkin, f.checkout, f.guests, f.nights, f.rate, f.subtotal, f.caution, f.deposit, f.paid, f.status, f.notes, f.message, id);
  audit('booking.update', cur.ref + ' ' + f.status); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/bookings\/(\d+)\/delete$/, 'admin', ({ res, m }) => { const b = get('SELECT ref FROM bookings WHERE id=?', Number(m[1])); run('DELETE FROM bookings WHERE id=?', Number(m[1])); audit('booking.delete', b && b.ref); J(res, 200, { ok: true }); });
route('GET', /^\/api\/admin\/enquiries$/, true, ({ res, w }) => J(res, 200, { enquiries: all('SELECT * FROM enquiries ORDER BY id DESC LIMIT 1000').map(e => w.role === 'admin' ? e : { ...e, email: '', phone: '' }) }));
route('POST', /^\/api\/admin\/enquiries\/(\d+)\/delete$/, 'admin', ({ res, m }) => { run('DELETE FROM enquiries WHERE id=?', Number(m[1])); J(res, 200, { ok: true }); });

// admin: old system records
route('GET', /^\/api\/admin\/legacy$/, 'admin', ({ res, url }) => {
  const t = url.searchParams.get('table'), tables = all('SELECT name,cols,row_count FROM legacy_tables ORDER BY name').map(x => ({ ...x, cols: JSON.parse(x.cols) }));
  if (!t) return J(res, 200, { tables, configured: !!process.env.DATABASE_URL });
  const info = tables.find(x => x.name === t); if (!info) throw new HttpError(404, 'Table not found');
  const off = Math.max(0, int(url.searchParams.get('offset'))), q = str(url.searchParams.get('q'), 80).toLowerCase();
  const where = q ? 'AND lower(data) LIKE ?' : '', args = q ? [t, '%' + q.replace(/[%_]/g, '') + '%'] : [t];
  const total = get(`SELECT COUNT(*) c FROM legacy_rows WHERE tbl=? ${where}`, ...args).c;
  J(res, 200, { table: info, total, rows: all(`SELECT id,data FROM legacy_rows WHERE tbl=? ${where} ORDER BY id LIMIT 50 OFFSET ${off}`, ...args).map(r => JSON.parse(r.data)) });
});
route('GET', /^\/api\/admin\/legacy\.csv$/, 'admin', ({ res, url }) => {
  const t = url.searchParams.get('table'), info = get('SELECT cols FROM legacy_tables WHERE name=?', t); if (!info) throw new HttpError(404, 'Table not found');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="old-${t.replace(/[^a-z0-9_]/gi, '')}.csv"`, 'Cache-Control': 'no-store' });
  res.end(toCsv(JSON.parse(info.cols), all('SELECT data FROM legacy_rows WHERE tbl=? ORDER BY id', t).map(r => JSON.parse(r.data))));
});
route('POST', /^\/api\/admin\/legacy\/import$/, 'admin', async ({ res }) => {
  const url = process.env.DATABASE_URL; if (!url) throw new HttpError(400, 'DATABASE_URL is not set in Render yet. See the setup steps.');
  let pg; try { pg = require('pg'); } catch { throw new HttpError(500, 'The "pg" package is not installed. Set the Render build command to: npm install'); }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try { await client.connect(); } catch (e) { throw new HttpError(502, 'Could not connect to the old database: ' + String(e.message).slice(0, 160)); }
  const summary = [];
  try {
    const tabs = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r => r.table_name);
    for (const t of tabs) {
      const q = await client.query(`SELECT * FROM "${t.replace(/"/g, '""')}" LIMIT 200000`);
      const cols = q.fields.map(f => f.name), rows = q.rows;
      db.exec('BEGIN');
      try {
        run('DELETE FROM legacy_rows WHERE tbl=?', t); run('INSERT OR REPLACE INTO legacy_tables(name,cols,row_count) VALUES(?,?,?)', t, JSON.stringify(cols), rows.length);
        const ins = db.prepare('INSERT INTO legacy_rows(tbl,data) VALUES(?,?)');
        for (const r of rows) ins.run(t, JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v));
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      summary.push({ name: t, rows: rows.length });
    }
  } catch (e) { throw new HttpError(500, 'Import stopped: ' + String(e.message).slice(0, 200)); } finally { try { await client.end(); } catch {} }
  audit('legacy.import', summary.map(s => s.name + ':' + s.rows).join(' ')); J(res, 200, { tables: summary });
});
const pick = (cols, re) => cols.find(c => re.test(c));
const normDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
route('POST', /^\/api\/admin\/legacy\/convert$/, 'admin', ({ res, body }) => {
  const t = str(body.table, 80), info = get('SELECT cols FROM legacy_tables WHERE name=?', t); if (!info) throw new HttpError(404, 'Choose an imported table.');
  const cols = JSON.parse(info.cols), M = {
    name: pick(cols, /^(guest_?name|full_?name|customer_?name|name)$/i) || pick(cols, /name/i), email: pick(cols, /e-?mail/i), phone: pick(cols, /phone|mobile|tel/i),
    room: pick(cols, /^(room|apartment|suite|unit|room_?type|room_?name|apartment_?name)$/i) || pick(cols, /room|apartment|suite/i), ci: pick(cols, /check_?-?in|arrival|start_?date|from_?date/i), co: pick(cols, /check_?-?out|departure|end_?date|to_?date/i),
    guests: pick(cols, /^(guests?|no_?of_?guests|num(ber)?_?(of_?)?guests|adults|persons|pax|occupants)$/i), total: pick(cols, /total|amount|price|cost/i), paid: pick(cols, /^(paid|amount_?paid|deposit)/i), status: pick(cols, /status/i), created: pick(cols, /created|booked|date_?added/i), id: pick(cols, /^(id|booking_?id|reference|ref)$/i)
  };
  if (!M.name || !M.ci || !M.co) throw new HttpError(400, 'This table does not look like bookings (no guest name or dates found). Pick the bookings table.');
  let added = 0, skipped = 0;
  const statusMap = (s) => { s = String(s || '').toLowerCase(); return /cancel/.test(s) ? 'cancelled' : /complete|checked.?out|done/.test(s) ? 'completed' : /checked.?in/.test(s) ? 'checked_in' : /confirm|paid|approved/.test(s) ? 'confirmed' : 'awaiting_payment'; };
  db.exec('BEGIN');
  try {
    for (const r of all('SELECT data FROM legacy_rows WHERE tbl=? ORDER BY id', t)) {
      const d = JSON.parse(r.data), ref = 'OLD-' + String(M.id ? d[M.id] : crypto.randomBytes(3).toString('hex')).replace(/[^A-Za-z0-9\-]/g, '').slice(0, 24);
      const ci = normDate(d[M.ci]), co = normDate(d[M.co]); if (get('SELECT 1 FROM bookings WHERE ref=?', ref) || !ci || !co || co <= ci) { skipped++; continue; }
      const nights = Math.max(1, daysBetween(ci, co)), total = M.total ? int(d[M.total]) : 0;
      run('INSERT INTO bookings(ref,created_at,name,email,phone,room,checkin,checkout,guests,nights,rate,subtotal,caution,deposit,paid,status,message,notes,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ref, (M.created && d[M.created] && !isNaN(new Date(d[M.created])) ? new Date(d[M.created]).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ')),
        str(d[M.name], 120), M.email ? str(d[M.email], 160) : '', M.phone ? str(d[M.phone], 40) : '', M.room ? str(d[M.room], 120) : '', ci, co, M.guests ? Math.max(1, int(d[M.guests], 1)) : 1, nights,
        Math.round(total / nights), total, 0, 0, M.paid ? int(d[M.paid]) : 0, statusMap(M.status ? d[M.status] : ''), '', 'Imported from the old system', 'old system');
      added++;
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw new HttpError(500, 'Conversion stopped: ' + String(e.message).slice(0, 160)); }
  audit('legacy.convert', `${t}: ${added} added, ${skipped} skipped`); J(res, 200, { added, skipped, mapping: M });
});
route('POST', /^\/api\/admin\/legacy\/load$/, 'admin', ({ res, body }) => {
  const list = Array.isArray(body.bookings) ? body.bookings.slice(0, 5000) : null; if (!list) throw new HttpError(400, 'That is not the old bookings file.');
  const STAT = ['awaiting_payment', 'confirmed', 'checked_in', 'completed', 'cancelled']; let added = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const o of list) {
      const ref = 'OLD-' + String(o.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase(), ci = str(o.checkin, 10), co = str(o.checkout, 10);
      if (ref === 'OLD-' || !isDate(ci) || !isDate(co) || co <= ci || get('SELECT 1 FROM bookings WHERE ref=?', ref)) { skipped++; continue; }
      const nights = daysBetween(ci, co), rate = Math.max(0, int(o.rate)), sub = o.subtotal != null ? Math.max(0, int(o.subtotal)) : nights * rate;
      run('INSERT INTO bookings(ref,created_at,name,email,phone,room,checkin,checkout,guests,nights,rate,subtotal,caution,deposit,paid,status,message,notes,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ref, /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(String(o.created_at)) ? String(o.created_at).slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' '),
        str(o.name, 120), str(o.email, 160), str(o.phone, 40), str(o.room, 120), ci, co, Math.max(1, int(o.guests, 1)), nights, rate, sub, 0, 0, Math.max(0, int(o.paid)), STAT.includes(o.status) ? o.status : 'confirmed', '', str(o.notes, 400), 'old system');
      added++;
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw new HttpError(500, 'Import stopped: ' + String(e.message).slice(0, 160)); }
  audit('legacy.load', added + ' added, ' + skipped + ' skipped'); J(res, 200, { added, skipped });
});
route('GET', /^\/api\/admin\/backup$/, 'admin', ({ res }) => {
  const f = path.join(DATA_DIR, 'backup-tmp.db'); try { fs.unlinkSync(f); } catch {} db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="phibs-backup-${lagosToday()}.db"`, 'Cache-Control': 'no-store' });
  fs.createReadStream(f).on('close', () => { try { fs.unlinkSync(f); } catch {} }).pipe(res);
});

/* ---------- payments and receipts ---------- */
const payInfo = (id, w) => { const b = get('SELECT * FROM bookings WHERE id=?', id); if (!b) throw new HttpError(404, 'Not found');
  const payments = all('SELECT * FROM payments WHERE booking_id=? ORDER BY id', id), sum = payments.reduce((t, p) => t + p.amount, 0);
  return { booking: w ? priv(w, b) : b, payments, carried: Math.max(0, b.paid - sum), site: getSite() }; };
route('GET', /^\/api\/admin\/bookings\/(\d+)\/payments$/, true, ({ res, m, w }) => J(res, 200, payInfo(Number(m[1]), w)));
route('POST', /^\/api\/admin\/bookings\/(\d+)\/payments$/, true, ({ res, body, m, w }) => {
  const id = Number(m[1]), b = get('SELECT * FROM bookings WHERE id=?', id); if (!b) throw new HttpError(404, 'Not found');
  const amount = int(body.amount); if (amount <= 0 || amount > 2e9) throw new HttpError(400, 'Enter the amount received.');
  run('INSERT INTO payments(booking_id,amount,method,note,by_name,by_user,created_at) VALUES(?,?,?,?,?,?,?)', id, amount, METHODS.includes(body.method) ? body.method : 'Transfer', str(body.note, 200), w.name, w.username || 'admin', nowLagos());
  const paid = b.paid + amount, status = b.status === 'awaiting_payment' && paid >= Math.max(1, Math.min(b.deposit || 1, b.subtotal || 1)) ? 'confirmed' : b.status;
  run('UPDATE bookings SET paid=?,status=? WHERE id=?', paid, status, id); audit('payment.add', b.ref + ' ' + amount + ' by ' + w.name);
  J(res, 200, payInfo(id, w));
});
route('POST', /^\/api\/admin\/payments\/(\d+)\/delete$/, 'admin', ({ res, m }) => {
  const p = get('SELECT * FROM payments WHERE id=?', Number(m[1])); if (!p) throw new HttpError(404, 'Not found');
  run('DELETE FROM payments WHERE id=?', p.id); run('UPDATE bookings SET paid=MAX(0,paid-?) WHERE id=?', p.amount, p.booking_id); audit('payment.delete', p.booking_id + ' ' + p.amount); J(res, 200, payInfo(p.booking_id, { role: 'admin' }));
});

/* ---------- payment summary (admin only) ---------- */
const payEvents = () => {
  const ev = all('SELECT p.id,p.amount,p.method,p.note,p.by_name,p.created_at,b.ref,b.name,b.room,b.status FROM payments p JOIN bookings b ON b.id=p.booking_id');
  for (const b of all('SELECT b.*, COALESCE((SELECT SUM(amount) FROM payments WHERE booking_id=b.id),0) s FROM bookings b')) if (b.paid > b.s) ev.push({ id: null, amount: b.paid - b.s, method: 'Old system', note: '', by_name: '', created_at: b.created_at, ref: b.ref, name: b.name, room: b.room, status: b.status });
  return ev.map(e => ({ ...e, day: String(e.created_at).slice(0, 10) }));
};
route('GET', /^\/api\/admin\/payments\/summary$/, 'admin', ({ res, url }) => {
  const q = url.searchParams.get('view'), view = ['daily', 'weekly', 'monthly'].includes(q) ? q : 'daily';
  let d = str(url.searchParams.get('date'), 10); if (!isDate(d)) d = lagosToday();
  const Y = Number(d.slice(0, 4)), M = Number(d.slice(5, 7)), iso = (x) => x.toISOString().slice(0, 10); let from, to, prev, next;
  if (view === 'daily') { from = to = d; prev = addDays(d, -1); next = addDays(d, 1); }
  else if (view === 'weekly') { const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; from = addDays(d, -dow); to = addDays(from, 6); prev = addDays(from, -7); next = addDays(from, 7); }
  else { from = iso(new Date(Date.UTC(Y, M - 1, 1))); to = iso(new Date(Date.UTC(Y, M, 0))); prev = iso(new Date(Date.UTC(Y, M - 2, 1))); next = iso(new Date(Date.UTC(Y, M, 1))); }
  const rows = payEvents().filter(e => e.day >= from && e.day <= to).sort((a, b) => a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
  const byMethod = {}, byDay = {}; let total = 0;
  for (const e of rows) { total += e.amount; byMethod[e.method] = (byMethod[e.method] || 0) + e.amount; (byDay[e.day] = byDay[e.day] || { total: 0, count: 0 }); byDay[e.day].total += e.amount; byDay[e.day].count++; }
  const days = []; for (let x = from; x <= to; x = addDays(x, 1)) days.push({ date: x, total: (byDay[x] || { total: 0 }).total, count: (byDay[x] || { count: 0 }).count });
  J(res, 200, { view, from, to, prev, next, total, count: rows.length, byMethod, days, payments: rows.slice(0, 500) });
});

/* ---------- staff accounts (admin only) ---------- */
route('GET', /^\/api\/admin\/staff$/, 'admin', ({ res }) => J(res, 200, { staff: all('SELECT id,username,name,created_at FROM staff ORDER BY name') }));
route('POST', /^\/api\/admin\/staff$/, 'admin', ({ res, body }) => {
  const name = str(body.name, 80), un = str(body.username, 30).toLowerCase().replace(/\s+/g, ''), pw = String(body.password || '');
  if (!name) throw new HttpError(400, 'Enter the staff name.');
  if (!/^[a-z0-9._-]{3,30}$/.test(un) || un === 'admin') throw new HttpError(400, 'Username: 3 to 30 letters or numbers, no spaces, and not "admin".');
  if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (get('SELECT 1 FROM staff WHERE username=?', un)) throw new HttpError(400, 'That username is taken.');
  run('INSERT INTO staff(username,name,hash) VALUES(?,?,?)', un, name, hashPw(pw)); audit('staff.add', un); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/staff\/(\d+)\/password$/, 'admin', ({ res, body, m }) => {
  const pw = String(body.password || ''); if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (!run('UPDATE staff SET hash=? WHERE id=?', hashPw(pw), Number(m[1])).changes) throw new HttpError(404, 'Not found'); audit('staff.password', m[1]); J(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/staff\/(\d+)\/delete$/, 'admin', ({ res, m }) => { const st = get('SELECT username FROM staff WHERE id=?', Number(m[1])); run('DELETE FROM staff WHERE id=?', Number(m[1])); audit('staff.delete', st && st.username); J(res, 200, { ok: true }); });

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC_JS = new Set(['admin.js']);
function serveFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase(); fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache };
    if (/^(text|application\/javascript)|svg/.test(MIME[ext] || '') && /gzip/.test(res.req.headers['accept-encoding'] || '') && buf.length > 1024) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(require('zlib').gzipSync(buf)); }
    res.writeHead(200, h); res.end(buf);
  });
}
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://wa.me";

const server = http.createServer(async (req, res) => {
  res.req = req;
  res.setHeader('Content-Security-Policy', CSP); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://x'); let p; try { p = decodeURIComponent(url.pathname); } catch { p = url.pathname; }
    if (p.startsWith('/api/')) {
      if (req.method === 'POST') { const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) throw new HttpError(403, 'Blocked.'); }
      const r = routes.find(r => r.method === req.method && r.re.test(p)); if (!r) throw new HttpError(404, 'Not found');
      const w = r.auth ? who(req) : null; if (r.auth && !w) throw new HttpError(401, 'Please log in again.');
      if (r.auth === 'admin' && w.role !== 'admin') throw new HttpError(403, 'Only the admin can do that.');
      const body = req.method === 'POST' ? await readBody(req, /admin\/upload$/.test(p) ? 12e6 : 1e6) : {};
      return await r.fn({ req, res, url, body, m: p.match(r.re), w });
    }
    if (p.startsWith('/uploads/')) { const n = p.slice(9); if (!/^[a-f0-9]{20}\.(jpg|png|webp)$/.test(n)) throw new HttpError(404, 'Not found'); return serveFile(res, path.join(UPLOADS, n), 'public, max-age=31536000, immutable'); }
    if (p === '/' ) p = '/index.html'; if (p === '/admin' || p === '/admin/') p = '/admin.html';
    const name = p.slice(1);
    if (!name || name.includes('/') || name.startsWith('.')) throw new HttpError(404, 'Not found');
    const ext = path.extname(name).toLowerCase();
    if (!MIME[ext] || (ext === '.js' && !PUBLIC_JS.has(name))) throw new HttpError(404, 'Not found');
    return serveFile(res, path.join(__dirname, name), ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600');
  } catch (e) {
    if (!res.headersSent) { if (e.status) J(res, e.status, { error: e.message, clash: !!e.clash }); else { console.error(e); J(res, 500, { error: 'Something went wrong.' }); } }
  }
});
if (require.main === module) server.listen(PORT, () => console.log('Phibs running on port ' + PORT));
module.exports = { server };
