/*
 * Gemeinsame Datenstruktur und Operationen eines Projekts.
 * Wird im Browser und auf dem Server verwendet (gleiche Logik, gleiche Validierung).
 */
(function (root) {
  'use strict';

  const SECTIONS = ['ziel', 'kriterien_muss', 'kriterien_nicht', 'erfolg', 'meilensteine', 'arbeitspakete',
    'ergebnis', 'team', 'stakeholder', 'nutzer', 'ressourcen', 'umfeld', 'risiken'];
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'purple', 'white'];
  const RISIKOARTEN = ['Technisches Risiko', 'Planungsrisiko', 'Vertragliches Risiko', 'Kaufmännisches Risiko',
    'Personelles Risiko', 'Politik- und Umweltrisiko'];
  const MASSNAHMENARTEN = ['Vermeidung', 'Verminderung', 'Begrenzung der Schadenshöhe', 'Abwälzung', 'Überwachung'];
  const QSTUFEN = ['sehr relevant', 'relevant', 'normal', 'nicht relevant'];
  const QBEREICHE = ['Produktqualität', 'Prozessqualität'];
  // Fragepyramide (Reihenfolge = von der Basis nach oben)
  const FRAGETYPEN = ['Offene Frage', 'Alternativfrage', 'Geschlossene Frage', 'Kontrollfrage'];
  // Termine laut Kick-off OSP 2026/27
  const OSP_TERMINE = [
    ['2026-11-13', 'Deadline Kundengespräch'], ['2026-12-22', 'Abgabe Planungsdokumente'], ['2027-01-15', 'Ende Feedback'],
    ['2027-01-22', 'Deadline Überarbeitung'], ['2027-01-25', 'Start Realisierungsphase'], ['2027-03-05', 'Ende Durchführung (max.)'],
    ['2027-03-19', 'Deadline Präsentation OSP']];

  // Feldtypen: s=Text(max), n=Zahl, b=Ja/Nein, d=Datum, e=Auswahl, l=Liste von Texten, id=Verweis
  const S = (max) => ['s', max];
  const COLLS = {
    notes: { section: ['e', SECTIONS], text: S(4000), color: ['e', COLORS], order: ['n'], date: ['d'], done: ['b'], author: S(80), editedBy: S(80), editedAt: ['n'] },
    psp: {
      parent: ['id'], order: ['n'], title: S(300), start: ['d'], end: ['d'], persons: ['l'], hours: ['n'],
      milestone: ['b'], deps: ['l'], lead: S(100), ergebnisse: S(8000), taetigkeiten: S(8000), voraussetzungen: S(8000),
      ki: S(2000), progress: ['n'],
    },
    criteria: { kind: ['e', ['M', 'W', 'A']], text: S(2000), order: ['n'] },
    phQuality: { merkmal: S(200), stufe: ['e', QSTUFEN.concat([''])], order: ['n'] },
    glossar: { begriff: S(200), erklaerung: S(2000), order: ['n'] },
    risks: {
      order: ['n'], risiko: S(500), art: ['e', RISIKOARTEN.concat([''])], ursache: S(2000),
      ausmass: ['n'], wkeit: ['n'], massnahmeArt: ['e', MASSNAHMENARTEN.concat([''])], massnahme: S(2000),
    },
    quality: {
      order: ['n'], bereich: ['e', QBEREICHE], massnahme: S(1000), kriterium: S(1000), zielgroesse: S(1000),
      zeitpunkt: S(500), verantwortlich: S(200),
    },
    costs: { order: ['n'], bezeichnung: S(300), menge: ['n'], einheit: S(40), einzelpreis: ['n'], bemerkung: S(1000) },
    log: { order: ['n'], datum: ['d'], todo: S(2000), helfer: S(300), verantwortlich: S(200), erledigt: S(2000) },
    // Fragenkatalog, Kernphase: Fragen nach Themengebiet und Fragetyp (Fragepyramide)
    questions: { order: ['n'], thema: S(200), typ: ['e', FRAGETYPEN.concat([''])], text: S(2000), antwort: S(4000) },
    // Rollenverteilung im Team
    roles: { order: ['n'], person: S(100), rolle: S(200), aufgaben: S(2000) },
  };

  const SCALARS = {
    name: S(200),
    'meta.leader': S(200), 'meta.owner': S(200), 'meta.auftraggeber': S(300), 'meta.auftragnehmer': S(300),
    'meta.gruppe': S(1000), 'meta.trello': S(500), 'meta.start': ['d'], 'meta.end': ['d'], 'meta.stundensatz': ['n'],
    'ph.thema': S(5000), 'ph.parteien': S(5000), 'ph.aufgabe': S(10000), 'ph.zeitrahmen': S(5000),
    'ph.kostenrahmen': S(5000), 'ph.ziel': S(5000), 'ph.anwendung': S(5000), 'ph.zielgruppen': S(5000),
    'ph.betrieb': S(5000), 'ph.umfeld': S(10000), 'ph.qhinweis': S(2000), 'ph.tests': S(10000),
    'ph.ergaenzungen': S(10000), 'ph.ort': S(300),
    'fragen.von': S(1000), 'fragen.ziel': S(2000), 'fragen.begruessung': S(10000), 'fragen.eroeffnung': S(10000),
    'fragen.kern': S(20000), 'fragen.abschluss': S(10000), 'fragen.verabschiedung': S(10000),
    'fragen.ist': S(10000), 'fragen.soll': S(10000), 'fragen.fehlend': S(10000), 'fragen.termin': ['d'],
    'meta.kunde': S(300), 'meta.technik': S(300), 'meta.kommunikation': S(10000),
  };

  // KI-Kennzeichnung je Dokument (Kick-off: „Nachweisen/markieren, wo KI zur Unterstützung genutzt wurde“)
  const KI_DOCS = ['canvas', 'pflichtenheft', 'psp', 'gantt', 'kosten', 'risiken', 'qualitaet', 'fragen', 'doku'];
  for (const k of KI_DOCS) SCALARS['ki.' + k] = S(3000);
  // Selbstcheck nach Bewertungskriterien (Pflichtenheft 1-14, Gantt 1-3)
  for (let i = 1; i <= 14; i++) SCALARS['check.ph' + i] = ['b'];
  for (let i = 1; i <= 3; i++) SCALARS['check.g' + i] = ['b'];

  // Bereiche für das Aktivitätsprotokoll
  const AREAS = {
    projekt: 'Projektdaten', canvas: 'Project Canvas', pflichtenheft: 'Pflichtenheft', psp: 'Projektstrukturplan',
    gantt: 'Zeitplan (Gantt)', kosten: 'Ressourcen- und Kostenplan', risiken: 'Risikoplan', qualitaet: 'Qualitätsplan',
    ap: 'Arbeitspaketbeschreibung', fragen: 'Fragenkatalog', doku: 'Grobe Zeitplanung',
  };
  const COLL_AREA = { notes: 'canvas', criteria: 'pflichtenheft', phQuality: 'pflichtenheft', glossar: 'pflichtenheft',
    risks: 'risiken', quality: 'qualitaet', costs: 'kosten', log: 'doku', questions: 'fragen', roles: 'projekt' };
  const PSP_GANTT = ['start', 'end', 'persons', 'hours', 'deps', 'milestone', 'progress'];
  const PSP_AP = ['ergebnisse', 'taetigkeiten', 'voraussetzungen', 'lead', 'ki'];
  function areaOf(op) {
    if (op.t === 'set') {
      const [a, b] = op.key.split('.');
      if (a === 'ph') return 'pflichtenheft';
      if (a === 'fragen') return 'fragen';
      if (a === 'ki') return b;
      if (a === 'check') return b.startsWith('ph') ? 'pflichtenheft' : 'gantt';
      if (op.key === 'meta.stundensatz') return 'kosten';
      return 'projekt';
    }
    if (op.c === 'psp') {
      const keys = Object.keys(op.patch || op.row || {});
      if (op.t === 'upd' && keys.some((k) => PSP_AP.includes(k))) return 'ap';
      if (op.t === 'upd' && keys.length && keys.every((k) => PSP_GANTT.includes(k))) return 'gantt';
      return 'psp';
    }
    return COLL_AREA[op.c] || 'projekt';
  }

  const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function clean(type, v) {
    switch (type[0]) {
      case 's': return typeof v === 'string' ? v.slice(0, type[1]) : undefined;
      case 'n': return v === null || v === '' ? null : (Number.isFinite(+v) ? +v : undefined);
      case 'b': return typeof v === 'boolean' ? v : undefined;
      case 'd': return v === '' || v === null ? '' : (typeof v === 'string' && DATE_RE.test(v) ? v : undefined);
      case 'e': return type[1].includes(v) ? v : undefined;
      case 'id': return v === null || v === '' ? null : (typeof v === 'string' && ID_RE.test(v) ? v : undefined);
      case 'l': return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 100)) : undefined;
      default: return undefined;
    }
  }

  function cleanFields(c, obj) {
    const out = {};
    const spec = COLLS[c];
    for (const k of Object.keys(obj || {})) {
      if (!spec[k]) continue;
      const v = clean(spec[k], obj[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  function emptyProject(id, name, by) {
    const p = {
      id, name: name || 'Neues Projekt', createdAt: Date.now(), createdBy: by || '',
      meta: { stundensatz: null },
      ph: { qhinweis: 'Diese tabellarische Übersicht dient lediglich der Schwerpunktsetzung im Projekt. Es lässt sich keinerlei rechtlicher Anspruch daraus ableiten.' },
      fragen: { ziel: 'Die Wünsche und Anforderungen Ihres Kunden konkret und umfassend analysieren.' },
      ki: {}, check: {}, baseline: null,
      canvasVersions: [],
    };
    for (const c of Object.keys(COLLS)) p[c] = {};
    return p;
  }

  function getPath(doc, key) {
    const [a, b] = key.split('.');
    return b ? (doc[a] || {})[b] : doc[a];
  }
  function setPath(doc, key, v) {
    const [a, b] = key.split('.');
    if (b) { doc[a] = doc[a] || {}; doc[a][b] = v; } else doc[a] = v;
  }

  function descendants(doc, id) {
    const out = [];
    const walk = (pid) => {
      for (const n of Object.values(doc.psp)) if (n.parent === pid) { out.push(n.id); walk(n.id); }
    };
    walk(id);
    return out;
  }

  /**
   * Wendet eine Operation an. Rückgabe: Liste der tatsächlich angewendeten (bereinigten) Operationen.
   * Operationen: set {key,value} | add {c,row} | upd {c,id,patch} | del {c,id}
   */
  function apply(doc, op) {
    if (!op || typeof op !== 'object') return [];
    if (op.t === 'set') {
      const type = SCALARS[op.key];
      if (!type) return [];
      const v = clean(type, op.value);
      if (v === undefined) return [];
      setPath(doc, op.key, v);
      return [{ t: 'set', key: op.key, value: v }];
    }
    const c = op.c;
    if (!COLLS[c]) return [];
    doc[c] = doc[c] || {};
    if (op.t === 'add') {
      const row = op.row || {};
      if (!ID_RE.test(row.id) || doc[c][row.id]) return [];
      if (Object.keys(doc[c]).length >= 2000) return [];
      const clean = cleanFields(c, row);
      clean.id = row.id;
      if (c === 'psp' && clean.parent && !doc.psp[clean.parent]) clean.parent = null;
      doc[c][row.id] = clean;
      return [{ t: 'add', c, row: clean }];
    }
    if (op.t === 'upd') {
      const row = doc[c][op.id];
      if (!row) return [];
      const patch = cleanFields(c, op.patch);
      if (c === 'psp' && 'parent' in patch) {
        // keine Zyklen, nur vorhandene Eltern
        if (patch.parent && (!doc.psp[patch.parent] || patch.parent === op.id || descendants(doc, op.id).includes(patch.parent))) delete patch.parent;
      }
      if (!Object.keys(patch).length) return [];
      Object.assign(row, patch);
      return [{ t: 'upd', c, id: op.id, patch }];
    }
    if (op.t === 'del') {
      if (!doc[c][op.id]) return [];
      const ids = c === 'psp' ? [op.id].concat(descendants(doc, op.id)) : [op.id];
      for (const id of ids) delete doc[c][id];
      if (c === 'psp') {
        for (const n of Object.values(doc.psp)) {
          if (n.deps && n.deps.some((d) => ids.includes(d))) n.deps = n.deps.filter((d) => !ids.includes(d));
        }
      }
      return [{ t: 'del', c, id: op.id }];
    }
    return [];
  }

  // ---------- Hilfsfunktionen für PSP / Gantt ----------

  /** Baum in Reihenfolge (Tiefensuche) mit Code (1, 1.1, 1.1.1) und Ebene. */
  function pspTree(doc) {
    const byParent = {};
    for (const n of Object.values(doc.psp || {})) {
      const p = n.parent && doc.psp[n.parent] ? n.parent : '';
      (byParent[p] = byParent[p] || []).push(n);
    }
    for (const k in byParent) byParent[k].sort((a, b) => (a.order || 0) - (b.order || 0));
    const out = [];
    const walk = (pid, prefix, level) => {
      (byParent[pid] || []).forEach((n, i) => {
        const code = prefix ? prefix + '.' + (i + 1) : String(i + 1);
        const kids = byParent[n.id] || [];
        out.push({ node: n, code, level, isLeaf: kids.length === 0, children: kids.map((k) => k.id) });
        walk(n.id, code, level + 1);
      });
    };
    walk('', '', 1);
    return out;
  }

  function dayNum(d) { return d ? Math.round(Date.parse(d + 'T00:00:00Z') / 86400000) : null; }
  function numDay(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

  /** Start/Ende inkl. Sammelvorgänge (aus Kindern berechnet). */
  function pspDates(doc) {
    const tree = pspTree(doc);
    const res = {};
    for (let i = tree.length - 1; i >= 0; i--) {
      const t = tree[i];
      if (t.isLeaf) {
        const s = dayNum(t.node.start);
        let e = dayNum(t.node.end);
        if (s !== null && (e === null || e < s)) e = s;
        res[t.node.id] = { s, e: s === null ? null : e };
      } else {
        let s = null, e = null;
        for (const k of t.children) {
          const r = res[k];
          if (r && r.s !== null) { s = s === null ? r.s : Math.min(s, r.s); e = e === null ? r.e : Math.max(e, r.e); }
        }
        res[t.node.id] = { s, e };
      }
    }
    return { tree, dates: res };
  }

  const api = {
    SECTIONS, COLORS, RISIKOARTEN, MASSNAHMENARTEN, QSTUFEN, QBEREICHE, FRAGETYPEN, OSP_TERMINE, COLLS, SCALARS, AREAS, KI_DOCS, areaOf,
    apply, emptyProject, getPath, pspTree, pspDates, dayNum, numDay, ID_RE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ops = api;
})(this);
