'use strict';
/**
 * Datenbank (SQLite, eine Datei im Datenverzeichnis).
 * Tabellen: users, sessions, projects (Projektinhalt als JSON), activity (Aktivitätsprotokoll).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'osp.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      pw TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      must_change INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      area TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 1,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_project ON activity(project_id, id);
  `);

  const q = (sql) => db.prepare(sql);
  const toUser = (r) => r && ({
    id: r.id, name: r.name, email: r.email, pw: r.pw, role: r.role, status: r.status,
    mustChange: !!r.must_change, createdAt: r.created_at,
  });

  const st = {
    userAll: q('SELECT * FROM users ORDER BY created_at'),
    userById: q('SELECT * FROM users WHERE id = ?'),
    userByEmail: q('SELECT * FROM users WHERE email = ?'),
    userInsert: q('INSERT INTO users (id, name, email, pw, role, status, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    userUpdate: q('UPDATE users SET name = ?, email = ?, pw = ?, role = ?, status = ?, must_change = ? WHERE id = ?'),
    userDelete: q('DELETE FROM users WHERE id = ?'),
    userCountAdmins: q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    userCountPending: q("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'"),
    userActive: q("SELECT id, name FROM users WHERE status = 'active' ORDER BY name"),

    sessGet: q('SELECT * FROM sessions WHERE token = ?'),
    sessInsert: q('INSERT INTO sessions (token, user_id, exp) VALUES (?, ?, ?)'),
    sessDelete: q('DELETE FROM sessions WHERE token = ?'),
    sessDeleteUser: q('DELETE FROM sessions WHERE user_id = ?'),
    sessPurge: q('DELETE FROM sessions WHERE exp < ?'),

    projGet: q('SELECT data FROM projects WHERE id = ? AND deleted = 0'),
    projInsert: q('INSERT INTO projects (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    projSave: q('UPDATE projects SET name = ?, data = ?, updated_at = ? WHERE id = ?'),
    projList: q('SELECT id, name, created_at, updated_at FROM projects WHERE deleted = 0 ORDER BY updated_at DESC'),
    projDelete: q('UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?'),

    actLast: q('SELECT * FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT 1'),
    actInsert: q('INSERT INTO activity (project_id, user_id, user_name, area, n, at) VALUES (?, ?, ?, ?, ?, ?)'),
    actBump: q('UPDATE activity SET n = n + ?, at = ? WHERE id = ?'),
    actList: q('SELECT id, user_id, user_name, area, n, at FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT ?'),
  };

  const api = {
    raw: db,
    users: {
      all: () => st.userAll.all().map(toUser),
      byId: (id) => toUser(st.userById.get(id)),
      byEmail: (email) => toUser(st.userByEmail.get(email)),
      insert: (u) => st.userInsert.run(u.id, u.name, u.email, u.pw, u.role, u.status, u.mustChange ? 1 : 0, u.createdAt),
      update: (u) => st.userUpdate.run(u.name, u.email, u.pw, u.role, u.status, u.mustChange ? 1 : 0, u.id),
      delete: (id) => st.userDelete.run(id),
      countAdmins: () => st.userCountAdmins.get().n,
      countPending: () => st.userCountPending.get().n,
      active: () => st.userActive.all().map((r) => ({ id: r.id, name: r.name })),
    },
    sessions: {
      get: (token) => st.sessGet.get(token),
      create: (token, userId, exp) => st.sessInsert.run(token, userId, exp),
      delete: (token) => st.sessDelete.run(token),
      deleteForUser: (userId) => st.sessDeleteUser.run(userId),
      purge: () => st.sessPurge.run(Date.now()),
    },
    projects: {
      get: (id) => { const r = st.projGet.get(id); return r ? JSON.parse(r.data) : null; },
      create: (doc) => st.projInsert.run(doc.id, doc.name, JSON.stringify(doc), doc.createdAt, doc.createdAt),
      save: (doc) => st.projSave.run(doc.name || '', JSON.stringify(doc), doc.updatedAt || Date.now(), doc.id),
      list: () => st.projList.all().map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at })),
      delete: (id) => st.projDelete.run(Date.now(), id),
    },
    activity: {
      /** Gleiche Person + gleicher Bereich innerhalb von 10 Minuten wird zusammengefasst */
      log(projectId, user, area, n = 1) {
        const now = Date.now();
        const last = st.actLast.get(projectId);
        if (last && last.user_id === user.id && last.area === area && now - last.at < 10 * 60 * 1000) {
          st.actBump.run(n, now, last.id);
          return { id: last.id, userId: user.id, name: user.name, area, n: last.n + n, at: now };
        }
        const r = st.actInsert.run(projectId, user.id, user.name, area, n, now);
        return { id: Number(r.lastInsertRowid), userId: user.id, name: user.name, area, n, at: now };
      },
      list: (projectId, limit = 300) => st.actList.all(projectId, limit)
        .map((r) => ({ id: r.id, userId: r.user_id, name: r.user_name, area: r.area, n: r.n, at: r.at })),
    },
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };

  migrateJson(api, dataDir);
  return api;
}

/** Einmalige Übernahme der alten JSON-Dateien (users.json, sessions.json, projects/*.json) */
function migrateJson(api, dataDir) {
  const usersFile = path.join(dataDir, 'users.json');
  const projDir = path.join(dataDir, 'projects');
  const hasOld = fs.existsSync(usersFile) || fs.existsSync(projDir);
  if (!hasOld || api.users.all().length || api.projects.list().length) return;
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  let nu = 0, np = 0;
  api.tx(() => {
    for (const u of read(usersFile, [])) {
      api.users.insert({ ...u, mustChange: !!u.mustChange });
      nu++;
    }
    const sessions = read(path.join(dataDir, 'sessions.json'), {});
    const ids = new Set(api.users.all().map((u) => u.id));
    for (const [t, s] of Object.entries(sessions)) if (ids.has(s.userId) && s.exp > Date.now()) api.sessions.create(t, s.userId, s.exp);
    if (fs.existsSync(projDir)) {
      for (const f of fs.readdirSync(projDir).filter((x) => x.endsWith('.json'))) {
        const d = read(path.join(projDir, f), null);
        if (!d || !d.id) continue;
        d.createdAt = d.createdAt || Date.now();
        api.projects.create(d);
        if (d.updatedAt) api.projects.save(d);
        np++;
      }
    }
  });
  // alte Dateien umbenennen, damit klar ist, dass sie übernommen wurden
  for (const f of [usersFile, path.join(dataDir, 'sessions.json'), projDir]) {
    if (fs.existsSync(f)) fs.renameSync(f, f + '.migriert');
  }
  console.log(`Alte JSON-Daten in die Datenbank übernommen: ${nu} Benutzer, ${np} Projekte`);
}

module.exports = { open };
