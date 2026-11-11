/* RU/EN switch for the landing page. Russian stays in the markup; English is looked up by the exact
   Russian text. The choice is stored under "landing-lang" (shared with privacy.html). */
(function () {
  'use strict';
  var D = document, W = window, K = 'landing-lang';
  var P = [
    ['Слои', 'Layers'], ['Разбор', 'Review'], ['Возможности', 'Features'], ['Конфиденциальность', 'Privacy'], ['Войти', 'Sign in'],
    ['Открыть журнал', 'Open journal'], ['Журнал сделок для order flow', 'Trade journal for order flow'],
    ['Каждая сделка. <em>Весь</em> контекст.', 'Every trade. <em>Full</em> context.'],
    ['Журнал для трейдера order flow: риск в процентах от баланса, разбор по триггерам и сетапам, синхронизация между устройствами.', 'A journal for order flow traders: risk as a percent of balance, review by triggers and setups, sync across devices.'],
    ['Войти через Google', 'Sign in with Google'], ['14 дней бесплатно, без карты', '14 days free, no card'],
    ['Листайте: камера полетит сквозь сцену', 'Scroll: the camera flies through the scene'], ['Изолинии · шаг 1/6 R', 'Contours · 1/6 R step'],
    ['01 / Три слоя', '01 / Three layers'], ['Одна сделка — <em>три</em> слоя.', 'One trade, <em>three</em> layers.'],
    ['Каждая запись в журнале разбирается по трём слоям. Переключайте их, и сцена за этим текстом перестроится.', 'Every journal entry is read through three layers. Switch them and the scene behind this text rebuilds.'],
    ['Сделки', 'Trades'], ['журнал', 'journal'], ['Вход, выход, скриншоты, заметки и оценка. Поиск и фильтры по любому полю.', 'Entry, exit, screenshots, notes and grade. Search and filters on any field.'],
    ['Риск', 'Risk'], ['% от баланса', '% of balance'], ['Результат в R и в процентах от счёта. Кривая и просадка считаются сами.', 'Result in R and as a percent of the account. Equity curve and drawdown are computed for you.'],
    ['Триггеры', 'Triggers'], ['Срезы по каждому полю показывают, какие сетапы приносят R, а какие съедают депозит.', 'Breakdowns by every field show which setups earn R and which eat the deposit.'],
    ['02 / Разбор', '02 / Review'], ['Неделя сделок — <em>одним</em> взглядом.', 'A week of trades, <em>at</em> a glance.'],
    ['Кривая, календарь, разбор недели и месяца. Видно, где вы торговали по системе, а где по эмоциям.', 'Equity curve, calendar, weekly and monthly review. See where you traded your system and where you traded emotions.'],
    ['кривая и просадка', 'curve and drawdown'], ['риск от счёта', 'risk of account'], ['оценка сделки', 'trade grade'],
    ['03 / Везде', '03 / Everywhere'], ['Один журнал на <em>всех</em> устройствах.', 'One journal on <em>every</em> device.'],
    ['Записали сделку с компьютера, открыли разбор с телефона. Данные хранятся в вашем аккаунте и синхронизируются сами.', 'Log a trade on your computer, open the review on your phone. Your data lives in your account and syncs by itself.'],
    ['Начать бесплатно', 'Start free'], ['04 / Возможности', '04 / Features'], ['Всё, что нужно после торгового дня', 'Everything you need after the trading day'],
    ['План на день', 'Daily plan'], ['План до открытия и итог после закрытия. Видно, сбылся ли сценарий.', 'A plan before the open and a result after the close. See whether the scenario played out.'],
    ['А что если…', 'What if…'], ['Симулятор правил: что было бы с кривой без худших сетапов или с другим риском.', 'Rule simulator: what your curve would look like without the worst setups or with different risk.'],
    ['Свои сетапы', 'Your setups'], ['Соберите стратегию из полей журнала и смотрите её отдельную кривую.', 'Build a strategy from journal fields and watch its own equity curve.'],
    ['Импорт ATAS и MT5', 'ATAS and MT5 import'], ['Сделки из торговых платформ без ручного ввода. Скоро.', 'Trades from trading platforms without manual entry. Coming soon.'],
    ['05 / Старт', '05 / Start'], ['14 дней бесплатно, <em>без</em> карты', '14 days free, <em>no</em> card'],
    ['Войдите через Google, и журнал откроется сразу. Данные только ваши и доступны с любого устройства.', 'Sign in with Google and the journal opens right away. Your data is yours alone and available on any device.'],
    ['Journal by myIDgod использует вход через Google только чтобы определить ваш аккаунт: из данных Google сервис получает адрес почты и внутренний идентификатор. Эти данные нужны для входа, синхронизации журнала и защиты пробного периода, их не продают и не передают рекламным сетям. Подробности в <a href="privacy.html">политике конфиденциальности</a>.', 'Journal by myIDgod uses Google sign-in only to identify your account: from Google data the service receives your email address and an internal identifier. They are needed for sign-in, journal sync and trial protection, and are never sold or passed to ad networks. Details are in the <a href="privacy.html">privacy policy</a>.'],
    ['Политика конфиденциальности', 'Privacy policy'], ['Вид', 'View'], ['Высота', 'Altitude'], ['Наклон', 'Tilt'], ['Точек', 'Points'],
    ['Сделка #0417 · A+', 'Trade #0417 · A+'], ['NQ · СТОП', 'NQ · STOP'], ['Слой сделок', 'Trades layer'], ['Слой риска', 'Risk layer'], ['Слой триггеров', 'Triggers layer'],
    ['ИТОГ НЕДЕЛИ', 'WEEK TOTAL'], ['+7.4R · 9 сделок', '+7.4R · 9 trades'], ['Пик', 'Peak'], ['Звук', 'Sound'], ['Журнал Journal by myIDgod, на главную', 'Journal by myIDgod, home']
  ];
  var EN = {}, RU = {}; P.forEach(function (p) { EN[p[0]] = p[1]; RU[p[1]] = p[0]; });
  var VIEWS = { ru: ['ПИК', 'СВЕЧИ', 'ПОТОК', 'ОРБИТА'], en: ['PEAK', 'CANDLES', 'FLOW', 'ORBIT'] };
  var META = { ru: ['Journal by myIDgod — журнал сделок для order flow', 'Journal by myIDgod — онлайн-журнал сделок для трейдеров order flow: риск в процентах от баланса, разбор по триггерам, синхронизация между устройствами. 14 дней бесплатно, без карты.'],
    en: ['Journal by myIDgod — trade journal for order flow', 'Journal by myIDgod is an online trade journal for order flow traders: risk as a percent of balance, review by triggers, sync across devices. 14 days free, no card.'] };
  var cur = 'ru';
  function tr(s, map) { var t = s.trim(); if (!t || !map[t]) return null; return s.replace(t, map[t]); }
  function apply(lang) {
    var map = lang === 'en' ? EN : RU;
    var els = D.body.querySelectorAll('h1,h2,p,footer p');
    els.forEach(function (e) { var raw = e.dataset.raw != null, h = (raw ? e.dataset.raw : e.innerHTML).trim(); if (map[h] == null) return; if (raw) e.dataset.raw = map[h]; else if (/<em>|<a /.test(h + map[h])) e.innerHTML = map[h]; });
    var w = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = w.nextNode())) { if (n.parentNode.closest('script,style,[data-raw]')) continue; list.push(n); }
    list.forEach(function (n) { var r = tr(n.nodeValue, map); if (r != null) n.nodeValue = r; });
    D.querySelectorAll('[aria-label]').forEach(function (e) { var r = tr(e.getAttribute('aria-label'), map); if (r != null) e.setAttribute('aria-label', r); });
    D.documentElement.lang = lang; D.documentElement.dataset.lang = lang;
    D.title = META[lang][0]; var m = D.querySelector('meta[name=description]'); if (m) m.content = META[lang][1];
    W.LANDING_VIEW = VIEWS[lang]; W.LANDING_UNIT = lang === 'en' ? ' m' : ' М';
    D.querySelectorAll('[data-lang-btn]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.langBtn === lang); });
    cur = lang; W.dispatchEvent(new Event('landing:lang'));
  }
  function set(lang) { try { localStorage.setItem(K, lang); } catch (e) {} if (lang !== cur) apply(lang); }
  var saved = null; try { saved = localStorage.getItem(K); } catch (e) {}
  if (saved !== 'ru' && saved !== 'en') saved = /^(ru|uk|be)/i.test(navigator.language || '') ? 'ru' : 'en';
  W.LANDING_VIEW = VIEWS.ru; W.LANDING_UNIT = ' М';
  D.querySelectorAll('[data-lang-btn]').forEach(function (b) { b.addEventListener('click', function () { set(b.dataset.langBtn); }); });
  if (saved === 'en') apply('en'); else D.querySelectorAll('[data-lang-btn]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.langBtn === 'ru'); });
})();
