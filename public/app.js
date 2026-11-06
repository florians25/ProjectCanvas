/* Project Canvas – Client */
(function () {
  'use strict';

  const canvasId = decodeURIComponent(location.pathname.split('/').pop());
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'];
  const PEER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f', '#c2410c', '#0f766e'];

  // ---------- lokale Einstellungen ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let myName = store.get('pc.name', '');
  let myColor = store.get('pc.color', null);
  if (!myColor) { myColor = PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)]; store.set('pc.color', myColor); }
  let lastColor = store.get('pc.noteColor', 'yellow');

  // ---------- Zustand ----------
  let doc = null;
  let myId = null;
  let peers = [];
  let ws = null;
  let pending = [];   // noch nicht bestätigt gesendete Ops (für Reconnect)
  let outbox = [];
  let retry = 0;
  const noteEls = new Map();
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const uid = () => {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  // ---------- Verbindung ----------
  function setStatus(state, label) {
    const s = $('#status');
    s.dataset.state = state;
    $('.label', s).textContent = label;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ c: canvasId, name: myName || 'Gast', color: myColor });
    ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
    setStatus('connecting', 'Verbinde…');

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'init') {
        retry = 0;
        doc = msg.doc;
        myId = msg.you;
        peers = msg.peers;
        // Offline gemachte Änderungen erneut anwenden und senden
        const replay = pending;
        pending = [];
        for (const op of replay) { applyOp(op); queue(op); }
        renderAll();
        renderPeers();
        rememberCanvas();
        setStatus('online', 'Live');
      } else if (msg.type === 'ops') {
        for (const op of msg.ops) applyOp(op, true);
      } else if (msg.type === 'peers') {
        peers = msg.peers;
        renderPeers();
        renderFocus();
      }
    };

    ws.onclose = (ev) => {
      if (ev.code === 4004) { setStatus('error', 'Nicht gefunden'); location.reload(); return; }
      setStatus('offline', 'Offline – verbinde neu…');
      const delay = Math.min(10000, 500 * 2 ** retry++);
      setTimeout(connect, delay);
    };
  }

  function queue(op) {
    outbox.push(op);
    pending.push(op);
    if (outbox.length === 1) queueMicrotask(flush);
  }

  function flush() {
    if (!outbox.length) return;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'ops', ops: outbox }));
      outbox = [];
      // Als bestätigt betrachten, sobald der Puffer leer ist
      const check = () => { if (ws.bufferedAmount === 0) pending = []; else setTimeout(check, 200); };
      check();
    } else {
      outbox = []; // liegt in "pending" und wird nach Reconnect gesendet
    }
  }

  function sendPresence(data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'presence', ...data }));
  }

  // ---------- Operationen ----------
  function applyOp(op, remote) {
    if (op.t === 'add') {
      doc.notes[op.note.id] = { ...op.note };
      renderSection(op.note.section);
    } else if (op.t === 'update') {
      const n = doc.notes[op.id];
      if (!n) return;
      const oldSection = n.section;
      Object.assign(n, op.patch);
      if (oldSection !== n.section) renderSection(oldSection);
      updateNoteEl(n, remote);
      if ('section' in op.patch || 'order' in op.patch || 'date' in op.patch) renderSection(n.section);
    } else if (op.t === 'delete') {
      const n = doc.notes[op.id];
      if (!n) return;
      delete doc.notes[op.id];
      const el = noteEls.get(op.id);
      if (el) { el.remove(); noteEls.delete(op.id); }
      renderSection(n.section);
    } else if (op.t === 'field') {
      doc.fields[op.key] = op.value;
      const inp = $(`[data-field="${op.key}"]`);
      if (inp && document.activeElement !== inp) inp.value = op.value;
      if (op.key === 'projectName') { updateTitle(); rememberCanvas(); }
    }
  }

  function local(op) {
    applyOp(op, false);
    queue(op);
  }

  // ---------- Rendering ----------
  function sectionEl(name) { return $(`[data-section="${name}"]`); }

  function sortedNotes(section) {
    const list = Object.values(doc.notes).filter((n) => n.section === section);
    if (section === 'meilensteine') {
      list.sort((a, b) => (a.date || '9999') .localeCompare(b.date || '9999') || a.order - b.order);
    } else {
      list.sort((a, b) => a.order - b.order);
    }
    return list;
  }

  function renderAll() {
    for (const el of noteEls.values()) el.remove();
    noteEls.clear();
    $$('[data-section]').forEach((s) => renderSection(s.dataset.section));
    for (const inp of $$('[data-field]')) {
      if (document.activeElement !== inp) inp.value = doc.fields[inp.dataset.field] || '';
    }
    updateTitle();
    renderFocus();
  }

  function renderSection(section) {
    const sec = sectionEl(section);
    if (!sec || !doc) return;
    const wrap = $('.notes', sec);
    const notes = sortedNotes(section);
    const want = notes.map((n) => noteEl(n));
    const have = [...wrap.children].filter((c) => c.classList.contains('note'));
    // Nur umsortieren, wenn sich die Reihenfolge geändert hat (sonst verliert man den Fokus)
    const same = want.length === have.length && want.every((el, i) => el === have[i]);
    if (!same) {
      const focused = document.activeElement;
      const sel = focused && focused.tagName === 'TEXTAREA' ? [focused.selectionStart, focused.selectionEnd] : null;
      for (const el of want) wrap.appendChild(el);
      for (const el of have) if (!want.includes(el)) el.remove();
      if (sel && focused.isConnected && document.activeElement !== focused) {
        focused.focus();
        focused.setSelectionRange(sel[0], sel[1]);
      }
    }
    sec.classList.toggle('empty', notes.length === 0);
    for (const el of want) autosize($('textarea', el));
  }

  function noteEl(n) {
    let el = noteEls.get(n.id);
    if (!el) {
      el = buildNote(n);
      noteEls.set(n.id, el);
    }
    updateNoteEl(n, true);
    return el;
  }

  function buildNote(n) {
    const el = document.createElement('div');
    el.className = 'note';
    el.dataset.id = n.id;
    el.innerHTML = `
      <div class="note-bar">
        <span class="grip" title="Ziehen zum Verschieben">⠿</span>
        <input type="checkbox" class="done" title="Erledigt">
        <input type="date" class="date" title="Datum">
        <span class="editing-by"></span>
        <button class="icon-btn color-btn" title="Farbe">●</button>
        <button class="icon-btn del-btn" title="Löschen">×</button>
      </div>
      <textarea rows="1" maxlength="4000" placeholder="Notiz…"></textarea>`;
    const ta = $('textarea', el);
    let timer = null;
    const sendText = () => {
      clearTimeout(timer); timer = null;
      const note = doc.notes[n.id];
      if (note && note.text !== ta.value) local({ t: 'update', id: n.id, patch: { text: ta.value } });
    };
    ta.addEventListener('input', () => {
      autosize(ta);
      clearTimeout(timer);
      timer = setTimeout(sendText, 250);
    });
    ta.addEventListener('focus', () => sendPresence({ focus: n.id }));
    ta.addEventListener('blur', () => { sendText(); sendPresence({ focus: null }); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ta.blur();
      // Strg/Cmd+Enter → neue Notiz darunter
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendText();
        const note = doc.notes[n.id];
        addNote(note.section, note.order + 0.5);
      }
      // Leere Notiz mit Backspace löschen
      if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault();
        deleteNote(n.id, false);
      }
    });
    $('.del-btn', el).addEventListener('click', () => deleteNote(n.id, true));
    $('.color-btn', el).addEventListener('click', (e) => openColorPicker(e.currentTarget, n.id));
    $('.done', el).addEventListener('change', (e) => local({ t: 'update', id: n.id, patch: { done: e.target.checked } }));
    $('.date', el).addEventListener('change', (e) => local({ t: 'update', id: n.id, patch: { date: e.target.value } }));
    $('.grip', el).addEventListener('pointerdown', (e) => startDrag(e, n.id));
    return el;
  }

  function updateNoteEl(n, remote) {
    const el = noteEls.get(n.id);
    if (!el) return;
    el.className = `note c-${n.color}${n.done ? ' is-done' : ''}`;
    el.dataset.sec = n.section;
    const ta = $('textarea', el);
    if (ta.value !== n.text && (document.activeElement !== ta || !remote)) {
      ta.value = n.text;
      autosize(ta);
    }
    $('.done', el).checked = !!n.done;
    const d = $('.date', el);
    if (document.activeElement !== d) d.value = n.date || '';
  }

  function autosize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function renderFocus() {
    for (const el of noteEls.values()) {
      el.style.removeProperty('--peer');
      el.classList.remove('peer-editing');
      $('.editing-by', el).textContent = '';
    }
    for (const p of peers) {
      if (p.id === myId || !p.focus) continue;
      const el = noteEls.get(p.focus);
      if (!el) continue;
      el.classList.add('peer-editing');
      el.style.setProperty('--peer', p.color);
      const tag = $('.editing-by', el);
      tag.textContent = tag.textContent ? tag.textContent + ', ' + p.name : p.name;
    }
  }

  function renderPeers() {
    const box = $('#peers');
    box.innerHTML = '';
    const sorted = [...peers].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0));
    const max = 6;
    for (const p of sorted.slice(0, max)) {
      const a = document.createElement('button');
      a.className = 'avatar' + (p.id === myId ? ' me' : '');
      a.style.background = p.color;
      a.textContent = initials(p.name);
      a.title = p.id === myId ? `${p.name} (du) – klicken zum Umbenennen` : p.name;
      if (p.id === myId) a.addEventListener('click', askName);
      box.appendChild(a);
    }
    if (sorted.length > max) {
      const more = document.createElement('span');
      more.className = 'avatar more';
      more.textContent = '+' + (sorted.length - max);
      more.title = sorted.slice(max).map((p) => p.name).join(', ');
      box.appendChild(more);
    }
  }

  function initials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function updateTitle() {
    document.title = (doc.fields.projectName ? doc.fields.projectName + ' – ' : '') + 'Project Canvas';
  }

  function rememberCanvas() {
    let list = store.get('pc.recent', []).filter((r) => r.id !== canvasId);
    list.unshift({ id: canvasId, name: doc.fields.projectName || '', at: Date.now() });
    store.set('pc.recent', list.slice(0, 20));
  }

  // ---------- Aktionen ----------
  function addNote(section, order) {
    if (!doc) return;
    if (order === undefined) {
      const list = sortedNotes(section);
      order = list.length ? Math.max(...list.map((n) => n.order)) + 1 : 1;
    }
    const note = { id: uid(), section, text: '', color: lastColor, order, author: myName };
    local({ t: 'add', note });
    const ta = $('textarea', noteEls.get(note.id));
    ta.focus();
  }

  let undoNote = null;
  function deleteNote(id, offerUndo) {
    const n = doc.notes[id];
    if (!n) return;
    // Fokus auf vorherige Notiz setzen (angenehm beim Tippen)
    const list = sortedNotes(n.section);
    const idx = list.findIndex((x) => x.id === id);
    const prev = list[idx - 1];
    local({ t: 'delete', id });
    if (!offerUndo && prev) {
      const ta = $('textarea', noteEls.get(prev.id));
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    if (offerUndo && n.text.trim()) {
      undoNote = { ...n };
      toast('Notiz gelöscht', 'Rückgängig', () => {
        if (undoNote) local({ t: 'add', note: undoNote });
        undoNote = null;
      });
    }
  }

  // Farbwahl
  let picker = null;
  function openColorPicker(btn, id) {
    closePicker();
    picker = document.createElement('div');
    picker.className = 'picker';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = `swatch c-${c}`;
      b.title = c;
      b.addEventListener('click', () => {
        lastColor = c; store.set('pc.noteColor', c);
        local({ t: 'update', id, patch: { color: c } });
        closePicker();
      });
      picker.appendChild(b);
    }
    document.body.appendChild(picker);
    const r = btn.getBoundingClientRect();
    picker.style.top = (r.bottom + window.scrollY + 4) + 'px';
    picker.style.left = Math.min(window.innerWidth - picker.offsetWidth - 8, r.left + window.scrollX - 60) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  }
  function outside(e) { if (picker && !picker.contains(e.target)) closePicker(); }
  function closePicker() {
    if (picker) picker.remove();
    picker = null;
    document.removeEventListener('pointerdown', outside);
  }

  // ---------- Drag & Drop (Pointer-Events → funktioniert auch auf Touch) ----------
  let drag = null;
  function startDrag(e, id) {
    e.preventDefault();
    const el = noteEls.get(id);
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = r.width + 'px';
    document.body.appendChild(ghost);
    const marker = document.createElement('div');
    marker.className = 'drop-marker';
    drag = { id, el, ghost, marker, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null };
    el.classList.add('dragging');
    moveDrag(e);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag, { once: true });
    window.addEventListener('pointercancel', cancelDrag, { once: true });
  }

  function moveDrag(e) {
    if (!drag) return;
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    // Auto-Scroll am Rand
    if (e.clientY < 50) window.scrollBy(0, -15);
    else if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 15);

    drag.ghost.style.display = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.display = '';
    const sec = under && under.closest('[data-section]');
    $$('.drop-target').forEach((s) => s.classList.remove('drop-target'));
    if (!sec) { drag.target = null; drag.marker.remove(); return; }
    sec.classList.add('drop-target');
    const wrap = $('.notes', sec);
    const others = [...wrap.children].filter((c) => c.classList.contains('note') && c !== drag.el);
    const horizontal = wrap.classList.contains('row');
    let before = null;
    for (const o of others) {
      const r = o.getBoundingClientRect();
      const hit = horizontal
        ? (e.clientY < r.bottom && (e.clientX < r.left + r.width / 2 || e.clientY < r.top))
        : e.clientY < r.top + r.height / 2;
      if (hit) { before = o; break; }
    }
    drag.target = { section: sec.dataset.section, before: before ? before.dataset.id : null };
    if (before) wrap.insertBefore(drag.marker, before); else wrap.appendChild(drag.marker);
  }

  function endDrag() {
    if (!drag) return;
    const { id, target } = drag;
    cleanupDrag();
    if (!target) return;
    const list = sortedNotes(target.section).filter((n) => n.id !== id);
    let order;
    if (target.before) {
      const i = list.findIndex((n) => n.id === target.before);
      const next = list[i].order;
      const prev = i > 0 ? list[i - 1].order : next - 2;
      order = (prev + next) / 2;
    } else {
      order = list.length ? list[list.length - 1].order + 1 : 1;
    }
    const n = doc.notes[id];
    if (n && (n.section !== target.section || n.order !== order)) {
      local({ t: 'update', id, patch: { section: target.section, order } });
    }
  }

  function cancelDrag() { cleanupDrag(); }
  function cleanupDrag() {
    window.removeEventListener('pointermove', moveDrag);
    drag.ghost.remove();
    drag.marker.remove();
    drag.el.classList.remove('dragging');
    $$('.drop-target').forEach((s) => s.classList.remove('drop-target'));
    drag = null;
  }

  // ---------- UI-Verdrahtung ----------
  function setupSections() {
    for (const sec of $$('[data-section]')) {
      const name = sec.dataset.section;
      const btn = document.createElement('button');
      btn.className = 'add-btn';
      btn.title = 'Notiz hinzufügen';
      btn.textContent = '+';
      btn.addEventListener('click', () => addNote(name));
      const head = $(':scope > h3, :scope > h4', sec);
      head.appendChild(btn);
      // Doppelklick auf freie Fläche → neue Notiz
      sec.addEventListener('dblclick', (e) => {
        if (e.target.closest('.note, button, input')) return;
        if (e.target.closest('[data-section]') !== sec) return;
        addNote(name);
      });
    }
  }

  function setupFields() {
    for (const inp of $$('[data-field]')) {
      let timer = null;
      const send = () => {
        clearTimeout(timer);
        if (doc && doc.fields[inp.dataset.field] !== inp.value) local({ t: 'field', key: inp.dataset.field, value: inp.value });
      };
      inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(send, 300); });
      inp.addEventListener('blur', send);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    }
  }

  function toast(text, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    t.appendChild(span);
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = actionLabel;
      b.onclick = () => { action(); t.classList.remove('show'); };
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 6000);
  }

  function inviteLink() { return `${location.origin}/c/${encodeURIComponent(canvasId)}`; }

  function setupInvite() {
    const dlg = $('#inviteDlg');
    $('#inviteBtn').addEventListener('click', () => {
      $('#inviteLink').value = inviteLink();
      const subject = 'Einladung: ' + (doc?.fields.projectName || 'Project Canvas');
      $('#mailBtn').href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent('Arbeite mit mir an unserem Project Canvas:\n' + inviteLink())}`;
      $('#shareBtn').hidden = !navigator.share;
      dlg.showModal();
      $('#inviteLink').select();
    });
    $('#copyBtn').addEventListener('click', async () => {
      const inp = $('#inviteLink');
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
      $('#copyBtn').textContent = 'Kopiert ✓';
      setTimeout(() => { $('#copyBtn').textContent = 'Kopieren'; }, 1500);
    });
    $('#shareBtn').addEventListener('click', () => {
      navigator.share({ title: doc?.fields.projectName || 'Project Canvas', url: inviteLink() }).catch(() => {});
    });
  }

  function askName() {
    const dlg = $('#nameDlg');
    $('#nameInput').value = myName;
    dlg.showModal();
  }

  function setupName() {
    $('#nameForm').addEventListener('submit', () => {
      const v = $('#nameInput').value.trim().slice(0, 40);
      if (!v) return;
      myName = v;
      store.set('pc.name', v);
      sendPresence({ name: v });
    });
    $('#nameDlg').addEventListener('cancel', (e) => { if (!myName) e.preventDefault(); });
  }

  function setupToolbar() {
    if (store.get('pc.hideHints', false)) document.body.classList.add('hide-hints');
    $('#hintsBtn').addEventListener('click', () => {
      const h = document.body.classList.toggle('hide-hints');
      store.set('pc.hideHints', h);
    });
    $('#exportBtn').addEventListener('click', () => { location.href = `/api/canvas/${encodeURIComponent(canvasId)}/export`; });
    $('#printBtn').addEventListener('click', () => window.print());
    // Vor dem Drucken Textfelder auf volle Höhe bringen
    window.addEventListener('beforeprint', () => $$('.note textarea').forEach(autosize));
  }

  setupSections();
  setupFields();
  setupInvite();
  setupName();
  setupToolbar();
  connect();
  if (!myName) askName();
})();
