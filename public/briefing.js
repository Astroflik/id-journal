/* Вкладка «Брифинг»: утренняя сводка по NQ + экспорт данных для Claude.
   Данные читаются из briefing/latest.json и briefing/history.json (их обновляет запланированная задача).
   Ничего личного в этих файлах быть не должно: репозиторий публичный. */
(() => {
  'use strict';
  const BASE = 'briefing/';
  const W_KEY = 'jbriefw', OPEN_KEY = 'jbriefopen';
  const DIR_RU = { long: 'ЛОНГ', short: 'ШОРТ', neutral: 'НЕЙТРАЛЬНО' };
  const CONF_RU = { low: 'низкая', medium: 'средняя', high: 'высокая' };

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const kyivToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
  const fmtTime = iso => {
    try { return new Date(iso).toLocaleString('ru', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso || ''; }
  };
  const getJSON = async name => {
    const r = await fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ': ' + r.status);
    return r.json();
  };
  const section = (root, title) => { root.append(h('h4', null, title)); };
  const list = (root, items) => {
    if (!Array.isArray(items) || !items.length) return;
    const ul = h('ul');
    items.forEach(t => ul.append(h('li', null, typeof t === 'string' ? t : (t.title ? t.title + ': ' : '') + (t.text || ''))));
    root.append(ul);
  };

  function renderScoreboard(root, history) {
    if (!Array.isArray(history) || !history.length) return;
    const done = history.filter(x => x.result === 'hit' || x.result === 'miss' || x.result === 'partial');
    if (!done.length) return;
    const score = done.reduce((s, x) => s + (x.result === 'hit' ? 1 : x.result === 'partial' ? 0.5 : 0), 0);
    section(root, 'Табло точности');
    const box = h('div', 'bc');
    box.append(h('p', null, 'Засчитано ' + score + ' из ' + done.length + ' (' + Math.round(score / done.length * 100) + '%). Частично верный наклон считается за 0,5.'));
    const dots = h('div', 'dots');
    history.slice(-20).forEach(x => {
      const d = h('span', 'dot ' + (x.result || ''));
      d.title = x.date + ' · ' + (DIR_RU[x.bias] || x.bias || '') + (x.note ? ' · ' + x.note : '');
      dots.append(d);
    });
    box.append(dots);
    root.append(box);
  }

  function renderBriefing(root, b, history) {
    root.replaceChildren();
    if (!b || !b.date) {
      root.append(h('p', 'mu', 'Сводки пока нет. Она появится здесь, когда ты ответишь «да» на вопрос «торгуешь сегодня?».'));
      renderScoreboard(root, history);
      return;
    }
    if (b.date !== kyivToday()) root.append(h('div', 'warn', 'Это сводка за ' + b.date + ', на сегодня ещё не готова.'));
    root.append(h('div', 'mu', (b.instrument || 'NQ') + ' · обновлено ' + fmtTime(b.updatedAt)));

    if (b.bias) {
      const row = h('div', 'bias');
      row.append(h('span', 'chip ' + (b.bias.dir || 'neutral'), DIR_RU[b.bias.dir] || 'НЕЙТРАЛЬНО'));
      row.append(h('span', 'mu', 'уверенность: ' + (CONF_RU[b.bias.confidence] || b.bias.confidence || '—')));
      root.append(row);
      if (b.bias.summary) root.append(h('p', null, b.bias.summary));
      root.append(h('p', 'mu', 'Это вероятностный наклон, а не прогноз. Вход решает твой order flow.'));
    }
    if (b.recap) { section(root, 'Разбор вчерашнего дня'); root.append(h('p', null, b.recap.text || '')); }
    if (b.why && b.why.length) { section(root, 'Почему так'); list(root, b.why); }
    if (b.confirm && b.confirm.length) { section(root, 'Что подтвердит сценарий'); list(root, b.confirm); }
    if (b.invalidate && b.invalidate.length) { section(root, 'Что его сломает'); list(root, b.invalidate); }

    if (b.calendar && b.calendar.length) {
      section(root, 'Календарь дня (Киев)');
      const t = h('table');
      const head = h('tr');
      ['Время', 'Событие', 'Прогноз', 'Факт', 'Реакция NQ'].forEach(x => head.append(h('th', null, x)));
      t.append(head);
      b.calendar.forEach(e => {
        const r = h('tr');
        [e.time, e.event, e.forecast, e.actual, e.reaction].forEach(x => r.append(h('td', null, x == null || x === '' ? '—' : String(x))));
        t.append(r);
      });
      root.append(t);
    }
    if (b.options) {
      section(root, 'Опционы / GEX');
      if (b.options.summary) root.append(h('p', null, b.options.summary));
      list(root, (b.options.levels || []).map(l => ({ title: l.name + (l.price ? ' ' + l.price : ''), text: l.note || '' })));
      if (b.options.explain) root.append(h('p', 'mu', b.options.explain));
      if (b.options.quality) root.append(h('p', 'mu', 'Качество данных: ' + b.options.quality));
    }
    if (b.earnings && b.earnings.length) { section(root, 'Отчёты мегакапов'); list(root, b.earnings.map(e => ({ title: e.company + (e.when ? ' (' + e.when + ')' : ''), text: e.note || '' }))); }
    if (b.risks && b.risks.length) { section(root, 'Риск-флаги'); list(root, b.risks); }
    if (b.weekly) { section(root, 'Обзор недели'); root.append(h('p', null, b.weekly.text || '')); }
    if (b.lesson) { section(root, 'Урок дня'); const c = h('div', 'bc'); c.append(h('b', null, b.lesson.title || '')); c.append(h('p', null, b.lesson.text || '')); root.append(c); }
    renderScoreboard(root, history);
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
    const head = h('div', 'bh'); head.append(h('b', null, '📰 Брифинг · NQ'));
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

    const toggle = h('button', 's', '📰'); toggle.id = 'brief-toggle'; toggle.type = 'button'; toggle.title = 'Брифинг'; toggle.setAttribute('aria-label', 'Открыть брифинг');
    document.body.append(toggle);

    const setW = w => document.documentElement.style.setProperty('--bw', Math.round(w) + 'px');
    const saved = parseInt(localStorage.getItem(W_KEY), 10);
    setW(saved >= 300 && saved <= 720 ? saved : 400);

    let loaded = false;
    const load = async () => {
      body.replaceChildren(h('p', 'mu', 'Загружаю…'));
      let latest = null, history = [];
      try { latest = await getJSON('latest.json'); } catch (e) { latest = null; }
      try { history = await getJSON('history.json'); } catch (e) { history = []; }
      renderBriefing(body, latest, history);
      loaded = true;
    };
    const setOpen = open => {
      document.body.classList.toggle('brief-open', open);
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
