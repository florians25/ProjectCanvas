/* Gantt-Diagramm: Vorgänge = Elemente des Projektstrukturplans */
(function () {
  'use strict';
  const esc = (s) => App.esc(s);
  const ROW = 34;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let zoom = store.get('gantt.zoom', 'day');       // day | week
  let compact = store.get('gantt.compact', false);  // nur Code + Vorgang

  // ---------- Feiertage NRW ----------
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
    const list = [fix('01-01', 'Neujahr'), [e - 2, 'Karfreitag'], [e + 1, 'Ostermontag'], fix('05-01', 'Tag der Arbeit'),
      [e + 39, 'Christi Himmelfahrt'], [e + 50, 'Pfingstmontag'], [e + 60, 'Fronleichnam'], fix('10-03', 'Tag der Deutschen Einheit'),
      fix('11-01', 'Allerheiligen'), fix('12-25', '1. Weihnachtstag'), fix('12-26', '2. Weihnachtstag')];
    holCache[y] = new Map(list);
    return holCache[y];
  }
  function holidayName(n) { return holidays(new Date(n * 86400000).getUTCFullYear()).get(n); }
  const weekday = (n) => new Date(n * 86400000).getUTCDay(); // 0 = So
  function isoWeek(n) {
    const d = new Date(n * 86400000);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  const short = (n) => { const d = new Date(n * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`; };
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  function personsLabel(list) {
    const n = (list || []).length;
    return !n ? '' : n <= 2 ? list.join(', ') : `${n} Personen`;
  }

  function columns(editable) {
    if (!editable) return [['Nr.', 45], ['Vorgang', 210], ['Start', 78], ['Ende', 78], ['Dauer', 52], ['Personen', 130]];
    if (compact) return [['Nr.', 50], ['Vorgang', 220]];
    return [['Nr.', 50], ['Vorgang', 210], ['Start', 118], ['Ende', 118], ['Tage', 56], ['Personen', 130], ['Std./Pers.', 70], ['Vorgänger', 80], ['MS', 34]];
  }

  function model(doc) {
    const { tree, dates } = Ops.pspDates(doc);
    let min = null, max = null;
    const consider = (n) => { if (n === null) return; min = min === null ? n : Math.min(min, n); max = max === null ? n : Math.max(max, n); };
    for (const k in dates) { consider(dates[k].s); consider(dates[k].e); }
    consider(Ops.dayNum(doc.meta.start || ''));
    consider(Ops.dayNum(doc.meta.end || ''));
    const today = Ops.dayNum(new Date().toISOString().slice(0, 10));
    if (min === null) { min = today; max = today + 41; }
    // auf ganze Wochen (Mo - So) erweitern, etwas Luft hinten
    const r0 = min - ((weekday(min) + 6) % 7);
    let r1 = max + 7;
    r1 = r1 + (6 - ((weekday(r1) + 6) % 7));
    const codeOf = Object.fromEntries(tree.map((t) => [t.node.id, t.code]));
    return { tree, dates, r0, r1, n: r1 - r0 + 1, today, codeOf };
  }

  function html(doc, opts) {
    const editable = opts.editable;
    const m = model(doc);
    const cols = columns(editable);
    const LW = cols.reduce((a, c) => a + c[1], 0);
    // Bearbeiten: Zoom nach Wahl. Dokument/Druck: so skalieren, dass alles auf A4 quer passt.
    const dw = editable ? (zoom === 'day' ? 26 : 9) : Math.max(3, Math.min(26, (1040 - LW) / m.n));
    const showDays = editable ? zoom === 'day' : dw >= 16;
    const TW = m.n * dw;

    // Kopf: Kalenderwochen und Tage
    let weeks = '', daysRow = '';
    for (let d = m.r0; d <= m.r1; d += 7) {
      weeks += `<div class="cell" style="left:${(d - m.r0) * dw}px;width:${7 * dw}px" title="KW ${isoWeek(d)}, ${short(d)} - ${short(d + 6)}">${7 * dw >= 34 ? 'KW ' : ''}${isoWeek(d)}${7 * dw >= 90 ? ' &middot; ' + short(d) : ''}</div>`;
    }
    if (showDays) {
      for (let d = m.r0; d <= m.r1; d++) {
        const wd = weekday(d), hol = holidayName(d);
        daysRow += `<div class="cell ${hol ? 'hol' : wd === 0 || wd === 6 ? 'we' : ''}" style="left:${(d - m.r0) * dw}px;width:${dw}px" title="${WD[wd]} ${short(d)}${hol ? ' - ' + esc(hol) : ''}">${new Date(d * 86400000).getUTCDate()}<br></div>`;
      }
    }
    const head = `<div class="g-row g-head">
      <div class="g-left">${cols.map((c) => `<div style="width:${c[1]}px" class="fw-semibold">${c[0]}</div>`).join('')}</div>
      <div class="g-time g-scale" style="width:${TW}px"><div class="r">${weeks}</div>${showDays ? `<div class="r">${daysRow}</div>` : ''}</div></div>`;

    // Hintergrund (Wochenenden, Feiertage, heute, Deadline)
    let bg = '';
    for (let d = m.r0; d <= m.r1; d++) {
      const wd = weekday(d), hol = holidayName(d);
      if (hol) bg += `<div class="g-bg hol" style="left:${(d - m.r0) * dw}px;width:${dw}px"></div>`;
      else if (wd === 0 || wd === 6) bg += `<div class="g-bg we" style="left:${(d - m.r0) * dw}px;width:${dw}px"></div>`;
    }
    if (m.today >= m.r0 && m.today <= m.r1) bg += `<div class="g-bg today" style="left:${(m.today - m.r0) * dw + dw / 2}px" title="Heute"></div>`;
    const dl = Ops.dayNum(doc.meta.end || '');
    if (dl !== null) bg += `<div class="g-bg deadline" style="left:${(dl - m.r0 + 1) * dw - 1}px" title="Projektende / Deadline ${App.fmtDate(doc.meta.end)}"></div>`;

    // Zeilen
    const rowsHtml = m.tree.map((t) => {
      const n = t.node, dt = m.dates[n.id];
      const sum = !t.isLeaf;
      const dur = dt.s !== null ? dt.e - dt.s + 1 : '';
      const ind = `padding-left:${4 + (t.level - 1) * 12}px`;
      let left;
      if (editable) {
        const c = [`<div style="width:50px">${t.code}</div>`,
          `<div style="width:${cols[1][1]}px;${ind}" class="${sum ? 'sum' : ''}"><input data-bind="upd|psp|${esc(n.id)}|title" value="${esc(n.title)}" placeholder="Vorgang"></div>`];
        if (!compact) {
          if (sum) {
            c.push(`<div style="width:118px" class="sum">${App.fmtDate(dt.s !== null ? Ops.numDay(dt.s) : '')}</div>`,
              `<div style="width:118px" class="sum">${App.fmtDate(dt.e !== null ? Ops.numDay(dt.e) : '')}</div>`,
              `<div style="width:56px" class="sum">${dur}</div>`, '<div style="width:130px"></div>', '<div style="width:70px"></div>',
              `<div style="width:80px"><input data-gdeps="${esc(n.id)}" value="${esc((n.deps || []).map((d) => m.codeOf[d]).filter(Boolean).join(', '))}" title="Vorgänger (Nr.), z. B. 1.1, 1.2"></div>`,
              '<div style="width:34px"></div>');
          } else {
            c.push(`<div style="width:118px"><input type="date" data-bind="upd|psp|${esc(n.id)}|start" value="${esc(n.start || '')}"></div>`,
              `<div style="width:118px"><input type="date" data-bind="upd|psp|${esc(n.id)}|end" value="${esc(n.end || '')}"></div>`,
              `<div style="width:56px"><input type="number" min="1" data-gdur="${esc(n.id)}" value="${dur}" title="Dauer in Tagen"></div>`,
              `<div style="width:130px">${opts.personsPicker ? opts.personsPicker(n) : ''}</div>`,
              `<div style="width:70px"><input type="number" min="0" step="any" data-bind="upd|psp|${esc(n.id)}|hours" value="${esc(n.hours ?? '')}" title="Stunden je Person"></div>`,
              `<div style="width:80px"><input data-gdeps="${esc(n.id)}" value="${esc((n.deps || []).map((d) => m.codeOf[d]).filter(Boolean).join(', '))}" title="Vorgänger (Nr.), z. B. 1.1, 1.2"></div>`,
              `<div style="width:34px"><input type="checkbox" class="form-check-input" style="width:16px;height:16px" data-bind="upd|psp|${esc(n.id)}|milestone" ${n.milestone ? 'checked' : ''} title="Meilenstein"></div>`);
          }
        }
        left = c.join('');
      } else {
        left = [`<div style="width:45px">${t.code}</div>`, `<div style="width:210px;${ind}" class="${sum ? 'fw-bold' : ''}">${esc(n.title)}</div>`,
          `<div style="width:78px">${App.fmtDate(dt.s !== null ? Ops.numDay(dt.s) : '')}</div>`, `<div style="width:78px">${App.fmtDate(dt.e !== null ? Ops.numDay(dt.e) : '')}</div>`,
          `<div style="width:52px">${dur}</div>`, `<div style="width:130px">${esc(sum ? '' : personsLabel(n.persons))}</div>`].join('');
      }
      let bar = '';
      if (dt.s !== null) {
        const x = (dt.s - m.r0) * dw, w = (dt.e - dt.s + 1) * dw;
        const lbl = sum ? '' : esc(personsLabel(n.persons));
        if (n.milestone && !sum) {
          if (dt.e > dt.s) bar = `<div class="g-bar" ${editable ? `data-gid="${esc(n.id)}"` : ''} style="left:${x}px;width:${w}px" title="${esc(n.title)}">${editable ? '<span class="rs"></span>' : ''}</div>`;
          bar += `<div class="g-ms" ${editable ? `data-gid="${esc(n.id)}"` : ''} style="left:${(dt.e - m.r0) * dw + dw / 2 - 8}px" title="Meilenstein: ${esc(n.title)} (${App.fmtDate(Ops.numDay(dt.e))})"><span class="lbl">${esc(n.title)}</span></div>`;
        } else if (sum) {
          bar = `<div class="g-bar sum" style="left:${x}px;width:${w}px" title="${esc(n.title)}"></div>`;
        } else {
          bar = `<div class="g-bar" ${editable ? `data-gid="${esc(n.id)}"` : ''} style="left:${x}px;width:${w}px" title="${esc(n.title)}: ${App.fmtDate(n.start)} - ${App.fmtDate(n.end || n.start)}">${editable ? '<span class="rs"></span>' : ''}<span class="lbl">${lbl}</span></div>`;
        }
      }
      const empty = editable && t.isLeaf && dt.s === null;
      return `<div class="g-row"><div class="g-left">${left}</div><div class="g-time ${empty ? 'g-empty' : ''}" data-gempty="${empty ? esc(n.id) : ''}" style="width:${TW}px" title="${empty ? 'Klicken, um den Vorgang an diesem Tag zu beginnen' : ''}">${bar}</div></div>`;
    }).join('');

    // Abhängigkeiten als Pfeile
    const idx = Object.fromEntries(m.tree.map((t, i) => [t.node.id, i]));
    let paths = '';
    for (const t of m.tree) {
      const n = t.node, dn = m.dates[n.id];
      if (dn.s === null) continue;
      for (const pidd of n.deps || []) {
        const dp = m.dates[pidd];
        if (!dp || dp.s === null || idx[pidd] === undefined) continue;
        const x1 = (dp.e - m.r0 + 1) * dw, y1 = idx[pidd] * ROW + ROW / 2;
        const x2 = (dn.s - m.r0) * dw + 1, y2 = idx[n.id] * ROW + ROW / 2;
        const bad = dn.s <= dp.e;
        const xm = x1 + 8;
        paths += `<path d="M${x1} ${y1} H${xm} V${y2} H${x2}" fill="none" stroke="${bad ? '#dc3545' : '#555'}" stroke-width="1.3" marker-end="url(#${bad ? 'arrBad' : 'arr'})"><title>${bad ? 'Achtung: beginnt vor Ende des Vorgängers' : 'Abhängigkeit'}</title></path>`;
      }
    }
    const H = m.tree.length * ROW;
    const svg = `<svg class="g-arrows" width="${TW}" height="${H}" style="left:${LW}px">
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#555"/></marker>
      <marker id="arrBad" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#dc3545"/></marker></defs>${paths}</svg>`;

    const toolbar = `<div class="d-flex flex-wrap gap-2 align-items-center mb-2 d-print-none">
      ${editable ? `<div class="btn-group btn-group-sm"><button class="btn ${zoom === 'day' ? 'btn-secondary' : 'btn-outline-secondary'}" data-gzoom="day">Tage</button>
      <button class="btn ${zoom === 'week' ? 'btn-secondary' : 'btn-outline-secondary'}" data-gzoom="week">Wochen</button></div>` : ''}
      ${editable ? `<button class="btn btn-sm btn-outline-secondary" data-gcompact="1">${compact ? 'Alle Spalten zeigen' : 'Nur Vorgänge zeigen'}</button>` : ''}
      ${editable ? '<button class="btn btn-sm btn-outline-secondary" data-gtoday="1">Zu heute</button>' : ''}
      ${editable ? `<button class="btn btn-sm btn-outline-primary" data-act="pspchild" data-id="">+ Teilprojekt (im PSP)</button>` : ''}
      <span class="small text-muted">${editable ? 'Balken ziehen = verschieben, rechte Kante ziehen = Dauer ändern. ' : ''}Grau = Wochenende, orange = Feiertag (NRW), blau = heute, rot = Projektende.</span></div>`;

    if (!m.tree.length) return toolbar + '<p class="text-muted">Noch keine Vorgänge. Die Vorgänge kommen aus dem Projektstrukturplan.</p>';
    return `${toolbar}<div class="gantt-wrap"><div class="gantt" style="width:${LW + TW}px;--c1w:${cols[0][1]}px">${head}
      <div class="g-body" style="position:relative">
        <div style="position:absolute;left:${LW}px;top:0;width:${TW}px;height:${H}px">${bg}</div>
        ${rowsHtml}${svg}</div></div></div>
      ${editable ? '<p class="small text-muted mt-2">Vorgänger: Nummern der Vorgänge, die vorher fertig sein müssen (z. B. „1.1, 1.2"). Std./Pers. = Aufwand je Person, fließt in den Ressourcen- und Kostenplan. MS = Meilenstein.</p>' : ''}`;
  }

  function attach(view, ctx) {
    const wrap = view.querySelector('.gantt-wrap');
    const m = model(ctx.doc);
    const dw = zoom === 'day' ? 26 : 9;

    view.querySelectorAll('[data-gzoom]').forEach((b) => b.addEventListener('click', () => { zoom = b.dataset.gzoom; store.set('gantt.zoom', zoom); ctx.render(); }));
    view.querySelectorAll('[data-gcompact]').forEach((b) => b.addEventListener('click', () => { compact = !compact; store.set('gantt.compact', compact); ctx.render(); }));
    view.querySelectorAll('[data-gtoday]').forEach((b) => b.addEventListener('click', () => {
      if (wrap) wrap.scrollLeft = Math.max(0, (m.today - m.r0) * dw - 200);
    }));
    if (!wrap) return;

    // Dauer → Ende berechnen
    wrap.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.gdur) {
        const n = ctx.doc.psp[el.dataset.gdur];
        const d = parseInt(el.value, 10);
        if (!n || !(d >= 1)) return;
        const start = n.start || new Date().toISOString().slice(0, 10);
        ctx.op({ t: 'upd', c: 'psp', id: n.id, patch: { start, end: Ops.numDay(Ops.dayNum(start) + d - 1) } });
        ctx.render();
      } else if (el.dataset.gdeps) {
        const byCode = Object.fromEntries(Object.entries(m.codeOf).map(([id, c]) => [c, id]));
        const ids = el.value.split(/[,;\s]+/).map((x) => byCode[x.trim()]).filter((x) => x && x !== el.dataset.gdeps);
        ctx.op({ t: 'upd', c: 'psp', id: el.dataset.gdeps, patch: { deps: [...new Set(ids)] } });
        ctx.render();
      }
    });

    // Klick auf leere Zeile → Vorgang an diesem Tag beginnen
    wrap.addEventListener('click', (e) => {
      const t = e.target.closest('[data-gempty]');
      if (!t || !t.dataset.gempty) return;
      const r = t.getBoundingClientRect();
      const day = m.r0 + Math.floor((e.clientX - r.left) / dw);
      const iso = Ops.numDay(day);
      ctx.op({ t: 'upd', c: 'psp', id: t.dataset.gempty, patch: { start: iso, end: iso } });
      ctx.render();
    });

    // Balken ziehen
    wrap.addEventListener('pointerdown', (e) => {
      const bar = e.target.closest('.g-bar[data-gid], .g-ms[data-gid]');
      if (!bar || e.button !== 0) return;
      e.preventDefault();
      const n = ctx.doc.psp[bar.dataset.gid];
      if (!n || !n.start) return;
      const resize = e.target.classList.contains('rs');
      const s0 = Ops.dayNum(n.start), e0 = Ops.dayNum(n.end || n.start);
      const x0 = e.clientX;
      const left0 = parseFloat(bar.style.left), w0 = parseFloat(bar.style.width || 0);
      let delta = 0;
      ctx.setDragging(true);
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        delta = Math.round((ev.clientX - x0) / dw);
        if (resize) bar.style.width = Math.max(dw, w0 + delta * dw) + 'px';
        else bar.style.left = (left0 + delta * dw) + 'px';
        bar.title = resize ? `Ende: ${App.fmtDate(Ops.numDay(Math.max(s0, e0 + delta)))}` : `${App.fmtDate(Ops.numDay(s0 + delta))} - ${App.fmtDate(Ops.numDay(e0 + delta))}`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        if (delta) {
          const patch = resize ? { end: Ops.numDay(Math.max(s0, e0 + delta)) } : { start: Ops.numDay(s0 + delta), end: Ops.numDay(e0 + delta) };
          ctx.op({ t: 'upd', c: 'psp', id: n.id, patch });
        }
        ctx.setDragging(false);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  window.Gantt = { html, attach };
})();
