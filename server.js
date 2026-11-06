'use strict';
/**
 * OSP-Projektmanagement – Server
 * Konten mit Freischaltung durch Admin, Projekte mit Live-Zusammenarbeit (WebSocket).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const Ops = require('./public/ops.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const SESSION_DAYS = 30;
const PROJ_DIR = path.join(DATA_DIR, 'projects');
fs.mkdirSync(PROJ_DIR, { recursive: true });

// ---------- Speicher (JSON-Dateien, atomar geschrieben) ----------

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
let users = readJson(USERS_FILE, []);
let sessions = readJson(SESSIONS_FILE, {});
const saveUsers = () => writeJson(USERS_FILE, users);
let sessTimer = null;
const saveSessions = () => { clearTimeout(sessTimer); sessTimer = setTimeout(() => writeJson(SESSIONS_FILE, sessions), 200); };

const newId = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

// ---------- Passwörter ----------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64);
  const ref = Buffer.from(hash, 'base64');
  return ref.length === h.length && crypto.timingSafeEqual(h, ref);
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt });

// ---------- Sitzungen ----------

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromReq(req) {
  const token = parseCookies(req.headers.cookie).sid;
  const s = token && sessions[token];
  if (!s) return null;
  if (s.exp < Date.now()) { delete sessions[token]; saveSessions(); return null; }
  const u = users.find((x) => x.id === s.userId);
  if (!u || u.status !== 'active') return null;
  return u;
}

function setSessionCookie(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${COOKIE_SECURE ? '; Secure' : ''}`);
}

function endSessionsOf(userId) {
  for (const [t, s] of Object.entries(sessions)) if (s.userId === userId) delete sessions[t];
  saveSessions();
  for (const ws of wss.clients) if (ws.user && ws.user.id === userId) ws.close(4001, 'logout');
}

// Einfache Bremse gegen Passwort-Raten
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, a);
  return a.length >= 20;
}
function noteAttempt(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }

// ---------- Projekte ----------

/** id -> { doc, clients:Set, timer } */
const rooms = new Map();
const projFile = (id) => path.join(PROJ_DIR, id + '.json');
const PID_RE = /^[A-Za-z0-9_-]{8,40}$/;

function loadProject(id) {
  if (!PID_RE.test(id)) return null;
  let room = rooms.get(id);
  if (room) return room;
  const doc = readJson(projFile(id), null);
  if (!doc) return null;
  // fehlende Bereiche ergänzen (z. B. nach Updates)
  const empty = Ops.emptyProject(id);
  for (const k of Object.keys(empty)) if (doc[k] === undefined) doc[k] = empty[k];
  room = { doc, clients: new Set(), timer: null };
  rooms.set(id, room);
  return room;
}
function saveNow(room) {
  clearTimeout(room.timer); room.timer = null;
  if (room.deleted) return;
  try { writeJson(projFile(room.doc.id), room.doc); } catch (e) { console.error('Speichern fehlgeschlagen', e.message); }
}
function scheduleSave(room) {
  room.doc.updatedAt = Date.now();
  if (!room.timer) room.timer = setTimeout(() => saveNow(room), 700);
}
function listProjects() {
  return fs.readdirSync(PROJ_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const id = f.slice(0, -5);
    const d = rooms.get(id)?.doc || readJson(projFile(id), null);
    return d && { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt || d.createdAt };
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------- HTTP ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '2mb' }));

const PUB = path.join(__dirname, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUB, file), { headers: { 'Cache-Control': 'no-cache' } });
const needPage = (file, admin) => (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.redirect('/login');
  if (admin && u.role !== 'admin') return res.redirect('/');
  page(file)(req, res);
};

app.use('/static', express.static(PUB, { index: false, maxAge: 0 }));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist'), { maxAge: '7d' }));

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/login', page('login.html'));
app.get('/register', page('register.html'));
app.get('/', needPage('index.html'));
app.get('/konto', needPage('account.html'));
app.get('/admin', needPage('admin.html', true));
app.get('/p/:id', (req, res, next) => (loadProject(req.params.id) ? needPage('project.html')(req, res) : next()));
app.get('/p/:id/canvas', (req, res, next) => (loadProject(req.params.id) ? needPage('canvas.html')(req, res) : next()));

// --- API: Konto ---
const api = express.Router();
const auth = (req, res, next) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Nicht angemeldet' });
  req.user = u;
  next();
};
const admin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Nur für Admins' }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

api.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
  const pw = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Bitte Namen angeben.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Bitte gültige E-Mail-Adresse angeben.' });
  if (pw.length < 8) return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen haben.' });
  if (users.some((u) => u.email === email)) return res.status(400).json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' });
  // Erster Admin: ADMIN_EMAIL (falls gesetzt), sonst die allererste Registrierung
  const isAdmin = ADMIN_EMAIL ? email === ADMIN_EMAIL : users.length === 0;
  const u = {
    id: newId(9), name, email, pw: hashPassword(pw),
    role: isAdmin ? 'admin' : 'user', status: isAdmin ? 'active' : 'pending', createdAt: Date.now(),
  };
  users.push(u);
  saveUsers();
  res.json({ ok: true, active: u.status === 'active' });
});

api.post('/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Zu viele Versuche. Bitte 15 Minuten warten.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = users.find((x) => x.email === email);
  if (!u || !checkPassword(String(req.body.password || ''), u.pw)) {
    noteAttempt(ip);
    return res.status(400).json({ error: 'E-Mail oder Passwort falsch.' });
  }
  if (u.status === 'pending') return res.status(403).json({ error: 'Dein Konto wurde noch nicht freigeschaltet. Bitte warte auf die Freischaltung durch einen Admin.' });
  if (u.status === 'blocked') return res.status(403).json({ error: 'Dein Konto ist gesperrt.' });
  const token = newId(32);
  sessions[token] = { userId: u.id, exp: Date.now() + SESSION_DAYS * 86400000 };
  saveSessions();
  setSessionCookie(res, token, SESSION_DAYS * 86400);
  res.json({ ok: true });
});

api.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token && sessions[token]) { delete sessions[token]; saveSessions(); }
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

api.get('/me', auth, (req, res) => {
  res.json({ ...publicUser(req.user), pending: req.user.role === 'admin' ? users.filter((u) => u.status === 'pending').length : 0 });
});

api.post('/me', auth, (req, res) => {
  const u = req.user;
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein.' });
    u.name = name;
  }
  if (req.body.newPassword !== undefined) {
    if (!checkPassword(String(req.body.password || ''), u.pw)) return res.status(400).json({ error: 'Aktuelles Passwort ist falsch.' });
    if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben.' });
    u.pw = hashPassword(String(req.body.newPassword));
  }
  saveUsers();
  res.json({ ok: true });
});

// Namen aller freigeschalteten Nutzer (für Personen-Auswahl)
api.get('/users', auth, (req, res) => {
  res.json(users.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name })));
});

// --- API: Admin ---
api.get('/admin/users', auth, admin, (req, res) => res.json(users.map(publicUser)));

api.post('/admin/users/:id', auth, admin, (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Nicht gefunden' });
  const self = u.id === req.user.id;
  const action = req.body.action;
  if (self && ['block', 'removeAdmin', 'delete'].includes(action)) return res.status(400).json({ error: 'Das geht nicht mit dem eigenen Konto.' });
  switch (action) {
    case 'approve': u.status = 'active'; break;
    case 'block': u.status = 'blocked'; endSessionsOf(u.id); break;
    case 'makeAdmin': u.role = 'admin'; break;
    case 'removeAdmin': u.role = 'user'; break;
    case 'resetPassword': {
      const pw = String(req.body.password || '');
      if (pw.length < 8) return res.status(400).json({ error: 'Mindestens 8 Zeichen.' });
      u.pw = hashPassword(pw);
      endSessionsOf(u.id);
      break;
    }
    case 'delete':
      users = users.filter((x) => x.id !== u.id);
      endSessionsOf(u.id);
      break;
    default: return res.status(400).json({ error: 'Unbekannte Aktion' });
  }
  saveUsers();
  res.json({ ok: true });
});

// --- API: Projekte ---
api.get('/projects', auth, (req, res) => res.json(listProjects()));

api.post('/projects', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 200) || 'Neues Projekt';
  const id = newId(12);
  const doc = Ops.emptyProject(id, name, req.user.name);
  writeJson(projFile(id), doc);
  res.json({ id });
});

api.delete('/projects/:id', auth, admin, (req, res) => {
  const room = loadProject(req.params.id);
  if (!room) return res.status(404).json({ error: 'Nicht gefunden' });
  room.deleted = true;
  clearTimeout(room.timer);
  for (const ws of room.clients) ws.close(4004, 'deleted');
  rooms.delete(req.params.id);
  fs.renameSync(projFile(req.params.id), projFile(req.params.id) + '.deleted');
  res.json({ ok: true });
});

api.get('/projects/:id/export', auth, (req, res) => {
  const room = loadProject(req.params.id);
  if (!room) return res.status(404).json({ error: 'Nicht gefunden' });
  res.setHeader('Content-Disposition', `attachment; filename="projekt-${room.doc.id}.json"`);
  res.json(room.doc);
});

app.use('/api', api);
app.use((req, res) => res.status(404).sendFile(path.join(PUB, 'notfound.html')));

// ---------- WebSocket (Live-Zusammenarbeit) ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  const host = req.headers.host;
  const user = userFromReq(req);
  const room = loadProject(url.searchParams.get('p') || '');
  const badOrigin = origin && new URL(origin).host !== host;
  if (url.pathname !== '/ws' || !user || !room || badOrigin) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, room, user));
});

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(data);
}
const peers = (room) => [...room.clients].map((c) => c.peer);

wss.on('connection', (ws, room, user) => {
  ws.user = user;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.peer = { id: newId(6), userId: user.id, name: user.name, focus: null };
  room.clients.add(ws);
  ws.send(JSON.stringify({ type: 'init', doc: room.doc, you: ws.peer.id, user: publicUser(user), peers: peers(room) }));
  broadcast(room, { type: 'peers', peers: peers(room) }, ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ops' && Array.isArray(msg.ops)) {
      const applied = [];
      for (const op of msg.ops.slice(0, 500)) applied.push(...Ops.apply(room.doc, op));
      if (applied.length) {
        scheduleSave(room);
        broadcast(room, { type: 'ops', ops: applied }, ws);
      }
    } else if (msg.type === 'snapshot') {
      // Entwicklungsschritt des Canvas speichern
      const snap = {
        id: newId(8), label: String(msg.label || '').slice(0, 200) || 'Version', at: Date.now(), by: user.name,
        name: room.doc.name, leader: room.doc.meta.leader || '', owner: room.doc.meta.owner || '',
        notes: JSON.parse(JSON.stringify(room.doc.notes)),
      };
      room.doc.canvasVersions.push(snap);
      scheduleSave(room);
      broadcast(room, { type: 'snapshot', snap });
    } else if (msg.type === 'delsnapshot') {
      room.doc.canvasVersions = room.doc.canvasVersions.filter((s) => s.id !== msg.id);
      scheduleSave(room);
      broadcast(room, { type: 'delsnapshot', id: msg.id });
    } else if (msg.type === 'presence') {
      ws.peer.focus = typeof msg.focus === 'string' ? msg.focus.slice(0, 60) : null;
      broadcast(room, { type: 'peers', peers: peers(room) });
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(room, { type: 'peers', peers: peers(room) });
    if (room.clients.size === 0 && !room.deleted) { saveNow(room); rooms.delete(room.doc.id); }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) if (room.timer) saveNow(room);
  clearTimeout(sessTimer);
  writeJson(SESSIONS_FILE, sessions);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`OSP-Projektmanagement läuft auf http://localhost:${PORT} (Daten: ${DATA_DIR})`));
