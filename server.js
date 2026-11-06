'use strict';
/**
 * Project Canvas – Echtzeit-Server
 * Keine Accounts: Wer den Link (lange, zufällige ID) kennt, kann bearbeiten.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_NOTES = 1500;
const MAX_TEXT = 4000;

const SECTIONS = new Set([
  'ziel', 'kriterien_muss', 'kriterien_nicht', 'erfolg',
  'meilensteine', 'arbeitspakete', 'ergebnis',
  'team', 'stakeholder', 'nutzer',
  'ressourcen', 'umfeld', 'risiken',
]);
const FIELDS = new Set(['projectName', 'leader', 'owner']);
const COLORS = new Set(['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white']);

// 32 Bytes Zufall → 43 Zeichen base64url (~256 Bit, nicht erratbar)
const ID_RE = /^[A-Za-z0-9_-]{32,64}$/;
const NOTE_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

fs.mkdirSync(DATA_DIR, { recursive: true });

/** id -> { doc, clients:Set<ws>, saveTimer } */
const rooms = new Map();

function newId() {
  return crypto.randomBytes(32).toString('base64url');
}

function filePath(id) {
  return path.join(DATA_DIR, id + '.json');
}

function emptyDoc(id) {
  return {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fields: { projectName: '', leader: '', owner: '' },
    notes: {},
  };
}

function loadDoc(id) {
  try {
    return JSON.parse(fs.readFileSync(filePath(id), 'utf8'));
  } catch {
    return null;
  }
}

function saveDocNow(room) {
  clearTimeout(room.saveTimer);
  room.saveTimer = null;
  const fp = filePath(room.doc.id);
  const tmp = fp + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(room.doc));
    fs.renameSync(tmp, fp);
  } catch (e) {
    console.error('Speichern fehlgeschlagen', room.doc.id, e.message);
  }
}

function scheduleSave(room) {
  room.doc.updatedAt = Date.now();
  if (!room.saveTimer) room.saveTimer = setTimeout(() => saveDocNow(room), 800);
}

function getRoom(id) {
  let room = rooms.get(id);
  if (room) return room;
  const doc = loadDoc(id);
  if (!doc) return null;
  room = { doc, clients: new Set(), saveTimer: null };
  rooms.set(id, room);
  return room;
}

function createRoom() {
  const id = newId();
  const room = { doc: emptyDoc(id), clients: new Set(), saveTimer: null };
  rooms.set(id, room);
  saveDocNow(room);
  return room;
}

// ---------- Operationen (serverseitig validiert, Last-Write-Wins) ----------

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function cleanNote(n) {
  const note = {
    id: n.id,
    section: n.section,
    text: str(n.text, MAX_TEXT),
    color: COLORS.has(n.color) ? n.color : 'yellow',
    order: Number.isFinite(n.order) ? n.order : Date.now(),
    author: str(n.author, 40),
    updatedAt: Date.now(),
  };
  if (typeof n.date === 'string' && /^\d{4}-\d{2}-\d{2}$|^$/.test(n.date)) note.date = n.date;
  if (typeof n.done === 'boolean') note.done = n.done;
  return note;
}

/** Wendet eine Operation an. Gibt die (bereinigte) Operation zurück oder null. */
function applyOp(doc, op) {
  if (!op || typeof op !== 'object') return null;
  switch (op.t) {
    case 'add': {
      const n = op.note;
      if (!n || !NOTE_ID_RE.test(n.id) || !SECTIONS.has(n.section)) return null;
      if (doc.notes[n.id]) return null;
      if (Object.keys(doc.notes).length >= MAX_NOTES) return null;
      const note = cleanNote(n);
      doc.notes[note.id] = note;
      return { t: 'add', note };
    }
    case 'update': {
      const note = doc.notes[op.id];
      if (!note || !op.patch || typeof op.patch !== 'object') return null;
      const p = op.patch;
      const patch = {};
      if ('text' in p) patch.text = str(p.text, MAX_TEXT);
      if ('color' in p && COLORS.has(p.color)) patch.color = p.color;
      if ('section' in p && SECTIONS.has(p.section)) patch.section = p.section;
      if ('order' in p && Number.isFinite(p.order)) patch.order = p.order;
      if ('date' in p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$|^$/.test(p.date)) patch.date = p.date;
      if ('done' in p && typeof p.done === 'boolean') patch.done = p.done;
      if (!Object.keys(patch).length) return null;
      Object.assign(note, patch, { updatedAt: Date.now() });
      return { t: 'update', id: op.id, patch };
    }
    case 'delete': {
      if (!doc.notes[op.id]) return null;
      delete doc.notes[op.id];
      return { t: 'delete', id: op.id };
    }
    case 'field': {
      if (!FIELDS.has(op.key)) return null;
      const value = str(op.value, 200);
      doc.fields[op.key] = value;
      return { t: 'field', key: op.key, value };
    }
    default:
      return null;
  }
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', // Canvas-ID nicht an Dritte leaken
  'X-Frame-Options': 'SAMEORIGIN',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SEC_HEADERS, ...extra });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', {
      'Cache-Control': 'no-cache',
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));

  if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok');

  // Neues Canvas anlegen → Weiterleitung auf den Link
  if ((req.method === 'POST' || req.method === 'GET') && p === '/new') {
    const room = createRoom();
    return send(res, 303, '', 'text/plain', { Location: '/c/' + room.doc.id });
  }

  let m = p.match(/^\/c\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    if (!ID_RE.test(m[1]) || !getRoom(m[1])) {
      return serveFile(res, path.join(PUBLIC_DIR, 'notfound.html'));
    }
    return serveFile(res, path.join(PUBLIC_DIR, 'canvas.html'));
  }

  m = p.match(/^\/api\/canvas\/([^/]+)\/export$/);
  if (req.method === 'GET' && m) {
    const room = ID_RE.test(m[1]) && getRoom(m[1]);
    if (!room) return send(res, 404, 'Nicht gefunden');
    const name = (room.doc.fields.projectName || 'project-canvas').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'project-canvas';
    return send(res, 200, JSON.stringify(room.doc, null, 2), 'application/json', {
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.json"`,
    });
  }

  // Import: JSON hochladen → neues Canvas
  if (req.method === 'POST' && p === '/api/import') {
    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        const src = JSON.parse(body);
        const room = createRoom();
        for (const k of FIELDS) applyOp(room.doc, { t: 'field', key: k, value: src.fields?.[k] });
        for (const n of Object.values(src.notes || {})) {
          applyOp(room.doc, { t: 'add', note: { ...n, id: NOTE_ID_RE.test(n.id) ? n.id : newId().slice(0, 16) } });
        }
        saveDocNow(room);
        send(res, 200, JSON.stringify({ id: room.doc.id }), 'application/json');
      } catch {
        send(res, 400, 'Ungültige Datei');
      }
    });
    return;
  }

  m = p.match(/^\/static\/([\w.-]+)$/);
  if (req.method === 'GET' && m) return serveFile(res, path.join(PUBLIC_DIR, m[1]));

  send(res, 404, 'Nicht gefunden');
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c !== except && c.readyState === 1) c.send(data);
  }
}

function peerList(room) {
  return [...room.clients].map((c) => c.peer);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('c') || '';
  const room = ID_RE.test(id) && getRoom(id);
  if (!room) {
    ws.close(4004, 'not found');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.peer = {
    id: crypto.randomBytes(6).toString('base64url'),
    name: str(url.searchParams.get('name'), 40) || 'Gast',
    color: /^#[0-9a-fA-F]{6}$/.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : '#888888',
    focus: null,
  };

  room.clients.add(ws);
  ws.send(JSON.stringify({ type: 'init', doc: room.doc, you: ws.peer.id, peers: peerList(room) }));
  broadcast(room, { type: 'peers', peers: peerList(room) }, ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ops' && Array.isArray(msg.ops)) {
      const applied = [];
      for (const op of msg.ops.slice(0, 200)) {
        const r = applyOp(room.doc, op);
        if (r) applied.push(r);
      }
      if (applied.length) {
        scheduleSave(room);
        broadcast(room, { type: 'ops', ops: applied, from: ws.peer.id }, ws);
      }
    } else if (msg.type === 'presence') {
      if ('name' in msg) ws.peer.name = str(msg.name, 40) || 'Gast';
      if ('color' in msg && /^#[0-9a-fA-F]{6}$/.test(msg.color)) ws.peer.color = msg.color;
      if ('focus' in msg) ws.peer.focus = typeof msg.focus === 'string' ? msg.focus.slice(0, 40) : null;
      broadcast(room, { type: 'peers', peers: peerList(room) });
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(room, { type: 'peers', peers: peerList(room) });
    if (room.clients.size === 0) {
      saveDocNow(room);
      rooms.delete(id);
    }
  });
});

// Tote Verbindungen aufräumen
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) if (room.saveTimer) saveDocNow(room);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`Project Canvas läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})`);
});
