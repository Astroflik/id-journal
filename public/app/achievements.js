/* Achievements: one config, computed from the journal data on this device.
   Every achievement rewards the PROCESS (keeping the journal, plans, reviews, screenshots, state,
   steady risk, stopping in time, reading the briefing), never profit or the number of trades,
   so nothing here pushes towards overtrading.

   Config entry: { id, r: rarity 1..5, g: group, icon, ru: [name, description], en: [...], goal, v: data => progress }
   Earned ids and dates live in CFG.ach.got (synced with the account like other settings);
   pinned ids (up to 6) in CFG.ach.pin; days the briefing was opened in CFG.ach.brief.
   Showing pins to other people needs migration 0005 (profiles.pinned_achievements): until it is
   applied the server profile has no "achievements" field and the showcase stays private.
   Uses the journal globals from app.js: T, P, CFG, ready, view, el, today, saveCfg, toast, render, FIELDS, motion. */
(function(){
  'use strict';
  const L=()=>window.I18N?I18N.lang():'ru', tr=k=>window.I18N?I18N.t(k):k;
  const RAR=['','common','uncommon','rare','epic','legendary'];

  // ---------------------------------------------------------------- data helpers
  const has=v=>v!=null&&String(v).trim()!=='';
  const dnum=s=>Date.parse(s+'T00:00:00Z');
  const okDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&isFinite(dnum(s));
  const wday=s=>new Date(dnum(s)).getUTCDay();
  const nextWorkday=s=>{let t=dnum(s);do t+=864e5;while([0,6].includes(new Date(t).getUTCDay()));return new Date(t).toISOString().slice(0,10)};
  // longest run of consecutive weekdays (Mon-Fri) from a set of dates; weekends neither count nor break
  function workStreak(dates){const a=[...new Set(dates.filter(okDate))].filter(d=>![0,6].includes(wday(d))).sort();let best=0,run=0,prev=null;
    a.forEach(d=>{run=prev&&nextWorkday(prev)===d?run+1:1;best=Math.max(best,run);prev=d});return best}
  // longest run of items passing f, in order
  function run(a,f){let best=0,c=0;a.forEach(x=>{c=f(x)?c+1:0;best=Math.max(best,c)});return best}
  // longest run of consecutive weeks / months among review keys
  function keyStreak(keys,step){const a=[...new Set(keys)].sort();let best=0,c=0,prev=null;a.forEach(k=>{c=prev&&step(prev)===k?c+1:1;best=Math.max(best,c);prev=k});return best}
  const nextWeek=k=>new Date(dnum(k)+7*864e5).toISOString().slice(0,10);
  const nextMonth=k=>{let[y,m]=k.split('-').map(Number);m++;if(m>12){m=1;y++}return y+'-'+String(m).padStart(2,'0')};
  const SELECT_FIELDS=()=>(typeof FIELDS!=='undefined'?FIELDS:[]).filter(f=>Array.isArray(f[2])).map(f=>f[0]);
  const CORE=['res','kind','side','time','grade','emo'],FACT=['cvd','tape','poc','zero','ivb','ivbtf','vp','origin','node'];
  const fullCard=t=>CORE.every(k=>has(t[k]))&&FACT.filter(k=>has(t[k])).length>=4;
  const shot=t=>(t.shots||[]).length>0;

  // everything the conditions read, computed once per check
  function facts(){
    const tr=(typeof T!=='undefined'?T:[]).filter(t=>okDate(t.date)).slice().sort((a,b)=>a.date.localeCompare(b.date)||String(a.time||'').localeCompare(String(b.time||''))||String(a.id??'').localeCompare(String(b.id??'')));
    const pl=(typeof P!=='undefined'?P:[]).filter(p=>okDate(p.date));
    const cfg=(typeof CFG!=='undefined'&&CFG)||{},rv=cfg.reviews||{},ach=cfg.ach||{};
    const byDay={};tr.forEach(t=>(byDay[t.date]=byDay[t.date]||[]).push(t));
    const tradeDays=Object.keys(byDay).sort();
    const planned=pl.filter(p=>has(p.plan)),plannedDays=new Set(planned.map(p=>p.date));
    const closed=pl.filter(p=>has(p.done)&&has(p.sum));
    const wk=Object.keys(rv).filter(k=>/^w:/.test(k)&&has(rv[k]&&rv[k].note)).map(k=>k.slice(2)).filter(okDate);
    const mo=Object.keys(rv).filter(k=>/^m:\d{4}-\d{2}$/.test(k)&&has(rv[k]&&rv[k].note)).map(k=>k.slice(2));
    const hidden=new Set(cfg.hiddenFields||[]),sel=SELECT_FIELDS().filter(k=>!hidden.has(k));
    const brief=(ach.brief||[]).filter(okDate);
    return{
      tr,pl,tradeDays,
      allDays:[...new Set(tr.map(t=>t.date).concat(pl.map(p=>p.date)))],
      planTradeDays:tradeDays.filter(d=>plannedDays.has(d)).length,
      planStreak:workStreak([...plannedDays]),
      planClosedStreak:workStreak(closed.filter(p=>has(p.plan)).map(p=>p.date)),
      closed:closed.length,
      honest:closed.filter(p=>p.done==='Частично'||p.done==='Не сбылся').length,
      wk,mo,weekStreak:keyStreak(wk,nextWeek),
      setups:(cfg.setups||[]).length,
      custom:(cfg.custom||[]).length+Object.keys(cfg.opts||{}).length,
      allFields:tr.some(t=>sel.length&&sel.every(k=>has(t[k]))),
      stopDays:tradeDays.filter(d=>{const a=byDay[d];return a.length>=2&&a[a.length-1].res==='Стоп'&&a[a.length-2].res==='Стоп'}).length,
      lightDays:run(tradeDays,d=>byDay[d].length<=3),
      brief:brief.length,briefStreak:workStreak(brief)
    }
  }

  // ---------------------------------------------------------------- the config
  const A=[
    // journal
    {id:'first_entry',r:1,g:'journal',icon:'pen',goal:1,v:f=>f.tr.length+f.pl.length,ru:['Первая запись','Добавьте в журнал первую сделку или план.'],en:['First entry','Add the first trade or plan to the journal.']},
    {id:'first_plan',r:1,g:'journal',icon:'cal',goal:1,v:f=>f.pl.filter(p=>has(p.plan)).length,ru:['План на бумаге','Напишите первый план на день.'],en:['Plan on paper','Write your first day plan.']},
    {id:'first_shot',r:1,g:'journal',icon:'cam',goal:1,v:f=>f.tr.filter(shot).length,ru:['Кадр','Прикрепите скриншот к сделке.'],en:['Snapshot','Attach a screenshot to a trade.']},
    {id:'full_card',r:1,g:'journal',icon:'card',goal:1,v:f=>f.tr.filter(fullCard).length,ru:['Полная карточка','Заполните сделку целиком: результат, тип, направление, время, оценку, состояние и хотя бы 4 фактора.'],en:['Full card','Fill a trade completely: result, type, side, time, grade, state and at least 4 factors.']},
    {id:'first_setup',r:1,g:'journal',icon:'target',goal:1,v:f=>f.setups,ru:['Свой сетап','Сохраните первый сетап.'],en:['Own setup','Save your first setup.']},
    {id:'custom_fields',r:1,g:'journal',icon:'sliders',goal:1,v:f=>f.custom,ru:['Под себя','Добавьте свой триггер или поле.'],en:['Made to fit','Add your own trigger or field.']},
    // consistency
    {id:'streak_3',r:1,g:'streak',icon:'flame',goal:3,v:f=>workStreak(f.allDays),ru:['Три дня подряд','Ведите журнал 3 рабочих дня подряд.'],en:['Three in a row','Keep the journal 3 workdays in a row.']},
    {id:'streak_5',r:2,g:'streak',icon:'flame',goal:5,v:f=>workStreak(f.allDays),ru:['Рабочая неделя','Ведите журнал 5 рабочих дней подряд.'],en:['Full week','Keep the journal 5 workdays in a row.']},
    {id:'streak_10',r:3,g:'streak',icon:'flame',goal:10,v:f=>workStreak(f.allDays),ru:['Две недели без пропуска','10 рабочих дней подряд с записью в журнале.'],en:['Two weeks, no gaps','10 workdays in a row with a journal entry.']},
    {id:'streak_20',r:4,g:'streak',icon:'flame',goal:20,v:f=>workStreak(f.allDays),ru:['Месяц без пропуска','20 рабочих дней подряд с записью в журнале.'],en:['A month, no gaps','20 workdays in a row with a journal entry.']},
    {id:'streak_60',r:5,g:'streak',icon:'peak',goal:60,v:f=>workStreak(f.allDays),ru:['Привычка','60 рабочих дней подряд с записью в журнале.'],en:['Habit','60 workdays in a row with a journal entry.']},
    {id:'days_30',r:2,g:'streak',icon:'stack',goal:30,v:f=>f.allDays.length,ru:['30 дней в журнале','Записи за 30 разных дней.'],en:['30 journal days','Entries on 30 different days.']},
    {id:'days_100',r:4,g:'streak',icon:'stack',goal:100,v:f=>f.allDays.length,ru:['100 дней в журнале','Записи за 100 разных дней.'],en:['100 journal days','Entries on 100 different days.']},
    {id:'days_250',r:5,g:'streak',icon:'peak',goal:250,v:f=>f.allDays.length,ru:['Торговый год','Записи за 250 разных дней — это год рабочих дней.'],en:['Trading year','Entries on 250 different days, a full year of workdays.']},
    // plan
    {id:'plan_trades_5',r:2,g:'plan',icon:'cal',goal:5,v:f=>f.planTradeDays,ru:['Сначала план','5 торговых дней, в которые был написан план.'],en:['Plan first','5 trading days that had a written plan.']},
    {id:'plan_closed_10',r:2,g:'plan',icon:'check',goal:10,v:f=>f.closed,ru:['Итог дня','Закройте 10 планов: отметьте, сбылся ли, и напишите итог.'],en:['Day result','Close 10 plans: mark whether it came true and write the result.']},
    {id:'plan_honest',r:2,g:'plan',icon:'scale',goal:3,v:f=>f.honest,ru:['Честный итог','3 раза честно отметьте «Частично» или «Не сбылся» и разберите почему.'],en:['Honest result','3 times honestly mark “Partly” or “Did not come true” and write why.']},
    {id:'plan_streak_5',r:3,g:'plan',icon:'cal',goal:5,v:f=>f.planStreak,ru:['План каждый день','План 5 рабочих дней подряд.'],en:['A plan every day','A plan 5 workdays in a row.']},
    {id:'plan_streak_20',r:4,g:'plan',icon:'compass',goal:20,v:f=>f.planClosedStreak,ru:['Штурман','20 рабочих дней подряд с планом и итогом дня.'],en:['Navigator','20 workdays in a row with a plan and a day result.']},
    // trade review
    {id:'desc_10',r:2,g:'trade',icon:'search',goal:10,v:f=>f.tr.filter(t=>has(t.desc)&&has(t.grade)).length,ru:['Разбор сделок','10 сделок с описанием и оценкой исполнения.'],en:['Trade review','10 trades with a description and an execution grade.']},
    {id:'shots_10',r:2,g:'trade',icon:'cam',goal:10,v:f=>run(f.tr,shot),ru:['Фотограф','10 сделок подряд со скриншотом.'],en:['Photographer','10 trades in a row with a screenshot.']},
    {id:'shots_30',r:3,g:'trade',icon:'film',goal:30,v:f=>run(f.tr,shot),ru:['Архив','30 сделок подряд со скриншотом.'],en:['Archive','30 trades in a row with a screenshot.']},
    {id:'all_fields',r:3,g:'trade',icon:'layers',goal:1,v:f=>f.allFields?1:0,ru:['Под лупой','Сделка, в которой заполнено каждое поле со списком.'],en:['Under the lens','A trade with every list field filled in.']},
    {id:'full_20',r:4,g:'trade',icon:'card',goal:20,v:f=>run(f.tr,t=>fullCard(t)&&has(t.desc)&&shot(t)),ru:['Педант','20 сделок подряд: полная карточка, описание и скриншот.'],en:['Pedant','20 trades in a row: full card, description and screenshot.']},
    // state and risk
    {id:'emo_10',r:2,g:'mind',icon:'pulse',goal:10,v:f=>run(f.tr,t=>has(t.emo)),ru:['Знаю себя','Отметьте состояние в 10 сделках подряд.'],en:['Self-aware','Mark your state in 10 trades in a row.']},
    {id:'calm_20',r:3,g:'mind',icon:'snow',goal:20,v:f=>run(f.tr,t=>has(t.emo)&&t.emo!=='FOMO'&&t.emo!=='Злость'),ru:['Холодная голова','20 сделок подряд без FOMO и злости (состояние отмечено).'],en:['Cool head','20 trades in a row without FOMO or anger (state marked).']},
    {id:'risk_20',r:3,g:'mind',icon:'ruler',goal:20,v:f=>{let best=0,c=0,prev=null;f.tr.forEach(t=>{const k=has(t.risk)?String(t.risk):null;c=k&&k===prev?c+1:k?1:0;prev=k;best=Math.max(best,c)});return best},ru:['Ровный риск','20 сделок подряд с одним и тем же риском.'],en:['Steady risk','20 trades in a row with the same risk.']},
    {id:'stop_rule_5',r:3,g:'mind',icon:'hand',goal:5,v:f=>f.stopDays,ru:['Вовремя остановиться','5 дней, когда вы закончили торговлю сразу после двух стопов подряд.'],en:['Stop in time','5 days you stopped trading right after two stops in a row.']},
    {id:'light_20',r:4,g:'mind',icon:'gauge',goal:20,v:f=>f.lightDays,ru:['Без перебора','20 торговых дней подряд — не больше 3 сделок в день.'],en:['No overdoing it','20 trading days in a row with no more than 3 trades a day.']},
    // reviews
    {id:'first_review',r:1,g:'review',icon:'mirror',goal:1,v:f=>f.wk.length+f.mo.length,ru:['Взгляд назад','Напишите первый разбор недели или месяца.'],en:['Looking back','Write your first week or month review.']},
    {id:'week_review_4',r:3,g:'review',icon:'mirror',goal:4,v:f=>f.weekStreak,ru:['Четыре недели','Разбор недели 4 недели подряд.'],en:['Four weeks','A week review 4 weeks in a row.']},
    {id:'week_review_12',r:4,g:'review',icon:'mirror',goal:12,v:f=>f.weekStreak,ru:['Квартал разборов','Разбор недели 12 недель подряд.'],en:['Quarter of reviews','A week review 12 weeks in a row.']},
    {id:'month_review_3',r:3,g:'review',icon:'book',goal:3,v:f=>keyStreak(f.mo,nextMonth),ru:['Три месяца','Разбор месяца 3 месяца подряд.'],en:['Three months','A month review 3 months in a row.']},
    {id:'month_review_12',r:5,g:'review',icon:'book',goal:12,v:f=>keyStreak(f.mo,nextMonth),ru:['Год в зеркале','Разбор месяца 12 месяцев подряд.'],en:['A year in the mirror','A month review 12 months in a row.']},
    // briefing
    {id:'brief_1',r:1,g:'brief',icon:'sun',goal:1,v:f=>f.brief,ru:['Утро трейдера','Откройте утреннюю сводку.'],en:['Trader’s morning','Open the morning briefing.']},
    {id:'brief_10',r:2,g:'brief',icon:'sun',goal:10,v:f=>f.brief,ru:['Читаю рынок','Сводка открыта в 10 разных дней.'],en:['Reading the market','Briefing opened on 10 different days.']},
    {id:'brief_streak_5',r:3,g:'brief',icon:'sun',goal:5,v:f=>f.briefStreak,ru:['Ритуал','Сводка 5 рабочих дней подряд.'],en:['Ritual','The briefing 5 workdays in a row.']},
    // all of it
    {id:'master',r:5,g:'brief',icon:'crown',goal:30,v:(f,got)=>Object.keys(got).filter(k=>k!=='master'&&BY[k]).length,ru:['Мастер процесса','Получите 30 других ачивок.'],en:['Master of process','Earn 30 other achievements.']}
  ];
  const BY=Object.fromEntries(A.map(a=>[a.id,a]));
  const GROUPS=['journal','streak','plan','trade','mind','review','brief'];

  // ---------------------------------------------------------------- icons (24px line icons, same style as the journal)
  const IC={
    pen:"<path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/>",
    cal:"<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/>",
    cam:"<path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'/><circle cx='12' cy='13' r='4'/>",
    card:"<rect x='3' y='3' width='18' height='18' rx='2'/><path d='M7 8h10M7 12h10M7 16h6'/>",
    target:"<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/>",
    sliders:"<path d='M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'/>",
    flame:"<path d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.7 1.3 2.8 2.5 2.8z'/>",
    peak:"<path d='M8 3l4 8 5-5 5 15H2z'/>",
    stack:"<path d='M12 2l10 5-10 5L2 7z'/><path d='M2 17l10 5 10-5M2 12l10 5 10-5'/>",
    check:"<path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect x='8' y='2' width='8' height='4' rx='1'/><path d='M9 14l2 2 4-4'/>",
    scale:"<path d='M12 3v18M5 21h14M6 7h12'/><path d='M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z'/>",
    compass:"<circle cx='12' cy='12' r='10'/><path d='M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z'/>",
    search:"<circle cx='11' cy='11' r='7'/><path d='M21 21l-4.3-4.3'/>",
    film:"<rect x='2' y='2' width='20' height='20' rx='2'/><path d='M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5'/>",
    layers:"<circle cx='11' cy='11' r='7'/><path d='M21 21l-4.3-4.3M8 11h6M11 8v6'/>",
    pulse:"<path d='M22 12h-4l-3 9L9 3l-3 9H2'/>",
    snow:"<path d='M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1L19.1 4.9'/><path d='M9 4l3 3 3-3M9 20l3-3 3 3M4 9l3 3-3 3M20 9l-3 3 3 3'/>",
    ruler:"<path d='M21.3 15.3l-6 6a1 1 0 0 1-1.4 0L2.7 10.1a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0l11.2 11.2a1 1 0 0 1 0 1.4z'/><path d='M7.5 10.5l2 2M10.5 7.5l2 2M13.5 13.5l2 2M16.5 10.5l2 2'/>",
    hand:"<path d='M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8'/><path d='M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15'/>",
    gauge:"<path d='M12 14l4-4'/><path d='M3.3 19A10 10 0 1 1 20.7 19'/>",
    mirror:"<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5M12 7v5l3 2'/>",
    book:"<path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z'/><path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'/>",
    sun:"<path d='M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4'/>",
    crown:"<path d='M2 18h20M3 7l5 5 4-7 4 7 5-5-2 11H5z'/>",
    pin:"<path d='M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z'/>"
  };
  const NS='http://www.w3.org/2000/svg';
  // medal: icon in a circle, rarity as 1..5 dotted rings (the journal's dots-and-isolines world), progress as an arc
  function medal(a,got,p,size){
    const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox','0 0 64 64');s.setAttribute('class','ach-medal r'+a.r+(got?' got':''));
    s.setAttribute('width',size||56);s.setAttribute('height',size||56);s.style.width=s.style.height=(size||56)+'px';s.setAttribute('aria-hidden','true');
    let h='';for(let i=0;i<a.r;i++)h+=`<circle class='ring' cx='32' cy='32' r='${(23.4+i*2.1).toFixed(1)}' style='--k:${i}'/>`;
    h+=`<circle class='disc' cx='32' cy='32' r='20'/>`;
    if(!got&&p>0)h+=`<circle class='arc' cx='32' cy='32' r='20' pathLength='100' stroke-dasharray='${Math.round(p*100)} 100' transform='rotate(-90 32 32)'/>`;
    h+=`<g class='ic' transform='translate(22.4 22.4) scale(.8)'>${IC[a.icon]||IC.target}</g>`;
    s.innerHTML=h;return s
  }

  // ---------------------------------------------------------------- state
  const st=()=>{const c=(typeof CFG!=='undefined'&&CFG)||{};c.ach=c.ach||{};const a=c.ach;a.got=a.got||{};a.pin=(a.pin||[]).filter(id=>BY[id]);a.brief=a.brief||[];return a};
  const name=a=>(L()==='en'?a.en:a.ru)[0],desc=a=>(L()==='en'?a.en:a.ru)[1];
  let started=0,quietUntil=0,timer=0,fresh=new Set(),last=null;
  function progress(f,got){return A.map(a=>{const v=Math.max(0,Number(a.v(f,got))||0);return{a,v,p:Math.min(1,v/a.goal),done:v>=a.goal}})}

  // compare with what was earned before; announce the new ones (silently on the first run and while the account data is arriving)
  function check(opts){
    if(typeof ready==='undefined'||!ready||typeof CFG==='undefined')return;
    if(!started){started=Date.now();quietUntil=started+(opts&&opts.quietMs!=null?opts.quietMs:5000)}
    const s=st(),first=!s.init,f=facts(),now=today();let added=[];
    // two passes so "master" sees the achievements earned in this check
    for(let pass=0;pass<2;pass++)progress(f,s.got).forEach(x=>{if(x.done&&!s.got[x.a.id]){s.got[x.a.id]=now;added.push(x.a)}});
    last=progress(f,s.got);
    if(first)s.init=1;
    if(!added.length&&!first)return;
    const quiet=!(opts&&opts.loud)&&(first||Date.now()<quietUntil);
    // the silent first count is not saved: it is derived from the data and gets saved with the next real change
    if(added.length&&!(first&&quiet))saveCfg();
    added.forEach(a=>fresh.add(a.id));
    if(quiet){if(first&&added.length>1)toast(tr('ach.toast.many').replace('{n}',added.length))}
    else celebrate(added);
    if(view==='ach')render()
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{try{check()}catch(e){console.warn('achievements',e)}},350)};

  // ---------------------------------------------------------------- unlock moment
  let queue=[],showing=false;
  function celebrate(list){queue=queue.concat(list.length>3?[{many:list.length,top:list.slice().sort((a,b)=>b.r-a.r)[0]}]:list);if(!showing)next()}
  function next(){
    const it=queue.shift();if(!it){showing=false;return}showing=true;
    const a=it.many?it.top:it,box=el('div','ach-pop r'+a.r);box.setAttribute('role','status');
    const m=medal(a,true,1,72),tx=el('div','ach-pop-t');
    tx.append(el('small',null,it.many?tr('ach.toast.many').replace('{n}',it.many):tr('ach.got')+' · '+tr('ach.r'+a.r)),el('b',null,name(a)),el('span',null,desc(a)));
    box.append(m,tx);box.onclick=()=>{close();if(typeof go==='function')go('ach')};
    document.body.append(box);requestAnimationFrame(()=>box.classList.add('in'));
    const close=()=>{if(!box.isConnected)return;box.classList.remove('in');box.classList.add('out');setTimeout(()=>{box.remove();next()},motionOff()?0:320)};
    setTimeout(close,4200)
  }
  const motionOff=()=>typeof motion==='function'&&motion()==='off';

  // ---------------------------------------------------------------- pins (showcase)
  const server=()=>{const me=window.SOCIAL&&SOCIAL.me;return !!(me&&Array.isArray(me.achievements))};
  let pushing=null;
  function pushPins(){
    if(!server()||pushing)return;const me=SOCIAL.me,pin=st().pin;
    if(JSON.stringify(me.achievements)===JSON.stringify(pin))return;
    pushing=SOCIAL.saveShowcase(pin,null).catch(e=>toast(e.message)).finally(()=>{pushing=null})
  }
  function togglePin(id){
    const s=st(),i=s.pin.indexOf(id);
    if(i>=0)s.pin.splice(i,1);else{if(s.pin.length>=6)return toast(tr('ach.pin.full'));if(!s.got[id])return;s.pin.push(id)}
    saveCfg();pushPins();render()
  }

  // ---------------------------------------------------------------- page
  let filt='all',show='all';
  function page(v){
    const s=st(),rows=last||progress(facts(),s.got),total=A.length,n=Object.keys(s.got).filter(k=>BY[k]).length;
    const root=el('div','ach');root.setAttribute('data-i18n-skip','');
    // head: count + distribution by rarity
    const head=el('div','ach-head'),h=el('h2',null,tr('tab.ach')),cnt=el('p','ach-count');
    cnt.append(el('b',null,String(n)),' '+tr('ach.of')+' '+total);
    const dist=el('div','ach-dist');
    for(let r=1;r<=5;r++){const all=A.filter(a=>a.r===r).length,g=A.filter(a=>a.r===r&&s.got[a.id]).length,c=el('div','ach-dseg r'+r);c.style.flexGrow=all;
      const bar=el('i');bar.style.width=(g/all*100).toFixed(1)+'%';c.append(bar,el('span',null,tr('ach.r'+r)+' '+g+'/'+all));dist.append(c)}
    head.append(h,cnt);root.append(head,dist);
    // showcase
    const sh=el('section','ach-show'),sht=el('div','ach-show-h');sht.append(el('h3',null,tr('ach.show')),el('span','mu',server()?tr('ach.show.on'):tr('ach.show.off')));
    const slots=el('div','ach-slots');
    for(let i=0;i<6;i++){const id=s.pin[i],a=id&&BY[id],b=el('button','ach-slot'+(a?' on':''));b.type='button';
      if(a){b.append(medal(a,true,1,44),el('span',null,name(a)));b.title=tr('ach.unpin');b.setAttribute('aria-label',tr('ach.unpin')+': '+name(a));b.onclick=()=>togglePin(id)}
      else{b.disabled=true;b.append(el('i'),el('span','mu',tr('ach.slot')))}slots.append(b)}
    sh.append(sht,slots);root.append(sh);
    // filters
    const fb=el('div','ach-filters'),seg=(cls,opts,cur,set)=>{const g=el('div','ach-seg '+cls);g.setAttribute('role','group');
      opts.forEach(([k,l])=>{const b=el('button','s'+(cur===k?' on':''),l);b.type='button';b.setAttribute('aria-pressed',String(cur===k));b.onclick=()=>{set(k);render()};g.append(b)});return g};
    fb.append(seg('rar',[['all',tr('ach.all')]].concat([1,2,3,4,5].map(r=>[String(r),tr('ach.r'+r)])),filt,k=>filt=k),
      seg('st',[['all',tr('ach.all')],['got',tr('ach.f.got')],['todo',tr('ach.f.todo')]],show,k=>show=k));
    root.append(fb);
    // groups
    let shown=0;
    GROUPS.forEach(g=>{
      const list=rows.filter(x=>x.a.g===g&&(filt==='all'||String(x.a.r)===filt)&&(show==='all'||(show==='got')===!!s.got[x.a.id]));
      if(!list.length)return;const sec=el('section','ach-group');sec.append(el('h3',null,tr('ach.g.'+g)));const grid=el('div','ach-grid');
      list.forEach((x,i)=>{const a=x.a,got=s.got[a.id],c=el('article','ach-card r'+a.r+(got?' got':'')+(fresh.has(a.id)?' fresh':''));c.style.setProperty('--i',i);
        const tx=el('div','ach-tx'),top=el('div','ach-top');top.append(el('b',null,name(a)),el('span','ach-rar',tr('ach.r'+a.r)));
        tx.append(top,el('p',null,desc(a)));
        if(got){const ft=el('div','ach-ft');ft.append(el('span','mu',tr('ach.on')+' '+fmt(got)));
          const pb=el('button','s ach-pin'+(s.pin.includes(a.id)?' on':''));pb.type='button';const on=s.pin.includes(a.id);
          pb.innerHTML=`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'>${IC.pin}</svg>`;
          pb.append(el('span',null,on?tr('ach.unpin'):tr('ach.pin')));pb.setAttribute('aria-pressed',String(on));pb.onclick=()=>togglePin(a.id);ft.append(pb);tx.append(ft)}
        else{const pr=el('div','ach-prog'),bar=el('i');bar.style.width=(x.p*100).toFixed(1)+'%';pr.append(bar);const lab=el('span','mu',Math.min(x.v,a.goal)+' / '+a.goal);tx.append(pr,lab)}
        c.append(medal(a,!!got,x.p,56),tx);grid.append(c);shown++});
      sec.append(grid);root.append(sec)});
    if(!shown)root.append(el('div','msg',tr('ach.none')));
    root.append(el('p','mu ach-note',tr('ach.note')));
    v.append(root);
    fresh.clear();pushPins();if(!last)schedule()
  }
  const fmt=d=>{try{return new Date(dnum(d)).toLocaleDateString(L()==='en'?'en-GB':'ru-RU',Object.assign({day:'numeric',month:'short',timeZone:'UTC'},d.slice(0,4)===today().slice(0,4)?{}:{year:'numeric'}))}catch(e){return d}};

  // badges for profile cards (social.js): known ids only, in the given order
  function badges(ids){
    const w=el('div','ach-badges');(ids||[]).map(id=>BY[id]).filter(Boolean).slice(0,6).forEach(a=>{const b=el('span','ach-badge r'+a.r);b.title=name(a)+' — '+desc(a);b.append(medal(a,true,1,30),el('span',null,name(a)));w.append(b)});
    return w.childNodes.length?w:null
  }

  // ---------------------------------------------------------------- briefing use
  function briefOpened(){const s=st(),d=today();if(s.brief.includes(d))return;s.brief.push(d);if(s.brief.length>400)s.brief=s.brief.slice(-400);saveCfg();schedule()}
  document.addEventListener('journal:briefing-open',briefOpened);
  if(document.body&&document.body.classList.contains('brief-open'))setTimeout(briefOpened,0);

  // ---------------------------------------------------------------- wiring
  // every data change ends in render(); check a moment later, off the render path
  if(typeof render==='function'){const r0=render;render=function(){const out=r0.apply(this,arguments);schedule();return out}}
  if(window.I18N)I18N.on(()=>{if(view==='ach')render()});
  window.ACH={list:A,byId:BY,view:page,check,badges,medal,togglePin,state:st,progress:()=>last,_facts:facts};
})();
