/* Journal strings, RU and EN. One dictionary for the journal and the morning briefing:
   every interface string lives here once, as [ru, en].
   I18N.t(key) -> string in the current language (falls back to Russian, then to the key),
   I18N.lang() -> 'ru' | 'en', I18N.set(lang) saves the choice (localStorage 'journal-lang')
   and calls every I18N.on(fn) listener. */
(function(){
  var D={
    'tab.home':['Старт','Start'],
    'tab.plan':['План на день','Day plan'],'tab.plan.s':['план и итог дня','plan and day result'],
    'tab.stats':['Кривая и статистика','Curve and stats'],'tab.stats.s':['винрейт по инструментам','win rate by instrument'],
    'tab.journal':['Журнал','Journal'],'tab.journal.s':['сделки и скриншоты','trades and screenshots'],
    'tab.graph':['Граф','Graph'],'tab.graph.s':['связи инструментов и сделок','links between instruments and trades'],
    'tab.whatif':['А что если…','What if…'],'tab.whatif.s':['симулятор правил','rule simulator'],
    'tab.setups':['Сетапы','Setups'],'tab.setups.s':['свои стратегии и их кривая','your strategies and their curve'],
    'tab.review':['Разбор','Review'],'tab.review.s':['неделя и месяц','week and month'],
    'dock.label':['Разделы журнала','Journal sections'],
    'dock.grip':['Переместить панель: перетащи к любому краю или нажми стрелку','Move the bar: drag it to any edge or press an arrow key'],
    'dock.moved':['Панель закреплена: ','Bar docked: '],
    'look.title':['Оформление','Appearance'],'look.theme':['Тема','Theme'],'look.theme.night':['Чёрная','Black'],'look.theme.paper':['Белая','White'],
    'look.perf':['Режим производительности','Performance mode'],'look.perf.auto':['Авто (рекомендуется)','Auto (recommended)'],'look.perf.on':['Включён: без фона и эффектов','On: no background or effects'],'look.perf.off':['Выключен: все эффекты','Off: all effects'],
    'perf.auto.on':['Включён режим производительности: слабое устройство','Performance mode is on: weak device'],
    'dock.top':['сверху','top'],'dock.bottom':['снизу','bottom'],'dock.left':['слева','left'],'dock.right':['справа','right']
  };
  var lang='ru',subs=[];
  try{var s=localStorage.getItem('journal-lang')||localStorage.getItem('landing-lang');if(s==='en'||s==='ru')lang=s}catch(e){}
  function t(k){var v=D[k];if(!v)return k;return (lang==='en'?v[1]:v[0])||v[0]}
  function set(l){if(l!=='en'&&l!=='ru'||l===lang)return;lang=l;try{localStorage.setItem('journal-lang',l)}catch(e){}document.documentElement.lang=l;subs.forEach(function(f){try{f(l)}catch(e){console.warn(e)}})}
  document.documentElement.lang=lang;
  window.I18N={t:t,set:set,lang:function(){return lang},on:function(f){subs.push(f)},add:function(o){for(var k in o)D[k]=o[k]}};
})();
