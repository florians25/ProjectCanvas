/* Gemeinsame Hilfsfunktionen für alle Seiten */
(function () {
  'use strict';

  async function api(method, url, body) {
    const res = await fetch('/api' + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401 && !url.startsWith('/login')) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

  const uid = () => {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '');
  const fmtEuro = (n) => (Number.isFinite(n) ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '');
  const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '');

  /** Navigationsleiste oben */
  async function navbar(active, extraHtml) {
    const me = await api('GET', '/me');
    const nav = document.createElement('nav');
    nav.className = 'navbar navbar-expand-md navbar-dark bg-dark d-print-none';
    nav.innerHTML = `
      <div class="container-fluid">
        <a class="navbar-brand" href="/">OSP-Projektmanagement</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav"><span class="navbar-toggler-icon"></span></button>
        <div class="collapse navbar-collapse" id="mainNav">
          <ul class="navbar-nav me-auto">
            <li class="nav-item"><a class="nav-link ${active === 'projects' ? 'active' : ''}" href="/">Projekte</a></li>
            ${me.role === 'admin' ? `<li class="nav-item"><a class="nav-link ${active === 'admin' ? 'active' : ''}" href="/admin">Benutzerverwaltung
              ${me.pending ? `<span class="badge bg-warning text-dark">${me.pending}</span>` : ''}</a></li>` : ''}
          </ul>
          ${extraHtml || ''}
          <ul class="navbar-nav">
            <li class="nav-item"><a class="nav-link ${active === 'account' ? 'active' : ''}" href="/konto">${esc(me.name)}</a></li>
            <li class="nav-item"><a class="nav-link" href="#" id="logoutLink">Abmelden</a></li>
          </ul>
        </div>
      </div>`;
    document.body.prepend(nav);
    nav.querySelector('#logoutLink').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('POST', '/logout');
      location.href = '/login';
    });
    return me;
  }

  /** Inhalt eines Elements als Word-Datei (.doc) herunterladen */
  function downloadWord(filename, title, html) {
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:Arial,sans-serif;font-size:11pt}
table{border-collapse:collapse;width:100%;margin-bottom:12pt}
th,td{border:1px solid #000;padding:4pt;vertical-align:top;text-align:left}
th{background:#e7e6e6}
h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}
.no-word{display:none}
</style></head><body>${html}</body></html>`;
    const blob = new Blob(['﻿', doc], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() + '.doc';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.App = { api, esc, nl2br, uid, navbar, fmtDate, fmtEuro, fmtNum, downloadWord };
})();
