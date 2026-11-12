/* Journal strings, RU and EN. One dictionary for the journal and the morning briefing:
   every interface string lives here once, as [ru, en].
   I18N.t(key) -> string in the current language (falls back to Russian, then to the key),
   I18N.lang() -> 'ru' | 'en', I18N.set(lang) saves the choice (localStorage 'journal-lang')
   and calls every I18N.on(fn) listener. */
(function(){
  var D={
    'tab.home':['Старт','Start'],
    'tab.plan':['План на день','Day plan'],'tab.plan.s':['план и итог дня','plan and day result'],
    'tab.stats':['Статистика','Statistics'],'tab.stats.s':['винрейт по инструментам','win rate by instrument'],
    'tab.journal':['Журнал','Journal'],'tab.journal.s':['сделки и скриншоты','trades and screenshots'],
    'tab.graph':['Граф','Graph'],'tab.graph.s':['связи инструментов и сделок','links between instruments and trades'],
    'tab.whatif':['А что если','What if'],'tab.whatif.s':['симулятор правил','rule simulator'],
    'tab.setups':['Сетапы','Setups'],'tab.setups.s':['свои стратегии и их кривая','your strategies and their curve'],
    'tab.review':['Разбор','Review'],'tab.review.s':['неделя и месяц','week and month'],
    'tab.ach':['Ачивки','Achievements'],'tab.ach.s':['привычки и дисциплина','habits and discipline'],
    'ach.of':['из','of'],'ach.got':['Новая ачивка','New achievement'],'ach.on':['Получена','Earned'],
    'ach.toast.many':['Открыто ачивок: {n}. Они на вкладке «Ачивки».','Achievements unlocked: {n}. See the Achievements tab.'],
    'ach.r1':['Обычная','Common'],'ach.r2':['Необычная','Uncommon'],'ach.r3':['Редкая','Rare'],'ach.r4':['Эпическая','Epic'],'ach.r5':['Легендарная','Legendary'],
    'ach.all':['Все','All'],'ach.f.got':['Полученные','Earned'],'ach.f.todo':['В процессе','In progress'],
    'ach.g.journal':['Журнал','Journal'],'ach.g.streak':['Постоянство','Consistency'],'ach.g.plan':['План дня','Day plan'],
    'ach.g.trade':['Разбор сделок','Trade review'],'ach.g.mind':['Состояние и риск','State and risk'],'ach.g.review':['Разбор недели и месяца','Week and month review'],'ach.g.brief':['Сводка и мастерство','Briefing and mastery'],
    'ach.show':['Витрина профиля','Profile showcase'],'ach.slot':['пусто','empty'],
    'ach.show.on':['До 6 ачивок. Их видят те, кому открыт ваш профиль.','Up to 6 achievements. Whoever can see your profile sees them.'],
    'ach.show.off':['До 6 ачивок. Пока витрину видите только вы: показ в профиле включится после обновления сервера.','Up to 6 achievements. For now only you see the showcase: showing it on your profile turns on after a server update.'],
    'ach.pin':['На витрину','Pin'],'ach.unpin':['Убрать с витрины','Unpin'],'ach.pin.full':['На витрине уже 6 ачивок. Уберите одну, чтобы добавить другую.','The showcase already has 6. Unpin one to add another.'],
    'ach.none':['Под этот фильтр ничего не подходит.','Nothing matches this filter.'],
    'ach.note':['Ачивки дают за привычки: план, разбор, скриншоты, ровный риск. Не за прибыль и не за количество сделок.','Achievements reward habits: plans, reviews, screenshots, steady risk. Never profit or the number of trades.'],
    'dock.label':['Разделы журнала','Journal sections'],
    'dock.grip':['Переместить панель: перетащи к любому краю или нажми стрелку','Move the bar: drag it to any edge or press an arrow key'],
    'dock.moved':['Панель закреплена: ','Bar docked: '],
    'look.title':['Оформление','Appearance'],'look.theme':['Тема','Theme'],'look.theme.night':['Чёрная','Black'],'look.theme.paper':['Белая','White'],
    'look.perf':['Режим производительности','Performance mode'],'look.perf.auto':['Авто (рекомендуется)','Auto (recommended)'],'look.perf.on':['Включён: без фона и эффектов','On: no background or effects'],'look.perf.off':['Выключен: все эффекты','Off: all effects'],
    'perf.auto.on':['Включён режим производительности: слабое устройство','Performance mode is on: weak device'],
    'dock.top':['сверху','top'],'dock.bottom':['снизу','bottom'],'dock.left':['слева','left'],'dock.right':['справа','right'],
    'tab.account':['Настройка аккаунта','Account settings'],'tab.account.s':['доступ, лимиты, оформление','access, limits, appearance'],
    'st.stats.h':['Кривая и *цифры*','Curve and *numbers*'],'st.review.h':['Разбор недели и *месяца*','Week and month *review*'],
    'st.journal.h':['Каждая сделка *на месте*','Every trade *in place*'],'st.setups.h':['Свои *сетапы*','Your own *setups*'],
    'st.plan.h':['План *на день*','Plan *for the day*'],'st.whatif.h':['А что, *если*','What *if*'],
    'st.account.h':['Аккаунт и *настройки*','Account and *settings*'],'st.graph.h':['Сделки *в объёме*','Trades *in depth*'],
    'st.ach.h':['Привычки и *дисциплина*','Habits and *discipline*'],
    'seg.stats':['Статистика','Statistics'],'seg.review':['Разбор','Review'],'seg.label':['Статистика или разбор','Statistics or review'],
    'hud.view':['Вкладка','Tab'],'hud.alt':['Высота','Height'],'hud.tilt':['Наклон','Tilt'],'hud.pts':['Точек','Points'],'hud.m':[' м',' m'],
    'tb.look':['Оформление','Appearance'],'tb.help':['Как пользоваться','How to use'],'tb.motion':['Анимации: включить или выключить','Animations: on or off'],
    'acc.access':['Доступ','Access'],'acc.access.guest':['Без аккаунта: данные хранятся только в этом браузере','No account: data stays in this browser only'],
    'acc.sign':['Вход и выход','Sign in and out'],'acc.sign.in':['Войти через Google','Sign in with Google'],'acc.sign.out':['Профиль и выход','Profile and sign out'],
    'acc.sign.p':['Аккаунт синхронизирует журнал между устройствами.','An account syncs the journal across devices.'],
    'acc.limits':['Лимиты счетов','Account limits'],'acc.limits.p':['Баланс, дневная и общая просадка, цель по каждому счёту.','Balance, daily and total drawdown, target for each account.'],'acc.limits.b':['Настроить лимиты','Set limits'],
    'acc.fields':['Триггеры и поля','Triggers and fields'],'acc.fields.p':['Свои варианты триггеров и новые поля карточки сделки.','Your own trigger options and new trade card fields.'],'acc.fields.b':['Открыть триггеры и поля','Open triggers and fields'],
    'acc.look':['Оформление','Appearance'],'acc.look.p':['Тема, шрифт, свой фон и положение панели.','Theme, font, custom background and bar position.'],'acc.look.b':['Открыть оформление','Open appearance'],
    'acc.theme':['Тема','Theme'],'acc.theme.paper':['Белая','White'],'acc.theme.night':['Чёрная','Black'],
    'acc.intro':['Интро','Intro'],'acc.intro.p':['Заставка при открытии журнала и короткий гайд.','The opening screen of the journal and a short guide.'],'acc.intro.show':['Показать интро','Show intro'],'acc.intro.guide':['Открыть гайд','Open the guide'],
    'acc.lang':['Язык','Language'],'acc.lang.p':['Интерфейс журнала и утренней сводки.','The journal interface and the morning briefing.'],
    'acc.motion':['Движение и производительность','Motion and performance'],'acc.motion.on':['Анимации','Animations'],'acc.motion.full':['Полное движение','Full motion'],'acc.perf':['Режим производительности','Performance mode'],
    'acc.perf.auto':['Авто','Auto'],'acc.perf.on':['Вкл','On'],'acc.perf.off':['Выкл','Off'],
    'acc.backup':['Резервная копия и импорт','Backup and import'],'acc.backup.p':['Файл JSON со сделками, планами, настройками и скриншотами.','A JSON file with trades, plans, settings and screenshots.'],
    'acc.social':['Профиль и клан','Profile and clan'],'acc.social.p':['Ник, аватар, витрина ачивок, клан и чат.','Nickname, avatar, achievement showcase, clan and chat.'],'acc.social.b':['Открыть профиль','Open profile'],'acc.social.chat':['Чат клана','Clan chat'],
    'acc.policy':['Политика','Policy'],'acc.policy.p':['Как журнал хранит и обрабатывает данные.','How the journal stores and handles data.'],'acc.policy.b':['Политика конфиденциальности','Privacy policy'],
    'acc.admin':['Админ-панель','Admin panel'],'acc.admin.p':['Пользователи, доступ, жалобы и блокировки.','Users, access, reports and bans.'],'acc.admin.b':['Открыть админ-панель','Open the admin panel'],
    'g3.hint':['Крути граф мышью или пальцем в любую сторону, колесо и щипок меняют масштаб. Наведи на NQ или ES, чтобы подсветить сделки; клик по сделке откроет карточку.','Drag the graph in any direction, wheel or pinch to zoom. Hover NQ or ES to highlight its trades; click a trade to open its card.'],
    'g3.x':['X · ширина','X · width'],'g3.y':['Y · высота','Y · height'],'g3.z':['Z · глубина','Z · depth'],'g3.scale':['Масштаб','Scale'],
    'g3.empty':['Пока нет сделок: добавь первую в журнале, и она появится здесь.','No trades yet: add the first one in the journal and it will show up here.'],
    'g3.aria':['Трёхмерный граф сделок. Стрелки вращают, плюс и минус меняют масштаб.','3D graph of trades. Arrow keys rotate, plus and minus zoom.'],'g3.reset':['Сбросить вид','Reset view']
  };
  var lang='ru',subs=[];
  try{var s=localStorage.getItem('journal-lang')||localStorage.getItem('landing-lang');if(s==='en'||s==='ru')lang=s}catch(e){}
  function t(k){var v=D[k];if(!v)return k;return (lang==='en'?v[1]:v[0])||v[0]}
  function set(l){if(l!=='en'&&l!=='ru'||l===lang)return;lang=l;try{localStorage.setItem('journal-lang',l)}catch(e){}document.documentElement.lang=l;subs.forEach(function(f){try{f(l)}catch(e){console.warn(e)}})}
  document.documentElement.lang=lang;
  /* ---------- phrase translation of the rendered page (English mode) ----------
     Russian phrases from lang-en.js are replaced inside text nodes and in placeholder/title/aria-label/alt.
     Whole phrases only (never inside a longer word), longest first. The Russian original is kept per node,
     so switching back restores it and text the app rewrites later is translated again. */
  var PH={},re=null,SRC=new WeakMap(),ATTR=['placeholder','title','aria-label','alt'],CY='А-Яа-яЁё';
  var BS=String.fromCharCode(92);function esc(x){return x.replace(/[^A-Za-z0-9А-Яа-яЁё ]/g,function(c){return BS+c})}
  function build(){var ks=Object.keys(PH).sort(function(a,b){return b.length-a.length});re=ks.length?new RegExp('(?<!['+CY+'])(?:'+ks.map(esc).join('|')+')(?!['+CY+'])','g'):null}
  function tr(x){if(lang!=='en'||!x||!/[А-Яа-яЁё]/.test(x))return x;if(!re)build();return re?x.replace(re,function(m){return PH[m]}):x}
  var SKIP={SCRIPT:1,STYLE:1,TEXTAREA:1,CODE:1,PRE:1};
  function skip(n,isAttr){var e=n.nodeType===1?n:n.parentElement;return !e||(!isAttr&&!!SKIP[e.tagName])||!!(e.closest&&e.closest('[data-i18n-skip]'))}
  function text(n){if(skip(n))return;var rec=SRC.get(n),v=n.nodeValue;
    if(lang==='en'){if(rec&&rec.out===v)return;var o=tr(v);SRC.set(n,{ru:v,out:o});if(o!==v){busy=1;n.nodeValue=o;busy=0}}
    else if(rec){if(n.nodeValue===rec.out){busy=1;n.nodeValue=rec.ru;busy=0}SRC.delete(n)}}
  function attrs(e){if(!e.getAttribute||skip(e,1))return;ATTR.forEach(function(a){var v=e.getAttribute(a);if(v==null)return;var key=SRC.get(e)||{};var rec=key[a];
    if(lang==='en'){if(rec&&rec.out===v)return;var o=tr(v);key[a]={ru:v,out:o};SRC.set(e,key);if(o!==v){busy=1;e.setAttribute(a,o);busy=0}}
    else if(rec){if(v===rec.out){busy=1;e.setAttribute(a,rec.ru);busy=0}delete key[a]}})}
  var busy=0;
  function apply(root){root=root||document.body;if(!root)return;
    if(root.nodeType===3){text(root);return}
    attrs(root);var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT),n;while(n=w.nextNode()){if(n.nodeType===3)text(n);else attrs(n)}}
  var mo=null,pend=0;
  function watch(){if(mo||!window.MutationObserver||!document.body)return;
    mo=new MutationObserver(function(list){if(busy)return;list.forEach(function(m){
      if(m.type==='characterData')text(m.target);else if(m.type==='attributes')attrs(m.target);else m.addedNodes.forEach(function(n){apply(n)})})});
    mo.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTR})}
  function refresh(){if(!document.body)return;watch();apply(document.body);document.title=lang==='en'?tr(document.title):document.title}
  ['alert','confirm','prompt'].forEach(function(f){var o=window[f];if(!o)return;window[f]=function(m){return o.apply(window,[tr(String(m))].concat([].slice.call(arguments,1)))}});
  subs.push(function(){refresh()});
  document.addEventListener('DOMContentLoaded',refresh);if(document.readyState!=='loading')refresh();
  window.I18N={t:t,tr:tr,set:set,lang:function(){return lang},on:function(f){subs.push(f)},add:function(o){for(var k in o)D[k]=o[k]},
    phrases:function(o){for(var k in o)PH[k]=o[k];re=null;if(lang==='en')refresh()},apply:apply};
})();
