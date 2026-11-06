/* Project Canvas – Live-Bearbeitung innerhalb eines Projekts */
(function () {
  'use strict';

  const pid = decodeURIComponent(location.pathname.split('/')[2]);
  const versionId = new URLSearchParams(location.search).get('v');
  const COLORS = Ops.COLORS;
  const PEER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f', '#c2410c', '#0f766e'];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let lastColor = store.get('pc.noteColor', 'yellow');
  let S = null;
  let readOnly = false;
  let viewDoc = null; // bei Ansicht eines Entwicklungsschritts
  const noteEls = new Map();
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = App.uid;
  const D = () => viewDoc || (S && S.doc);

  function setStatus(state, label) {
    const s = $('#status');
    s.dataset.state = state;
    $('.label', s).textContent = label;
  }

  /** Änderungen anderer: nur betroffene Teile neu zeichnen */
  function applyRemote(op) {
    if (op.t === 'set') {
      const inp = $(`[data-field="${op.key}"]`);
      if (inp && document.activeElement !== inp) inp.value = op.value;
      if (op.key === 'name') updateTitle();
      return;
    }
    if (op.c !== 'notes') return;
    if (op.t === 'add') renderSection(op.row.section);
    else if (op.t === 'upd') {
      const n = D().notes[op.id];
      if (!n) return;
      const el = noteEls.get(op.id);
      const old = el && el.dataset.sec;
      if (old && old !== n.section) renderSection(old);
      updateNoteEl(n, true);
      renderSection(n.section);
    } else if (op.t === 'del') {
      const el = noteEls.get(op.id);
      if (el) { const sec = el.dataset.sec; el.remove(); noteEls.delete(op.id); renderSection(sec); }
    }
  }

  /** Eigene Änderung: lokal anwenden, senden, betroffene Teile zeichnen */
  function local(op) {
    if (readOnly) return;
    const before = op.c === 'notes' && op.id && D().notes[op.id] ? D().notes[op.id].section : null;
    if (!S.op(op)) return;
    if (op.c === 'notes') {
      if (op.t === 'add') renderSection(op.row.section);
      else if (op.t === 'upd') {
        const n = D().notes[op.id];
        updateNoteEl(n, false);
        if (before && before !== n.section) renderSection(before);
        if ('section' in op.patch || 'order' in op.patch || 'date' in op.patch) renderSection(n.section);
      } else if (op.t === 'del') {
        const el = noteEls.get(op.id);
        if (el) { el.remove(); noteEls.delete(op.id); }
        if (before) renderSection(before);
      }
    } else if (op.key === 'name') updateTitle();
  }

  // ---------- Rendering ----------
  function sectionEl(name) { return $(`[data-section="${name}"]`); }

  function sortedNotes(section) {
    const list = Object.values(D().notes).filter((n) => n.section === section);
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
      if (document.activeElement !== inp) inp.value = (Ops.getPath(D(), inp.dataset.field) || '');
    }
    updateTitle();
    renderFocus();
  }

  function renderSection(section) {
    const sec = sectionEl(section);
    if (!sec || !D()) return;
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
        <span class="grip" title="Ziehen zum Verschieben">::</span>
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
      const note = D().notes[n.id];
      if (note && note.text !== ta.value) local({ t: 'upd', c: 'notes', id: n.id, patch: { text: ta.value } });
    };
    ta.addEventListener('input', () => {
      autosize(ta);
      clearTimeout(timer);
      timer = setTimeout(sendText, 250);
    });
    ta.addEventListener('focus', () => S.presence(n.id));
    ta.addEventListener('blur', () => { sendText(); S.presence(null); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') ta.blur();
      // Strg/Cmd+Enter → neue Notiz darunter
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendText();
        const note = D().notes[n.id];
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
    $('.done', el).addEventListener('change', (e) => local({ t: 'upd', c: 'notes', id: n.id, patch: { done: e.target.checked } }));
    $('.date', el).addEventListener('change', (e) => local({ t: 'upd', c: 'notes', id: n.id, patch: { date: e.target.value } }));
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
    for (const p of S.peers) {
      if (p.id === S.me || !p.focus) continue;
      const el = noteEls.get(p.focus);
      if (!el) continue;
      el.classList.add('peer-editing');
      el.style.setProperty('--peer', peerColor(p.userId));
      const tag = $('.editing-by', el);
      tag.textContent = tag.textContent ? tag.textContent + ', ' + p.name : p.name;
    }
  }

  function peerColor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PEER_COLORS[h % PEER_COLORS.length];
  }

  function renderPeers() {
    const box = $('#peers');
    box.innerHTML = '';
    const seen = new Set();
    for (const p of S.peers) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      const a = document.createElement('span');
      a.className = 'avatar' + (p.id === S.me ? ' me' : '');
      a.style.background = peerColor(p.userId);
      a.textContent = initials(p.name);
      a.title = p.id === S.me ? p.name + ' (du)' : p.name;
      box.appendChild(a);
    }
  }

  function initials(name) {
    const parts = (name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function updateTitle() {
    document.title = (D().name ? D().name + ' - ' : '') + 'Project Canvas';
  }

  // ---------- Aktionen ----------
  function addNote(section, order) {
    if (!D() || readOnly) return;
    if (order === undefined) {
      const list = sortedNotes(section);
      order = list.length ? Math.max(...list.map((n) => n.order)) + 1 : 1;
    }
    const note = { id: uid(), section, text: '', color: lastColor, order, author: S.user ? S.user.name : '' };
    local({ t: 'add', c: 'notes', row: note });
    const ta = $('textarea', noteEls.get(note.id));
    ta.focus();
  }

  let undoNote = null;
  function deleteNote(id, offerUndo) {
    const n = D().notes[id];
    if (!n) return;
    // Fokus auf vorherige Notiz setzen (angenehm beim Tippen)
    const list = sortedNotes(n.section);
    const idx = list.findIndex((x) => x.id === id);
    const prev = list[idx - 1];
    local({ t: 'del', c: 'notes', id });
    if (!offerUndo && prev) {
      const ta = $('textarea', noteEls.get(prev.id));
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    if (offerUndo && n.text.trim()) {
      undoNote = { ...n };
      toast('Notiz gelöscht', 'Rückgängig', () => {
        if (undoNote) local({ t: 'add', c: 'notes', row: undoNote });
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
        local({ t: 'upd', c: 'notes', id, patch: { color: c } });
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
    const n = D().notes[id];
    if (n && (n.section !== target.section || n.order !== order)) {
      local({ t: 'upd', c: 'notes', id, patch: { section: target.section, order } });
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
        if (D() && Ops.getPath(D(), inp.dataset.field) !== inp.value) local({ t: 'set', key: inp.dataset.field, value: inp.value });
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

  function setupToolbar() {
    if (store.get('pc.hideHints', false)) document.body.classList.add('hide-hints');
    $('#hintsBtn').addEventListener('click', () => {
      const h = document.body.classList.toggle('hide-hints');
      store.set('pc.hideHints', h);
    });
    $('#printBtn').addEventListener('click', () => window.print());
    window.addEventListener('beforeprint', () => $$('.note textarea').forEach(autosize));
    $('#backLink').href = '/p/' + encodeURIComponent(pid) + '#canvas';
  }

  function enterVersion() {
    const v = S.doc.canvasVersions.find((x) => x.id === versionId);
    const b = $('#versionBanner');
    b.hidden = false;
    if (!v) { b.textContent = 'Dieser Entwicklungsschritt existiert nicht (mehr).'; return false; }
    readOnly = true;
    document.body.classList.add('read-only');
    viewDoc = { name: v.name, meta: { leader: v.leader, owner: v.owner }, notes: JSON.parse(JSON.stringify(v.notes || {})) };
    b.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = `Entwicklungsschritt „${v.label}" vom ${new Date(v.at).toLocaleString('de-DE')} (${v.by}) - nur Ansicht. `;
    const a = document.createElement('a');
    a.href = '/p/' + encodeURIComponent(pid) + '/canvas';
    a.textContent = 'Zum aktuellen Stand';
    b.append(t, a);
    $$('[data-field]').forEach((i) => { i.readOnly = true; });
    return true;
  }

  (async () => {
    setupSections();
    setupFields();
    setupToolbar();
    S = Sync.connect(pid, {
      onInit: () => {
        if (versionId) enterVersion();
        renderAll();
        renderPeers();
        if (readOnly) $$('.note textarea, .note input').forEach((x) => { x.readOnly = true; x.disabled = x.type === 'checkbox' || x.type === 'date'; });
      },
      onOps: (ops) => { if (!readOnly) ops.forEach(applyRemote); },
      onPeers: () => { renderPeers(); renderFocus(); },
      onStatus: (state, text) => setStatus(state, text),
      onGone: () => { alert('Dieses Projekt wurde gelöscht.'); location.href = '/'; },
    });
  })();
})();
