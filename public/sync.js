/* Live-Synchronisation eines Projekts über WebSocket */
(function () {
  'use strict';

  /**
   * Sync.connect(projectId, handlers)
   * handlers: onInit(doc), onOps(ops), onPeers(peers), onStatus(state, text), onSnapshot(), onGone()
   */
  function connect(projectId, h) {
    const self = { doc: null, me: null, user: null, peers: [] };
    let ws = null;
    let retry = 0;
    let unsent = [];        // noch nicht gesendet (Text wird kurz gesammelt)
    let sentUnconfirmed = []; // gesendet, aber Verbindung evtl. weg
    let timer = null;

    function status(state, text) { if (h.onStatus) h.onStatus(state, text); }

    function open() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws?p=${encodeURIComponent(projectId)}`);
      status('connecting', 'Verbinde ...');
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'init') {
          retry = 0;
          self.doc = msg.doc;
          self.me = msg.you;
          self.user = msg.user;
          self.peers = msg.peers;
          // Änderungen, die während einer Unterbrechung gemacht wurden, erneut anwenden
          const replay = sentUnconfirmed.concat(unsent);
          sentUnconfirmed = []; unsent = [];
          for (const op of replay) { Ops.apply(self.doc, op); unsent.push(op); }
          if (unsent.length) flush();
          status('online', 'Live');
          h.onInit && h.onInit(self.doc);
        } else if (msg.type === 'ops') {
          for (const op of msg.ops) Ops.apply(self.doc, op);
          h.onOps && h.onOps(msg.ops);
        } else if (msg.type === 'peers') {
          self.peers = msg.peers;
          h.onPeers && h.onPeers(self.peers);
        } else if (msg.type === 'snapshot') {
          self.doc.canvasVersions.push(msg.snap);
          h.onSnapshot && h.onSnapshot();
        } else if (msg.type === 'delsnapshot') {
          self.doc.canvasVersions = self.doc.canvasVersions.filter((s) => s.id !== msg.id);
          h.onSnapshot && h.onSnapshot();
        }
      };
      ws.onclose = (ev) => {
        if (ev.code === 4004) { status('error', 'Projekt wurde gelöscht'); h.onGone && h.onGone(); return; }
        if (ev.code === 4001) { location.href = '/login'; return; }
        status('offline', 'Offline - verbinde neu ...');
        // 403 beim Verbindungsaufbau = Sitzung abgelaufen → prüfen
        if (retry > 2) fetch('/api/me').then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
        setTimeout(open, Math.min(10000, 500 * 2 ** retry++));
      };
    }

    function flush() {
      clearTimeout(timer); timer = null;
      if (!unsent.length) return;
      if (!ws || ws.readyState !== 1) return; // wird nach Reconnect gesendet
      ws.send(JSON.stringify({ type: 'ops', ops: unsent }));
      sentUnconfirmed = sentUnconfirmed.concat(unsent);
      unsent = [];
      const check = () => {
        if (!ws || ws.readyState !== 1) return;
        if (ws.bufferedAmount === 0) sentUnconfirmed = []; else setTimeout(check, 200);
      };
      setTimeout(check, 50);
    }

    /** Lokal anwenden und senden. Text-Änderungen (upd/set) werden kurz gesammelt. */
    self.op = function (op) {
      const res = Ops.apply(self.doc, op);
      if (!res.length) return false;
      // gleiche Zeile/Feld zusammenfassen
      const last = unsent[unsent.length - 1];
      if (last && op.t === 'upd' && last.t === 'upd' && last.c === op.c && last.id === op.id) {
        last.patch = Object.assign({}, last.patch, op.patch);
      } else if (last && op.t === 'set' && last.t === 'set' && last.key === op.key) {
        last.value = op.value;
      } else {
        unsent.push(op);
      }
      if (op.t === 'upd' || op.t === 'set') { if (!timer) timer = setTimeout(flush, 300); } else flush();
      return true;
    };
    self.flush = flush;
    self.send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
    self.presence = (focus) => self.send({ type: 'presence', focus });

    window.addEventListener('beforeunload', flush);
    open();
    return self;
  }

  window.Sync = { connect };
})();
