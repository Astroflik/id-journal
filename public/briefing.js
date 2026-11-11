/* Вкладка «Брифинг»: утренняя сводка по NQ + экспорт данных для Claude.
   Данные читаются из briefing/latest.json и briefing/history.json (их обновляет запланированная задача).
   Ничего личного в этих файлах быть не должно: репозиторий публичный. */
(() => {
  'use strict';
  const BASE = '../briefing/';
  const W_KEY = 'jbriefw', OPEN_KEY = 'jbriefopen';

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const kyivToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
  const fmtTime = iso => {
    try { return new Date(iso).toLocaleString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso || ''; }
  };
  const getJSON = async name => {
    const r = await fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ': ' + r.status);
    return r.json();
  };
  const DIR = { long: { t: 'ЛОНГ', i: '▲' }, short: { t: 'ШОРТ', i: '▼' }, neutral: { t: 'НЕЙТРАЛЬНО', i: '◆' } };
  const DIR_RU = { long: 'ЛОНГ', short: 'ШОРТ', neutral: 'НЕЙТРАЛЬНО' };
  const CONF_RU = { low: 'низкая', medium: 'средняя', high: 'высокая' };
  const CONF_N = { low: 1, medium: 2, high: 3 };
  const PENDING = /^(ожидается|ждём|—|-|нет данных|)$/i;

  const stripNum = s => String(s || '').replace(/^\s*\d+[.)]\s*/, '');
  const num = v => {
    if (typeof v === 'number') return v;
    const m = String(v == null ? '' : v).replace(/[\s ,]/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  };
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
  const dateRu = d => {
    try { const t = new Date(d + 'T12:00:00').toLocaleDateString((window.I18N&&I18N.lang()==='en')?'en-GB':'ru', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); }
    catch { return d; }
  };
  const headlineOf = b => {
    if (b.bias && b.bias.headline) return b.bias.headline;
    const s = (b.bias && b.bias.summary) || '';
    const first = s.split(/(?<=[.!?])\s/)[0] || s;
    return first.length > 220 ? first.slice(0, 217) + '…' : first;
  };

  /* сворачиваемая секция; возвращает контейнер для содержимого */
  const sec = (root, id, icon, title, open = true) => {
    const d = h('details', 'bsec'); d.id = 'bs-' + id; if (open) d.open = true;
    const s = h('summary'); s.append(h('span', 'ic', icon), h('span', 't', title));
    const body = h('div', 'sb');
    d.append(s, body); root.append(d);
    return body;
  };

  function renderScoreboard(root, history) {
    const done = (Array.isArray(history) ? history : []).filter(x => x.result === 'hit' || x.result === 'miss' || x.result === 'partial');
    const box = sec(root, 'score', '🎯', 'Табло точности', true);
    if (!done.length) {
      box.append(h('p', 'mu', 'Пока нечего считать. Табло начнётся после первого торгового дня с итогом: я сверяю наклон с тем, что сделал NQ, и учусь на промахах.'));
      return;
    }
    const score = done.reduce((s, x) => s + (x.result === 'hit' ? 1 : x.result === 'partial' ? 0.5 : 0), 0);
    const pct = Math.round(score / done.length * 100);
    const row = h('div', 'score');
    const ring = h('div', 'ring'); ring.style.setProperty('--p', pct + '%'); ring.append(h('span', null, pct + '%'));
    const txt = h('div');
    txt.append(h('b', null, 'Засчитано ' + score + ' из ' + done.length), h('div', 'mu', 'Частично верный наклон = 0,5. Нейтраль в день без движения — тоже верно.'));
    row.append(ring, txt); box.append(row);
    const dots = h('div', 'dots');
    history.slice(-20).forEach(x => {
      const d = h('span', 'dot ' + (x.result || ''));
      d.title = x.date + ' · ' + (DIR_RU[x.bias] || x.bias || '') + (x.note ? ' · ' + x.note : '');
      dots.append(d);
    });
    box.append(dots);
    const lg = h('div', 'legend');
    [['hit', 'верно'], ['partial', 'частично'], ['miss', 'мимо'], ['pending', 'ждём итога']].forEach(([c, t]) => { const i = h('span'); i.append(h('i', 'dot ' + c), document.createTextNode(' ' + t)); lg.append(i); });
    box.append(lg);
  }

  function renderOptions(root, o) {
    const box = sec(root, 'gex', '🧲', 'Опционы / GEX', true);
    const meta = h('div', 'chips');
    if (o.index) meta.append(h('span', 'pill', o.index));
    if (o.asof) meta.append(h('span', 'pill', 'снимок: ' + o.asof));
    if (o.source) meta.append(h('span', 'pill', o.source));
    const q = o.quality_level || (/^\s*(низк|low)/i.test(o.quality || '') ? 'low' : /^\s*(высок|high)/i.test(o.quality || '') ? 'high' : o.quality ? 'medium' : '');
    if (q) meta.append(h('span', 'pill q-' + q, 'качество: ' + ({ low: 'низкое', medium: 'среднее', high: 'хорошее' }[q] || q)));
    if (meta.children.length) box.append(meta);
    if (o.summary) box.append(h('p', null, o.summary));

    const lv = (o.levels || []).map(l => {
      const nm = String(l.name || '');
      const kind = l.kind || (/net/i.test(nm) ? 'net' : /call/i.test(nm) ? 'call' : /put/i.test(nm) ? 'put' : /flip|zero|нулев/i.test(nm) ? 'flip' : /spot|цена/i.test(nm) ? 'spot' : 'other');
      return { ...l, kind, v: num(l.price) };
    });
    const spot = num(o.spot);
    const info = lv.filter(l => l.kind === 'net' || isNaN(l.v));
    const ladder = lv.filter(l => l.kind !== 'net' && !isNaN(l.v));
    if (!isNaN(spot)) ladder.push({ name: o.spot_label || 'Цена сейчас', kind: 'spot', v: spot, price: String(spot), note: '' });
    ladder.sort((a, b) => b.v - a.v);
    if (ladder.length) {
      const lad = h('div', 'ladder');
      ladder.forEach(l => {
        const r = h('div', 'lv k-' + l.kind);
        r.append(h('span', 'nm', String(l.name).replace(/\s*\(не подтверждено\)/i, '')));
        r.append(h('b', 'pr', String(l.price)));
        if (!isNaN(spot) && l.kind !== 'spot') { const d = (l.v - spot) / spot * 100; r.append(h('span', 'ds', (d > 0 ? '+' : '') + d.toFixed(1) + '%')); }
        if (/не подтвержд/i.test(l.name)) r.append(h('span', 'un', '?'));
        if (l.note) r.title = l.note;
        lad.append(r);
        if (l.note) lad.append(h('div', 'lnote', l.note));
      });
      box.append(lad);
    }
    info.forEach(l => box.append(h('div', 'infoln', l.name + ': ' + (l.price || '') + (l.note ? ' — ' + l.note : ''))));
    if (o.explain) { const d = h('details', 'more'); d.append(h('summary', null, 'Как это читать'), h('p', null, o.explain)); box.append(d); }
    if (o.quality) { const d = h('details', 'more'); d.append(h('summary', null, 'Откуда данные и можно ли им верить'), h('p', null, o.quality)); box.append(d); }
  }

  function renderBriefing(root, b, history) {
    root.replaceChildren();
    if (!b || !b.date) {
      const e = h('div', 'empty');
      e.append(h('div', 'big', '📰'), h('b', null, 'Сводки пока нет'), h('p', 'mu', 'Она появится здесь, когда ты ответишь «да» на вопрос «ты за графиками?». Ответишь «нет» — день пропустим, а завтра добавлю разбор вчерашнего.'));
      root.append(e);
      renderScoreboard(root, history);
      return;
    }
    const dir = (b.bias && DIR[b.bias.dir]) ? b.bias.dir : 'neutral';

    if (b.date !== kyivToday()) root.append(h('div', 'warn', 'Это сводка за ' + b.date + ', на сегодня ещё не готова.'));

    /* шапка-карточка */
    const hero = h('div', 'hero d-' + dir);
    const top = h('div', 'htop');
    top.append(h('span', 'hdate', dateRu(b.date)));
    if (b.test) top.append(h('span', 'tag', 'ПРОБНАЯ'));
    top.append(h('span', 'mu', (b.instrument || 'NQ') + ' · ' + fmtTime(b.updatedAt)));
    hero.append(top);
    if (b.bias) {
      const main = h('div', 'hmain');
      main.append(h('div', 'hicon', DIR[dir].i));
      const mid = h('div');
      mid.append(h('div', 'hdir', DIR[dir].t));
      const conf = h('div', 'conf');
      const n = CONF_N[b.bias.confidence] || 0;
      for (let i = 1; i <= 3; i++) conf.append(h('i', i <= n ? 'on' : ''));
      conf.append(h('span', null, 'уверенность: ' + (CONF_RU[b.bias.confidence] || b.bias.confidence || '—')));
      mid.append(conf); main.append(mid); hero.append(main);
      hero.append(h('p', 'tldr', headlineOf(b)));
      if (b.bias.summary && b.bias.summary !== headlineOf(b)) { const d = h('details', 'more'); d.append(h('summary', null, 'Весь контекст'), h('p', null, b.bias.summary)); hero.append(d); }
      hero.append(h('div', 'disc', 'Вероятностный наклон, не прогноз. Вход решает твой order flow.'));
    }
    root.append(hero);

    /* быстрые переходы */
    const nav = h('div', 'qnav');
    const links = [['why', 'Почему'], ['scn', 'Сценарии'], ['cal', 'Календарь'], ['gex', 'GEX'], ['risk', 'Риски'], ['lesson', 'Урок']];
    links.forEach(([id, t]) => {
      const bt = h('button', null, t); bt.type = 'button';
      bt.onclick = () => { const el = root.querySelector('#bs-' + id); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
      nav.append(bt);
    });
    root.append(nav);

    if (b.recap && b.recap.text) { const x = sec(root, 'recap', '↩️', 'Разбор вчерашнего дня'); x.append(h('p', null, b.recap.text)); }

    if (b.why && b.why.length) {
      const x = sec(root, 'why', '🧠', 'Почему так');
      const ol = h('ol', 'chain');
      b.why.forEach((w, i) => {
        const li = h('li');
        li.append(h('span', 'n', String(i + 1)));
        const c = h('div');
        c.append(h('b', null, stripNum(typeof w === 'string' ? '' : w.title)), h('p', null, typeof w === 'string' ? w : (w.text || '')));
        li.append(c); ol.append(li);
      });
      x.append(ol);
    }

    if ((b.confirm && b.confirm.length) || (b.invalidate && b.invalidate.length)) {
      const x = sec(root, 'scn', '🧭', 'Сценарии: что подтвердит и что сломает');
      const mk = (cls, ttl, mark, items) => {
        if (!items || !items.length) return;
        const g = h('div', 'scn ' + cls); g.append(h('div', 'sh', ttl));
        items.forEach(t => { const r = h('div', 'si'); r.append(h('span', 'mk', mark), h('span', null, typeof t === 'string' ? t : (t.text || ''))); g.append(r); });
        x.append(g);
      };
      mk('ok', 'Подтвердит сценарий', '✓', b.confirm);
      mk('no', 'Сломает сценарий', '✕', b.invalidate);
    }

    if (b.calendar && b.calendar.length) {
      const x = sec(root, 'cal', '🗓️', 'Календарь (время по Киеву)');
      b.calendar.forEach(e => {
        const done = e.actual && !PENDING.test(String(e.actual).trim());
        const c = h('div', 'ev' + (done ? ' done' : '') + (e.impact ? ' imp-' + e.impact : ''));
        const hd = h('div', 'eh');
        hd.append(h('span', 'tm', e.time || '—'), h('span', 'en', e.event || ''));
        c.append(hd);
        const g = h('div', 'eg');
        const allEmpty = [e.forecast, e.actual, e.reaction].every(v => v == null || PENDING.test(String(v).trim()));
        if (allEmpty) { c.append(h('div', 'mu', 'Данных пока нет, ждём факт')); x.append(c); return; }
        [['Прогноз', e.forecast], ['Факт', e.actual], ['Реакция NQ', e.reaction]].forEach(([k, v]) => {
          const empty = v == null || PENDING.test(String(v).trim());
          const cell = h('div', 'cell' + (empty ? ' wait' : '') + (k === 'Реакция NQ' ? ' wide' : ''));
          cell.append(h('small', null, k), h('span', null, empty ? (k === 'Прогноз' ? 'нет данных' : 'ждём') : String(v)));
          g.append(cell);
        });
        c.append(g); x.append(c);
      });
    }

    if (b.options) renderOptions(root, b.options);

    if (b.earnings && b.earnings.length) {
      const x = sec(root, 'earn', '🏢', 'Отчёты мегакапов', false);
      b.earnings.forEach(e => {
        const r = h('div', 'er');
        r.append(h('b', 'tk', e.company || ''), h('span', 'mu', e.when || ''));
        if (e.note) r.append(h('p', null, e.note));
        x.append(r);
      });
    }

    if (b.risks && b.risks.length) {
      const x = sec(root, 'risk', '⚠️', 'Риск-флаги');
      b.risks.forEach(t => { const r = h('div', 'rk'); r.append(h('span', 'mk', '!'), h('span', null, typeof t === 'string' ? t : (t.text || ''))); x.append(r); });
    }

    if (b.weekly && b.weekly.text) { const x = sec(root, 'week', '📆', 'Обзор недели'); x.append(h('p', null, b.weekly.text)); }

    if (b.lesson) {
      const x = sec(root, 'lesson', '🎓', 'Урок дня');
      const c = h('div', 'lesson');
      c.append(h('b', null, b.lesson.title || ''), h('p', null, b.lesson.text || ''));
      x.append(c);
    }

    renderScoreboard(root, history);

    if (Array.isArray(b.sources) && b.sources.length) {
      const x = sec(root, 'src', '🔗', 'Источники сегодня', false);
      b.sources.forEach(s => {
        const u = safeUrl(s.url); const r = h('div', 'srcl');
        if (u) { const a = h('a', null, s.name || u); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; r.append(a); } else r.append(h('span', null, s.name || ''));
        if (s.used) r.append(h('span', 'mu', ' — ' + s.used));
        x.append(r);
      });
    }
  }

  async function exportForClaude() {
    const days = parseInt(prompt('За сколько последних дней выгрузить сделки и планы?', '7'), 10);
    if (!days || days < 1) return;
    const withShots = confirm('Добавить скриншоты в файл? OK = да (файл будет больше), Отмена = только текст.');
    const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const inRange = r => !r.date || r.date >= cut;
    const trades = (typeof T !== 'undefined' ? T : []).filter(inRange);
    const plans = (typeof P !== 'undefined' ? P : []).filter(inRange);
    const shots = {};
    if (withShots && typeof SHOTS !== 'undefined') {
      for (const rec of [...trades, ...plans]) for (const s of rec.shots || []) {
        if (s && s.id) { const u = await SHOTS.get(s); if (u) shots[s.id] = u; }
      }
    }
    const payload = { format: 'journal-export-for-claude', version: 1, exportedAt: new Date().toISOString(), fromDate: cut, trades, plans, shots };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const a = h('a'); a.href = url; a.download = 'journal-for-claude-' + kyivToday() + '.json'; a.style.display = 'none';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (typeof toast === 'function') toast('Файл готов: ' + trades.length + ' сделок, ' + plans.length + ' планов. Перетащи его в чат с Claude.');
  }

  function build() {
    if (document.getElementById('brief')) return;
    const panel = h('aside'); panel.id = 'brief'; panel.setAttribute('aria-label', 'Брифинг');
    const grip = h('div'); grip.id = 'brief-grip'; grip.title = 'Потяни, чтобы изменить ширину';
    const head = h('div', 'bh'); head.append(h('b', null, 'Брифинг · NQ'));
    const refresh = h('button', 's', '⟳'); refresh.title = 'Обновить'; refresh.type = 'button';
    const close = h('button', 's', '✕'); close.title = 'Закрыть'; close.type = 'button';
    head.append(refresh, close);
    const body = h('div', 'bb');
    const foot = h('div', 'bf');
    const exp = h('button', 's', '⬇ Экспорт для Claude'); exp.type = 'button';
    exp.onclick = () => exportForClaude().catch(e => typeof toast === 'function' && toast('Не удалось выгрузить: ' + e.message));
    foot.append(exp);
    panel.append(grip, head, body, foot);
    document.body.append(panel);

    const toggle = h('button', 's float brief'); toggle.id = 'brief-toggle';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h12v14H6a2 2 0 0 1-2-2z"/><path d="M16 9h4v8a2 2 0 0 1-2 2h-2"/><path d="M7.5 9h5M7.5 12.5h5M7.5 16h3"/></svg>'; toggle.type = 'button'; toggle.title = 'Брифинг'; toggle.setAttribute('aria-label', 'Открыть брифинг');
    const rail = document.querySelector('.quick-actions'); if (rail) rail.prepend(toggle); else document.body.append(toggle);  // one family of quick buttons

    const setW = w => document.documentElement.style.setProperty('--bw', Math.round(w) + 'px');
    const saved = parseInt(localStorage.getItem(W_KEY), 10);
    setW(saved >= 300 && saved <= 720 ? saved : 400);

    let loaded = false, raw = null;
    // English text of the briefing itself: the agent that writes the JSON may add an "en" object with the same
    // structure (only the fields it translated); in English mode it is merged over the Russian original.
    const merge = (a, b) => { if (Array.isArray(b)) return b; if (b && typeof b === 'object') { const o = Object.assign({}, a); for (const k in b) o[k] = merge(a && a[k], b[k]); return o } return b };
    const localize = b => (b && b.en && window.I18N && I18N.lang() === 'en') ? merge(b, b.en) : b;
    if (window.I18N) I18N.on(() => { if (loaded && raw) renderBriefing(body, localize(raw.latest), raw.history) });
    const load = async () => {
      body.replaceChildren(h('p', 'mu', 'Загружаю…'));
      let latest = null, history = [];
      try { latest = await getJSON('latest.json'); } catch (e) { latest = null; }
      try { history = await getJSON('history.json'); } catch (e) { history = []; }
      raw = { latest, history };
      renderBriefing(body, localize(latest), history);
      loaded = true;
    };
    const setOpen = open => {
      document.body.classList.toggle('brief-open', open);
      toggle.classList.toggle('on', open); toggle.setAttribute('aria-pressed', String(open));
      try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) { /* ignore */ }
      if (open && !loaded) load();
    };
    toggle.onclick = () => setOpen(!document.body.classList.contains('brief-open'));
    close.onclick = () => setOpen(false);
    refresh.onclick = load;
    addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('brief-open') && !document.querySelector('.ov,.shot-lightbox')) setOpen(false); });

    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add('on');
      const move = ev => setW(Math.min(720, Math.max(300, ev.clientX)));
      const up = () => {
        grip.classList.remove('on'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bw'), 10);
        try { localStorage.setItem(W_KEY, String(w)); } catch (err) { /* ignore */ }
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });

    if (localStorage.getItem(OPEN_KEY) === '1' && !document.querySelector('.intro,.start')) setOpen(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
