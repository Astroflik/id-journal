/* Journal shell: the header pill, station headings, the account station, the Stats | Review switch,
   the HUD and the widget motion. View only: no journal logic, data or sync lives here.
   Loaded before ../app.js; every function runs later, called by app.js, and uses its globals
   (el, $, view, go, render, CFG, applyLook, saveCfgD, motion, perfOn, modal, toast, accountApi, quickActions, xb). */
(function () {
  'use strict';
  var D = document, W = window;
  var KEYS = ['stats', 'journal', 'setups', 'plan', 'whatif', 'account', 'graph', 'ach'];
  var ICONS = { stats: '📈', journal: '📓', setups: '🎯', plan: '📅', whatif: '🧪', account: '⚙', graph: '🕸', ach: '🏆' };
  function t(k) { return W.I18N ? I18N.t(k) : k; }
  function station(v) { return v === 'home' || v === 'review' ? 'stats' : KEYS.indexOf(v) < 0 ? 'stats' : v; }
  function num(k) { var i = KEYS.indexOf(k) + 1; return (i < 10 ? '0' : '') + i; }
  function rich(node, text) {                       // "Кривая и *цифры*" → text + <em>
    String(text).split('*').forEach(function (part, i) { if (!part) return; if (i % 2) { var e = D.createElement('em'); e.textContent = part; node.append(e); } else node.append(part); });
  }

  /* ---- station heading: «02 / СТАТИСТИКА» + a large heading with an italic word ---- */
  function head(v) {
    if (!v || v.querySelector(':scope>.st-head')) return;
    var k = station(view), h = el('header', 'st-head'), lab = el('div', 'k mono', num(k) + ' / ' + t('tab.' + k)), h2 = el('h2');
    rich(h2, t('st.' + (view === 'review' ? 'review' : k) + '.h')); h.append(lab, h2);
    if (k === 'stats') {
      var seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', t('seg.label'));
      [['stats', 'seg.stats'], ['review', 'seg.review']].forEach(function (p) {
        var b = el('button', null, t(p[1])), on = (view === 'review') === (p[0] === 'review'); b.type = 'button'; b.dataset.seg = p[0]; b.setAttribute('aria-pressed', String(on));
        b.onclick = function () { if (!on) go(p[0]); }; seg.append(b);
      });
      h.append(seg);
    }
    v.prepend(h);
  }

  /* ---- account station: every setting in one place, each card calls the function the journal already has ---- */
  function card(grid, n, title, text) {
    var c = el('section', 'card'); c.append(el('span', 'k mono', n), el('b', null, title)); if (text) c.append(el('p', null, text)); grid.append(c); return c;
  }
  function btn(cls, label, fn) { var b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; }
  function bar(c) { var b = el('div', 'bar'); for (var i = 1; i < arguments.length; i++) if (arguments[i]) b.append(arguments[i]); c.append(b); return b; }
  function row(c, label, control) { var r = el('div', 'row'); r.append(el('span', null, label), control); c.append(r); return r; }
  function sw(on, label, fn) {
    var b = el('button', 'sw'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!on)); b.setAttribute('aria-label', label);
    b.onclick = function () { fn(b.getAttribute('aria-checked') !== 'true'); }; return b;
  }
  function seg(label, options, cur, fn) {
    var s = el('div', 'seg'); s.style.margin = '0'; s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var b = el('button', null, o[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(o[0] === cur)); b.onclick = function () { if (o[0] !== cur) fn(o[0]); }; s.append(b); });
    return s;
  }
  function setLook(k, val) { CFG.look = Object.assign({}, CFG.look || {}, (function () { var o = {}; o[k] = val; return o; })()); applyLook(); saveCfgD(); render(); }
  function account(v) {
    var g = el('div', 'acc-grid'), A = accountApi, n = 0, id = function () { n++; return (n < 10 ? '0' : '') + n; }, c;
    // access / subscription
    c = card(g, id(), t('acc.access'), A.user ? (A.accessText() || '') : t('acc.access.guest'));
    if (A.user && A.readOnly) c.append(el('p', null, A.reasonText()));
    // sign in / out
    c = card(g, id(), t('acc.sign'), t('acc.sign.p'));
    if (A.user) { c.append(el('p', 'mono', A.user.email)); bar(c, btn('s', t('acc.sign.out'), function () { A.openProfile(); })); }
    else bar(c, btn('p', t('acc.sign.in'), function () { A.openAuth('login'); }));
    // limits
    c = card(g, id(), t('acc.limits'), t('acc.limits.p')); bar(c, btn('s', t('acc.limits.b'), function () { limits2(); }));
    // triggers and fields
    c = card(g, id(), t('acc.fields'), t('acc.fields.p')); bar(c, btn('s', t('acc.fields.b'), function () { fieldsForm(); }));
    // appearance
    c = card(g, id(), t('acc.look'), t('acc.look.p'));
    row(c, t('acc.theme'), seg(t('acc.theme'), [['paper', t('acc.theme.paper')], ['night', t('acc.theme.night')]], (W.LOOK || {}).style === 'night' ? 'night' : 'paper', function (x) { setLook('style', x); }));
    bar(c, btn('s', t('acc.look.b'), function () { lookForm2(); }));
    // intro
    c = card(g, id(), t('acc.intro'), t('acc.intro.p'));
    bar(c, btn('s', t('acc.intro.show'), function () { D.body.classList.add('pre'); intro(); }), btn('s', t('acc.intro.guide'), function () { guide(null); }));
    // language
    c = card(g, id(), t('acc.lang'), t('acc.lang.p'));
    if (W.I18N) row(c, t('acc.lang'), seg(t('acc.lang'), [['ru', 'RU'], ['en', 'EN']], I18N.lang(), function (x) { I18N.set(x); }));
    // motion and performance
    c = card(g, id(), t('acc.motion'));
    var mo = motion();
    row(c, t('acc.motion.on'), sw(mo !== 'off', t('acc.motion.on'), function (on) { var L = Object.assign({}, CFG.look || {}); if (on) L.motion = L.motionPrev && L.motionPrev !== 'off' ? L.motionPrev : 'light'; else { L.motionPrev = mo; L.motion = 'off'; } CFG.look = L; applyLook(); saveCfgD(); render(); }));
    row(c, t('acc.motion.full'), sw(mo === 'full', t('acc.motion.full'), function (on) { setLook('motion', on ? 'full' : 'light'); }));
    row(c, t('acc.perf'), seg(t('acc.perf'), [['auto', t('acc.perf.auto')], ['on', t('acc.perf.on')], ['off', t('acc.perf.off')]], (CFG.look || {}).perf || 'auto', function (x) { setLook('perf', x); }));
    // backup and import: the journal's own buttons, moved here
    c = card(g, id(), t('acc.backup'), t('acc.backup.p')); if (typeof xb !== 'undefined' && xb) c.append(xb);
    // profile and clan
    if (W.SOCIAL) { c = card(g, id(), t('acc.social'), t('acc.social.p')); bar(c, btn('s', t('acc.social.b'), function () { SOCIAL.open(); }), btn('s', t('acc.social.chat'), function () { SOCIAL.toggleChat(); })); }
    // policy
    c = card(g, id(), t('acc.policy'), t('acc.policy.p'));
    var a = el('a', null, t('acc.policy.b')); a.href = '../privacy.html'; a.target = '_blank'; a.rel = 'noopener'; c.append(a);
    // admin panel
    if (A.access && A.access.status === 'admin') { c = card(g, id(), t('acc.admin'), t('acc.admin.p')); bar(c, btn('p', t('acc.admin.b'), function () { A.openAdmin(); })); }
    v.append(g);
  }

  /* ---- header: logo + tabs + round buttons in one pill ---- */
  function header() {
    var top = $('#top'); if (!top || top._sh) return top; top._sh = 1;
    if (typeof quickActions !== 'undefined') top.append(quickActions);
    var g = el('button', 'dock-grip'); g.type = 'button';
    g.innerHTML = '<svg viewBox="0 0 12 18" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="3" cy="15" r="1.4"/><circle cx="9" cy="15" r="1.4"/></g></svg>';
    top.prepend(g);
    var ttl = $('#ttl'); if (ttl) { ttl.tabIndex = 0; ttl.setAttribute('role', 'link'); ttl.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ttl.click(); } }); }
    labels(); return top;
  }
  function labels() {
    var top = $('#top'); if (!top) return;
    var g = top.querySelector('.dock-grip'); if (g) { g.title = t('dock.grip'); g.setAttribute('aria-label', t('dock.grip')); }
    var nav = $('#nav'); if (nav) { nav.setAttribute('role', 'navigation'); nav.setAttribute('aria-label', t('dock.label')); }
    [['.float.look', 'tb.look'], ['.float.h', 'tb.help'], ['.float.mt', 'tb.motion']].forEach(function (p) { var b = top.querySelector(p[0]); if (b) { b.title = t(p[1]); b.setAttribute('aria-label', t(p[1])); } });
    var ban = top.querySelector('.acc-banner'), main = $('main'); if (ban && main) main.prepend(ban);   // the access note sits above the station, not inside the pill
    var hud = $('#hud'); if (hud) hud.querySelectorAll('[data-t]').forEach(function (s) { s.textContent = t(s.dataset.t); });
  }

  /* ---- widget motion at rest: arrive one by one, then drift a pixel or two ---- */
  var inT = 0, driftT = 0;
  function calm() { var v = $('#v'); if (v) v.classList.remove('v-in', 'v-land', 'v-arr'); clearTimeout(inT); clearTimeout(driftT); }
  function index(v) {
    var list = [], Z = [-70, 40, -20, 80];          // widgets: children of the tab, or of a bare wrapper div inside it
    [].forEach.call(v.children, function (c) { if (c.tagName === 'DIV' && !c.hasAttribute('class')) [].push.apply(list, c.children); else list.push(c); });
    list.forEach(function (c, i) { c.style.setProperty('--wi', Math.min(i, 12)); c.style.setProperty('--wz', Z[i % 4]); });
    v.querySelectorAll('.tiles').forEach(function (g) { [].forEach.call(g.children, function (c, j) { c.style.setProperty('--ti', Math.min(j, 10)); }); });
  }
  function drift() { }                           // the drift is plain CSS: it runs whenever the tab is at rest (see shell.css)
  function arrive(v, animate) {
    calm(); index(v);
    if (motion() === 'off' || perfOn() || (W.World && World.flying())) return;
    if (!animate) { v.classList.add('v-land'); driftT = setTimeout(function () { v.classList.remove('v-land'); }, 1500); return; }   // landed after a flight: only the chart lines draw
    void v.offsetWidth; v.classList.add('v-in');
    inT = setTimeout(function () { v.classList.remove('v-in'); }, 1100 + Math.min(v.children.length, 12) * 75);
  }

  W.Shell = { KEYS: KEYS, ICONS: ICONS, station: station, head: head, account: account, header: header, labels: labels, arrive: arrive, calm: calm, drift: drift, index: index };
})();
