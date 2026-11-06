/* Hell/Dunkel: vor dem Rendern setzen, damit nichts aufblitzt. Einstellung: light | dark | auto */
(function () {
  'use strict';
  const KEY = 'osp.theme';
  const get = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; } };
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function apply(pref) {
    const t = pref === 'auto' ? (mq.matches ? 'dark' : 'light') : pref;
    document.documentElement.setAttribute('data-bs-theme', t);
  }
  apply(get());
  mq.addEventListener('change', () => { if (get() === 'auto') apply('auto'); });
  window.Theme = {
    get,
    set(pref) { try { localStorage.setItem(KEY, pref); } catch {} apply(pref); document.dispatchEvent(new CustomEvent('themechange')); },
    /** Umschalter als HTML (Bootstrap-Dropdown) */
    menuHtml(cls = '') {
      const cur = get();
      const item = (v, l) => `<li><button class="dropdown-item ${cur === v ? 'active' : ''}" data-theme-set="${v}">${l}</button></li>`;
      return `<div class="dropdown ${cls}"><button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown" type="button">Darstellung</button>
        <ul class="dropdown-menu dropdown-menu-end">${item('light', 'Hell')}${item('dark', 'Dunkel')}${item('auto', 'Wie System')}</ul></div>`;
    },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    window.Theme.set(b.dataset.themeSet);
    (b.closest('.dropdown-menu, .btn-group') || document).querySelectorAll('[data-theme-set]').forEach((x) => x.classList.toggle('active', x === b));
  });
})();
