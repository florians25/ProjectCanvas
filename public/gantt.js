/* Gantt-Editor: Vorgänge = Elemente des Projektstrukturplans */
(function () {
  'use strict';
  const esc = (s) => App.esc(s);
  const ROW = 34;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  // Ansichtseinstellungen (pro Browser)
  const opt = Object.assign({ zoom: 'day', compact: false, critical: true, load: true, baseline: true, autoShift: true, workdays: true, osp: true },
    store.get('gantt.opt', {}));
  const saveOpt = () => store.set('gantt.opt', opt);
  const collapsed = new Set(store.get('gantt.collapsed', []));
  let fitWidth = 1100;          // Breite des Containers (für "Einpassen")
  const undoStack = [];         // Liste von Schritten, jeder Schritt = Liste inverser Operationen

  // ---------- Kalender: Wochenenden und Feiertage NRW ----------
  const holCache = {};
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return Ops.dayNum(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  function holidays(y) {
    if (holCache[y]) return holCache[y];
    const e = easter(y);
    const fix = (md, n) => [Ops.dayNum(`${y}-${md}`), n];
    holCache[y] = new Map([fix('01-01', 'Neujahr'), [e - 2, 'Karfreitag'], [e + 1, 'Ostermontag'], fix('05-01', 'Tag der Arbeit'),
      [e + 39, 'Christi Himmelfahrt'], [e + 50, 'Pfingstmontag'], [e + 60, 'Fronleichnam'], fix('10-03', 'Tag der Deutschen Einheit'),
      fix('11-01', 'Allerheiligen'), fix('12-25', '1. Weihnachtstag'), fix('12-26', '2. Weihnachtstag')]);
    return holCache[y];
  }
  const holidayName = (n) => holidays(new Date(n * 86400000).getUTCFullYear()).get(n);
  const weekday = (n) => new Date(n * 86400000).getUTCDay(); // 0 = So
  const isWorkday = (n) => weekday(n) !== 0 && weekday(n) !== 6 && !holidayName(n);
  const nextWorkday = (n) => { let x = n; for (let i = 0; i < 30 && !isWorkday(x); i++) x++; return x; };
  const workdays = (s, e) => { let c = 0; for (let d = s; d <= e; d++) if (isWorkday(d)) c++; return c; };
  function isoWeek(n) {
    const d = new Date(n * 86400000);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const short = (n) => { const d = new Date(n * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`; };
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const fmt = (n) => (n === null || n === undefined ? '' : App.fmtDate(Ops.numDay(n)));

  function personsLabel(list) {
    const n = (list || []).length;
    return !n ? '' : n <= 2 ? list.join(', ') : `${n} Personen`;
  }

  // ---------- Berechnungen ----------
  function successors(doc) {
    const succ = {};
    for (const n of Object.values(doc.psp)) for (const p of n.deps || []) (succ[p] = succ[p] || []).push(n.id);
    return succ;
  }

  /** Kritischer Pfad bei festen Terminen: Vorgänge ohne Puffer bis zum Projektende */
  function criticalSet(doc, tree, dates) {
    const leaves0 = tree.filter((t) => t.isLeaf && dates[t.node.id].s !== null).map((t) => t.node.id);
    if (!leaves0.length) return new Set();
    // Bei "Nur Arbeitstage" zählen Wochenenden/Feiertage nicht als Puffer: in Arbeitstag-Nummern rechnen
    const lo = Math.min(...leaves0.map((id) => dates[id].s)) - 14, hi = Math.max(...leaves0.map((id) => dates[id].e)) + 14;
    const ord = {};
    let c = 0;
    for (let d = lo; d <= hi; d++) { if (!opt.workdays || isWorkday(d)) c++; ord[d] = c; }
    const D = {};
    for (const id of Object.keys(dates)) {
      const r = dates[id];
      if (r.s === null) { D[id] = r; continue; }
      // Beginn = erster Arbeitstag ab s, Ende = letzter Arbeitstag bis e
      const s = opt.workdays && !isWorkday(r.s) ? ord[r.s] + 1 : ord[r.s];
      D[id] = { s, e: Math.max(s, ord[r.e]) };
    }
    dates = D;
    const leaves = leaves0;
    const succ = successors(doc);
    const projEnd = Math.max(...leaves.map((id) => dates[id].e));
    const lf = {};
    const calc = (id, depth = 0) => {
      if (lf[id] !== undefined) return lf[id];
      if (depth > 500) return projEnd;
      const ss = (succ[id] || []).filter((x) => dates[x] && dates[x].s !== null);
      // spätestes Ende = spätester Beginn des Nachfolgers - 1 (spätester Beginn = spätestes Ende - Dauer)
      lf[id] = ss.length ? Math.min(...ss.map((x) => calc(x, depth + 1) - (dates[x].e - dates[x].s) - 1)) : projEnd;
      return lf[id];
    };
    const crit = new Set();
    for (const id of leaves) if (calc(id) - dates[id].e <= 0) crit.add(id);
    return crit;
  }

  /** Nachfolger nach hinten schieben, damit sie erst nach dem Vorgänger beginnen */
  function cascadePatches(doc, startIds) {
    const L = {};
    for (const n of Object.values(doc.psp)) if (n.start) L[n.id] = { s: Ops.dayNum(n.start), e: Math.max(Ops.dayNum(n.start), Ops.dayNum(n.end || n.start)) };
    const succ = successors(doc);
    const patches = {};
    const queue = [...startIds];
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const id = queue.shift();
      const d = L[id];
      if (!d) continue;
      for (const sid of succ[id] || []) {
        const sd = L[sid];
        if (!sd) continue;
        let need = d.e + 1;
        if (opt.workdays) need = nextWorkday(need);
        if (sd.s < need) {
          const delta = need - sd.s;
          sd.s += delta; sd.e += delta;
          patches[sid] = { start: Ops.numDay(sd.s), end: Ops.numDay(sd.e) };
          queue.push(sid);
        }
      }
    }
    return patches;
  }

  /** Würde die Abhängigkeit "from -> to" einen Kreis erzeugen? */
  function createsCycle(doc, from, to) {
    const succ = successors(doc);
    const seen = new Set();
    const stack = [to];
    while (stack.length) {
      const x = stack.pop();
      if (x === from) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const y of succ[x] || []) stack.push(y);
    }
    return false;
  }

  function columns(editable) {
    if (!editable) return [['Nr.', 45], ['Vorgang', 210], ['Start', 78], ['Ende', 78], ['Tage', 44], ['Personen', 130]];
    if (opt.compact) return [['Nr.', 50], ['Vorgang', 240], ['', 30]];
    return [['Nr.', 50], ['Vorgang', 220], ['Start', 118], ['Ende', 118], ['Tage', 52], ['AT', 36], ['%', 52], ['Personen', 130], ['Std./P.', 62], ['Vorgänger', 78], ['MS', 32], ['', 30]];
  }

  function model(doc) {
    const { tree, dates } = Ops.pspDates(doc);
    let min = null, max = null;
    const consider = (n) => { if (n === null || n === undefined) return; min = min === null ? n : Math.min(min, n); max = max === null ? n : Math.max(max, n); };
    for (const k in dates) { consider(dates[k].s); consider(dates[k].e); }
    consider(Ops.dayNum(doc.meta.start || ''));
    consider(Ops.dayNum(doc.meta.end || ''));
    if (doc.baseline && opt.baseline) for (const k in doc.baseline.items) { consider(doc.baseline.items[k][0]); consider(doc.baseline.items[k][1]); }
    const today = Ops.dayNum(new Date().toISOString().slice(0, 10));
    if (min === null) { min = today; max = today + 41; }
    const r0 = min - ((weekday(min) + 6) % 7);
    let r1 = max + 7;
    r1 += 6 - ((weekday(r1) + 6) % 7);
    const codeOf = Object.fromEntries(tree.map((t) => [t.node.id, t.code]));
    // sichtbare Zeilen (eingeklappte Sammelvorgänge verbergen ihre Kinder)
    const vis = [];
    let hideBelow = null;
    for (const t of tree) {
      if (hideBelow !== null && t.level > hideBelow) continue;
      hideBelow = null;
      vis.push(t);
      if (!t.isLeaf && collapsed.has(t.node.id)) hideBelow = t.level;
    }
    return { tree, vis, dates, r0, r1, n: r1 - r0 + 1, today, codeOf };
  }

  function dayWidth(m, editable, LW) {
    if (!editable) return Math.max(3, Math.min(26, (1040 - LW) / m.n));
    if (opt.zoom === 'fit') return Math.max(2, (fitWidth - LW - 4) / m.n);
    return { day: 26, week: 9, month: 3.2 }[opt.zoom] || 26;
  }

  // ---------- HTML ----------
  function html(doc, opts) {
    const editable = opts.editable;
    const m = model(doc);
    const cols = columns(editable);
    const LW = cols.reduce((a, c) => a + c[1], 0);
    const dw = dayWidth(m, editable, LW);
    const showDays = dw >= 16;
    const TW = Math.ceil(m.n * dw);
    const X = (d) => (d - m.r0) * dw;
    const crit = opt.critical ? criticalSet(doc, m.tree, m.dates) : new Set();
    const base = opt.baseline && doc.baseline ? doc.baseline.items : null;

    // Kopf
    let top = '', bottom = '';
    if (dw < 6) {
      // Monate oben, Kalenderwochen unten
      let d = m.r0;
      while (d <= m.r1) {
        const dt = new Date(d * 86400000);
        const next = Ops.dayNum(`${dt.getUTCMonth() === 11 ? dt.getUTCFullYear() + 1 : dt.getUTCFullYear()}-${String(((dt.getUTCMonth() + 1) % 12) + 1).padStart(2, '0')}-01`);
        const e = Math.min(next - 1, m.r1);
        top += `<div class="cell" style="left:${X(d)}px;width:${(e - d + 1) * dw}px">${MONTHS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}</div>`;
        d = e + 1;
      }
      for (let w = m.r0; w <= m.r1; w += 7) bottom += `<div class="cell" style="left:${X(w)}px;width:${7 * dw}px" title="KW ${isoWeek(w)}">${7 * dw >= 18 ? isoWeek(w) : ''}</div>`;
    } else {
      for (let w = m.r0; w <= m.r1; w += 7) {
        top += `<div class="cell" style="left:${X(w)}px;width:${7 * dw}px" title="KW ${isoWeek(w)}, ${short(w)} - ${short(w + 6)}">${7 * dw >= 34 ? 'KW ' : ''}${isoWeek(w)}${7 * dw >= 90 ? ' &middot; ' + short(w) : ''}</div>`;
      }
      if (showDays) {
        for (let d = m.r0; d <= m.r1; d++) {
          const wd = weekday(d), hol = holidayName(d);
          bottom += `<div class="cell ${hol ? 'hol' : wd === 0 || wd === 6 ? 'we' : ''}" style="left:${X(d)}px;width:${dw}px" title="${WD[wd]} ${short(d)}${hol ? ' - ' + esc(hol) : ''}">${new Date(d * 86400000).getUTCDate()}</div>`;
        }
      }
    }
    const head = `<div class="g-row g-head">
      <div class="g-left">${cols.map((c) => `<div style="width:${c[1]}px" class="fw-semibold">${c[0]}</div>`).join('')}</div>
      <div class="g-time g-scale" style="width:${TW}px"><div class="r">${top}</div>${bottom ? `<div class="r">${bottom}</div>` : ''}</div></div>`;

    // Hintergrund
    let bg = '';
    if (dw >= 3) {
      for (let d = m.r0; d <= m.r1; d++) {
        const wd = weekday(d), hol = holidayName(d);
        if (hol) bg += `<div class="g-bg hol" style="left:${X(d)}px;width:${dw}px" title="${esc(hol)}"></div>`;
        else if (wd === 0 || wd === 6) bg += `<div class="g-bg we" style="left:${X(d)}px;width:${dw}px"></div>`;
      }
    }
    if (m.today >= m.r0 && m.today <= m.r1) bg += `<div class="g-bg today" style="left:${X(m.today) + dw / 2}px" title="Heute"></div>`;
    const dl = Ops.dayNum(doc.meta.end || '');
    if (opt.osp) for (const [d, label] of Ops.OSP_TERMINE) {
      const n = Ops.dayNum(d);
      if (n >= m.r0 && n <= m.r1) bg += `<div class="g-bg osp" style="left:${X(n + 1) - 1}px" title="OSP: ${esc(label)} (${App.fmtDate(d)})"><span>${esc(label)}</span></div>`;
    }
    if (dl !== null) bg += `<div class="g-bg deadline" style="left:${X(dl + 1) - 1}px" title="Projektende / Abgabe ${App.fmtDate(doc.meta.end)}"></div>`;

    // Vorgangszeilen
    const rowsHtml = m.vis.map((t) => {
      const n = t.node, dt = m.dates[n.id];
      const sum = !t.isLeaf;
      const dur = dt.s !== null ? dt.e - dt.s + 1 : '';
      const wdays = dt.s !== null ? workdays(dt.s, dt.e) : '';
      const ind = `padding-left:${4 + (t.level - 1) * 14}px`;
      const tog = sum ? `<button class="g-tog" data-gtoggle="${esc(n.id)}" title="${collapsed.has(n.id) ? 'Aufklappen' : 'Zuklappen'}">${collapsed.has(n.id) ? '&#9656;' : '&#9662;'}</button>` : '<span class="g-tog-sp"></span>';
      const deps = esc((n.deps || []).map((d) => m.codeOf[d]).filter(Boolean).join(', '));
      const menu = `<div class="dropdown"><button class="g-menu" data-bs-toggle="dropdown" type="button" title="Aktionen">&#8942;</button>
        <ul class="dropdown-menu dropdown-menu-end small">
          <li><button class="dropdown-item" data-act="pspafter" data-id="${esc(n.id)}">Vorgang darunter einfügen</button></li>
          <li><button class="dropdown-item" data-act="pspchild" data-id="${esc(n.id)}">Untervorgang einfügen</button></li>
          <li><button class="dropdown-item" data-act="pspin" data-id="${esc(n.id)}">Einrücken</button></li>
          <li><button class="dropdown-item" data-act="pspout" data-id="${esc(n.id)}">Ausrücken</button></li>
          ${t.isLeaf && (n.deps || []).length ? `<li><button class="dropdown-item" data-gcleardeps="${esc(n.id)}">Vorgänger entfernen</button></li>` : ''}
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" data-act="pspdel" data-id="${esc(n.id)}">Löschen</button></li></ul></div>`;
      let left;
      if (editable) {
        const c = [`<div style="width:50px" class="small text-body-secondary">${t.code}</div>`,
          `<div style="width:${cols[1][1]}px;${ind}" class="${sum ? 'sum' : ''}">${tog}<input data-bind="upd|psp|${esc(n.id)}|title" value="${esc(n.title)}" placeholder="Vorgang benennen" data-genter="${esc(n.id)}"></div>`];
        if (!opt.compact) {
          if (sum) {
            const pr = sumProgress(doc, t, m);
            c.push(`<div style="width:118px" class="sum">${fmt(dt.s)}</div>`, `<div style="width:118px" class="sum">${fmt(dt.e)}</div>`,
              `<div style="width:52px" class="sum">${dur}</div>`, `<div style="width:36px" class="sum small">${wdays}</div>`,
              `<div style="width:52px" class="sum small">${pr === null ? '' : pr + '%'}</div>`,
              '<div style="width:130px"></div>', '<div style="width:62px"></div>', '<div style="width:78px"></div>', '<div style="width:32px"></div>');
          } else {
            c.push(`<div style="width:118px"><input type="date" data-bind="upd|psp|${esc(n.id)}|start" value="${esc(n.start || '')}"></div>`,
              `<div style="width:118px"><input type="date" data-bind="upd|psp|${esc(n.id)}|end" value="${esc(n.end || '')}"></div>`,
              `<div style="width:52px"><input type="number" min="1" data-gdur="${esc(n.id)}" value="${dur}" title="Dauer in Kalendertagen"></div>`,
              `<div style="width:36px" class="small text-body-secondary" title="Arbeitstage (ohne Wochenende/Feiertage)">${wdays}</div>`,
              `<div style="width:52px"><input type="number" min="0" max="100" step="10" data-bind="upd|psp|${esc(n.id)}|progress" value="${esc(n.progress ?? '')}" title="Fortschritt in %"></div>`,
              `<div style="width:130px">${opts.personsPicker ? opts.personsPicker(n) : ''}</div>`,
              `<div style="width:62px"><input type="number" min="0" step="any" data-bind="upd|psp|${esc(n.id)}|hours" value="${esc(n.hours ?? '')}" title="Stunden je Person"></div>`,
              `<div style="width:78px"><input data-gdeps="${esc(n.id)}" value="${deps}" title="Vorgänger (Nr.), z. B. 1.1, 1.2"></div>`,
              `<div style="width:32px"><input type="checkbox" class="form-check-input" style="width:16px;height:16px" data-bind="upd|psp|${esc(n.id)}|milestone" ${n.milestone ? 'checked' : ''} title="Meilenstein"></div>`);
          }
        }
        c.push(`<div style="width:30px">${menu}</div>`);
        left = c.join('');
      } else {
        left = [`<div style="width:45px">${t.code}</div>`, `<div style="width:210px;${ind}" class="${sum ? 'fw-bold' : ''}">${esc(n.title)}</div>`,
          `<div style="width:78px">${fmt(dt.s)}</div>`, `<div style="width:78px">${fmt(dt.e)}</div>`,
          `<div style="width:44px">${dur}</div>`, `<div style="width:130px">${esc(sum ? '' : personsLabel(n.persons))}</div>`].join('');
      }
      let bar = '';
      if (base && base[n.id] && t.isLeaf) {
        const [bs, be] = base[n.id];
        bar += `<div class="g-base" style="left:${X(bs)}px;width:${(be - bs + 1) * dw}px" title="Basisplan: ${fmt(bs)} - ${fmt(be)}"></div>`;
      }
      if (dt.s !== null) {
        const x = X(dt.s), w = (dt.e - dt.s + 1) * dw;
        const gid = editable ? `data-gid="${esc(n.id)}"` : '';
        const tip = `${t.code} ${n.title || ''}\n${fmt(dt.s)} - ${fmt(dt.e)} (${dur} Tage, ${wdays} Arbeitstage)${n.persons && n.persons.length ? '\nPersonen: ' + n.persons.join(', ') : ''}${n.hours ? '\nAufwand: ' + n.hours + ' h je Person' : ''}${Number.isFinite(n.progress) ? '\nFortschritt: ' + n.progress + ' %' : ''}${crit.has(n.id) ? '\nKritischer Pfad' : ''}`;
        if (sum) {
          bar += `<div class="g-bar sum" style="left:${x}px;width:${w}px" title="${esc(tip)}"></div>`;
        } else {
          const handles = editable ? '<span class="rs-l" title="Beginn ziehen"></span><span class="rs" title="Ende ziehen"></span><span class="lk" title="Ziehen auf einen anderen Vorgang = Abhängigkeit"></span>' : '';
          const prog = Number.isFinite(n.progress) && n.progress > 0 ? `<span class="pg" style="width:${Math.min(100, n.progress)}%"></span>` : '';
          if (!n.milestone || dt.e > dt.s) {
            bar += `<div class="g-bar ${crit.has(n.id) ? 'crit' : ''}" ${gid} style="left:${x}px;width:${w}px" title="${esc(tip)}">${prog}${handles}${n.milestone ? '' : `<span class="lbl">${esc(personsLabel(n.persons))}</span>`}</div>`;
          }
          if (n.milestone) bar += `<div class="g-ms ${crit.has(n.id) ? 'crit' : ''}" ${dt.e === dt.s ? gid : ''} style="left:${X(dt.e) + dw / 2 - 8}px" title="Meilenstein: ${esc(n.title)} (${fmt(dt.e)})"><span class="lbl">${esc(n.title)}</span></div>`;
        }
      }
      const empty = editable && t.isLeaf && dt.s === null;
      return `<div class="g-row ${sum ? 'is-sum' : ''}"><div class="g-left">${left}</div><div class="g-time ${empty ? 'g-empty' : ''}" data-grow="${esc(n.id)}" data-gempty="${empty ? esc(n.id) : ''}" style="width:${TW}px" title="${empty ? 'Klicken, um den Vorgang an diesem Tag zu beginnen' : ''}">${bar}</div></div>`;
    }).join('');

    // Auslastung je Person (paralleles Arbeiten sichtbar)
    let loadHtml = '', loadRows = 0;
    if (opt.load) {
      const per = {};
      for (const t of m.tree) {
        if (!t.isLeaf) continue;
        const r = m.dates[t.node.id];
        if (r.s === null) continue;
        for (const p of t.node.persons || []) {
          const e = per[p] = per[p] || {};
          for (let d = r.s; d <= r.e; d++) (e[d] = e[d] || []).push(t.code);
        }
      }
      const names = Object.keys(per).sort((a, b) => a.localeCompare(b));
      if (names.length) {
        loadRows = names.length + 1;
        loadHtml = `<div class="g-row g-loadhead"><div class="g-left"><div style="width:${LW}px" class="fw-semibold small">Auslastung je Person <span class="fw-normal text-body-secondary">(rot = mehrere Vorgänge gleichzeitig)</span></div></div><div class="g-time" style="width:${TW}px"></div></div>`
          + names.map((name) => {
            let cells = '';
            let d0 = null, cnt = 0, codes = '';
            const flush = (end) => {
              if (d0 === null) return;
              cells += `<div class="g-load ${cnt > 1 ? 'over' : ''}" style="left:${X(d0)}px;width:${(end - d0 + 1) * dw}px" title="${esc(name)}: ${fmt(d0)}${end > d0 ? ' - ' + fmt(end) : ''}\n${cnt} Vorgang/Vorgänge: ${esc(codes)}">${cnt > 1 && (end - d0 + 1) * dw > 14 ? cnt : ''}</div>`;
              d0 = null;
            };
            for (let d = m.r0; d <= m.r1 + 1; d++) {
              const list = per[name][d];
              const c = list ? list.length : 0;
              const k = list ? list.join(', ') : '';
              if (d0 !== null && (c !== cnt || k !== codes)) flush(d - 1);
              if (c && d0 === null) { d0 = d; cnt = c; codes = k; }
            }
            return `<div class="g-row g-loadrow"><div class="g-left"><div style="width:${LW}px" class="small">${esc(name)}</div></div><div class="g-time" style="width:${TW}px">${cells}</div></div>`;
          }).join('');
      }
    }

    // Abhängigkeiten
    const idx = Object.fromEntries(m.vis.map((t, i) => [t.node.id, i]));
    let paths = '';
    for (const t of m.vis) {
      const n = t.node, dn = m.dates[n.id];
      if (dn.s === null) continue;
      for (const p of n.deps || []) {
        const dp = m.dates[p];
        if (!dp || dp.s === null || idx[p] === undefined) continue;
        const x1 = X(dp.e + 1), y1 = idx[p] * ROW + ROW / 2;
        const x2 = X(dn.s) + 1, y2 = idx[n.id] * ROW + ROW / 2;
        const bad = dn.s <= dp.e;
        const isCrit = crit.has(n.id) && crit.has(p);
        const col = bad ? '#dc3545' : isCrit ? '#d63384' : '#8a8a8a';
        const xm = x1 + 8;
        paths += `<path d="M${x1} ${y1} H${xm} V${y2} H${x2}" fill="none" stroke="${col}" stroke-width="${isCrit || bad ? 1.8 : 1.3}" marker-end="url(#${bad ? 'arrBad' : isCrit ? 'arrCrit' : 'arr'})"><title>${bad ? 'Achtung: beginnt vor Ende des Vorgängers' : 'Abhängigkeit ' + m.codeOf[p] + ' → ' + t.code}</title></path>`;
      }
    }
    const H = (m.vis.length + loadRows) * ROW;
    const mk = (id, c) => `<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${c}"/></marker>`;
    const svg = `<svg class="g-arrows" width="${TW}" height="${H}" style="left:${LW}px"><defs>${mk('arr', '#8a8a8a')}${mk('arrBad', '#dc3545')}${mk('arrCrit', '#d63384')}</defs>${paths}<path class="g-linkline" d="" fill="none" stroke="#0d6efd" stroke-width="2" stroke-dasharray="4 3"/></svg>`;

    const tg = (key, label, title) => `<input type="checkbox" class="btn-check" id="go-${key}" data-gopt="${key}" ${opt[key] ? 'checked' : ''}><label class="btn btn-sm btn-outline-secondary" for="go-${key}" title="${title}">${label}</label>`;
    const zb = (z, l) => `<button class="btn ${opt.zoom === z ? 'btn-secondary' : 'btn-outline-secondary'}" data-gzoom="${z}">${l}</button>`;
    const toolbar = editable ? `<div class="gantt-toolbar d-flex flex-wrap gap-2 align-items-center mb-2 d-print-none">
      <div class="btn-group btn-group-sm">${zb('day', 'Tage')}${zb('week', 'Wochen')}${zb('month', 'Monate')}${zb('fit', 'Einpassen')}</div>
      <button class="btn btn-sm btn-outline-secondary" data-gtoday="1">Heute</button>
      <div class="vr"></div>
      ${tg('critical', 'Kritischer Pfad', 'Vorgänge ohne Puffer bis zum Projektende hervorheben')}
      ${tg('load', 'Auslastung', 'Auslastung je Person anzeigen (paralleles Arbeiten)')}
      ${tg('baseline', 'Basisplan', 'Gespeicherten Basisplan als graue Linie zeigen')}
      ${tg('autoShift', 'Nachfolger mitziehen', 'Beim Verschieben werden abhängige Vorgänge automatisch nach hinten geschoben')}
      ${tg('workdays', 'Nur Arbeitstage', 'Automatisch geplante Vorgänge beginnen am nächsten Arbeitstag')}
      ${tg('osp', 'OSP-Termine', 'Termine aus dem Kick-off als Linien anzeigen')}
      ${tg('compact', 'Kompakt', 'Nur Nummer und Vorgang anzeigen')}
      <div class="vr"></div>
      <button class="btn btn-sm btn-outline-secondary" data-gschedule="1" title="Alle Vorgänge so verschieben, dass sie nach ihren Vorgängern beginnen">Termine berechnen</button>
      <div class="dropdown"><button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">Basisplan</button>
        <ul class="dropdown-menu small"><li><button class="dropdown-item" data-gbaseline="save">Aktuellen Plan als Basisplan speichern</button></li>
        ${doc.baseline ? `<li><span class="dropdown-item-text text-body-secondary">gespeichert ${new Date(doc.baseline.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} von ${esc(doc.baseline.by)}</span></li>
        <li><button class="dropdown-item text-danger" data-gbaseline="clear">Basisplan entfernen</button></li>` : ''}</ul></div>
      <button class="btn btn-sm btn-outline-secondary" data-gundo="1" ${undoStack.length ? '' : 'disabled'} title="Rückgängig (Strg+Z)">Rückgängig</button>
      <button class="btn btn-sm btn-outline-primary ms-auto" data-act="osptemplate" title="Phasen und Termine aus dem Kick-off als Vorgänge anlegen">OSP-Ablauf übernehmen</button>
      <button class="btn btn-sm btn-primary" data-act="pspchild" data-id="">+ Teilprojekt</button>
    </div>` : '';

    const legend = `<div class="small text-body-secondary mt-2 d-flex flex-wrap gap-3">
      <span><span class="lg lg-bar"></span> Vorgang</span>${opt.critical ? '<span><span class="lg lg-crit"></span> kritischer Pfad</span>' : ''}
      <span><span class="lg lg-sum"></span> Sammelvorgang</span><span><span class="lg lg-ms"></span> Meilenstein</span>
      ${base ? '<span><span class="lg lg-base"></span> Basisplan</span>' : ''}<span><span class="lg lg-we"></span> Wochenende</span><span><span class="lg lg-hol"></span> Feiertag NRW</span>
      <span><span class="lg lg-today"></span> heute</span><span><span class="lg lg-dl"></span> Projektende</span>${opt.osp ? '<span><span class="lg lg-osp"></span> OSP-Termin</span>' : ''}</div>`;

    if (!m.tree.length) {
      return toolbar + `<div class="card card-body text-body-secondary">Noch keine Vorgänge. Mit „OSP-Ablauf übernehmen“ werden die Phasen und Termine aus dem Kick-off angelegt,
        oder lege oben ein Teilprojekt an und füge Vorgänge über das Menü (&#8942;) hinzu. Die Vorgänge sind dieselben wie im Projektstrukturplan.</div>`;
    }
    return `${toolbar}<div class="gantt-wrap"><div class="gantt ${editable ? 'is-edit' : ''}" style="width:${LW + TW}px;--c1w:${cols[0][1]}px">${head}
      <div class="g-body" style="position:relative">
        <div style="position:absolute;left:${LW}px;top:0;width:${TW}px;height:${H}px">${bg}</div>
        ${rowsHtml}${loadHtml}${svg}</div></div></div>${legend}
      ${editable ? `<p class="small text-body-secondary mt-2 mb-0">Bedienung: Balken ziehen = verschieben, Kanten ziehen = Beginn/Ende ändern, Punkt am Balkenende auf einen anderen Vorgang ziehen = Abhängigkeit.
        Klick in eine leere Zeile setzt den Beginn. Enter im Namen legt den nächsten Vorgang an. AT = Arbeitstage, % = Fortschritt, Std./P. = Aufwand je Person (fließt in den Kostenplan), MS = Meilenstein.</p>` : ''}`;
  }

  function sumProgress(doc, t, m) {
    // gewichteter Fortschritt der Kinder (nach Dauer)
    let tot = 0, done = 0;
    const walk = (id) => {
      for (const n of Object.values(doc.psp)) {
        if (n.parent !== id) continue;
        const kids = Object.values(doc.psp).some((x) => x.parent === n.id);
        if (kids) { walk(n.id); continue; }
        const r = m.dates[n.id];
        if (!r || r.s === null) continue;
        const w = r.e - r.s + 1;
        tot += w; done += w * (Number.isFinite(n.progress) ? n.progress : 0) / 100;
      }
    };
    walk(t.node.id);
    return tot ? Math.round((100 * done) / tot) : null;
  }

  // ---------- Ereignisse ----------
  function attach(view, ctx) {
    const wrap = view.querySelector('.gantt-wrap');
    if (wrap) fitWidth = wrap.clientWidth;
    else fitWidth = Math.max(600, view.clientWidth);
    const doc = ctx.doc;
    const m = model(doc);
    const cols = columns(true);
    const LW = cols.reduce((a, c) => a + c[1], 0);
    const dw = dayWidth(m, true, LW);

    /** Mehrere Operationen als ein rückgängig machbarer Schritt */
    function step(fn) {
      const inverse = [];
      const op = (o) => {
        if (o.t === 'upd') {
          const cur = doc.psp[o.id];
          if (!cur) return;
          const prev = {};
          for (const k of Object.keys(o.patch)) prev[k] = cur[k] === undefined ? (k === 'deps' || k === 'persons' ? [] : k === 'start' || k === 'end' ? '' : null) : cur[k];
          inverse.unshift({ t: 'upd', c: 'psp', id: o.id, patch: prev });
        }
        ctx.op(o);
      };
      fn(op);
      if (inverse.length) { undoStack.push(inverse); if (undoStack.length > 50) undoStack.shift(); }
    }
    function shift(op, ids) {
      if (!opt.autoShift) return;
      const p = cascadePatches(doc, ids);
      for (const [id, patch] of Object.entries(p)) op({ t: 'upd', c: 'psp', id, patch });
    }
    Gantt._undo = () => {
      const inv = undoStack.pop();
      if (!inv) return;
      for (const o of inv) ctx.op(o);
      ctx.render();
    };

    view.querySelectorAll('[data-gzoom]').forEach((b) => b.addEventListener('click', () => { opt.zoom = b.dataset.gzoom; saveOpt(); ctx.render(); }));
    view.querySelectorAll('[data-gopt]').forEach((b) => b.addEventListener('change', () => { opt[b.dataset.gopt] = b.checked; saveOpt(); ctx.render(); }));
    view.querySelectorAll('[data-gtoday]').forEach((b) => b.addEventListener('click', () => { if (wrap) wrap.scrollLeft = Math.max(0, (m.today - m.r0) * dw - 200); }));
    view.querySelectorAll('[data-gundo]').forEach((b) => b.addEventListener('click', () => Gantt._undo()));
    view.querySelectorAll('[data-gschedule]').forEach((b) => b.addEventListener('click', () => {
      const ids = Object.values(doc.psp).filter((n) => n.start).map((n) => n.id);
      const p = cascadePatches(doc, ids);
      const k = Object.keys(p).length;
      if (!k) { alert('Alle Vorgänge beginnen bereits nach ihren Vorgängern.'); return; }
      step((op) => { for (const [id, patch] of Object.entries(p)) op({ t: 'upd', c: 'psp', id, patch }); });
      ctx.render();
    }));
    view.querySelectorAll('[data-gbaseline]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.gbaseline === 'clear') { if (confirm('Basisplan entfernen?')) ctx.baseline(null); return; }
      const items = {};
      for (const [id, r] of Object.entries(m.dates)) if (r.s !== null && !Object.values(doc.psp).some((x) => x.parent === id)) items[id] = [r.s, r.e];
      if (doc.baseline && !confirm('Vorhandenen Basisplan überschreiben?')) return;
      ctx.baseline(items);
    }));
    if (!wrap) return;

    wrap.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-gtoggle]');
      if (tog) {
        const id = tog.dataset.gtoggle;
        if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
        store.set('gantt.collapsed', [...collapsed]);
        ctx.render();
        return;
      }
      const cl = e.target.closest('[data-gcleardeps]');
      if (cl) { step((op) => op({ t: 'upd', c: 'psp', id: cl.dataset.gcleardeps, patch: { deps: [] } })); ctx.render(); return; }
      const t = e.target.closest('[data-gempty]');
      if (!t || !t.dataset.gempty || e.target.closest('.g-bar, .g-ms')) return;
      const r = t.getBoundingClientRect();
      const day = m.r0 + Math.floor((e.clientX - r.left) / dw);
      step((op) => op({ t: 'upd', c: 'psp', id: t.dataset.gempty, patch: { start: Ops.numDay(day), end: Ops.numDay(day) } }));
      ctx.render();
    });

    wrap.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.gdur) {
        const n = doc.psp[el.dataset.gdur];
        const d = parseInt(el.value, 10);
        if (!n || !(d >= 1)) return;
        const start = n.start || new Date().toISOString().slice(0, 10);
        step((op) => { op({ t: 'upd', c: 'psp', id: n.id, patch: { start, end: Ops.numDay(Ops.dayNum(start) + d - 1) } }); shift(op, [n.id]); });
        ctx.render();
      } else if (el.dataset.gdeps) {
        const byCode = Object.fromEntries(Object.entries(m.codeOf).map(([id, c]) => [c, id]));
        const target = el.dataset.gdeps;
        const ids = [...new Set(el.value.split(/[,;\s]+/).map((x) => byCode[x.trim()]).filter((x) => x && x !== target))];
        const ok = ids.filter((p) => !createsCycle({ psp: Object.assign({}, doc.psp, { [target]: Object.assign({}, doc.psp[target], { deps: [] }) }) }, target, p));
        if (ok.length < ids.length) alert('Einige Vorgänger wurden ignoriert, weil sie einen Kreis erzeugen würden.');
        step((op) => { op({ t: 'upd', c: 'psp', id: target, patch: { deps: ok } }); shift(op, ok); });
        ctx.render();
      } else if (el.type === 'date' && /\|psp\|/.test(el.dataset.bind || '') && opt.autoShift) {
        // Datum direkt geändert: Nachfolger nachziehen (Datum selbst wurde bereits gespeichert)
        const id = el.dataset.bind.split('|')[2];
        step((op) => shift(op, [id]));
      }
    });

    // Enter im Namen: nächsten Vorgang darunter anlegen
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.genter) {
        e.preventDefault();
        ctx.addAfter(e.target.dataset.genter);
      }
    });

    // Ziehen: verschieben, Kanten ändern, Abhängigkeit verbinden
    wrap.addEventListener('pointerdown', (e) => {
      const bar = e.target.closest('.g-bar[data-gid], .g-ms[data-gid]');
      if (!bar || e.button !== 0) return;
      e.preventDefault();
      const n = doc.psp[bar.dataset.gid];
      if (!n || !n.start) return;
      const cls = e.target.classList;
      const mode = cls.contains('lk') ? 'link' : cls.contains('rs') ? 'end' : cls.contains('rs-l') ? 'start' : 'move';
      const s0 = Ops.dayNum(n.start), e0 = Math.max(s0, Ops.dayNum(n.end || n.start));
      const x0 = e.clientX;
      const left0 = parseFloat(bar.style.left), w0 = parseFloat(bar.style.width || 0);
      let delta = 0;
      ctx.setDragging(true);
      bar.setPointerCapture(e.pointerId);
      const line = wrap.querySelector('.g-linkline');
      const svgBox = wrap.querySelector('.g-arrows').getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      const sx = barBox.right - svgBox.left, sy = barBox.top + barBox.height / 2 - svgBox.top;
      let hover = null;
      const move = (ev) => {
        if (mode === 'link') {
          line.setAttribute('d', `M${sx} ${sy} L${ev.clientX - svgBox.left} ${ev.clientY - svgBox.top}`);
          bar.style.pointerEvents = 'none';
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          bar.style.pointerEvents = '';
          const tgt = under && under.closest('[data-grow]');
          if (hover) hover.classList.remove('g-linktarget');
          hover = tgt && tgt.dataset.grow !== n.id ? tgt : null;
          if (hover) hover.classList.add('g-linktarget');
          return;
        }
        delta = Math.round((ev.clientX - x0) / dw);
        if (mode === 'end') bar.style.width = Math.max(dw, w0 + delta * dw) + 'px';
        else if (mode === 'start') { const dd = Math.min(delta, e0 - s0); bar.style.left = (left0 + dd * dw) + 'px'; bar.style.width = (w0 - dd * dw) + 'px'; }
        else bar.style.left = (left0 + delta * dw) + 'px';
        bar.title = mode === 'end' ? `Ende: ${fmt(Math.max(s0, e0 + delta))}` : mode === 'start' ? `Beginn: ${fmt(Math.min(e0, s0 + delta))}` : `${fmt(s0 + delta)} - ${fmt(e0 + delta)}`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        if (mode === 'link') {
          line.setAttribute('d', '');
          if (hover) {
            hover.classList.remove('g-linktarget');
            const tid = hover.dataset.grow;
            const tn = doc.psp[tid];
            const isLeaf = tn && !Object.values(doc.psp).some((x) => x.parent === tid);
            if (!isLeaf) alert('Abhängigkeiten nur zwischen Vorgängen (nicht Sammelvorgängen).');
            else if ((tn.deps || []).includes(n.id)) { /* schon vorhanden */ }
            else if (createsCycle(doc, tid, n.id)) alert('Diese Abhängigkeit würde einen Kreis erzeugen.');
            else step((op) => { op({ t: 'upd', c: 'psp', id: tid, patch: { deps: (tn.deps || []).concat([n.id]) } }); shift(op, [n.id]); });
          }
        } else if (delta) {
          const patch = mode === 'end' ? { end: Ops.numDay(Math.max(s0, e0 + delta)) }
            : mode === 'start' ? { start: Ops.numDay(Math.min(e0, s0 + delta)) }
              : { start: Ops.numDay(s0 + delta), end: Ops.numDay(e0 + delta) };
          step((op) => { op({ t: 'upd', c: 'psp', id: n.id, patch }); shift(op, [n.id]); });
        }
        ctx.setDragging(false);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  window.Gantt = { html, attach, _undo: () => {} };
})();
