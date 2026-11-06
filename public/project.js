/* Projektseite: alle Planungsdokumente */
(function () {
  'use strict';
  const { esc, nl2br, uid, fmtDate, fmtEuro, fmtNum } = App;
  const pid = decodeURIComponent(location.pathname.split('/')[2]);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let S = null;          // Sync-Verbindung
  let me = null;
  let users = [];        // freigeschaltete Benutzer (für Personen-Auswahl)
  let mode = 'edit';     // edit | doc
  let apSelected = null; // gewähltes Arbeitspaket (Arbeitspaketbeschreibung)

  const TABS = [
    ['uebersicht', 'Übersicht'],
    ['canvas', 'Project Canvas'],
    ['pflichtenheft', 'Pflichtenheft'],
    ['psp', 'Projektstrukturplan'],
    ['gantt', 'Zeitplan (Gantt)'],
    ['kosten', 'Ressourcen- und Kostenplan'],
    ['risiken', 'Risikoplan'],
    ['qualitaet', 'Qualitätsplan'],
    ['ap', 'Arbeitspaketbeschreibung'],
    ['fragen', 'Fragenkatalog'],
    ['doku', 'Grobe Zeitplanung'],
  ];
  const tab = () => {
    const t = location.hash.slice(1);
    return TABS.some((x) => x[0] === t) ? t : 'uebersicht';
  };

  // ---------- Hilfen ----------
  const doc = () => S.doc;
  const rows = (c, filter) => Object.values(doc()[c] || {}).filter(filter || (() => true)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const val = (key) => Ops.getPath(doc(), key) ?? '';
  const days = (s, e) => (s && e ? Ops.dayNum(e) - Ops.dayNum(s) + 1 : null);

  function addRow(c, extra) {
    const list = rows(c);
    const order = list.length ? Math.max(...list.map((r) => r.order || 0)) + 1 : 1;
    const row = Object.assign({ id: uid(), order }, extra || {});
    S.op({ t: 'add', c, row });
    return row;
  }

  function moveRow(c, id, dir, filter) {
    const list = rows(c, filter);
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const oa = a.order || 0, ob = b.order || 0;
    S.op({ t: 'upd', c, id: a.id, patch: { order: ob === oa ? oa + dir : ob } });
    S.op({ t: 'upd', c, id: b.id, patch: { order: oa } });
  }

  // Eingabefelder: data-bind="set|key" oder "upd|c|id|feld"
  function inp(bind, value, type = 'text', attrs = '') {
    const v = value ?? '';
    if (type === 'textarea') return `<textarea class="form-control auto" rows="2" data-bind="${esc(bind)}" ${attrs}>${esc(v)}</textarea>`;
    if (type === 'number') return `<input class="form-control" type="number" step="any" data-bind="${esc(bind)}" value="${esc(v)}" ${attrs}>`;
    return `<input class="form-control" type="${type}" data-bind="${esc(bind)}" value="${esc(v)}" ${attrs}>`;
  }
  function sel(bind, value, options, attrs = '') {
    return `<select class="form-select" data-bind="${esc(bind)}" ${attrs}>${options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  }
  const field = (label, key, type = 'text', hint = '') =>
    `<div class="mb-3"><label class="form-label fw-semibold">${esc(label)}</label>${inp('set|' + key, val(key), type)}${hint ? `<div class="form-text">${esc(hint)}</div>` : ''}</div>`;
  const btn = (label, act, data = {}, cls = 'btn-outline-secondary') =>
    `<button type="button" class="btn btn-sm ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`;
  const rowBtns = (c, id, filterKey) => `<div class="btn-group btn-group-sm">
      ${btn('hoch', 'up', { c, id, f: filterKey || '' })}${btn('runter', 'down', { c, id, f: filterKey || '' })}${btn('löschen', 'del', { c, id }, 'btn-outline-danger')}</div>`;

  /** Generische Tabellen-Bearbeitung */
  function tableEditor(c, cols, filter, filterKey) {
    const list = rows(c, filter);
    return `<div class="table-responsive"><table class="table table-sm table-bordered table-edit">
      <thead class="table-light"><tr>${cols.map((col) => `<th style="${col.w ? 'width:' + col.w : ''}">${esc(col.label)}</th>`).join('')}<th style="width:1%"></th></tr></thead>
      <tbody>${list.length ? list.map((r, i) => `<tr>${cols.map((col) => {
        if (col.render) return `<td class="${col.cls || ''}">${col.render(r, i)}</td>`;
        const b = `upd|${c}|${r.id}|${col.k}`;
        if (col.type === 'select') return `<td>${sel(b, r[col.k], col.options)}</td>`;
        return `<td>${inp(b, r[col.k], col.type || 'textarea', col.list ? `list="${col.list}"` : '')}</td>`;
      }).join('')}<td class="text-nowrap">${rowBtns(c, r.id, filterKey)}</td></tr>`).join('')
        : `<tr><td colspan="${cols.length + 1}" class="text-muted">Noch keine Einträge.</td></tr>`}</tbody>
    </table></div>`;
  }

  function personsLabel(list) {
    const n = (list || []).length;
    if (!n) return '';
    return n <= 2 ? list.join(', ') : `${n} Personen`;
  }

  /** Personen-Auswahl (Mehrfachauswahl aus freigeschalteten Benutzern) */
  function personsPicker(node) {
    const chosen = node.persons || [];
    const names = [...new Set(users.map((u) => u.name).concat(chosen))];
    return `<div class="dropdown">
      <button class="btn btn-sm btn-outline-secondary persons-btn" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" title="${esc(chosen.join(', '))}">${esc(personsLabel(chosen) || 'Personen wählen')}</button>
      <div class="dropdown-menu p-2" style="min-width:14rem">${names.map((n) => `<label class="dropdown-item-text d-block">
        <input type="checkbox" class="form-check-input me-1" data-act="person" data-id="${esc(node.id)}" data-name="${esc(n)}" ${chosen.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </div></div>`;
  }

  function autosizeAll(root) { $$('textarea.auto', root).forEach(autosize); }
  function autosize(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

  // ---------- Rendering ----------
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<li class="nav-item"><a class="nav-link ${tab() === k ? 'active' : ''}" href="#${k}">${esc(l)}</a></li>`).join('');
  }

  const DOC_TABS = ['pflichtenheft', 'psp', 'gantt', 'kosten', 'risiken', 'qualitaet', 'ap', 'fragen', 'doku'];

  function renderToolbar() {
    const t = tab();
    const tb = $('#toolbar');
    if (!DOC_TABS.includes(t)) { tb.innerHTML = ''; return; }
    tb.innerHTML = `
      <div class="btn-group btn-group-sm">
        <button class="btn ${mode === 'edit' ? 'btn-primary' : 'btn-outline-primary'}" data-act="mode" data-m="edit">Bearbeiten</button>
        <button class="btn ${mode === 'doc' ? 'btn-primary' : 'btn-outline-primary'}" data-act="mode" data-m="doc">Dokumentansicht</button>
      </div>
      <button class="btn btn-sm btn-outline-secondary" data-act="print">Drucken / PDF</button>
      ${t !== 'gantt' ? '<button class="btn btn-sm btn-outline-secondary" data-act="word">Als Word-Datei</button>' : ''}`;
  }

  let dragging = false;
  function render() {
    if (!S || !S.doc || dragging) return;
    const view = $('#view');
    // Fokus merken
    const a = document.activeElement;
    const focusBind = a && a.dataset && a.dataset.bind;
    const selRange = focusBind && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    const scroll = [window.scrollX, window.scrollY];
    const gwrap = $('.gantt-wrap');
    const gscroll = gwrap ? gwrap.scrollLeft : null;

    $('#projTitle').textContent = doc().name || 'Projekt';
    document.title = (doc().name || 'Projekt') + ' - OSP-Projektmanagement';
    renderTabs();
    renderToolbar();
    const t = tab();
    const V = VIEWS[t];
    if (mode === 'doc' && V.doc) view.innerHTML = `<div class="doc">${V.doc()}</div>`;
    else view.innerHTML = V.edit();
    if (V.after) V.after(view);
    autosizeAll(view);

    if (focusBind) {
      const el = $$('[data-bind]', view).find((x) => x.dataset.bind === focusBind);
      if (el) {
        el.focus({ preventScroll: true });
        if (selRange) try { el.setSelectionRange(selRange[0], selRange[1]); } catch {}
      }
    }
    const g2 = $('.gantt-wrap');
    if (g2 && gscroll !== null) g2.scrollLeft = gscroll;
    window.scrollTo(scroll[0], scroll[1]);
  }

  // ---------- Ansichten ----------
  const VIEWS = {};

  // ---- Übersicht ----
  VIEWS.uebersicht = {
    edit: () => {
      const d = doc();
      const trello = d.meta.trello && /^https?:\/\//.test(d.meta.trello) ? `<a href="${esc(d.meta.trello)}" target="_blank" rel="noopener">Trello-Board öffnen</a>` : '';
      return `<div class="row g-4">
        <div class="col-lg-7">
          <h2 class="h5">Projektdaten</h2>
          ${field('Projektname', 'name')}
          <div class="row">
            <div class="col-md-6">${field('Auftraggeber', 'meta.auftraggeber')}</div>
            <div class="col-md-6">${field('Auftragnehmer', 'meta.auftragnehmer')}</div>
            <div class="col-md-6">${field('Projektleiter/in', 'meta.leader')}</div>
            <div class="col-md-6">${field('Produkteigentümer', 'meta.owner')}</div>
            <div class="col-md-6">${field('Projektstart', 'meta.start', 'date')}</div>
            <div class="col-md-6">${field('Projektende / Deadline', 'meta.end', 'date', 'Wird im Gantt-Diagramm als rote Linie angezeigt.')}</div>
          </div>
          ${field('Gruppenmitglieder', 'meta.gruppe', 'textarea')}
          ${field('Trello-Board (Link)', 'meta.trello', 'url', 'Kanban/Aufgaben laufen über Trello.')}
          ${trello}
        </div>
        <div class="col-lg-5">
          <h2 class="h5">Planungsdokumente</h2>
          <div class="list-group mb-4">
            ${TABS.slice(1).map(([k, l]) => `<a class="list-group-item list-group-item-action" href="#${k}">${esc(l)}</a>`).join('')}
          </div>
          <h2 class="h6">Gerade online</h2>
          <ul class="small">${S.peers.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul>
          <a class="small" href="/api/projects/${encodeURIComponent(pid)}/export">Projekt als JSON sichern</a>
        </div>
      </div>`;
    },
  };

  // ---- Project Canvas ----
  VIEWS.canvas = {
    edit: () => {
      const d = doc();
      const versions = [...d.canvasVersions].sort((a, b) => b.at - a.at);
      return `<p>Das Project Canvas wird gemeinsam live bearbeitet. Wichtige Stände als <b>Entwicklungsschritt</b> speichern
        (z. B. „Erste Canvas Version", „Nach Kundengespräch"), damit die Entwicklung nachvollziehbar bleibt.</p>
        <a class="btn btn-primary mb-4" href="/p/${encodeURIComponent(pid)}/canvas">Canvas öffnen</a>
        <h2 class="h5">Entwicklungsschritte</h2>
        <form class="input-group mb-3" style="max-width:600px" id="snapForm">
          <input class="form-control" id="snapLabel" placeholder="Bezeichnung, z. B. Erste Canvas Version" maxlength="200" required>
          <button class="btn btn-outline-primary">Aktuellen Stand speichern</button>
        </form>
        <table class="table table-sm table-bordered" style="max-width:900px">
          <thead class="table-light"><tr><th>Bezeichnung</th><th>Gespeichert am</th><th>von</th><th>Notizen</th><th></th></tr></thead>
          <tbody>${versions.length ? versions.map((v) => `<tr><td>${esc(v.label)}</td><td>${new Date(v.at).toLocaleString('de-DE')}</td><td>${esc(v.by)}</td>
            <td>${Object.keys(v.notes || {}).length}</td>
            <td class="text-nowrap"><a class="btn btn-sm btn-outline-secondary" href="/p/${encodeURIComponent(pid)}/canvas?v=${encodeURIComponent(v.id)}">Ansehen</a>
            ${btn('löschen', 'delsnap', { id: v.id }, 'btn-outline-danger')}</td></tr>`).join('')
            : '<tr><td colspan="5" class="text-muted">Noch keine Entwicklungsschritte gespeichert.</td></tr>'}</tbody>
        </table>`;
    },
    after: (view) => {
      $('#snapForm', view).addEventListener('submit', (e) => {
        e.preventDefault();
        S.send({ type: 'snapshot', label: $('#snapLabel', view).value });
      });
    },
  };

  // ---- Pflichtenheft ----
  const KIND = { M: ['Musskriterien', 'Leistungen, die unabdingbar sind und auf jeden Fall erfüllt werden müssen.'],
    W: ['Wunschkriterien', 'Nicht unabdingbar, deren Erfüllung aber so gut wie möglich angestrebt werden sollte.'],
    A: ['Abgrenzungskriterien', 'Was mit dem Produkt bewusst nicht erreicht werden soll.'] };
  const critId = (k, i) => `//${k}${String(i + 1).padStart(2, '0')}`;

  VIEWS.pflichtenheft = {
    edit: () => `<div style="max-width:1000px">
      <h2 class="h5">1 Einleitende Beschreibung</h2>
      ${field('1.1 Projektthema', 'ph.thema', 'textarea')}
      ${field('1.2 Beteiligte Parteien', 'ph.parteien', 'textarea')}
      ${field('1.3 Allgemeine Aufgabe', 'ph.aufgabe', 'textarea')}
      <h2 class="h5">2 Rahmenbedingungen</h2>
      ${field('2.1 Zeitrahmen', 'ph.zeitrahmen', 'textarea')}
      ${field('2.2 Kostenrahmen', 'ph.kostenrahmen', 'textarea')}
      <h2 class="h5">3 Zielbestimmung</h2>
      ${field('Ziel (SMART+, vgl. Canvas)', 'ph.ziel', 'textarea')}
      ${['M', 'W', 'A'].map((k, n) => `<h3 class="h6 mt-3">3.${n + 1} ${KIND[k][0]}</h3><div class="form-text mb-2">${esc(KIND[k][1])} IDs werden automatisch vergeben (${critId(k, 0)}, ${critId(k, 1)} ...).</div>
        ${tableEditor('criteria', [{ label: 'ID', w: '6rem', render: (r, i) => `<span class="font-monospace">${critId(k, i)}</span>` }, { k: 'text', label: 'Kriterium' }],
          (r) => r.kind === k, 'kind:' + k)}
        ${btn('+ ' + KIND[k][0].replace('kriterien', 'kriterium'), 'add', { c: 'criteria', extra: JSON.stringify({ kind: k }) })}`).join('')}
      <h2 class="h5 mt-4">4 Produkteinsatz</h2>
      ${field('4.1 Anwendungsbereiche', 'ph.anwendung', 'textarea')}
      ${field('4.2 Zielgruppen', 'ph.zielgruppen', 'textarea')}
      ${field('4.3 Betriebsbedingungen', 'ph.betrieb', 'textarea', 'Physikalische Umgebung, tägliche Betriebszeit, Beobachtung durch Bediener oder unbeaufsichtigter Betrieb.')}
      <h2 class="h5">5 Produktumgebung</h2>
      ${field('5.1 Technisches Umfeld', 'ph.umfeld', 'textarea', 'Welche technische Ausstattung ist vorhanden?')}
      <h2 class="h5">6 Qualitätsanforderungen</h2>
      ${tableEditor('phQuality', [{ k: 'merkmal', label: 'Qualitätsmerkmal' }, { k: 'stufe', label: 'Einstufung', type: 'select', w: '12rem', options: [['', '-']].concat(Ops.QSTUFEN) }])}
      <div class="d-flex gap-2 mb-3">${btn('+ Merkmal', 'add', { c: 'phQuality' })}
        ${rows('phQuality').length ? '' : btn('Merkmale aus Vorlage einfügen (Funktionalität, Zuverlässigkeit, Veränderbarkeit, Benutzerfreundlichkeit)', 'phdefaults')}</div>
      ${field('Hinweis unter der Tabelle', 'ph.qhinweis', 'textarea')}
      <h2 class="h5">7 Testszenarien / Testfälle (optional)</h2>
      ${field('Testszenarien', 'ph.tests', 'textarea')}
      <h2 class="h5">8 Ergänzungen</h2>
      ${field('Ergänzungen', 'ph.ergaenzungen', 'textarea', 'z. B. Installationsbedingungen, Bereitstellung von Testdaten, zu berücksichtigende Normen, Vorschriften, Lizenzen.')}
      <h2 class="h5">Glossar</h2>
      ${tableEditor('glossar', [{ k: 'begriff', label: 'Begriff', type: 'text', w: '16rem' }, { k: 'erklaerung', label: 'Erklärung' }])}
      ${btn('+ Begriff', 'add', { c: 'glossar' })}
      <h2 class="h5 mt-4">Bestätigung</h2>
      ${field('Ort', 'ph.ort')}
    </div>`,
    doc: () => {
      const d = doc();
      const p = (k) => nl2br(val('ph.' + k));
      const crit = (k) => {
        const l = rows('criteria', (r) => r.kind === k);
        return l.length ? `<table><tr><th style="width:6rem">ID</th><th>Kriterium</th></tr>${l.map((r, i) => `<tr><td>${critId(k, i)}</td><td>${nl2br(r.text)}</td></tr>`).join('')}</table>` : '<p>-</p>';
      };
      const toc = ['1 Einleitende Beschreibung', '2 Rahmenbedingungen', '3 Zielbestimmung', '4 Produkteinsatz', '5 Produktumgebung',
        '6 Qualitätsanforderungen', '7 Testszenarien / Testfälle', '8 Ergänzungen', 'Glossar', 'Bestätigung'];
      return `<div class="cover"><h1>Pflichtenheft (vorläufig)</h1><h2>${esc(d.name)}</h2>
        <table style="max-width:600px"><tr><th>Auftraggeber</th><td>${esc(d.meta.auftraggeber)}</td></tr>
        <tr><th>Auftragnehmer</th><td>${esc(d.meta.auftragnehmer)}</td></tr>
        <tr><th>Projektleitung</th><td>${esc(d.meta.leader)}</td></tr>
        <tr><th>Gruppenmitglieder</th><td>${nl2br(d.meta.gruppe)}</td></tr>
        <tr><th>Stand</th><td>${new Date().toLocaleDateString('de-DE')}</td></tr></table></div>
        <div class="page-break"></div>
        <h2>Inhaltsverzeichnis</h2><ol style="list-style:none;padding-left:0">${toc.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <div class="page-break"></div>
        <h2>1 Einleitende Beschreibung</h2><h3>1.1 Projektthema</h3><p>${p('thema')}</p><h3>1.2 Beteiligte Parteien</h3><p>${p('parteien')}</p>
        <h3>1.3 Allgemeine Aufgabe</h3><p>${p('aufgabe')}</p>
        <h2>2 Rahmenbedingungen</h2><h3>2.1 Zeitrahmen</h3><p>${p('zeitrahmen')}</p><h3>2.2 Kostenrahmen</h3><p>${p('kostenrahmen')}</p>
        <h2>3 Zielbestimmung</h2><p>${p('ziel')}</p>
        <h3>3.1 Musskriterien</h3>${crit('M')}<h3>3.2 Wunschkriterien</h3>${crit('W')}<h3>3.3 Abgrenzungskriterien</h3>${crit('A')}
        <h2>4 Produkteinsatz</h2><h3>4.1 Anwendungsbereiche</h3><p>${p('anwendung')}</p><h3>4.2 Zielgruppen</h3><p>${p('zielgruppen')}</p>
        <h3>4.3 Betriebsbedingungen</h3><p>${p('betrieb')}</p>
        <h2>5 Produktumgebung</h2><h3>5.1 Technisches Umfeld</h3><p>${p('umfeld')}</p>
        <h2>6 Qualitätsanforderungen</h2>
        <table><tr><th>Qualitätsmerkmal</th>${Ops.QSTUFEN.map((s) => `<th style="width:7rem">${esc(s)}</th>`).join('')}</tr>
        ${rows('phQuality').map((r) => `<tr><td>${esc(r.merkmal)}</td>${Ops.QSTUFEN.map((s) => `<td style="text-align:center">${r.stufe === s ? 'X' : ''}</td>`).join('')}</tr>`).join('')}</table>
        <p><i>${p('qhinweis')}</i></p>
        <h2>7 Testszenarien / Testfälle</h2><p>${p('tests') || '-'}</p>
        <h2>8 Ergänzungen</h2><p>${p('ergaenzungen') || '-'}</p>
        <h2>Glossar</h2>${rows('glossar').length ? `<table><tr><th style="width:30%">Begriff</th><th>Erklärung</th></tr>${rows('glossar').map((r) => `<tr><td>${esc(r.begriff)}</td><td>${nl2br(r.erklaerung)}</td></tr>`).join('')}</table>` : '<p>-</p>'}
        <h2>Bestätigung</h2>
        <table><tr><th style="width:33%">Ort, Datum</th><th style="width:33%">Unterschrift Auftraggeber</th><th>Unterschrift Auftragnehmer</th></tr>
        <tr><td class="sign">${esc(val('ph.ort'))}</td><td class="sign"></td><td class="sign"></td></tr></table>`;
    },
  };

  // ---- Projektstrukturplan ----
  function pspKind(t) { return t.isLeaf ? 'Arbeitspaket' : t.level === 1 ? 'Teilprojekt' : 'Teilaufgabe'; }

  VIEWS.psp = {
    edit: () => {
      const tree = Ops.pspTree(doc());
      return `<div style="max-width:1100px">
        <p class="small text-muted mb-2">Gliederung: Projekt &rarr; Teilprojekte &rarr; Teilaufgaben &rarr; Arbeitspakete (kleinste Einheit, in sich abgeschlossen und delegierbar).
        Codierung numerisch (1, 1.1, 1.1.1) wird automatisch vergeben. Hinweis: Arbeitspakete mit Verben versehen, z. B. „Drucker einrichten" statt „Drucker".</p>
        <div class="tree-row fw-semibold"><span class="code">Code</span><span class="kind">Ebene</span><span class="flex-grow-1">${esc(doc().name)} (Projekt)</span></div>
        ${tree.map((t) => `<div class="tree-row" style="padding-left:${(t.level - 1) * 1.5}rem">
          <span class="code">${t.code}</span><span class="kind">${pspKind(t)}</span>
          ${inp(`upd|psp|${t.node.id}|title`, t.node.title, 'text', 'placeholder="Bezeichnung"').replace('form-control', 'form-control form-control-sm')}
          <div class="btn-group btn-group-sm">
            ${btn('+ Unterpunkt', 'pspchild', { id: t.node.id })}${btn('hoch', 'pspmove', { id: t.node.id, dir: -1 })}${btn('runter', 'pspmove', { id: t.node.id, dir: 1 })}
            ${btn('einrücken', 'pspin', { id: t.node.id })}${btn('ausrücken', 'pspout', { id: t.node.id })}${btn('löschen', 'pspdel', { id: t.node.id }, 'btn-outline-danger')}
          </div></div>`).join('')}
        <div class="mt-3">${btn('+ Teilprojekt', 'pspchild', { id: '' }, 'btn-primary')}</div>
      </div>`;
    },
    doc: () => {
      const d = doc();
      const tree = Ops.pspTree(d);
      const byId = Object.fromEntries(tree.map((t) => [t.node.id, t]));
      const box = (t) => `<div class="psp-box ${t.level === 1 ? 'l1' : t.isLeaf ? 'ap' : ''}" style="margin-left:${Math.max(0, t.level - 2) * 0.8}rem"><span class="c">${t.code}</span>${esc(t.node.title)}</div>`;
      const sub = (t) => [box(t)].concat(t.children.map((id) => sub(byId[id]))).join('');
      const tops = tree.filter((t) => t.level === 1);
      return `<h1>Projektstrukturplan</h1><h2>${esc(d.name)}</h2>
        <div class="psp-chart no-word"><div class="psp-root"><div class="psp-box l1">${esc(d.name)}</div></div>
          <div class="psp-cols">${tops.map((t) => `<div class="psp-col">${sub(t)}</div>`).join('')}</div></div>
        <h3>Übersicht mit Codierung</h3>
        <table><tr><th style="width:6rem">Code</th><th>Element</th><th style="width:9rem">Ebene</th></tr>
        ${tree.map((t) => `<tr><td>${t.code}</td><td style="padding-left:${0.45 + (t.level - 1) * 1.2}rem">${esc(t.node.title)}</td><td>${pspKind(t)}</td></tr>`).join('')}</table>`;
    },
  };

  function pspAddChild(parentId) {
    const sib = Object.values(doc().psp).filter((n) => (n.parent || '') === parentId);
    const order = sib.length ? Math.max(...sib.map((n) => n.order || 0)) + 1 : 1;
    const row = { id: uid(), parent: parentId || null, order, title: '', persons: [], deps: [] };
    S.op({ t: 'add', c: 'psp', row });
    render();
    const el = $$('[data-bind]').find((x) => x.dataset.bind === `upd|psp|${row.id}|title`);
    if (el) el.focus();
  }
  function pspSiblings(n) {
    return Object.values(doc().psp).filter((x) => (x.parent || '') === (n.parent || '')).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  // ---- Zeitplan (Gantt) ----
  VIEWS.gantt = {
    edit: () => Gantt.html(doc(), { editable: true, personsPicker }),
    doc: () => `<h1>Zeitplan (Gantt-Diagramm)</h1><h2>${esc(doc().name)}</h2>` + Gantt.html(doc(), { editable: false }),
    after: (view) => Gantt.attach(view, {
      doc: doc(), op: (o) => S.op(o), render, setDragging: (v) => { dragging = v; if (!v) render(); }, personsPicker,
    }),
  };

  // ---- Ressourcen- und Kostenplan ----
  function costData() {
    const d = doc();
    const rate = Number.isFinite(d.meta.stundensatz) ? d.meta.stundensatz : 0;
    const aps = Ops.pspTree(d).filter((t) => t.isLeaf);
    const personal = aps.map((t) => {
      const n = (t.node.persons || []).length;
      const h = Number.isFinite(t.node.hours) ? t.node.hours : 0;
      return { t, n, h, total: n * h, cost: n * h * rate };
    });
    const perPerson = {};
    for (const p of personal) for (const name of p.t.node.persons || []) {
      const e = perPerson[name] = perPerson[name] || { h: 0, aps: [] };
      e.h += p.h; e.aps.push(p.t.code);
    }
    const sach = rows('costs').map((r) => ({ r, total: (r.menge || 0) * (r.einzelpreis || 0) }));
    const sumP = personal.reduce((a, b) => a + b.cost, 0);
    const sumS = sach.reduce((a, b) => a + b.total, 0);
    return { rate, personal, perPerson, sach, sumP, sumS, sumH: personal.reduce((a, b) => a + b.total, 0) };
  }

  VIEWS.kosten = {
    edit: () => {
      const c = costData();
      return `<div style="max-width:1200px">
        <div class="row"><div class="col-md-4">${field('Stundensatz (EUR pro Stunde)', 'meta.stundensatz', 'number')}</div></div>
        <h2 class="h5">Personalkosten (aus den Arbeitspaketen)</h2>
        <p class="small text-muted">Personen und Stunden je Person werden auch im Zeitplan gepflegt. Beispiel: 2 Personen &times; 104 h = 208 h.</p>
        <div class="table-responsive"><table class="table table-sm table-bordered table-edit">
          <thead class="table-light"><tr><th class="w-code">Code</th><th>Arbeitspaket</th><th style="width:14rem">Personen</th><th style="width:5rem">Anzahl</th>
          <th style="width:8rem">Std. je Person</th><th style="width:7rem">Std. gesamt</th><th style="width:8rem">Kosten</th></tr></thead>
          <tbody>${c.personal.length ? c.personal.map((p) => `<tr><td>${p.t.code}</td><td>${esc(p.t.node.title)}</td><td>${personsPicker(p.t.node)}</td>
            <td class="num">${p.n}</td><td>${inp(`upd|psp|${p.t.node.id}|hours`, p.t.node.hours, 'number', 'min="0"')}</td>
            <td class="num">${fmtNum(p.total)}</td><td class="num">${fmtEuro(p.cost)}</td></tr>`).join('')
            : '<tr><td colspan="7" class="text-muted">Noch keine Arbeitspakete im Projektstrukturplan.</td></tr>'}</tbody>
          <tfoot><tr class="fw-semibold"><td colspan="5">Summe Personal</td><td class="num">${fmtNum(c.sumH)}</td><td class="num">${fmtEuro(c.sumP)}</td></tr></tfoot>
        </table></div>
        <h2 class="h5">Ressourcenplan je Person</h2>
        ${perPersonTable(c, 'table table-sm table-bordered')}
        <h2 class="h5">Sachmittel</h2>
        ${tableEditor('costs', [
          { k: 'bezeichnung', label: 'Bezeichnung' }, { k: 'menge', label: 'Menge', type: 'number', w: '7rem' },
          { k: 'einheit', label: 'Einheit', type: 'text', w: '7rem' }, { k: 'einzelpreis', label: 'Einzelpreis (EUR)', type: 'number', w: '9rem' },
          { label: 'Gesamt', w: '8rem', cls: 'num', render: (r) => fmtEuro((r.menge || 0) * (r.einzelpreis || 0)) }, { k: 'bemerkung', label: 'Bemerkung' }])}
        ${btn('+ Sachmittel', 'add', { c: 'costs' })}
        <h2 class="h5 mt-4">Gesamtkosten</h2>
        ${sumTable(c, 'table table-sm table-bordered')}
      </div>`;
    },
    doc: () => {
      const c = costData();
      return `<h1>Ressourcen- und Kostenplan</h1><h2>${esc(doc().name)}</h2>
        <p>Stundensatz: ${fmtEuro(c.rate)} pro Stunde</p>
        <h3>Personalkosten</h3>
        <table><tr><th>Code</th><th>Arbeitspaket</th><th>Personen</th><th>Anzahl</th><th>Std. je Person</th><th>Std. gesamt</th><th>Kosten</th></tr>
        ${c.personal.map((p) => `<tr><td>${p.t.code}</td><td>${esc(p.t.node.title)}</td><td>${esc((p.t.node.persons || []).join(', '))}</td>
          <td class="num">${p.n}</td><td class="num">${fmtNum(p.h)}</td><td class="num">${fmtNum(p.total)}</td><td class="num">${fmtEuro(p.cost)}</td></tr>`).join('')}
        <tr><th colspan="5">Summe Personal</th><th class="num">${fmtNum(c.sumH)}</th><th class="num">${fmtEuro(c.sumP)}</th></tr></table>
        <h3>Ressourcenplan je Person</h3>${perPersonTable(c)}
        <h3>Sachmittel</h3>
        <table><tr><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis</th><th>Gesamt</th><th>Bemerkung</th></tr>
        ${c.sach.map(({ r, total }) => `<tr><td>${esc(r.bezeichnung)}</td><td class="num">${fmtNum(r.menge)}</td><td>${esc(r.einheit)}</td>
          <td class="num">${fmtEuro(r.einzelpreis)}</td><td class="num">${fmtEuro(total)}</td><td>${nl2br(r.bemerkung)}</td></tr>`).join('')}
        <tr><th colspan="4">Summe Sachmittel</th><th class="num">${fmtEuro(c.sumS)}</th><th></th></tr></table>
        <h3>Gesamtkosten</h3>${sumTable(c)}`;
    },
  };
  function perPersonTable(c, cls = '') {
    const e = Object.entries(c.perPerson).sort((a, b) => a[0].localeCompare(b[0]));
    return `<table class="${cls}"><thead class="table-light"><tr><th>Person</th><th>Arbeitspakete</th><th>Stunden</th><th>Kosten</th></tr></thead><tbody>
      ${e.length ? e.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${esc(v.aps.join(', '))}</td><td class="num">${fmtNum(v.h)}</td><td class="num">${fmtEuro(v.h * c.rate)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="text-muted">Noch keine Personen den Arbeitspaketen zugeordnet.</td></tr>'}</tbody></table>`;
  }
  function sumTable(c, cls = '') {
    return `<table class="${cls}" style="max-width:500px"><tbody>
      <tr><td>Personalkosten</td><td class="num">${fmtEuro(c.sumP)}</td></tr>
      <tr><td>Sachmittel</td><td class="num">${fmtEuro(c.sumS)}</td></tr>
      <tr class="fw-bold"><th>Gesamtkosten</th><th class="num">${fmtEuro(c.sumP + c.sumS)}</th></tr></tbody></table>`;
  }

  // ---- Risikoplan / -matrix ----
  const AUSMASS = [[1, '1 - gering'], [2, '2 - mittel'], [3, '3 - gravierend']];
  const WKEIT = [[1, '1 - gering'], [2, '2 - möglich'], [3, '3 - wahrscheinlich'], [4, '4 - beinahe sicher']];
  // Farben der Matrix wie im Material (Zeile = Auswirkung 3..1, Spalte = Wahrscheinlichkeit 1..4)
  const MCOL = { 3: ['r-y', 'r-o', 'r-r', 'r-dr'], 2: ['r-g2', 'r-y', 'r-o', 'r-r'], 1: ['r-g1', 'r-g2', 'r-y', 'r-o'] };
  function riskCat(a, w) {
    if (!a || !w) return null;
    const cls = MCOL[a][w - 1];
    const cat = cls.startsWith('r-g') ? 'gering' : cls === 'r-y' ? 'mittel' : 'hoch';
    return { cls, cat, score: a * w };
  }
  function riskMatrix() {
    const list = rows('risks');
    const cell = (a, w) => list.map((r, i) => (r.ausmass === a && r.wkeit === w ? `<span class="dot">${i + 1}</span>` : '')).join('');
    return `<div class="table-responsive"><table class="matrix"><tr><th rowspan="4" style="width:2rem;writing-mode:vertical-rl;transform:rotate(180deg)">Auswirkungen / Schadensausmaß</th>
      <th>Gravierend (3)</th>${[1, 2, 3, 4].map((w) => `<td class="${MCOL[3][w - 1]}">${cell(3, w)}</td>`).join('')}</tr>
      <tr><th>Mittel (2)</th>${[1, 2, 3, 4].map((w) => `<td class="${MCOL[2][w - 1]}">${cell(2, w)}</td>`).join('')}</tr>
      <tr><th>Gering (1)</th>${[1, 2, 3, 4].map((w) => `<td class="${MCOL[1][w - 1]}">${cell(1, w)}</td>`).join('')}</tr>
      <tr><th></th><th>Gering (1)</th><th>Möglich (2)</th><th>Wahrscheinlich (3)</th><th>Beinahe sicher (4)</th></tr>
      <tr><td colspan="2"></td><th colspan="4">Eintrittswahrscheinlichkeit</th></tr></table></div>
      <p class="small mt-2">Risikokategorie: <span class="px-2 r-g1">gering</span> <span class="px-2 r-y">mittel</span> <span class="px-2 r-r">hoch</span>
      &nbsp; Risikobewertung = Schadensausmaß &times; Eintrittswahrscheinlichkeit</p>`;
  }
  function riskScore(r) {
    const c = riskCat(r.ausmass, r.wkeit);
    return c ? `<span class="badge ${c.cls} text-dark border">${c.score} (${c.cat})</span>` : '';
  }

  VIEWS.risiken = {
    edit: () => `<p class="small text-muted mb-2">Schritte: Risiken identifizieren, Ursachen analysieren, Schadensausmaß bestimmen,
      Eintrittswahrscheinlichkeit schätzen, Risiken bewerten, Maßnahmen ableiten.</p>
      ${tableEditor('risks', [
        { label: 'Nr.', w: '3rem', render: (r, i) => i + 1 },
        { k: 'risiko', label: 'Identifiziertes Risiko' },
        { k: 'art', label: 'Risikoart', type: 'select', w: '11rem', options: [['', '-']].concat(Ops.RISIKOARTEN) },
        { k: 'ursache', label: 'Risikoursache' },
        { k: 'ausmass', label: 'Schadensausmaß', type: 'select', w: '9rem', options: [['', '-']].concat(AUSMASS) },
        { k: 'wkeit', label: 'Eintrittswahrscheinlichkeit', type: 'select', w: '10rem', options: [['', '-']].concat(WKEIT) },
        { label: 'Risikobewertung', w: '7rem', render: riskScore },
        { k: 'massnahmeArt', label: 'Art der Maßnahme', type: 'select', w: '10rem', options: [['', '-']].concat(Ops.MASSNAHMENARTEN) },
        { k: 'massnahme', label: 'Maßnahme' }])}
      ${btn('+ Risiko', 'add', { c: 'risks' }, 'btn-primary')}
      <h2 class="h5 mt-4">Risikomatrix</h2>${riskMatrix()}`,
    doc: () => {
      const l = rows('risks');
      const lab = (arr, v) => (arr.find((x) => x[0] === v) || [, ''])[1];
      return `<h1>Risikoanalyse</h1><h2>${esc(doc().name)}</h2>
        <table><tr><th>Nr.</th><th>Identifiziertes Risiko</th><th>Risikoart</th><th>Risikoursache</th><th>Schadensausmaß</th><th>Eintrittswahrscheinlichkeit</th><th>Risikobewertung</th><th>Maßnahme</th></tr>
        ${l.map((r, i) => {
          const c = riskCat(r.ausmass, r.wkeit);
          return `<tr><td>${i + 1}</td><td>${nl2br(r.risiko)}</td><td>${esc(r.art)}</td><td>${nl2br(r.ursache)}</td><td>${esc(lab(AUSMASS, r.ausmass))}</td>
          <td>${esc(lab(WKEIT, r.wkeit))}</td><td class="${c ? c.cls : ''}">${c ? `${c.score} (${c.cat})` : ''}</td>
          <td>${r.massnahmeArt ? `<b>${esc(r.massnahmeArt)}:</b> ` : ''}${nl2br(r.massnahme)}</td></tr>`;
        }).join('')}</table>
        <h3>Risikomatrix</h3>${riskMatrix()}`;
    },
  };

  // ---- Qualitätsplan ----
  const QCOLS = [
    { k: 'massnahme', label: 'Maßnahme zur Qualitätssicherung', list: 'qsMassnahmen' },
    { k: 'kriterium', label: 'Qualitätskriterium (WAS?)' },
    { k: 'zielgroesse', label: 'Zielgröße (WIE? WELCHES Ergebnis?)' },
    { k: 'zeitpunkt', label: 'Zeitpunkt / Prüfintervall (WANN?)' },
    { k: 'verantwortlich', label: 'Verantwortlicher (WER?)', type: 'text', list: 'userNames' }];
  VIEWS.qualitaet = {
    edit: () => `<p class="small text-muted mb-2">Unterteilung in Produkt- und Prozessqualität. Qualität muss messbar sein: konkrete Kriterien und Zielgrößen statt „gut".
      Kriterien aus dem Pflichtenheft können über ihre ID referenziert werden (z. B. //M01).</p>
      <datalist id="qsMassnahmen"><option>Richtlinien erstellen</option><option>Reviews</option><option>Tests</option><option>QS-Schulungsmaßnahmen</option></datalist>
      <datalist id="userNames">${users.map((u) => `<option>${esc(u.name)}</option>`).join('')}</datalist>
      ${Ops.QBEREICHE.map((b) => `<h2 class="h5 mt-3">${b}</h2>${tableEditor('quality', QCOLS, (r) => r.bereich === b, 'bereich:' + b)}
        ${btn('+ Maßnahme (' + b + ')', 'add', { c: 'quality', extra: JSON.stringify({ bereich: b }) })}`).join('')}`,
    doc: () => `<h1>Qualitätsplan</h1><h2>${esc(doc().name)}</h2>
      ${Ops.QBEREICHE.map((b) => `<h3>${b}</h3><table><tr>${QCOLS.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
        ${rows('quality', (r) => r.bereich === b).map((r) => `<tr>${QCOLS.map((c) => `<td>${nl2br(r[c.k])}</td>`).join('')}</tr>`).join('')}</table>`).join('')}`,
  };

  // ---- Arbeitspaketbeschreibung ----
  function apList() { return Ops.pspDates(doc()); }
  VIEWS.ap = {
    edit: () => {
      const { tree } = apList();
      const leaves = tree.filter((t) => t.isLeaf);
      if (!leaves.length) return '<p class="text-muted">Zuerst Arbeitspakete im Projektstrukturplan anlegen.</p>';
      if (!apSelected || !leaves.some((t) => t.node.id === apSelected)) {
        apSelected = (leaves.find((t) => t.node.lead === me.name) || leaves[0]).node.id;
      }
      const t = leaves.find((x) => x.node.id === apSelected);
      const n = t.node;
      const d = doc();
      const leadNames = [...new Set(users.map((u) => u.name).concat(n.lead ? [n.lead] : []))];
      return `<div style="max-width:1000px">
        <div class="mb-3"><label class="form-label fw-semibold">Arbeitspaket</label>
          <select class="form-select" id="apSelect">${leaves.map((x) => `<option value="${esc(x.node.id)}" ${x.node.id === apSelected ? 'selected' : ''}>${x.code} ${esc(x.node.title)}${x.node.lead ? ' (' + esc(x.node.lead) + ')' : ''}</option>`).join('')}</select></div>
        <table class="table table-bordered">
          <tr><th style="width:25%">Projektname</th><td>${esc(d.name)}</td><th style="width:20%">Projektleitung</th><td>${esc(d.meta.leader)}</td></tr>
          <tr><th>Arbeitspaket-Nr.</th><td>${t.code}</td><th>Arbeitspaketname</th><td>${inp(`upd|psp|${n.id}|title`, n.title)}</td></tr>
          <tr><th>Beginn und Ende des AP</th><td><div class="d-flex gap-1">${inp(`upd|psp|${n.id}|start`, n.start, 'date')}${inp(`upd|psp|${n.id}|end`, n.end, 'date')}</div></td>
            <th>Dauer</th><td>${days(n.start, n.end || n.start) ? days(n.start, n.end || n.start) + ' Tage' : ''}</td></tr>
          <tr><th>Arbeitspaketleitung</th><td colspan="3">${sel(`upd|psp|${n.id}|lead`, n.lead || '', [['', '-']].concat(leadNames))}</td></tr>
        </table>
        ${field('Ergebnisse (Was genau soll bei diesem Arbeitspaket herauskommen?)', '', 'textarea').replace('data-bind="set|"', `data-bind="upd|psp|${n.id}|ergebnisse"`).replace('></textarea>', `>${esc(n.ergebnisse)}</textarea>`)}
        ${field('Tätigkeiten (Was genau muss in diesem Arbeitspaket gemacht werden?)', '', 'textarea').replace('data-bind="set|"', `data-bind="upd|psp|${n.id}|taetigkeiten"`).replace('></textarea>', `>${esc(n.taetigkeiten)}</textarea>`)}
        ${field('Voraussetzungen (Welche Dokumente und Ressourcen benötigen wir?)', '', 'textarea').replace('data-bind="set|"', `data-bind="upd|psp|${n.id}|voraussetzungen"`).replace('></textarea>', `>${esc(n.voraussetzungen)}</textarea>`)}
      </div>`;
    },
    doc: () => {
      const { tree } = apList();
      const t = tree.find((x) => x.node.id === apSelected) || tree.find((x) => x.isLeaf);
      if (!t) return '<p>Keine Arbeitspakete vorhanden.</p>';
      const n = t.node, d = doc();
      const du = days(n.start, n.end || n.start);
      return `<h1>Arbeitspaketbeschreibung</h1>
        <table>
          <tr><th style="width:22%">Projektname:</th><td colspan="2">${esc(d.name)}</td><th style="width:22%">Projektleitung:</th><td>${esc(d.meta.leader)}</td></tr>
          <tr><th>Arbeitspaket-Nr.</th><td colspan="2">${t.code}</td><th>Arbeitspaketname:</th><td>${esc(n.title)}</td></tr>
          <tr><th>Beginn und Ende des AP:</th><td>${fmtDate(n.start)} - ${fmtDate(n.end || n.start)}</td><th>Dauer</th><td>${du ? du + ' Tage' : ''}</td><td><b>Arbeitspaketleitung:</b> ${esc(n.lead)}</td></tr>
          <tr><th colspan="5">Ergebnisse (Was genau soll bei diesem Arbeitspaket herauskommen?)</th></tr><tr><td colspan="5" style="height:6rem">${nl2br(n.ergebnisse)}</td></tr>
          <tr><th colspan="5">Tätigkeiten (Was genau muss in diesem Arbeitspaket gemacht werden?)</th></tr><tr><td colspan="5" style="height:6rem">${nl2br(n.taetigkeiten)}</td></tr>
          <tr><th colspan="5">Voraussetzungen (Welche Dokumente und Ressourcen benötigen wir?)</th></tr><tr><td colspan="5" style="height:6rem">${nl2br(n.voraussetzungen)}</td></tr>
          <tr><td colspan="3" class="sign" style="vertical-align:bottom">Unterschrift Projektleiter/in</td><td colspan="2" class="sign" style="vertical-align:bottom">Unterschrift Arbeitspaket-Verantwortliche/r</td></tr>
        </table>`;
    },
    after: (view) => {
      const s = $('#apSelect', view);
      if (s) s.addEventListener('change', () => { apSelected = s.value; render(); });
    },
  };

  // ---- Fragenkatalog ----
  const PHASEN = [
    ['begruessung', 'Begrüßung', 'u. a. Eröffnungsfrage? Überleitungsfrage?'],
    ['eroeffnung', 'Gesprächseröffnung', 'u. a. Eröffnungsfrage? Überleitungsfrage?'],
    ['kern', 'Kernphase', 'Fragen nach Themengebieten/Kategorien und in Form eines Fragetrichters sortieren'],
    ['abschluss', 'Gesprächsabschluss', 'u. a. Eröffnungsfrage? Überleitungsfrage?'],
    ['verabschiedung', 'Verabschiedung', 'u. a. Eröffnungsfrage? Finale Frage?']];
  VIEWS.fragen = {
    edit: () => `<div style="max-width:1000px">
      ${field('Fragenkatalog von', 'fragen.von')}
      ${field('Ziel des Gespräches', 'fragen.ziel', 'textarea')}
      ${PHASEN.map(([k, l, h]) => field(l, 'fragen.' + k, 'textarea', h)).join('')}</div>`,
    doc: () => `<h1>Fragenkatalog</h1><h2>${esc(doc().name)}</h2>
      <p><b>Fragenkatalog von:</b> ${esc(val('fragen.von'))}</p><p><b>Ziel des Gespräches:</b> ${nl2br(val('fragen.ziel'))}</p>
      <table><tr><th style="width:20%">Phasen</th><th>Fragen</th></tr>
      ${PHASEN.map(([k, l]) => `<tr><td><b>${l}</b></td><td>${nl2br(val('fragen.' + k))}</td></tr>`).join('')}</table>`,
  };

  // ---- Grobe Zeitplanung / Dokumentation ----
  const DCOLS = [
    { k: 'datum', label: 'Datum', type: 'date', w: '10rem' }, { k: 'todo', label: 'Was ist zu tun?' },
    { k: 'helfer', label: 'Wer hilft mit?', w: '12rem' }, { k: 'verantwortlich', label: 'Verantwortlicher?', type: 'text', w: '12rem', list: 'userNames' },
    { k: 'erledigt', label: 'Was wurde getan?' }];
  VIEWS.doku = {
    edit: () => `<datalist id="userNames">${users.map((u) => `<option>${esc(u.name)}</option>`).join('')}</datalist>
      ${tableEditor('log', DCOLS)}${btn('+ Eintrag', 'add', { c: 'log' }, 'btn-primary')}`,
    doc: () => `<h1>Grobe Zeitplanung / Dokumentation</h1><h2>${esc(doc().name)}</h2>
      <table><tr>${DCOLS.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
      ${rows('log').map((r) => `<tr><td>${fmtDate(r.datum)}</td><td>${nl2br(r.todo)}</td><td>${nl2br(r.helfer)}</td><td>${esc(r.verantwortlich)}</td><td>${nl2br(r.erledigt)}</td></tr>`).join('')}</table>`,
  };

  // ---------- Ereignisse ----------
  function onInput(e) {
    const el = e.target;
    if (el.classList.contains('auto')) autosize(el);
    const b = el.dataset.bind;
    if (!b) return;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
    else if (el.tagName === 'SELECT' && /^\d+$/.test(el.value) && /\|(ausmass|wkeit)$/.test(b)) v = Number(el.value);
    else if (el.tagName === 'SELECT' && el.value === '' && /\|(ausmass|wkeit)$/.test(b)) v = null;
    else v = el.value;
    const parts = b.split('|');
    if (parts[0] === 'set') S.op({ t: 'set', key: parts[1], value: v });
    else S.op({ t: 'upd', c: parts[1], id: parts[2], patch: { [parts[3]]: v } });
    // berechnete Werte aktualisieren (Selects, Zahlen, Datum sofort; Text beim Verlassen)
    if (el.tagName === 'SELECT' || el.type === 'checkbox') render();
    if (parts[1] === 'name' && parts[0] === 'set') $('#projTitle').textContent = v;
  }

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;
    const d = el.dataset;
    if (a === 'person') return; // über change behandelt
    if (a === 'mode') { mode = d.m; render(); return; }
    if (a === 'print') { printView(); return; }
    if (a === 'word') { wordExport(); return; }
    if (a === 'add') { addRow(d.c, d.extra ? JSON.parse(d.extra) : {}); render(); return; }
    if (a === 'del') {
      if (!confirm('Eintrag löschen?')) return;
      S.op({ t: 'del', c: d.c, id: d.id }); render(); return;
    }
    if (a === 'up' || a === 'down') {
      const [fk, fv] = (d.f || '').split(':');
      moveRow(d.c, d.id, a === 'up' ? -1 : 1, fk ? (r) => r[fk] === fv : null); render(); return;
    }
    if (a === 'phdefaults') {
      ['Funktionalität', 'Zuverlässigkeit', 'Veränderbarkeit', 'Benutzerfreundlichkeit'].forEach((m) => addRow('phQuality', { merkmal: m, stufe: '' }));
      render(); return;
    }
    if (a === 'delsnap') { if (confirm('Entwicklungsschritt löschen?')) S.send({ type: 'delsnapshot', id: d.id }); return; }
    // PSP
    if (a === 'pspchild') { pspAddChild(d.id); return; }
    if (a === 'pspdel') {
      const n = doc().psp[d.id];
      const kids = Object.values(doc().psp).some((x) => x.parent === d.id);
      if (!confirm(`"${n.title || 'Element'}"${kids ? ' mit allen Unterpunkten' : ''} löschen?`)) return;
      S.op({ t: 'del', c: 'psp', id: d.id }); render(); return;
    }
    if (a === 'pspmove') {
      const n = doc().psp[d.id];
      const sib = pspSiblings(n);
      const i = sib.findIndex((x) => x.id === n.id), j = i + Number(d.dir);
      if (j < 0 || j >= sib.length) return;
      const oi = sib[i].order || 0, oj = sib[j].order || 0;
      S.op({ t: 'upd', c: 'psp', id: sib[i].id, patch: { order: oj === oi ? oi + Number(d.dir) : oj } });
      S.op({ t: 'upd', c: 'psp', id: sib[j].id, patch: { order: oi } });
      render(); return;
    }
    if (a === 'pspin') {
      const n = doc().psp[d.id];
      const sib = pspSiblings(n);
      const i = sib.findIndex((x) => x.id === n.id);
      if (i <= 0) return;
      const newParent = sib[i - 1];
      const kids = Object.values(doc().psp).filter((x) => x.parent === newParent.id);
      S.op({ t: 'upd', c: 'psp', id: n.id, patch: { parent: newParent.id, order: kids.length ? Math.max(...kids.map((k) => k.order || 0)) + 1 : 1 } });
      render(); return;
    }
    if (a === 'pspout') {
      const n = doc().psp[d.id];
      if (!n.parent) return;
      const p = doc().psp[n.parent];
      S.op({ t: 'upd', c: 'psp', id: n.id, patch: { parent: p.parent || '', order: (p.order || 0) + 0.5 } });
      render(); return;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.act === 'person') {
      const n = doc().psp[el.dataset.id];
      if (!n) return;
      const name = el.dataset.name;
      const list = (n.persons || []).filter((x) => x !== name);
      if (el.checked) list.push(name);
      S.op({ t: 'upd', c: 'psp', id: n.id, patch: { persons: list } });
      // Button-Beschriftung direkt aktualisieren, Dropdown offen lassen
      const b = el.closest('.dropdown').querySelector('.persons-btn');
      b.textContent = personsLabel(list) || 'Personen wählen';
      return;
    }
    // Zahl/Datum: beim Verlassen neu berechnen (Summen, Dauer, Balken)
    if (el.dataset.bind && (el.type === 'number' || el.type === 'date')) { render(); return; }
    // Textfelder: beim Verlassen neu berechnen
    if (el.dataset.bind && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
      if (/\|(title)$/.test(el.dataset.bind) && tab() !== 'psp') render();
    }
  }

  function setPageOrientation(landscape) {
    let st = document.getElementById('pageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
    st.textContent = landscape ? '@page { size: A4 landscape; margin: 10mm; }' : '';
  }

  /** Gantt beim Drucken auf Seitenbreite (A4 quer, ca. 1040 px) verkleinern */
  function fitForPrint() {
    const g = $('.gantt');
    if (!g) return;
    g.style.zoom = '';
    const w = g.scrollWidth;
    if (w > 1040) g.style.zoom = String(1040 / w);
  }
  function unfit() { const g = $('.gantt'); if (g) g.style.zoom = ''; }
  window.addEventListener('beforeprint', () => {
    if (['gantt', 'risiken', 'qualitaet', 'kosten', 'doku', 'psp'].includes(tab())) setPageOrientation(true);
    fitForPrint();
  });
  window.addEventListener('afterprint', unfit);

  function printView() {
    if (mode !== 'doc') { mode = 'doc'; render(); }
    setPageOrientation(['gantt', 'risiken', 'qualitaet', 'kosten', 'doku', 'psp'].includes(tab()));
    // Personen-Dropdowns schließen, dann drucken
    setTimeout(() => window.print(), 100);
  }

  function wordExport() {
    const t = tab();
    const V = VIEWS[t];
    if (!V.doc) return;
    const title = TABS.find((x) => x[0] === t)[1];
    const holder = document.createElement('div');
    holder.innerHTML = V.doc();
    $$('.no-word', holder).forEach((x) => x.remove());
    App.downloadWord(`${doc().name} - ${title}`, title, holder.innerHTML);
  }

  // Personen-Dropdown: beim Schließen neu zeichnen (damit Summen etc. stimmen)
  document.addEventListener('hidden.bs.dropdown', () => render());

  // ---------- Start ----------
  (async () => {
    me = await App.navbar('projects');
    users = await App.api('GET', '/users').catch(() => []);
    const view = $('#view');
    view.addEventListener('input', onInput);
    view.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && e.target.dataset.bind) return; onChange(e); });
    view.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.bind) S.flush(); });
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', () => { mode = 'edit'; render(); window.scrollTo(0, 0); });

    S = Sync.connect(pid, {
      onInit: () => render(),
      onOps: () => {
        // während jemand in einem Personen-Dropdown ist, nicht neu zeichnen
        if (document.querySelector('.dropdown-menu.show')) return;
        render();
      },
      onPeers: (peers) => {
        $('#peers').textContent = 'Online: ' + peers.map((p) => p.name).filter((v, i, a) => a.indexOf(v) === i).join(', ');
        if (tab() === 'uebersicht' && !document.activeElement.dataset.bind) render();
      },
      onStatus: (state, text) => {
        const s = $('#status');
        s.textContent = text;
        s.className = 'badge ' + (state === 'online' ? 'bg-success' : state === 'connecting' ? 'bg-warning text-dark' : 'bg-danger');
      },
      onSnapshot: () => { if (tab() === 'canvas') render(); },
      onGone: () => { alert('Dieses Projekt wurde gelöscht.'); location.href = '/'; },
    });
    window.addEventListener('afterprint', () => setPageOrientation(false));
  })();
})();
