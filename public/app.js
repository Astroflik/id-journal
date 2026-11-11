
const FIELDS=[['res','Результат',['Тейк','BE','Стоп']],['kind','Тип',['Реверс','Продолжение']],['rr','RR (итог, для тейка)','num'],['risk','Риск %',['0.15','0.25','0.5','0.75','1']],['cvd','CVD',['Buy Exhaustion','Buy Absorption','Sell Exhaustion','Sell Absorption']],['tape','Speed of Tape',['On','Off']],['poc','Footprint: POC',['Тело','Тень']],['zero','Footprint: Zero',['Нет','Сверху','Снизу']],['ivb','IVB',['Нет','0','0.5','1']],['ivbtf','IVB диапазон',['5m','30m']],['vp','Профиль RTH',['D','P','b','B']],['origin','Набрана от',['VAH','VAL','POC']],['node','LVN / HVN',['LVN','HVN']],['side','Направление',['Long','Short']],['entry','Цена входа','num'],['exit','Цена выхода','num'],['time','Время входа','time'],['grade','Оценка сделки',['A+','A','B','C']],['emo','Состояние',['Спокойно','Уверенно','FOMO','Страх','Злость','Усталость']]];
const INST=['NQ','ES'],BAL={fp:25000,iq:50000},$=s=>document.querySelector(s);
// Buttons that change journal data; hidden in read-only mode (body.ro).
const WRITE_BTN=/^(＋ (Сделка|Новый|Новое|Добавить|Условие|Счёт)|Сохранить|💾 Сохранить как|Удалить|⬆ Импорт|Импортировать|✎ Править|Копия|⚙ )/;
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null){e.textContent=x;if(t==='button'&&WRITE_BTN.test(x))e.dataset.w=''}return e};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const num=v=>{const n=parseFloat(String(v??'').replace(',','.'));return isFinite(n)?n:null};
let T=[],P=[],view='home',db=null,assets=null,ready=false;
// ---- storage: db (shared with this artifact) or localStorage fallback ----
const store={
  async init(){try{T=JSON.parse(localStorage.getItem('jt')||'[]');P=JSON.parse(localStorage.getItem('jp')||'[]');if(T.length||P.length){ready=true;render()}}catch(e){}try{const c=window.claude&&await window.claude.use('db');if(c){db=c;}}catch(e){}try{assets=window.claude&&await window.claude.use('assets')}catch(e){}
    if(db){for(const k of['trades','plans'])db.collection(k).onSnapshot(s=>{const a=s.docs.map(d=>({id:d.id,...d.data()}));const mg='jm_'+k,lk=k==='trades'?'jt':'jp';try{const first=!localStorage.getItem(mg);localStorage.setItem(mg,'1');if(!a.length&&first){JSON.parse(localStorage.getItem(lk)||'[]').forEach(x=>store.save(k,x).catch(e=>toast('Не удалось перенести запись: '+(e.code||e.message))))}else localStorage.setItem(lk,JSON.stringify(a))}catch(e){}k==='trades'?T=a:P=a;ready=true;render()},()=>{})}
    else{try{T=JSON.parse(localStorage.getItem('jt')||'[]');P=JSON.parse(localStorage.getItem('jp')||'[]')}catch(e){}ready=true;render()}},
  async save(k,o,sync=false){if(accountApi.readOnly)throw new Error(accountApi.READ_ONLY);const id=o.id!=null&&o.id!==''?String(o.id):'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);const d={...o};delete d.id;
    if(db)await db.collection(k).doc(id).set(JSON.parse(JSON.stringify(d)));else{const a=k==='trades'?T:P;const i=a.findIndex(x=>String(x.id)===String(id));const r={...d,id};i<0?a.push(r):a[i]=r;localStorage.setItem(k==='trades'?'jt':'jp',JSON.stringify(a));render()}
    if(sync)await accountApi.flush()},
  async del(k,id,sync=false){if(accountApi.readOnly)throw new Error(accountApi.READ_ONLY);if(db)await db.collection(k).doc(String(id)).delete();else{const a=(k==='trades'?T:P).filter(x=>String(x.id)!==String(id));k==='trades'?T=a:P=a;localStorage.setItem(k==='trades'?'jt':'jp',JSON.stringify(a));render()}
    if(sync)await accountApi.flush()}
};
// ---- maths ----
const R=t=>t.res==='Тейк'?(num(t.rr)??0):t.res==='BE'?0:t.res==='Стоп'?-1:null;
const cl=()=>T.filter(t=>R(t)!==null).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||String(a.time||'').localeCompare(String(b.time||''))||String(a.id??'').localeCompare(String(b.id??'')));
function stats(a){const n=a.length,tk=a.filter(t=>t.res==='Тейк').length,be=a.filter(t=>t.res==='BE').length,st=n-tk-be;let s=0,pos=0,neg=0,eq=0,pk=0,dd=0;
  a.forEach(t=>{const r=R(t);s+=r;r>0?pos+=r:neg-=r;eq+=r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)});
  return{n,tk,be,st,wr:n?tk/n:null,s,avg:n?s/n:null,pf:neg>0?pos/neg:pos>0?Infinity:null,dd}}
const f2=x=>x==null?'—':String(Math.round(x*100)/100),fR=x=>x==null?'—':(x>0?'+':'')+f2(x)+'R',fW=x=>x==null?'—':f2(x*100)+'%',sg=x=>x>0?'w':x<0?'l':'';
function series(a,m){const lb=['Старт'],v=[0];let e=0;a.forEach(t=>{const r=R(t),k=num(t.risk);e+=m==='R'?r:m==='pct'?(k==null?0:r*k):(k==null?0:r*k/100*ACC().reduce((s,x)=>s+(t[x.id]?x.bal:0),0));lb.push(t.date);v.push(Math.round(e*100)/100)});return{lb,v}}
// ---- curve ----
function curve(box,s,m){const n=s.v.length;if(n<2){box.append(el('div','msg','Кривая появится после первой сделки с результатом.'));return}
  const W=900,H=300,pl=60,pr=16,pt=14,pb=28,lo=Math.min(0,...s.v),hi=Math.max(0,...s.v),sp=(hi-lo)||1,x=i=>pl+i/(n-1)*(W-pl-pr),y=v=>pt+(1-(v-lo)/sp)*(H-pt-pb),last=s.v[n-1],col=last>=0?((window.LOOK&&LOOK.w)||'#34d399'):((window.LOOK&&LOOK.l)||'#f87171'),NS='http://www.w3.org/2000/svg';
  const sv=document.createElementNS(NS,'svg');sv.setAttribute('viewBox',`0 0 ${W} ${H}`);const mk=(t,at,p)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);(p||sv).appendChild(e);return e};
  const u=v=>m==='R'?f2(v)+'R':m==='pct'?f2(v)+'%':(v<0?'−':'')+'$'+Math.abs(Math.round(v));
  for(let k=0;k<5;k++){const v=lo+sp*k/4;mk('line',{x1:pl,x2:W-pr,y1:y(v),y2:y(v),class:'gl'});mk('text',{x:pl-7,y:y(v)+4,'text-anchor':'end',class:'ax'}).textContent=u(v)}
  mk('line',{x1:pl,x2:W-pr,y1:y(0),y2:y(0),stroke:'#888','stroke-dasharray':'5 4'});
  const tk=Math.min(6,n);for(let k=0;k<tk;k++){const i=Math.round(k*(n-1)/(tk-1||1));mk('text',{x:x(i),y:H-8,'text-anchor':k?k===tk-1?'end':'middle':'start',class:'ax'}).textContent=s.lb[i]}
  let d='';s.v.forEach((v,i)=>d+=(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1));
  mk('path',{d:d+`L${x(n-1)} ${y(0)}L${x(0)} ${y(0)}Z`,fill:col,'fill-opacity':.13});mk('path',{d,fill:'none',stroke:col,'stroke-width':2.6,'stroke-linejoin':'round',class:'dl',pathLength:1});
  if(n<80)s.v.forEach((v,i)=>mk('circle',{cx:x(i),cy:y(v),r:2.8,fill:col}));
  const dot=mk('circle',{r:5,fill:col,stroke:'#fff',visibility:'hidden'}),tip=el('div','tip');box.append(sv,tip);
  sv.onmousemove=e=>{const r=sv.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.round(((e.clientX-r.left)/r.width*W-pl)/(W-pl-pr)*(n-1))));dot.setAttribute('cx',x(i));dot.setAttribute('cy',y(s.v[i]));dot.setAttribute('visibility','visible');tip.textContent=s.lb[i]+' · '+u(s.v[i]);tip.style.display='block';tip.style.left=Math.min(r.width-140,Math.max(0,x(i)/W*r.width-50))+'px'};
  sv.onmouseleave=()=>{dot.setAttribute('visibility','hidden');tip.style.display='none'}}
// ---- ui helpers ----
const tiles=(p,a)=>{const w=el('div','tiles');a.forEach(([v,l,c],ti)=>{const t=el('div','tile');t.style.setProperty('--i',ti);const bb=el('b',c,v);cnt(bb,String(v));t.append(bb,el('span',null,l));w.append(t)});p.append(w)};
function table(p,h,rows,click){const w=el('div','tw card'),t=el('table'),tr=el('tr');h.forEach(x=>tr.append(el('th',null,x)));const th=el('thead');th.append(tr);t.append(th);const b=el('tbody');
  rows.forEach((r,ri)=>{const q=el('tr');q.style.setProperty('--i',Math.min(ri,14));r.cells.forEach(c=>{const td=el('td',c&&c.c,c&&c.t!=null?c.t:c);q.append(td)});if(click)q.onclick=()=>click(r.o);b.append(q)});t.append(b);w.append(t);p.append(w)}
const resC=t=>t.res==='Тейк'?{t:'✅ Тейк',c:'w'}:t.res==='Стоп'?{t:'❌ Стоп',c:'l'}:t.res==='BE'?{t:'⚪ BE',c:'b'}:'';
const accL=t=>ACC().filter(x=>t[x.id]).map(x=>x.name).join(' + ');
// ---- modal forms ----
function modal(build){const o=el('div','ov'),m=el('div','md');o.append(m);o.onmousedown=e=>{if(e.target===o)o.remove()};document.body.append(o);build(m,()=>o.remove())}
function openShot(src){const overlay=el('div','shot-lightbox'),image=el('img'),close=el('button',null,'×');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Просмотр скриншота');image.src=src;image.alt='Скриншот сделки';close.type='button';close.setAttribute('aria-label','Закрыть просмотр скриншота');const dismiss=()=>{overlay.remove();document.removeEventListener('keydown',onKey)};const onKey=e=>{if(e.key==='Escape')dismiss()};close.onclick=dismiss;overlay.onclick=e=>{if(e.target===overlay)dismiss()};overlay.append(image,close);document.body.append(overlay);document.addEventListener('keydown',onKey)}
async function addShot(o,blob,redraw){let url;try{url=URL.createObjectURL(blob);const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Не удалось прочитать изображение'));img.src=url});
  let scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),compressed=null;
  for(const quality of[.82,.74,.66,.58]){const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('Не удалось обработать изображение');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);compressed=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Не удалось сжать изображение')),'image/jpeg',quality));if(compressed.size<=550*1024)break;scale*=.78}
  if(!compressed||compressed.size>550*1024)throw new Error('Скриншот слишком большой даже после сжатия. Попробуй изображение меньшего размера');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Не удалось прочитать сжатый скриншот'));reader.onerror=()=>reject(reader.error||new Error('Не удалось прочитать сжатый скриншот'));reader.readAsDataURL(compressed)});
  const sh={id:'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)};if(!await SHOTS.put(sh,data))sh.url=data;(o.shots=o.shots||[]).push(sh);redraw();toast('Скриншот добавлен — он сохранится вместе со сделкой')
 }catch(error){toast('Не удалось добавить скриншот: '+error.message)}finally{if(url)URL.revokeObjectURL(url)}}
function shotsUI(m,o){const box=el('div','shots'),draw=()=>{box.replaceChildren(...(o.shots||[]).map((s,i)=>{const d=el('div'),im=el('img');SHOTS.bind(im,s);const x=el('button',null,'×');x.type='button';x.setAttribute('aria-label','Удалить скриншот');x.onclick=()=>{o.shots.splice(i,1);draw()};d.append(im,x);return d}))};
  const f=el('input');f.type='file';f.accept='image/*';f.multiple=true;f.onchange=async()=>{for(const file of f.files)await addShot(o,file,draw);f.value=''};
  const hint=el('div','mu',(accountApi.user?'Скриншоты сохраняются в облаке твоего аккаунта. ':'Без входа скриншоты останутся только в этом браузере. ')+'Вставь через Ctrl+V / Cmd+V или выбери файлы');m.append(hint,f,box);
  document.onpaste=e=>{if(!document.querySelector('.ov'))return;for(const it of e.clipboardData.items)if(it.type.startsWith('image/'))addShot(o,it.getAsFile(),draw)};draw()}
function tradeForm(t){const o={...t};if(!o.id){o.date=o.date||today();o.inst=o.inst||'NQ'}
  modal((m,close)=>{m.append(el('h3',null,o.id?'Сделка':'Новая сделка'));const g=el('div','fg');
    const L=(lab,inp)=>{const l=el('label');l.append(el('span',null,lab),inp);g.append(l)};
    const d=el('input');d.type='date';d.value=o.date;d.onchange=()=>o.date=d.value;L('Дата',d);
    const is=el('select');INST.forEach(i=>is.append(new Option(i,i)));is.value=o.inst;is.onchange=()=>o.inst=is.value;L('Инструмент',is);
    FIELDS.forEach(([k,lab,op])=>{let c;if(op==='num'||op==='time'){c=el('input');c.type=op==='num'?'number':'time';c.step='any';c.value=o[k]??'';c.oninput=()=>o[k]=c.value}else{c=el('select');c.append(new Option('—',''));op.forEach(v=>c.append(new Option(v,v)));c.value=o[k]||'';c.onchange=()=>o[k]=c.value}L(lab,c)});
    m.append(g);const ac=el('div','bar');ACC().map(x=>[x.id,x.name]).forEach(([k,lab])=>{const l=el('label'),c=el('input');c.type='checkbox';c.checked=!!o[k];c.onchange=()=>o[k]=c.checked;l.append(c,' '+lab);ac.append(l)});m.append(ac);
    const ta=(k,lab)=>{const t=el('textarea');t.rows=3;t.style.width='100%';t.value=o[k]||'';t.oninput=()=>o[k]=t.value;m.append(el('div','mu',lab),t)};ta('desc','Описание');ta('err','Ошибки');shotsUI(m,o);
    const b=el('div','bar');const sv=el('button','p','Сохранить');sv.onclick=async()=>{sv.disabled=true;try{await store.save('trades',o,true);close();if(o.res==='Тейк')boom()}catch(error){if(!accountApi.errorShown)toast('Не удалось сохранить сделку: '+error.message)}finally{sv.disabled=false}};b.append(sv);
    const cn=el('button','s','Отмена');cn.onclick=close;b.append(cn);if(o.id){const x=el('button','s','Удалить');x.onclick=()=>two(x,async()=>{try{await store.del('trades',o.id,true);close()}catch(error){if(!accountApi.errorShown)toast('Не удалось удалить сделку: '+error.message)}});b.append(x);const dp=el('button','s','Копия');dp.onclick=async()=>{try{await store.save('trades',{...o,id:'',date:today()},true);close();toast('Копия создана')}catch(error){if(!accountApi.errorShown)toast('Не удалось сохранить копию: '+error.message)}};b.append(dp);const shb=el('button','p','🎬 Поделиться');shb.onclick=()=>shareCard(o);b.append(shb)}m.append(b)})}
function planForm(p){const o={...p};if(!o.id&&!o.date)o.date=today();
  modal((m,close)=>{m.append(el('h3',null,'План на день'));const g=el('div','fg'),d=el('input');d.type='date';d.value=o.date;d.onchange=()=>o.date=d.value;
    const s=el('select');['—','Сбылся','Частично','Не сбылся'].forEach(v=>s.append(new Option(v,v==='—'?'':v)));s.value=o.done||'';s.onchange=()=>o.done=s.value;
    [['Дата',d],['Итог дня',s]].forEach(([a,i])=>{const l=el('label');l.append(el('span',null,a),i);g.append(l)});m.append(g);
    const ta=(k,lab,r)=>{const t=el('textarea');t.rows=r;t.style.width='100%';t.value=o[k]||'';t.oninput=()=>o[k]=t.value;m.append(el('div','mu',lab),t)};ta('plan','План (свободный текст)',7);ta('sum','Итог дня',4);shotsUI(m,o);
    const b=el('div','bar'),sv=el('button','p','Сохранить');sv.onclick=async()=>{sv.disabled=true;try{await store.save('plans',o,true);close()}catch(error){if(!accountApi.errorShown)toast('Не удалось сохранить план: '+error.message)}finally{sv.disabled=false}};const cn=el('button','s','Отмена');cn.onclick=close;b.append(sv,cn);
    if(o.id){const x=el('button','s','Удалить');x.onclick=()=>two(x,async()=>{try{await store.del('plans',o.id,true);close()}catch(error){if(!accountApi.errorShown)toast('Не удалось удалить план: '+error.message)}});b.append(x)}m.append(b)})}
// ---- views ----
function vStats(p,full){const a=cl();let m=window._m||'R',ac=window._a||'all';const box=el('div');p.append(box);
  const draw=()=>{box.replaceChildren();const f=a.filter(t=>ac==='all'||t[ac]),s=stats(f);
    if(full){const bar=el('div','bar'),mk=(v,opts,cur,cb)=>{const e=el('select');opts.forEach(([x,y])=>e.append(new Option(y,x)));e.value=cur;e.onchange=()=>cb(e.value);bar.append(e)};
      mk(1,[['all','Все счета'],...ACC().map(x=>[x.id,x.name])],ac,v=>{window._a=ac=v;draw()});mk(2,[['R','Кривая в R'],['pct','Кривая в %'],['usd','Кривая в $']],m,v=>{window._m=m=v;draw()});box.append(bar)}
    tiles(box,[[s.n,'сделок'],[fW(s.wr),'винрейт'],[fR(s.s),'итого R',sg(s.s)],...(full?[[fR(s.avg),'ср. R',sg(s.avg)],[s.pf==null?'—':s.pf===Infinity?'∞':f2(s.pf),'profit factor'],[f2(s.dd)+'R','макс. просадка']]:[])]);
    const c=el('div','card');curve(c,series(f,full?m:'R'),full?m:'R');box.append(c);dash(box,f,full);
    if(full){box.append(el('h3',null,'По инструментам'));const rows=INST.map(i=>{const x=stats(f.filter(t=>t.inst===i));return{cells:[i,x.n,x.tk,x.be,x.st,{t:fW(x.wr),c:'w'},{t:fR(x.s),c:sg(x.s)},fR(x.avg)]}});table(box,['Инструмент','Сделок','Тейков','BE','Стопов','Винрейт','ΣR','Ср. R'],rows);
      box.append(el('h3',null,'Срезы по полям'));const sr=[];[['kind','Тип'],['risk','Риск %'],['cvd','CVD'],['tape','Speed of Tape'],['poc','POC'],['zero','Zero'],['ivb','IVB'],['ivbtf','IVB диапазон'],['vp','Профиль'],['origin','Набрана от'],['node','LVN/HVN'],['grade','Оценка'],['emo','Состояние'],...(CFG.custom||[]).map(c=>[c.key,c.label])].forEach(([k,lb])=>{const mp={};f.forEach(t=>{if(t[k])(mp[t[k]]=mp[t[k]]||[]).push(t)});Object.keys(mp).sort().forEach(v=>{const x=stats(mp[v]);sr.push({cells:[lb,v,x.n,{t:fW(x.wr),c:'w'},{t:fR(x.s),c:sg(x.s)},fR(x.avg)]})})});table(box,['Поле','Значение','Сделок','Винрейт','ΣR','Ср. R'],sr)}};draw()}
function vJournal(p){const b=el('div','bar');INST.forEach(i=>{const x=el('button','p','＋ Сделка '+i);x.onclick=()=>tradeForm({inst:i});b.append(x)});const im=el('button','s','⬆ Импорт MT5 / ATAS'),imf=el('input');imf.type='file';imf.accept='.csv,.html,.htm,.xlsx,.xls';imf.style.display='none';imf.onchange=()=>imf.files[0]&&importFile(imf.files[0]);im.onclick=()=>imf.click();b.append(im,imf);p.append(b);
  const fl=window._f=window._f||{q:'',i:'',r:'',a:''},fb=el('div','bar');
  const sl=(o,k)=>{const s=el('select');o.forEach(([v,t])=>s.append(new Option(t,v)));s.value=fl[k];s.onchange=()=>{fl[k]=s.value;render()};fb.append(s)};
  const qi=el('input');qi.placeholder='Поиск по описанию и ошибкам…';qi.value=fl.q;qi.onchange=()=>{fl.q=qi.value;render()};fb.append(qi);
  sl([['','Все инструменты'],...INST.map(i=>[i,i])],'i');sl([['','Любой результат'],['Тейк','Тейк'],['BE','BE'],['Стоп','Стоп']],'r');sl([['','Все счета'],...ACC().map(x=>[x.id,x.name])],'a');p.append(fb);
  const a=[...T].filter(t=>(!fl.i||t.inst===fl.i)&&(!fl.r||t.res===fl.r)&&(!fl.a||t[fl.a])&&(!fl.q||((t.desc||'')+' '+(t.err||'')).toLowerCase().includes(fl.q.toLowerCase()))).sort((x,y)=>(y.date||'').localeCompare(x.date||'')||y.id.localeCompare(x.id));
  if(!a.length){p.append(el('div','msg','Пока пусто. Нажми «＋ Сделка», выбери значения из списков и вставь скриншот через Ctrl+V.'));return}
  const cut=s=>(s||'').length>40?s.slice(0,39)+'…':(s||'');
  table(p,['Дата','Инстр.','Результат','Тип','RR','Риск %','CVD','Tape','POC','Zero','IVB','ТФ','Профиль','От чего','LVN/HVN','Оценка','Состояние','Сетап',...(CFG.custom||[]).map(c=>c.label),'Описание','Ошибки','📷','Аккаунт'],a.map(t=>({o:t,cells:[(t.imp&&!t.cvd?'🆕 ':'')+t.date,t.inst,resC(t),t.kind,t.rr,t.risk,t.cvd,t.tape,t.poc,t.zero,t.ivb,t.ivbtf,t.vp,t.origin,t.node,t.grade,t.emo,setupsOf(t),...(CFG.custom||[]).map(c=>t[c.key]||''),cut(t.desc),cut(t.err),(t.shots||[]).length||'',accL(t)]})),t=>tradeForm(t))}
function vPlan(p){const b=el('div','bar'),x=el('button','p','＋ Добавить план');x.onclick=()=>planForm({});b.append(x);p.append(b);
  const a=[...P].sort((x,y)=>(y.date||'').localeCompare(x.date||''));if(!a.length){p.append(el('div','msg','Планов пока нет.'));return}
  const dc=d=>d==='Сбылся'?{t:'✅ Сбылся',c:'w'}:d==='Частично'?{t:'🟡 Частично',c:'b'}:d==='Не сбылся'?{t:'❌ Не сбылся',c:'l'}:'—';
  table(p,['Дата','Итог','План','📷'],a.map(q=>({o:q,cells:[q.date,dc(q.done),(q.plan||'').slice(0,110),(q.shots||[]).length||'']})),q=>planForm(q))}
function vGraph(p){const NS='http://www.w3.org/2000/svg',W=900,H=540,sv=document.createElementNS(NS,'svg');sv.setAttribute('viewBox',`0 0 ${W} ${H}`);const mk=(t,at,pr)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);(pr||sv).appendChild(e);return e},scale=window._graphScale=window._graphScale||{x:1,y:1,z:1};
  p.append(el('div','mu','Масштабируй граф по X, Y и Z. Наведи на NQ или ES, чтобы подсветить сделки; клик по сделке откроет карточку.'));
  const controls=el('div','bar',''),scaleNames={x:'X · ширина',y:'Y · высота',z:'Z · глубина'},inputs={};
  Object.entries(scaleNames).forEach(([axis,label])=>{const wrap=el('label','graph-scale'),name=el('span','mu',label),input=el('input');input.type='range';input.min='.5';input.max='1.8';input.step='.1';input.value=scale[axis];input.setAttribute('aria-label','Масштаб '+axis);inputs[axis]=input;input.oninput=()=>{scale[axis]=Number(input.value);input.title=scale[axis].toFixed(1)+'×'};wrap.append(name,input);controls.append(wrap)});p.append(controls);
  const cs={NQ:[W*.28,H/2],ES:[W*.72,H/2]},nodes=[],gA=2.399963;
  INST.forEach(i=>{const a=[...T].filter(t=>t.inst===i).sort((x,y)=>(x.date||'').localeCompare(y.date||''));a.forEach((t,k)=>{const r=26+Math.sqrt(k+1)*34,an=k*gA;nodes.push({t,i,x:cs[i][0]+Math.cos(an)*r,y:cs[i][1]+Math.sin(an)*r})})});
  const g=mk('g',{}),all=[];nodes.forEach(n=>{const l=mk('line',{x1:cs[n.i][0],y1:cs[n.i][1],x2:n.x,y2:n.y,class:'ln'},g);n.l=l});
  const col=t=>t.res==='Тейк'?'#34d399':t.res==='Стоп'?'#f87171':t.res==='BE'?'#94a3b8':'#64748b';
  nodes.forEach(n=>{const c=mk('circle',{cx:n.x,cy:n.y,r:6,fill:col(n.t),class:'nd',stroke:'transparent','stroke-width':24},g);const tt=mk('title',{},c);tt.textContent=`${n.t.date} ${n.t.inst} ${n.t.res||''} ${n.t.rr?R(n.t)+'R':''}`;c.onclick=()=>tradeForm(n.t);n.c=c});
  INST.forEach(i=>{const [x,y]=cs[i],gr=mk('g',{class:'nd hub'},g);mk('circle',{cx:x,cy:y,r:24,fill:'#2563eb'},gr);mk('text',{x,y:y+4,'text-anchor':'middle',style:'fill:#fff;font-weight:700'},gr).textContent=i;
    gr.onmouseenter=()=>nodes.forEach(n=>{const on=n.i===i;n.c.classList.toggle('dim',!on);n.l.classList.toggle('dim',!on)});gr.onmouseleave=()=>nodes.forEach(n=>{n.c.classList.remove('dim');n.l.classList.remove('dim')})});
  const c=el('div','card');c.append(sv);p.append(c);
  let M=null;const glow=mk('circle',{r:80,fill:'rgba(167,139,250,.15)',style:'pointer-events:none;opacity:0;transition:opacity .3s'},g);sv.addEventListener('mousemove',e=>{const r=sv.getBoundingClientRect();M={x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H};glow.style.opacity=1});sv.addEventListener('mouseleave',()=>{M=null;glow.style.opacity=0});
  const t0=performance.now();nodes.forEach((n,k)=>{n.ph=k*1.7;n.bx=n.x;n.by=n.y});
  (function tick(now){if(!sv.isConnected||view!=='graph')return;const t=(now-t0)/1000;nodes.forEach(n=>{const anchor=cs[n.i],depth=scale.z,baseX=anchor[0]+(n.bx-anchor[0])*scale.x*depth,baseY=H/2+(n.by-H/2)*scale.y*depth;let x=baseX+Math.sin(t*.8+n.ph)*7*scale.x,y=baseY+Math.cos(t*.65+n.ph*1.3)*7*scale.y,tx=0,ty=0,s=1;if(M){const dx=M.x-x,dy=M.y-y,d=Math.hypot(dx,dy);if(d<160){const k=1-d/160;tx=dx*k*.6;ty=dy*k*.6;s=1+k*1.2}}n.ox=(n.ox||0)+(tx-(n.ox||0))*.14;n.oy=(n.oy||0)+(ty-(n.oy||0))*.14;n.sc=(n.sc||1)+(s-(n.sc||1))*.16;x+=n.ox;y+=n.oy;n.c.setAttribute('cx',x);n.c.setAttribute('cy',y);n.c.setAttribute('r',6*n.sc*Math.max(.65,Math.min(1.5,depth)));n.l.setAttribute('x1',anchor[0]);n.l.setAttribute('y1',H/2);n.l.setAttribute('x2',x);n.l.setAttribute('y2',y)});if(M){glow.setAttribute('cx',M.x);glow.setAttribute('cy',M.y)}requestAnimationFrame(tick)})(t0)}
function render(){const nav=$('#nav');nav.replaceChildren();[['plan','📅','План на день','план и итог дня'],['stats','📈','Кривая и статистика','винрейт по инструментам'],['journal','📓','Журнал','сделки и скриншоты'],['graph','🕸','Граф','связи инструментов и сделок'],['whatif','🧪','А что если…','симулятор правил'],['setups','🎯','Сетапы','свои стратегии и их кривая'],['review','📆','Разбор','неделя и месяц']].forEach(([k,i,t,s],bi)=>{const b=el('button','big'+(view===k?' on':''));b.title=t+' — '+s;b.setAttribute('aria-label',t);b.style.setProperty('--i',bi);b.append(el('i',null,i),el('b',null,t),el('span',null,s));b.onclick=()=>go(k);nav.append(b)});
  const v=$('#v');v.replaceChildren();v.classList.toggle('anim',view!==window._lv);window._lv=view;if(!ready){v.append(el('div','msg','Загрузка…'));return}
  if(view==='home')vStats(v,false);else if(view==='stats')vStats(v,true);else if(view==='journal')vJournal(v);else if(view==='plan')vPlan(v);else if(view==='whatif')vWhatIf(v);else if(view==='setups')vSetups(v);else if(view==='review')vReview(v);else vGraph(v)}
$('#ttl').onclick=()=>go('home');
function toast(t){const e=el('div','toast',t);document.body.append(e);setTimeout(()=>{e.classList.add('out');setTimeout(()=>e.remove(),420)},2300)}
function dash(p,a,full){const w=el('div','two'),days={};a.forEach(t=>days[t.date]=(days[t.date]||0)+R(t));const s=stats(a),dv=Object.values(days),cons=dv.length?dv.filter(x=>x>0).length/dv.length:0,cp=(x,lo,hi)=>Math.max(0,Math.min(100,(x-lo)/(hi-lo)*100));
  const sc=a.length?Math.round((cp(s.wr*100,20,70)+cp(s.pf===Infinity?3:s.pf||0,0,3)+cp(s.avg,-.5,1)+cons*100)/4):0;
  const r=el('div','card ring');r.innerHTML='<svg viewBox="0 0 120 120"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(167,139,250,.14)" stroke-width="9"/><circle class="rg" cx="60" cy="60" r="50" fill="none" stroke="url(#rg)" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="100" style="stroke-dashoffset:'+(100-sc)+';transform:rotate(-90deg);transform-origin:center"/><text x="60" y="67" text-anchor="middle" style="font-size:30px;font-weight:700;fill:var(--tx)">'+sc+'</text></svg><div class="mu">Score<br><small>винрейт · PF · ср. R · стабильность</small></div>';
  const c=el('div','card'),o=window._mo||0,d0=new Date();d0.setDate(1);d0.setMonth(d0.getMonth()+o);const y=d0.getFullYear(),mo=d0.getMonth(),n=new Date(y,mo+1,0).getDate(),st=(d0.getDay()+6)%7,mx=Math.max(1,...dv.map(Math.abs)),hd=el('div','bar'),pv=el('button','s','‹'),nx=el('button','s','›');
  pv.onclick=()=>{window._mo=o-1;render()};nx.onclick=()=>{window._mo=o+1;render()};hd.append(pv,el('b',null,d0.toLocaleDateString('ru',{month:'long',year:'numeric'})),nx);c.append(hd);
  const g=el('div','cg');['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(x=>g.append(el('span','mu',x)));for(let i=0;i<st;i++)g.append(el('i'));
  for(let d=1;d<=n;d++){const k=y+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'),v=days[k],ce=el('div','cd');ce.style.cursor='pointer';ce.onclick=()=>dayScreen(k);ce.append(el('span','mu',d));if(v!==undefined){const cc=v>0?'w':v<0?'l':'b',b=el('em',cc);b.style.height=Math.max(8,Math.abs(v)/mx*34)+'px';ce.append(b,el('small',cc,fR(v)))}g.append(ce)}
  c.append(g);w.append(r,c);p.append(w);if(full)extra(p,a)}
const xb=el('div','bar'),eb=el('button','s','⬇ Резервная копия (JSON)');eb.onclick=async()=>{try{const shots={};for(const rec of[...T,...P])for(const s of rec.shots||[])if(s&&s.id){const u=await SHOTS.get(s);if(u)shots[s.id]=u}const backup={format:'Journal by myIDgod',version:2,exportedAt:new Date().toISOString(),state:accountApi.snapshot(),shots},url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='journal-backup-'+today()+'.json';a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(error){toast('Не удалось создать резервную копию: '+error.message)}};const ib=el('button','s','⬆ Импорт'),fi=el('input');fi.type='file';fi.accept='.json,application/json';fi.style.display='none';fi.onchange=async()=>{try{const file=fi.files[0];if(!file)return;const backup=JSON.parse(await file.text());if(backup.format==='Journal by myIDgod'&&backup.version===2&&backup.state&&typeof backup.state==='object'&&!Array.isArray(backup.state)){if(Object.entries(backup.state).some(([key,value])=>!key||typeof value!=='string'))throw new Error('В резервной копии некорректные данные');if(new Blob([JSON.stringify(backup.state)]).size>5*1024*1024)throw new Error('Резервная копия превышает лимит 5 МБ');if(!confirm('Импорт заменит текущие сделки, планы и настройки. Продолжить?'))return;const previous=accountApi.snapshot();accountApi.restore(backup.state);if(backup.shots&&typeof backup.shots==='object')for(const[id,u]of Object.entries(backup.shots))if(typeof u==='string')await SHOTS.put({id},u);try{if(accountApi.user)await accountApi.writeState(accountApi.snapshot())}catch(error){accountApi.restore(previous);throw error}render();toast('Данные и настройки восстановлены ✓')}else if(Array.isArray(backup.trades)&&Array.isArray(backup.plans)){if(!confirm('Старый формат копии: сделки и планы будут добавлены в журнал. Продолжить?'))return;let count=0;for(const trade of backup.trades){await store.save('trades',trade);count++}for(const plan of backup.plans){await store.save('plans',plan);count++}if(accountApi.user)await accountApi.writeState(accountApi.snapshot());toast('Импортировано записей: '+count)}else throw new Error('Формат резервной копии не поддерживается')}catch(error){toast('Не удалось импортировать резервную копию: '+error.message)}finally{fi.value=''}};ib.onclick=()=>fi.click();xb.append(eb,ib,fi);$('main').append(xb);
let CFG={accts:[{id:'fp',name:'FundingPips',bal:25000,dd:10,dl:5,tg:8},{id:'iq',name:'IQcapital',bal:50000,dd:10,dl:5,tg:8}]};const ACC=()=>CFG.accts;try{const s=JSON.parse(localStorage.getItem('jcfg')||'null');if(s&&s.accts)CFG=s;else if(s&&s.fp)CFG.accts.forEach(x=>Object.assign(x,s[x.id]||{}));if(CFG.look&&CFG.look.bg==='stars'&&!CFG.look.bg1&&!CFG.look.bg2&&!CFG.look.bg3)CFG.look={...CFG.look,bg:'gradient'}}catch(e){}
function limits(){modal((m,close)=>{m.append(el('h3',null,'Лимиты аккаунтов'),el('div','mu','Впиши правила своих счетов: баланс, лимит просадки и цель прибыли (в %).'));const g=el('div','fg'),inp={};[['fp','FundingPips'],['iq','IQcapital']].forEach(([k,nm])=>[['bal','Баланс $'],['dd','Лимит просадки %'],['tg','Цель прибыли %']].forEach(([f,lb])=>{const l=el('label'),i=el('input');i.type='number';i.step='any';i.value=CFG[k][f];inp[k+f]=i;l.append(el('span',null,nm+' · '+lb),i);g.append(l)}));m.append(g);const b=el('div','bar'),s=el('button','p','Сохранить');s.onclick=()=>{['fp','iq'].forEach(k=>['bal','dd','tg'].forEach(f=>{CFG[k][f]=num(inp[k+f].value)||CFG[k][f]}));try{localStorage.setItem('jcfg',JSON.stringify(CFG))}catch(e){}BAL.fp=CFG.fp.bal;BAL.iq=CFG.iq.bal;close();render();toast('Лимиты сохранены')};b.append(s);m.append(b)})}
function extra(p,a){const dw=t=>['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][new Date(t.date+'T00:00').getDay()];let cw=0,cs=0,mw=0,ml=0;a.forEach(t=>{if(t.res==='Тейк'){cw++;cs=0;mw=Math.max(mw,cw)}else if(t.res==='Стоп'){cs++;cw=0;ml=Math.max(ml,cs)}});
  tiles(p,[[cw?cw+' 🔥':cs?cs+' ❄️':'—',cw?'тейков подряд сейчас':cs?'стопов подряд сейчас':'серия'],[mw,'макс. серия тейков'],[ml,'макс. серия стопов'],[a.length?fR(a.reduce((s,t)=>s+R(t),0)/new Set(a.map(t=>t.date)).size):'—','R в среднем за день']]);
  const keys=['cvd','origin','vp','kind','tape','poc','zero','ivb','ivbtf','node','grade','emo','dow'],lb={cvd:'CVD',origin:'Набрана от',vp:'Профиль',kind:'Тип',tape:'Tape',poc:'POC',zero:'Zero',ivb:'IVB',ivbtf:'IVB ТФ',node:'LVN/HVN',grade:'Оценка',emo:'Состояние',dow:'День'},gs=[];
  keys.forEach(k=>{const m={};a.forEach(t=>{const v=k==='dow'?dw(t):t[k];if(v)(m[v]=m[v]||[]).push(t)});for(const v in m)if(m[v].length>=3)gs.push({n:lb[k]+' · '+v,s:stats(m[v])})});gs.sort((x,y)=>y.s.s-x.s.s);
  const bx=el('div','ins');[['🟢 Что работает',gs.filter(g=>g.s.s>0).slice(0,4)],['🔴 Что сливает',gs.filter(g=>g.s.s<0).slice(-4).reverse()]].forEach(([h2,arr])=>{const c=el('div','card');c.append(el('b',null,h2));const u=el('ul');arr.forEach(g=>u.append(el('li',null,g.n+' — '+fW(g.s.wr)+', '+fR(g.s.s)+' ('+g.s.n+')')));if(!arr.length)u.append(el('li','mu','нужно ≥3 сделок в группе'));c.append(u);bx.append(c)});p.append(bx);more(p,a);
  const hd=el('div','bar');hd.append(el('h3',null,'Проп-аккаунты'));const gb=el('button','s','⚙ Лимиты');gb.onclick=limits2;hd.append(gb);p.append(hd);const dk=el('div','ins');
  ACC().forEach(C=>{const k=C.id,nm=C.name,f=cl().filter(t=>t[k]);let e=0,pk=0,mdd=0;f.forEach(t=>{const r=num(t.risk);e+=r==null?0:R(t)*r;pk=Math.max(pk,e);mdd=Math.max(mdd,pk-e)});const used=Math.max(0,-e),c=el('div','card');c.append(el('b',null,nm+' · $'+C.bal.toLocaleString('en-US')),el('div','mu','Прибыль '+f2(e)+'% из цели '+C.tg+'% · ≈ '+(e<0?'−':'+')+'$'+Math.abs(Math.round(e/100*C.bal))));
    const p1=el('div','prog'),i1=el('i');i1.style.width=Math.max(0,Math.min(100,e/C.tg*100))+'%';p1.append(i1);c.append(p1,el('div','mu','Просадка от старта '+f2(used)+'% из лимита '+C.dd+'% · макс. от пика '+f2(mdd)+'%'));const p2=el('div','prog'+(used/C.dd>.6?' bad':'')),i2=el('i');i2.style.width=Math.min(100,used/C.dd*100)+'%';p2.append(i2);c.append(p2);const d2={};f.forEach(t=>{const r=num(t.risk);d2[t.date]=(d2[t.date]||0)+(r==null?0:R(t)*r)});c.append(el('div','mu','Худший день '+f2(Math.min(0,...Object.values(d2)))+'%'+(C.dl?' из лимита '+C.dl+'%':'')));dk.append(c)});p.append(dk)}
document.addEventListener('keydown',e=>{if(e.key==='n'&&!e.metaKey&&!e.ctrlKey&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!document.querySelector('.ov'))tradeForm({inst:'NQ'})});
function two(b,fn){if(b._a){fn();return}b._a=1;const t=b.textContent;b.textContent='Точно удалить?';b.classList.add('bad');setTimeout(()=>{b._a=0;b.textContent=t;b.classList.remove('bad')},3000)}
function cnt(e,s){const m=s.match(/^([+−-]?)(\d+(?:\.\d+)?)(.*)$/);if(!m||matchMedia('(prefers-reduced-motion:reduce)').matches)return;const to=parseFloat(m[2]),dec=(m[2].split('.')[1]||'').length,t0=performance.now();(function f(now){const k=Math.min(1,(now-t0)/900),v=to*(1-Math.pow(1-k,3));e.textContent=m[1]+v.toFixed(dec)+m[3];if(k<1)requestAnimationFrame(f)})(t0)}
function boom(){const cv=el('canvas');cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:30;pointer-events:none';cv.width=innerWidth;cv.height=innerHeight;document.body.append(cv);const x=cv.getContext('2d'),P=Array.from({length:120},()=>({x:innerWidth/2,y:innerHeight*.6,vx:(Math.random()-.5)*18,vy:-Math.random()*17-4,c:['#fff','#c4b5fd','#8b5cf6','#6d28d9'][Math.random()*4|0],r:Math.random()*5+2,a:1}));let n=0;(function f(){x.clearRect(0,0,cv.width,cv.height);P.forEach(p=>{p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.a-=.012;x.globalAlpha=Math.max(0,p.a);x.fillStyle=p.c;x.fillRect(p.x,p.y,p.r,p.r*1.6)});if(++n<95)requestAnimationFrame(f);else cv.remove()})()}
function limits2(){modal((m,close)=>{const C=JSON.parse(JSON.stringify(CFG));m.append(el('h3',null,'Аккаунты и лимиты'),el('div','mu','Добавляй свои счета, меняй название, баланс, лимит просадки, дневной лимит и цель (в %).'));const box=el('div');m.append(box);
  const draw=()=>{box.replaceChildren();C.accts.forEach((x,i)=>{const g=el('div','fg card');[['name','Название','text'],['bal','Баланс $','number'],['dd','Лимит просадки %','number'],['dl','Дневной лимит %','number'],['tg','Цель %','number']].forEach(([k,lb,ty])=>{const l=el('label'),n=el('input');n.type=ty;n.step='any';n.value=x[k]??'';n.oninput=()=>x[k]=ty==='number'?num(n.value)||0:n.value;l.append(el('span',null,lb),n);g.append(l)});const d=el('button','s','Удалить счёт');d.onclick=()=>two(d,()=>{C.accts.splice(i,1);draw()});g.append(d);box.append(g)})};draw();
  const b=el('div','bar'),ad=el('button','s','＋ Счёт'),s=el('button','p','Сохранить');ad.onclick=()=>{C.accts.push({id:'a'+Date.now().toString(36),name:'Новый счёт',bal:10000,dd:10,dl:5,tg:8});draw()};s.onclick=()=>{CFG=C;try{localStorage.setItem('jcfg',JSON.stringify(CFG))}catch(e){}if(db)db.collection('settings').doc('cfg').set(JSON.parse(JSON.stringify(CFG))).catch(()=>{});close();render();toast('Сохранено ✓')};b.append(ad,s);m.append(b)})}
function more(p,a){const bx=el('div','ins'),H={};a.filter(t=>t.time).forEach(t=>{const h=t.time.slice(0,2);(H[h]=H[h]||[]).push(t)});
  const c1=el('div','card');c1.append(el('b',null,'⏰ По часам входа (ΣR)'));const ks=Object.keys(H).sort();
  if(!ks.length)c1.append(el('div','mu','Укажи «Время входа» в сделках — появится разбор по часам.'));else{const vs=ks.map(k=>stats(H[k]).s),mx=Math.max(1,...vs.map(Math.abs)),w=el('div','hb');ks.forEach((k,i)=>{const col=el('div'),bar=el('em',vs[i]>=0?'w':'l');bar.style.height=Math.max(6,Math.abs(vs[i])/mx*90)+'px';bar.style.animationDelay=i*60+'ms';col.append(bar,el('small',null,k+':00'),el('small',vs[i]>=0?'w':'l',fR(vs[i])));w.append(col)});c1.append(w)}
  const c2=el('div','card');c2.append(el('b',null,'📊 Распределение результата (R)'));const bk={};a.forEach(t=>{const r=R(t),k=r<=-1?'≤−1':r<=0?'0':r<1?'0–1':r<2?'1–2':r<3?'2–3':'3+';bk[k]=(bk[k]||0)+1});
  const ord=['≤−1','0','0–1','1–2','2–3','3+'],mc=Math.max(1,...ord.map(k=>bk[k]||0)),w2=el('div','hb');ord.forEach((k,i)=>{const col=el('div'),bar=el('em',i===0?'l':i===1?'b':'w');bar.style.height=Math.max(4,(bk[k]||0)/mc*90)+'px';bar.style.animationDelay=i*70+'ms';col.append(bar,el('small',null,k),el('small',null,bk[k]||0));w2.append(col)});c2.append(w2);bx.append(c1,c2);p.append(bx);
  const c3=el('div','card');c3.append(el('b',null,'📉 Просадка (R)'));const s=series(a,'R'),dd=[0];let pk=0;s.v.slice(1).forEach(v=>{pk=Math.max(pk,v);dd.push(Math.round((v-pk)*100)/100)});curve(c3,{lb:s.lb,v:dd},'R');p.append(c3)}
document.addEventListener('mousemove',e=>{const t=e.target.closest&&e.target.closest('.card,.tile,.big');if(!t)return;const r=t.getBoundingClientRect(),X=e.clientX-r.left,Y=e.clientY-r.top;t.style.setProperty('--mx',X+'px');t.style.setProperty('--my',Y+'px');if(t.classList.contains('big'))t.style.transform='perspective(700px) rotateX('+((Y/r.height-.5)*-9)+'deg) rotateY('+((X/r.width-.5)*9)+'deg) translateY(-3px)'});
document.addEventListener('mouseout',e=>{const t=e.target.closest&&e.target.closest('.big');if(t&&!t.contains(e.relatedTarget))t.style.transform=''});
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)||document.querySelector('.ov'))return;const m={0:'home',1:'plan',2:'stats',3:'journal',4:'graph',5:'whatif',6:'setups',7:'review'}[e.key];if(m)go(m)});
(function(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const cv=el('canvas');cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none';document.body.prepend(cv);const x=cv.getContext('2d');let W,H,S=[],mx=0,my=0,sh=null;
  const rs=()=>{const d=Math.min(2,devicePixelRatio||1);W=innerWidth;H=innerHeight;cv.width=W*d;cv.height=H*d;x.setTransform(d,0,0,d,0,0);S=Array.from({length:Math.round(W*H/5500)},()=>({x:Math.random()*W,y:Math.random()*H,z:Math.random(),r:Math.random()*1.3+.2,p:Math.random()*6.3,s:.6+Math.random()*2}))};rs();addEventListener('resize',rs);addEventListener('mousemove',e=>{mx=e.clientX/W-.5;my=e.clientY/H-.5});let nx=performance.now()+2500;
  (function f(now){x.clearRect(0,0,W,H);if(motion()!=='full'||window.LOOK&&['off','gradient'].includes(window.LOOK.bg)){requestAnimationFrame(f);return}S.forEach(a=>{a.y-=.03+a.z*.12;if(a.y<-2){a.y=H+2;a.x=Math.random()*W}const px=a.x+mx*a.z*30,py=a.y+my*a.z*30,tw=.45+.55*Math.sin(now/1000*a.s+a.p);x.globalAlpha=tw*(.35+a.z*.65);x.fillStyle=a.z>.75?'#fff':a.z>.4?'#ddd6fe':((window.LOOK&&LOOK.ac)||'#a78bfa');x.beginPath();x.arc(px,py,a.r*(.7+a.z*.6),0,7);x.fill()});x.globalAlpha=1;
   if(window.LOOK&&window.LOOK.bg==='particles'){x.lineWidth=1;const nn=Math.min(S.length,110);for(let i=0;i<nn;i++)for(let j=i+1;j<nn;j++){const A=S[i],B=S[j],d=Math.hypot(A.x-B.x,A.y-B.y);if(d<140){x.strokeStyle='rgba(139,92,246,'+(.22*(1-d/140))+')';x.beginPath();x.moveTo(A.x,A.y);x.lineTo(B.x,B.y);x.stroke()}}}if(!sh&&now>nx){sh={x:Math.random()*W*.8+W*.1,y:Math.random()*H*.4,vx:6+Math.random()*4,vy:3+Math.random()*2,l:0};nx=now+4000+Math.random()*5000}
   if(sh){sh.x+=sh.vx;sh.y+=sh.vy;sh.l++;const g=x.createLinearGradient(sh.x,sh.y,sh.x-sh.vx*14,sh.y-sh.vy*14);g.addColorStop(0,'rgba(255,255,255,.95)');g.addColorStop(1,'rgba(167,139,250,0)');x.strokeStyle=g;x.lineWidth=2;x.beginPath();x.moveTo(sh.x,sh.y);x.lineTo(sh.x-sh.vx*14,sh.y-sh.vy*14);x.stroke();if(sh.l>70)sh=null}requestAnimationFrame(f)})(performance.now())})();
(function(){return;const cv=el('canvas');cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none';document.body.prepend(cv);const x=cv.getContext('2d');let W,H,P=[];const rs=()=>{W=cv.width=innerWidth;H=cv.height=innerHeight;P=Array.from({length:Math.min(70,Math.round(W*H/22000))},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.6+.5}))};rs();addEventListener('resize',rs);
  (function f(){x.clearRect(0,0,W,H);P.forEach((a,i)=>{a.x=(a.x+a.vx+W)%W;a.y=(a.y+a.vy+H)%H;x.fillStyle='rgba(196,181,253,.55)';x.beginPath();x.arc(a.x,a.y,a.r,0,7);x.fill();for(let j=i+1;j<P.length;j++){const b=P[j],d=Math.hypot(a.x-b.x,a.y-b.y);if(d<130){x.strokeStyle='rgba(139,92,246,'+(.2*(1-d/130))+')';x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke()}}});requestAnimationFrame(f)})()})();
function go0(k){if(k===view||window._go)return;if(matchMedia('(prefers-reduced-motion:reduce)').matches){view=k;render();return}window._go=1;const v=$('#v'),s=el('div','sweep');document.body.append(s);v.classList.add('out');setTimeout(()=>{view=k;render();v.classList.remove('out');window.scrollTo({top:0,behavior:'smooth'})},260);setTimeout(()=>{s.remove();window._go=0},950)}
const idb=()=>new Promise((res,rej)=>{const q=indexedDB.open('jmedia',1);q.onupgradeneeded=()=>q.result.createObjectStore('m');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const mget=async k=>{try{const d=await idb();return await new Promise(res=>{const q=d.transaction('m').objectStore('m').get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}};
const mput=async(k,v)=>{try{const d=await idb();await new Promise((res,rej)=>{const tx=d.transaction('m','readwrite');v===null?tx.objectStore('m').delete(k):tx.objectStore('m').put(v,k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});return true}catch(e){return false}};
const SHOTS={mem:new Map(),
 path(s){const u=accountApi.user;return accountApi.cloud&&u&&u.uid&&/^[\w-]{1,64}$/.test(String(s.id))?u.uid+'/'+s.id:null},
 async get(s){if(!s)return null;if(s.url)return s.url;if(this.mem.has(s.id))return this.mem.get(s.id);let v=await mget('shot:'+s.id);if(!v){const p=this.path(s);if(p){try{const{data,error}=await accountApi.sb.storage.from('shots').download(p);if(!error&&data&&/^image\//.test(data.type)){v=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(data)});mput('shot:'+s.id,v)}}catch(e){}}}if(v)this.mem.set(s.id,v);return v||null},
 async put(s,data){this.mem.set(s.id,data);const okL=await mput('shot:'+s.id,data);if(!accountApi.user)return okL;const p=this.path(s);if(!p||accountApi.readOnly||!/^data:image\//.test(String(data)))return false;try{const blob=await(await fetch(data)).blob();if(blob.size>2*1024*1024)throw new Error('Screenshot is larger than 2 MB');const{error}=await accountApi.sb.storage.from('shots').upload(p,blob,{upsert:true,contentType:blob.type||'image/jpeg'});if(error)throw error;return okL}catch(e){console.warn('Shot upload failed',e);return false}},
 bind(im,s){im.alt='Скриншот сделки';this.get(s).then(u=>{if(u)im.src=u});im.onclick=async()=>{const u=await this.get(s);u?openShot(u):toast('Скриншот не найден на этом устройстве')}}
};
async function migrateShots(){try{let ch=false;for(const arr of[T,P])for(const rec of arr||[])for(const s of rec.shots||[])if(s&&s.url&&s.id&&await SHOTS.put(s,s.url)){delete s.url;ch=true}if(ch){localStorage.setItem('jt',JSON.stringify(T));localStorage.setItem('jp',JSON.stringify(P));toast('Фото перенесены в отдельное хранилище ✓')}}catch(e){console.warn('Shot migration failed',e)}}
const vb=el('button','s','🎬 Интро-видео'),vf=el('input');vf.type='file';vf.accept='video/*';vf.style.display='none';vf.onchange=async()=>{const f=vf.files[0];if(f)toast((await mput('intro',f))?'Интро сохранено — увидишь при следующем запуске':'Не удалось сохранить видео')};vb.onclick=()=>vf.click();
const vd=el('button','s','✕ Убрать интро');vd.onclick=async()=>{await mput('intro',null);toast('Интро убрано')};const vr=el('button','s','↻ Показать интро');vr.onclick=()=>{document.body.classList.add('pre');intro()};
function goCine(k){if(k===view||window._go)return;if(motion()!=='full'){view=k;render();return}window._go=1;const B=document.body,a=el('div','lb t'),b=el('div','lb b');B.append(a,b);B.classList.add('cine');requestAnimationFrame(()=>requestAnimationFrame(()=>{a.classList.add('in');b.classList.add('in')}));
  setTimeout(()=>{B.append(el('div','sweep'),el('div','flash'))},420);setTimeout(()=>{view=k;render();window.scrollTo({top:0});B.classList.remove('cine');B.classList.add('first')},820);setTimeout(()=>{a.classList.remove('in');b.classList.remove('in')},1150);setTimeout(()=>{a.remove();b.remove();document.querySelectorAll('.sweep,.flash').forEach(e=>e.remove());B.classList.remove('first');window._go=0},1750)}
async function intro(){const B=document.body;let done=false;const reveal=()=>{if(done)return;done=true;if(accountApi.user){B.classList.remove('pre');render()}else startMenu()};setTimeout(reveal,25000);
  try{const blob=await mget('intro'),ov=el('div','intro'),sk=el('button','s skip','Пропустить ›');document.body.append(ov);ov.append(sk);const skipKey=e=>{if(!ov.isConnected){removeEventListener('keydown',skipKey);return}if(e.key==='Escape'||e.key===' '||e.key==='Enter'){e.preventDefault();sk.click()}};addEventListener('keydown',skipKey);ov.addEventListener('click',e=>{if(Date.now()-(ov._ig||0)<900||ov.classList.contains('wait'))return;if(!e.target.closest('button'))sk.click()});
   if(!blob){const lg=el('div','splash');lg.append(logoEl(),el('span','sub','Journal by myIDgod'));const ub=el('button','p snd','🎬 Загрузить своё интро-видео'),uf=el('input');uf.type='file';uf.accept='video/*';uf.style.display='none';uf.onchange=async()=>{const f=uf.files[0];if(f&&await mput('intro',f)){ov.remove();document.body.classList.add('pre');intro()}};ub.onclick=()=>uf.click();ov.append(lg,ub,uf);const end=()=>{reveal();ov.classList.add('fade');setTimeout(()=>ov.remove(),1400)};setTimeout(end,3200);sk.onclick=end;return}
   const v=el('video','ivid');v.src=URL.createObjectURL(blob);v.playsInline=true;v.preload='auto';ov.prepend(v);let snd=true;try{await v.play()}catch(e){snd=false}if(!snd){const tap=el('button','p snd tap','▶ Нажмите, чтобы начать со звуком');ov.append(tap);ov.classList.add('wait');await new Promise(res=>{const go=ev=>{if(ev&&ev.target&&ev.target.closest&&ev.target.closest('.skip'))ov._skip=1;ov._ig=Date.now();ov.removeEventListener('pointerdown',go,true);removeEventListener('keydown',go,true);res()};ov.addEventListener('pointerdown',go,true);addEventListener('keydown',go,true);setTimeout(go,15000)});tap.remove();ov.classList.remove('wait');if(!ov.isConnected)return;if(ov._skip){URL.revokeObjectURL(v.src);reveal();ov.classList.add('fade');setTimeout(()=>ov.remove(),900);return}v.currentTime=0;try{v.muted=false;await v.play();snd=true}catch(e){v.muted=true;try{await v.play()}catch(e2){}}}
   if(!snd){const sb=el('button','p snd','🔊 Включить звук');sb.onclick=()=>{v.muted=false;v.volume=1;sb.remove()};ov.append(sb)}
   const T=Math.max(.5,Math.min(+localStorage.getItem('jrev')||10,(v.duration||14)-4));let fs=false;const fade=D=>{if(fs)return;fs=true;reveal();ov.classList.add('reveal');const t0=performance.now(),v0=v.volume;(function f(now){const k=Math.min(1,(now-t0)/D);v.volume=Math.max(0,v0*(1-k));v.style.opacity=String(1-k);if(k<1)requestAnimationFrame(f);else{v.pause();URL.revokeObjectURL(v.src);ov.remove()}})(t0)};
   (function chk(){if(fs)return;if(v.currentTime>=T||v.ended)fade(4000);else requestAnimationFrame(chk)})();sk.onclick=()=>fade(700)}catch(e){reveal()}}
async function shareCard(o){const st={asset:o.inst||'',entry:o.entry||'',exit:o.exit||'',date:o.date||today(),side:o.side||'Long',pnl:'',dur:''};const r0=R(o),k0=num(o.risk),en=num(o.entry),ex=num(o.exit);
  if(r0!==null&&k0!=null)st.pnl=String(f2(r0*k0));else if(en&&ex!=null)st.pnl=String(f2((ex-en)/en*100*(st.side==='Short'?-1:1)));
  let t0=performance.now(),vid=null,url=null,ss=null,markUrl=null,previewUrl=null;let W=900,H=1200;const cv=el('canvas'),x=cv.getContext('2d'),shareLogo=new Image(),markSvg=new XMLSerializer().serializeToString(logoEl().querySelector('svg'));markUrl=URL.createObjectURL(new Blob([markSvg],{type:'image/svg+xml'}));shareLogo.src=markUrl;cv.width=W;cv.height=H;cv.style.cssText='width:min(380px,100%);border-radius:18px;border:1px solid var(--bd);display:block';const drawLogo=(cx,cy,w,alpha)=>{if(!shareLogo.complete||!shareLogo.naturalWidth)return;x.save();x.globalAlpha=alpha;x.globalCompositeOperation='screen';x.shadowColor='#9d4cff';x.shadowBlur=24;x.drawImage(shareLogo,cx-w/2,cy-w*260/360/2,w,w*260/360);x.restore()};
  const ease=t=>1-Math.pow(1-Math.min(1,Math.max(0,t)),3),seg=(t,a,b)=>ease((t-a)/(b-a)),F=(w,s)=>w+' '+s+'px Inter,system-ui,-apple-system,sans-serif';
  const frame=now=>{if(!cv.isConnected){if(url)URL.revokeObjectURL(url);if(markUrl){URL.revokeObjectURL(markUrl);markUrl=null}return}const t=(now-t0)/1000;const L=ss?{pnl:545,pf:170,r1:1105,d:1295}:{pnl:720,pf:220,r1:920,d:H-110};x.fillStyle='#050409';x.fillRect(0,0,W,H);
   if(vid&&vid.readyState>1&&vid.videoWidth){const s=Math.max(W/vid.videoWidth,H/vid.videoHeight),w=vid.videoWidth*s,h=vid.videoHeight*s;x.drawImage(vid,(W-w)/2,(H-h)/2,w,h)}else{const bg=x.createLinearGradient(0,0,W,H);bg.addColorStop(0,LOOK.bg1||'#100b2b');bg.addColorStop(.52,LOOK.bg2||'#25105c');bg.addColorStop(1,LOOK.bg3||'#071c3b');x.fillStyle=bg;x.fillRect(0,0,W,H)}
   const sh=x.createLinearGradient(0,0,0,H);sh.addColorStop(0,'rgba(0,0,0,.55)');sh.addColorStop(.45,'rgba(0,0,0,.25)');sh.addColorStop(1,'rgba(0,0,0,.72)');x.fillStyle=sh;x.fillRect(0,0,W,H);x.textAlign='center';
   let a=seg(t,0,.8);drawLogo(W/2,160,230*(.6+.4*a),a);
   a=seg(t,.3,1);x.save();x.globalAlpha=a;x.fillStyle='#fff';x.font=F(700,64);x.fillText((st.asset||'—')+'  ·  '+st.side.toUpperCase(),W/2,430+(1-a)*50);x.restore();
   a=seg(t,.7,1.9);const pv=parseFloat(String(st.pnl).replace(',','.')),ng=pv<0,c=ng?'#fb7185':'#34d399';x.save();x.globalAlpha=Math.min(1,a*1.6);x.translate(W/2,L.pnl);const pp=.85+.15*Math.min(1,a*1.2);x.scale(pp,pp);x.shadowColor=c;x.shadowBlur=60;x.fillStyle=c;x.font=F(900,L.pf);x.fillText(isFinite(pv)?((pv>0?'+':pv<0?'−':'')+(Math.abs(pv)*a).toFixed(2)+'%'):'—',0,0);x.restore();
   if(r0!==null){const q=seg(t,1.3,2);x.save();x.globalAlpha=q;x.font=F(700,52);x.fillStyle='rgba(255,255,255,.85)';x.fillText(fR(r0),W/2,L.pnl+(ss?60:90));x.restore()}
   if(ss){const q=seg(t,1.2,2),w=860,h=Math.min(380,w*ss.height/ss.width),sx=(W-w)/2,sy=620+(1-q)*40;x.save();x.globalAlpha=q;x.beginPath();x.roundRect(sx,sy,w,h,26);x.clip();x.drawImage(ss,sx,sy,w,h);x.restore();x.save();x.globalAlpha=q*.5;x.strokeStyle='#a78bfa';x.lineWidth=3;x.beginPath();x.roundRect(sx,sy,w,h,26);x.stroke();x.restore()}
   [['ВХОД',st.entry,1.5],['ВЫХОД',st.exit,1.75]].forEach(([l,v,s0],i)=>{const q=seg(t,s0,s0+.6),y=L.r1+i*95+(1-q)*40;x.save();x.globalAlpha=q;x.textAlign='left';x.fillStyle='rgba(255,255,255,.55)';x.font=F(600,40);x.fillText(l,150,y);x.textAlign='right';x.fillStyle='#fff';x.font=F(700,56);x.fillText(String(v||'—'),W-150,y);x.globalAlpha=q*.25;x.fillStyle='#fff';x.fillRect(150,y+28,W-300,2);x.restore()});
   a=seg(t,2.1,2.7);x.save();x.globalAlpha=a;x.fillStyle='rgba(255,255,255,.72)';x.font=F(600,44);x.fillText(st.date||'',W/2,L.d);x.restore();requestAnimationFrame(frame)};
  const loadBg=async()=>{if(vid){vid.pause();vid.remove();vid=null}if(url){URL.revokeObjectURL(url);url=null}const b=await mget('share');if(!b)return;url=URL.createObjectURL(b);vid=document.createElement('video');vid.src=url;vid.loop=true;vid.muted=true;vid.playsInline=true;vid.setAttribute('playsinline','');vid.preload='auto';vid.style.cssText='position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';document.body.append(vid);vid.addEventListener('loadeddata',()=>vid&&vid.play().catch(()=>{}));vid.play().catch(()=>{})};
  const frame2=now=>{if(!cv.isConnected){if(url)URL.revokeObjectURL(url);if(markUrl){URL.revokeObjectURL(markUrl);markUrl=null}if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}if(vid){vid.pause();vid.remove()}return}const t=(now-t0)/1000,u=Math.min(W,H)/1080,ls=W/H>1.2,F=(w,s)=>w+' '+Math.round(s*u)+'px Inter,system-ui,-apple-system,sans-serif',cx=ls&&ss?W*.3:W/2,LP=!!ss&&!ls,ay=(a,b)=>seg(t,a,b),cw=(window.LOOK&&LOOK.w)||'#34d399',cl2=(window.LOOK&&LOOK.l)||'#fb7185';
   if(vid&&vid.readyState>1&&vid.videoWidth){const s=Math.max(W/vid.videoWidth,H/vid.videoHeight),w=vid.videoWidth*s,h=vid.videoHeight*s;x.drawImage(vid,(W-w)/2,(H-h)/2,w,h)}else{const bg=x.createLinearGradient(0,0,W,H);bg.addColorStop(0,LOOK.bg1||'#100b2b');bg.addColorStop(.52,LOOK.bg2||'#25105c');bg.addColorStop(1,LOOK.bg3||'#071c3b');x.fillStyle=bg;x.fillRect(0,0,W,H)}
   const sh=x.createLinearGradient(0,0,0,H);sh.addColorStop(0,'rgba(0,0,0,.55)');sh.addColorStop(.45,'rgba(0,0,0,.25)');sh.addColorStop(1,'rgba(0,0,0,.72)');x.fillStyle=sh;x.fillRect(0,0,W,H);x.textAlign='center';let a=ay(0,.8);
   drawLogo(cx,H*(ls?.16:.125),230*u*(.6+.4*a),a);
   a=ay(.3,1);x.save();x.globalAlpha=a;x.fillStyle='#fff';x.font=F(700,58);x.fillText((st.asset||'—')+'  ·  '+st.side.toUpperCase(),cx,H*.285+(1-a)*40*u);x.restore();
   a=ay(.7,1.9);const pv=parseFloat(String(st.pnl).replace(',','.')),c=pv<0?cl2:cw,py=H*(LP?.455:ls?.53:.5);x.save();x.globalAlpha=Math.min(1,a*1.6);x.translate(cx,py);const pp=.85+.15*Math.min(1,a*1.2);x.scale(pp,pp);x.shadowColor=c;x.shadowBlur=60*u;x.fillStyle=c;x.font=F(900,LP?170:210);x.fillText(isFinite(pv)?((pv>0?'+':pv<0?'−':'')+(Math.abs(pv)*a).toFixed(2)+'%'):'—',0,0);x.restore();
   if(r0!==null){a=ay(1.3,2);x.save();x.globalAlpha=a;x.font=F(700,48);x.fillStyle='rgba(255,255,255,.85)';x.fillText(fR(r0),cx,py+62*u);x.restore()}
   if(ss){a=ay(1.2,2);const w=ls?W*.43:W*.82,h=ls?H*.72:H*.3,bx=ls?W*.52:(W-w)/2,by=(ls?H*.14:H*.53)+(1-a)*40*u,k=Math.max(w/ss.width,h/ss.height),sw=w/k,sh2=h/k;x.save();x.globalAlpha=a;x.beginPath();x.roundRect(bx,by,w,h,26*u);x.clip();x.drawImage(ss,(ss.width-sw)/2,(ss.height-sh2)/2,sw,sh2,bx,by,w,h);x.restore();x.save();x.globalAlpha=a*.5;x.strokeStyle='#a78bfa';x.lineWidth=3*u;x.beginPath();x.roundRect(bx,by,w,h,26*u);x.stroke();x.restore()}
   const rx0=cx-(ls&&ss?W*.22:W*.36),rx1=cx+(ls&&ss?W*.22:W*.36);
   if(LP){a=ay(1.5,2.1);x.save();x.globalAlpha=a;x.fillStyle='rgba(255,255,255,.9)';x.font=F(700,44);x.fillText('ВХОД '+(st.entry||'—')+'  →  ВЫХОД '+(st.exit||'—'),cx,H*.885);x.restore()}else{[['ВХОД',st.entry,1.5],['ВЫХОД',st.exit,1.75]].forEach(([l,v,s0],i)=>{const q=ay(s0,s0+.6),y=H*.72+i*88*u+(1-q)*36*u;x.save();x.globalAlpha=q;x.textAlign='left';x.fillStyle='rgba(255,255,255,.55)';x.font=F(600,38);x.fillText(l,rx0,y);x.textAlign='right';x.fillStyle='#fff';x.font=F(700,52);x.fillText(String(v||'—'),rx1,y);x.globalAlpha=q*.25;x.fillStyle='#fff';x.fillRect(rx0,y+24*u,rx1-rx0,2);x.restore()})}
   a=ay(2.1,2.7);x.save();x.globalAlpha=a;x.fillStyle='rgba(255,255,255,.72)';x.font=F(600,42);x.fillText(st.date||'',cx,H*.955);x.restore();requestAnimationFrame(frame2)};
  modal((m,close)=>{m.style.width='min(920px,100%)';m.append(el('h3',null,'Поделиться позицией'));const row=el('div','shr'),side=el('div'),g=el('div','fg');row.append(cv,side);side.append(g);m.append(row);
   const inp=(lb,k)=>{const l=el('label'),i=el('input');i.value=st[k];i.oninput=()=>st[k]=i.value;l.append(el('span',null,lb),i);g.append(l)};inp('Прибыль, %','pnl');inp('Актив','asset');inp('Цена входа','entry');inp('Цена выхода','exit');inp('Дата','date');inp('Длительность, с (пусто = по видео)','dur');
   const sl=el('label'),sd=el('select');['Long','Short'].forEach(v=>sd.append(new Option(v,v)));sd.value=st.side;sd.onchange=()=>st.side=sd.value;sl.append(el('span',null,'Направление'),sd);g.append(sl);const fl2=el('label'),fsel=el('select');[['3:4',900,1200],['1:1',1080,1080],['4:3',1200,900],['16:9',1280,720],['9:16',1080,1920]].forEach(([n,w,h])=>fsel.append(new Option(n,n+'|'+w+'|'+h)));fsel.onchange=()=>{const p=fsel.value.split('|');W=+p[1];H=+p[2];cv.width=W;cv.height=H;cv.style.width=W>H?'100%':'min(380px,100%)';t0=performance.now()};fl2.append(el('span',null,'Формат'),fsel);g.append(fl2);
   const bar=el('div','bar'),fi=el('input');fi.type='file';fi.accept='video/*';fi.style.display='none';fi.onchange=async()=>{const f=fi.files[0];if(!f)return;if(!(await mput('share',f)))toast('Не удалось сохранить фон');await loadBg();t0=performance.now()};
   const bt=(tx,c,fn)=>{const b=el('button',c,tx);b.onclick=fn;bar.append(b);return b};bt('▶ Повторить','s',async()=>{t0=performance.now();if(vid){try{vid.currentTime=0;await vid.play()}catch(error){toast('Не удалось перезапустить видео: '+error.message)}}});bt('🎞 Свой видео-фон','s',()=>fi.click());bt('✕ Фон','s',async()=>{if(!await mput('share',null)){toast('Не удалось удалить видео-фон');return}await loadBg()});const fsi=el('input');fsi.type='file';fsi.accept='image/*';fsi.style.display='none';const setSS=async f=>{if(!f)return;const im=new Image(),imageUrl=URL.createObjectURL(f);im.src=imageUrl;try{await im.decode();ss=im;t0=performance.now()}catch(error){URL.revokeObjectURL(imageUrl);toast('Не удалось открыть изображение: '+error.message)}};fsi.onchange=()=>setSS(fsi.files[0]);bt('🖼 Скриншот','s',()=>fsi.click());const sb2=bt('🔇 Звук выключен','s',async()=>{if(!vid){toast('Сначала выбери свой видео-фон');return}if(vid.muted){vid.defaultMuted=false;vid.removeAttribute('muted');vid.muted=false;vid.volume=1;try{await vid.play()}catch(error){toast('Не удалось запустить звук: '+error.message);return}if(typeof vid.captureStream==='function'){const stream=vid.captureStream(),hasAudio=stream.getAudioTracks().length>0;stream.getTracks().forEach(track=>track.stop());if(!hasAudio)toast('Браузер не передаёт звук этого видео. Открой журнал в Safari или Chrome.')}}else{vid.muted=true;vid.defaultMuted=true}sb2.textContent=vid.muted?'🔇 Звук выключен':'🔊 Звук включён';sb2.setAttribute('aria-pressed',String(!vid.muted));sb2.title=vid.muted?'Включить звук видео':'Выключить звук видео'});sb2.setAttribute('aria-pressed','false');sb2.title='Включить звук видео';bt('✕ Скриншот','s',()=>{ss=null;t0=performance.now()});side.append(fsi);const ph=e=>{if(!cv.isConnected){window.removeEventListener('paste',ph,true);return}for(const it of e.clipboardData.items)if(it.type.startsWith('image/')){setSS(it.getAsFile());e.stopImmediatePropagation()}};window.addEventListener('paste',ph,true);
   const fim=el('img'),fvd=el('video');fim.style.cssText='display:none;max-width:100%;margin-top:8px;border-radius:12px';fvd.style.cssText='display:none;width:min(420px,100%);max-height:68vh;object-fit:contain;margin-top:12px;border-radius:12px;background:#050409';fvd.controls=true;fvd.playsInline=true;fvd.preload='metadata';
   const save=async(name,b,show)=>{if(!b){toast('Не удалось подготовить файл для скачивания');return}if(show){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(b);show.src=previewUrl;show.style.display='block';show.load()}try{if(window.claude&&typeof window.claude.use==='function'){const d=await window.claude.use('downloads');if(d){await d.save({filename:name,data:b});return}}}catch(error){console.warn('Native download service is unavailable; using browser download:',error)}const u=URL.createObjectURL(b),a=el('a');a.href=u;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)};
   const exportCard=async()=>{
     if(!window.MediaRecorder||!cv.captureStream){toast('Запись видео не поддерживается в этом браузере');return}
     const hasV=!!(vid&&Number.isFinite(vid.duration)&&vid.duration>0),audioTypes=['video/mp4;codecs=avc3,mp4a.40.2','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4'],silentTypes=['video/mp4;codecs=avc3','video/mp4;codecs=avc1','video/mp4'],mt=(hasV?audioTypes:silentTypes).find(type=>MediaRecorder.isTypeSupported(type));
     if(!mt){toast(hasV?'Этот браузер не поддерживает MP4 со звуком. Открой журнал в актуальном Safari или Chrome.':'Этот браузер не умеет записывать MP4. Открой журнал в актуальном Safari или Chrome.');return}
     const customDur=Number(st.dur),dur=Number.isFinite(customDur)&&customDur>0?customDur:(hasV?vid.duration:3.5),wasMuted=vid?vid.muted:null,wasDefaultMuted=vid?vid.defaultMuted:null,hadMutedAttribute=vid?vid.hasAttribute('muted'):false,wasLoop=vid?vid.loop:null,wasVolume=vid?vid.volume:null;
     rb.disabled=true;rb.textContent='Готовлю MP4…';let cs,sourceStream=null,ds=null,mr=null,tick=null,fin=null;
     try{
       cs=cv.captureStream(30);
       if(hasV){
         vid.pause();vid.loop=false;vid.muted=false;vid.defaultMuted=false;vid.removeAttribute('muted');vid.volume=1;
         sourceStream=typeof vid.captureStream==='function'?vid.captureStream():null;
         const sourceTracks=sourceStream&&sourceStream.getAudioTracks();
         if(sourceStream&&!sourceTracks.length)throw new Error('Браузер не передаёт звук этого видео. Открой журнал в Safari или Chrome.');
         if(sourceTracks&&sourceTracks.length)sourceTracks.forEach(track=>cs.addTrack(track));
         else{
           const AudioContextClass=window.AudioContext||window.webkitAudioContext;
           if(!AudioContextClass)throw new Error('В этом браузере нет поддержки захвата звука');
           const ac=vid._ac||(vid._ac=new AudioContextClass()),source=vid._sr||(vid._sr=ac.createMediaElementSource(vid));
           if(vid._ds){try{source.disconnect(vid._ds)}catch(error){}}
           ds=ac.createMediaStreamDestination();source.connect(ds);source.connect(ac.destination);vid._ds=ds;
           await ac.resume();
           const tracks=ds.stream.getAudioTracks();if(!tracks.length)throw new Error('Не удалось подключить звуковую дорожку');
           tracks.forEach(track=>cs.addTrack(track))
         }
         if(vid.currentTime>.01)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Не удалось перемотать видео к началу')),2000);vid.addEventListener('seeked',()=>{clearTimeout(timeout);resolve()}, {once:true});vid.currentTime=0});
         else vid.currentTime=0
       }
       const chunks=[];mr=new MediaRecorder(cs,{mimeType:mt,videoBitsPerSecond:50e6,audioBitsPerSecond:192e3});
       fin=new Promise((resolve,reject)=>{mr.onstop=resolve;mr.onerror=event=>reject(event.error||new Error('Ошибка записи MP4'))});
       mr.ondataavailable=event=>{if(event.data&&event.data.size)chunks.push(event.data)};
       t0=performance.now();mr.start(250);if(hasV)await vid.play();
       const started=performance.now();tick=setInterval(()=>{rb.textContent='Создаю MP4… '+Math.min(100,Math.round((performance.now()-started)/dur/10))+'%'},300);
       await new Promise(resolve=>setTimeout(resolve,dur*1000+150));if(mr.state!=='inactive')mr.stop();await fin;
       await save('position-'+(st.asset||'trade')+'-'+st.date+'.mp4',new Blob(chunks,{type:mt}),fvd)
     }catch(error){
       if(mr&&mr.state!=='inactive'){mr.stop();if(fin)await fin.catch(()=>{})}
       toast('Не удалось создать MP4: '+(error.message||'ошибка записи'))
     }finally{
       if(tick)clearInterval(tick);if(cs)cs.getTracks().forEach(track=>track.stop());if(sourceStream)sourceStream.getTracks().forEach(track=>track.stop());
       if(vid){vid.pause();vid.loop=wasLoop;vid.defaultMuted=wasDefaultMuted;if(hadMutedAttribute)vid.setAttribute('muted','');else vid.removeAttribute('muted');vid.muted=wasMuted;vid.volume=wasVolume;if(vid._sr&&ds){try{vid._sr.disconnect(ds)}catch(error){}}vid._ds=null;vid.play().catch(()=>{})}
       rb.disabled=false;rb.textContent='⬇ Скачать карточку (MP4)'
     }
   };
   bt('⬇ PNG','p',()=>cv.toBlob(b=>save('position-'+(st.asset||'trade')+'-'+st.date+'.png',b,fim),'image/png'));
   const rb=bt('⬇ Скачать карточку (MP4)','p',()=>exportCard());
   side.append(bar,fi,el('div','mu','Фон — твоё видео (хранится только в этом браузере). Тексты появляются по таймлайну, как в карточках Axiom.'),fim,fvd)});
  await loadBg();requestAnimationFrame(frame2)}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('button');if(!b)return;const r=b.getBoundingClientRect(),s=el('span','rip');s.style.left=(e.clientX-r.left)+'px';s.style.top=(e.clientY-r.top)+'px';b.append(s);setTimeout(()=>s.remove(),700)});
document.addEventListener('mousemove',e=>{const b=e.target.closest&&e.target.closest('button.p,button.s');if(!b)return;const r=b.getBoundingClientRect();b.style.setProperty('--tx',((e.clientX-r.left-r.width/2)*.18)+'px');b.style.setProperty('--ty',((e.clientY-r.top-r.height/2)*.28)+'px')});
document.addEventListener('mouseout',e=>{const b=e.target.closest&&e.target.closest('button.p,button.s');if(b&&!b.contains(e.relatedTarget)){b.style.setProperty('--tx','0px');b.style.setProperty('--ty','0px')}});
(function(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;const o=el('div','orb');document.body.append(o);let X=innerWidth/2,Y=innerHeight/2,a=X,b=Y;addEventListener('mousemove',e=>{X=e.clientX;Y=e.clientY});(function f(){a+=(X-a)*.1;b+=(Y-b)*.1;o.style.transform='translate('+(a-200)+'px,'+(b-200)+'px)';requestAnimationFrame(f)})()})();
const DOWN=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],WK=[['inst','Инструмент'],['kind','Тип'],['cvd','CVD'],['tape','Speed of Tape'],['poc','Footprint: POC'],['zero','Footprint: Zero'],['ivb','IVB'],['ivbtf','IVB диапазон'],['vp','Профиль RTH'],['origin','Набрана от'],['node','LVN / HVN'],['side','Направление'],['grade','Оценка'],['emo','Состояние'],['risk','Риск %'],['dow','День недели'],['hour','Час входа'],['acc','Аккаунт']],WKL=Object.fromEntries(WK);
const gv=(t,k)=>k==='dow'?DOWN[new Date(t.date+'T00:00').getDay()]:k==='hour'?(t.time||'').slice(0,2):k==='acc'?accL(t):(t[k]==null?'':String(t[k]));
const pass=(t,rs)=>rs.every(r=>r.v===''||(r.op==='='?gv(t,r.k)===r.v:gv(t,r.k)!==r.v));
const vals=k=>{const s=new Set(),f=FIELDS.find(x=>x[0]===k);if(f&&Array.isArray(f[2]))f[2].forEach(v=>s.add(v));if(k==='inst')INST.forEach(v=>s.add(v));if(k==='dow')DOWN.forEach(v=>s.add(v));T.forEach(t=>{const v=gv(t,k);if(v)s.add(v)});return[...s]};
const setupsOf=t=>(CFG.setups||[]).filter(s=>pass(t,s.rules)).map(s=>s.name).join(', ');
const saveCfg=()=>{try{localStorage.setItem('jcfg',JSON.stringify(CFG))}catch(e){}if(db)db.collection('settings').doc('cfg').set(JSON.parse(JSON.stringify(CFG))).catch(()=>{})};
function ruleEd(p,rs,cb){const w=el('div'),draw=()=>{w.replaceChildren();rs.forEach((r,i)=>{const row=el('div','bar'),sk=el('select'),so=el('select'),sv=el('select');WK.forEach(([k,l])=>sk.append(new Option(l,k)));sk.value=r.k;[['=','равно'],['!=','не равно']].forEach(([v,l])=>so.append(new Option(l,v)));so.value=r.op;
    const fill=()=>{sv.replaceChildren();const vs=vals(r.k);vs.forEach(v=>sv.append(new Option(v,v)));if(!vs.includes(r.v))r.v=vs[0]||'';sv.value=r.v};fill();sk.onchange=()=>{r.k=sk.value;r.v='';fill();cb()};so.onchange=()=>{r.op=so.value;cb()};sv.onchange=()=>{r.v=sv.value;cb()};
    const x=el('button','s','✕');x.onclick=()=>{rs.splice(i,1);draw();cb()};row.append(sk,so,sv,x);w.append(row)});const ad=el('button','s','＋ Условие');ad.onclick=()=>{rs.push({k:'cvd',op:'=',v:''});draw();cb()};w.append(ad)};draw();p.append(w)}
function dual(box,A,B){const n=A.length;if(n<2){box.append(el('div','msg','Нет данных'));return}const W=900,H=300,pl=60,pr=16,pt=14,pb=28,al=A.concat(B),lo=Math.min(0,...al),hi=Math.max(0,...al),sp=(hi-lo)||1,x=i=>pl+i/(n-1)*(W-pl-pr),y=v=>pt+(1-(v-lo)/sp)*(H-pt-pb),NS='http://www.w3.org/2000/svg',sv=document.createElementNS(NS,'svg');sv.setAttribute('viewBox','0 0 '+W+' '+H);
  const mk=(t,at)=>{const e=document.createElementNS(NS,t);for(const k in at)e.setAttribute(k,at[k]);sv.appendChild(e);return e};for(let k=0;k<5;k++){const v=lo+sp*k/4;mk('line',{x1:pl,x2:W-pr,y1:y(v),y2:y(v),class:'gl'});mk('text',{x:pl-7,y:y(v)+4,'text-anchor':'end',class:'ax'}).textContent=f2(v)+'R'}
  mk('line',{x1:pl,x2:W-pr,y1:y(0),y2:y(0),stroke:'#888','stroke-dasharray':'5 4'});const path=(S,c,wd)=>{let d='';S.forEach((v,i)=>d+=(i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1));mk('path',{d,fill:'none',stroke:c,'stroke-width':wd,'stroke-linejoin':'round',class:'dl',pathLength:1})};path(A,'#a69dca',2);path(B,'#34d399',3);box.append(sv);
  const lg=el('div','bar');lg.style.padding='0 8px';[['#a69dca','все сделки'],['#34d399','только по правилам']].forEach(([c,t])=>{const s=el('span','mu','● '+t);s.style.color=c;lg.append(s)});box.append(lg)}
function setupForm(s){const o=JSON.parse(JSON.stringify(s));modal((m,close)=>{m.append(el('h3',null,s.id?'Сетап':'Новый сетап'));const n=el('input');n.placeholder='Название, например «Absorption от VAL»';n.value=o.name;n.style.width='100%';n.oninput=()=>o.name=n.value;m.append(n,el('div','mu','Сделка относится к сетапу, если выполняются все условия:'));ruleEd(m,o.rules,()=>{});
    const b=el('div','bar'),sv=el('button','p','Сохранить');sv.onclick=()=>{if(!o.name.trim()){toast('Введи название');return}CFG.setups=CFG.setups||[];if(o.id)CFG.setups=CFG.setups.map(x=>x.id===o.id?o:x);else{o.id='s'+Date.now().toString(36);CFG.setups.push(o)}saveCfg();close();render();toast('Сетап сохранён ✓')};b.append(sv);m.append(b)})}
function vWhatIf(p){const st=window._wi=window._wi||{rules:[{k:'tape',op:'=',v:'On'}],acc:'all'};p.append(el('div','mu','Включи условия — журнал пересчитает кривую так, будто ты брал только подходящие сделки.'));
  const box=el('div'),rb=el('div','card');rb.append(el('b',null,'Условия (все должны выполняться)'));
  const draw=()=>{box.replaceChildren();const a=cl().filter(t=>st.acc==='all'||t[st.acc]);if(!a.length){box.append(el('div','msg','Нет сделок с результатом.'));return}const keep=a.filter(t=>pass(t,st.rules)),out=a.filter(t=>!pass(t,st.rules)),s0=stats(a),s1=stats(keep),so=stats(out),pf=x=>x.pf==null?'—':x.pf===Infinity?'∞':f2(x.pf);
    tiles(box,[[s1.n+' из '+s0.n,'сделок проходит правила'],[fW(s1.wr)+' vs '+fW(s0.wr),'винрейт: с правилами / без'],[fR(s1.s)+' vs '+fR(s0.s),'ΣR: с правилами / без'],[fR(s1.s-s0.s),'эффект правил (ΣR)',sg(s1.s-s0.s)],[fR(so.s),'дали сделки вне правил',sg(so.s)],[pf(s1)+' vs '+pf(s0),'profit factor'],[f2(s1.dd)+'R vs '+f2(s0.dd)+'R','макс. просадка']]);
    let e=0,e2=0;const A=[0],B=[0];a.forEach(t=>{e+=R(t);A.push(Math.round(e*100)/100);if(pass(t,st.rules))e2+=R(t);B.push(Math.round(e2*100)/100)});const c=el('div','card');dual(c,A,B);box.append(c)};
  ruleEd(rb,st.rules,draw);const ab=el('div','bar'),sa=el('select');[['all','Все счета'],...ACC().map(x=>[x.id,x.name])].forEach(([v,l])=>sa.append(new Option(l,v)));sa.value=st.acc;sa.onchange=()=>{st.acc=sa.value;draw()};
  const sv=el('button','p','💾 Сохранить как сетап');sv.onclick=()=>setupForm({name:'',rules:JSON.parse(JSON.stringify(st.rules))});ab.append(sa,sv);p.append(rb,ab,box);draw()}
function vSetups(p){CFG.setups=CFG.setups||[];const b=el('div','bar'),nb=el('button','p','＋ Новый сетап');nb.onclick=()=>setupForm({name:'',rules:[{k:'cvd',op:'=',v:''}]});b.append(nb);p.append(b);const a=cl();
  if(!CFG.setups.length)p.append(el('div','msg','Сетапов пока нет. Создай сетап здесь или собери условия в «А что если…» и нажми «Сохранить как сетап».'));
  const g=el('div','ins'),pf=x=>x.pf==null?'—':x.pf===Infinity?'∞':f2(x.pf);CFG.setups.forEach(s=>{const m=a.filter(t=>pass(t,s.rules)),st=stats(m),c=el('div','card');c.append(el('b',null,'🎯 '+s.name),el('div','mu',s.rules.map(r=>(WKL[r.k]||r.k)+(r.op==='='?' = ':' ≠ ')+r.v).join(' · ')));
    tiles(c,[[st.n,'сделок'],[fW(st.wr),'винрейт'],[fR(st.s),'ΣR',sg(st.s)],[pf(st),'PF']]);const cc=el('div');curve(cc,series(m,'R'),'R');c.append(cc);const bb=el('div','bar'),e=el('button','s','✎ Править'),d=el('button','s','Удалить');e.onclick=()=>setupForm(s);d.onclick=()=>two(d,()=>{CFG.setups=CFG.setups.filter(x=>x.id!==s.id);saveCfg();render()});bb.append(e,d);c.append(bb);g.append(c)});
  if(CFG.setups.length){const rest=a.filter(t=>!CFG.setups.some(s=>pass(t,s.rules))),st=stats(rest),c=el('div','card');c.append(el('b',null,'⚪ Вне сетапов'),el('div','mu','Сделки, не подходящие ни под один сетап'));tiles(c,[[st.n,'сделок'],[fW(st.wr),'винрейт'],[fR(st.s),'ΣR',sg(st.s)],[pf(st),'PF']]);const cc=el('div');curve(cc,series(rest,'R'),'R');c.append(cc);g.append(c)}p.append(g)}
function shotsRow(a){if(!a||!a.length)return null;const d=el('div','shots');a.forEach(s=>{const im=el('img');SHOTS.bind(im,s);d.append(im)});return d}
function dayScreen(date){modal((m,close)=>{const sh=d=>{const x=new Date(date+'T00:00');x.setDate(x.getDate()+d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
    const draw=()=>{m.replaceChildren();const pl=P.filter(x=>x.date===date),tr=T.filter(t=>t.date===date).sort((a,b)=>(a.time||'').localeCompare(b.time||'')||a.id.localeCompare(b.id)),s=stats(tr.filter(t=>R(t)!==null));
      const hd=el('div','bar'),pv=el('button','s','‹'),nx=el('button','s','›');pv.onclick=()=>{date=sh(-1);draw()};nx.onclick=()=>{date=sh(1);draw()};hd.append(pv,el('h3',null,new Date(date+'T00:00').toLocaleDateString('ru',{weekday:'long',day:'numeric',month:'long',year:'numeric'})),nx);m.append(hd);
      tiles(m,[[tr.length,'сделок'],[fR(s.s),'итого R за день',sg(s.s)],[fW(s.wr),'винрейт'],[(pl[0]&&pl[0].done)||'—','итог плана']]);m.append(el('h3',null,'План и итог'));
      if(!pl.length){const b=el('button','p','＋ Добавить план на этот день');b.onclick=()=>{close();planForm({date})};m.append(b)}
      pl.forEach(q=>{const c=el('div','card'),t1=el('div',null,q.plan||'—'),t2=el('div',null,q.sum||'—');t1.style.whiteSpace=t2.style.whiteSpace='pre-wrap';c.append(el('b',null,'План'),t1,el('b',null,'Итог дня'),t2);const sw=shotsRow(q.shots);if(sw)c.append(sw);const e=el('button','s','✎ Открыть план');e.onclick=()=>{close();planForm(q)};c.append(e);m.append(c)});
      m.append(el('h3',null,'Сделки'));if(!tr.length)m.append(el('div','mu','В этот день сделок нет.'));
      tr.forEach(t=>{const c=el('div','card'),r=R(t);c.append(el('b',null,(t.time||'')+' '+t.inst+' · '+(t.res||'—')+(r!==null?' · '+fR(r):'')),el('div','mu',[t.kind,t.cvd,t.tape&&'Tape '+t.tape,t.origin,t.vp,t.grade,t.emo].filter(Boolean).join(' · ')));if(t.desc)c.append(el('div',null,t.desc));if(t.err)c.append(el('div','l','Ошибки: '+t.err));const sw=shotsRow(t.shots);if(sw)c.append(sw);const e=el('button','s','✎ Открыть сделку');e.onclick=()=>{close();tradeForm(t)};c.append(e);m.append(c)})};draw()})}
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const FONTS={system:'-apple-system,BlinkMacSystemFont,SF Pro Display,Inter,Segoe UI,sans-serif',rounded:'ui-rounded,SF Pro Rounded,Nunito,system-ui,sans-serif',serif:'ui-serif,Georgia,Cambria,serif',mono:'ui-monospace,SF Mono,Menlo,Consolas,monospace'},DL={ac:'#8b5cf6',w:'#34d399',l:'#fb7185',bg:'gradient',bg1:'#100b2b',bg2:'#25105c',bg3:'#071c3b',font:'system',style:'night',nav:'top',anim:'fast'},LOOKS=[['TrustBit',{ac:'#8b5cf6',w:'#34d399',l:'#fb7185',bg:'gradient',font:'system',style:'tb'}],['Classic Night',{ac:'#8b5cf6',w:'#34d399',l:'#fb7185',bg:'stars',font:'system',style:'classic'}],['Midnight Blue',{ac:'#3b82f6',w:'#34d399',l:'#fb7185',bg:'gradient',bg1:'#06152d',bg2:'#123d72',bg3:'#090b25',font:'system'}],['Emerald',{ac:'#10b981',w:'#6ee7b7',l:'#fb7185',bg:'particles',font:'system'}],['Rose',{ac:'#f43f5e',w:'#34d399',l:'#fb923c',bg:'gradient',bg1:'#260b25',bg2:'#5a1945',bg3:'#160c32',font:'rounded'}],['Monochrome',{ac:'#e7e7e7',w:'#dedede',l:'#818181',bg:'off',font:'system',style:'mono'}]];
function motion(){const m=(CFG.look||{}).motion;return m==='full'||m==='light'||m==='off'?m:matchMedia('(prefers-reduced-motion:reduce)').matches?'off':'light'}
function applyLook(){if(CFG.look&&!CFG.look.v2){CFG.look.v2=1;if(!CFG.look.style||CFG.look.style==='paper')CFG.look.style='night'}const k=Object.assign({},DL,CFG.look||{});if(k.style==='paper'){k.ac='#0A0A0B';k.w='#0A0A0B';k.l='#8a8c94'}if(k.style==='night'){k.ac='#D6D5D0';k.w='#E9E8E3';k.l='#7D7F88'}window.LOOK=k;applyFields();document.body.classList.toggle('paper',k.style==='paper');document.body.classList.toggle('night',k.style==='night');document.body.classList.toggle('mo-light',motion()==='light');document.body.classList.toggle('mo-off',motion()==='off');const r=document.documentElement.style;r.setProperty('--ac',k.ac);r.setProperty('--acr',hexRgb(k.ac));r.setProperty('--gradient-a',k.bg1);r.setProperty('--gradient-b',k.bg2);r.setProperty('--gradient-c',k.bg3);document.body.classList.toggle('tb',k.style==='tb');document.body.classList.toggle('mono',k.style==='mono');document.body.dataset.navPosition=['top','bottom','left','right'].includes(k.nav)?k.nav:'top';if(k.style==='tb')gfont('Outfit');r.setProperty('--w',k.w);r.setProperty('--l',k.l);document.body.style.fontFamily=/^[fg]:/.test(k.font)?String.fromCharCode(39)+k.font.slice(2)+String.fromCharCode(39)+',system-ui,sans-serif':((k.font==='system'&&k.style==='tb')?FONTS.tb:(FONTS[k.font]||FONTS.system));loadFonts()}
function lookForm(){const o=Object.assign({},DL,CFG.look||{});modal((m,close)=>{m.append(el('h3',null,'Оформление'));const g=el('div','fg'),set=(k,v)=>{o[k]=v;CFG.look=o;applyLook()};
  const col=(lb,k)=>{const l=el('label'),i=el('input');i.type='color';i.value=o[k];i.oninput=()=>set(k,i.value);l.append(el('span',null,lb),i);g.append(l)};col('Акцент','ac');col('Цвет прибыли','w');col('Цвет убытка','l');
  const sel=(lb,k,ops)=>{const l=el('label'),s=el('select');ops.forEach(([v,t])=>s.append(new Option(t,v)));s.value=o[k];s.onchange=()=>set(k,s.value);l.append(el('span',null,lb),s);g.append(l)};sel('Фон','bg',[['stars','Звёздное небо'],['particles','Частицы'],['off','Выкл']]);sel('Шрифт','font',[['system','Системный (Apple)'],['rounded','Округлый'],['serif','С засечками'],['mono','Моно'],...(CFG.fonts||[]).map(n=>['f:'+n,n+' (свой)']),...(CFG.gfonts||[]).map(n=>['g:'+n,n+' (Google)'])]);
  const fb=el('div','bar'),ff=el('input');ff.type='file';ff.accept='.woff2,.woff,.ttf,.otf';ff.style.display='none';ff.onchange=async()=>{const f=ff.files[0];if(!f)return;const n=f.name.replace(/\.[^.]+$/,'');if(await mput('font:'+n,f)){CFG.fonts=(CFG.fonts||[]).filter(x=>x!==n).concat([n]);set('font','f:'+n);saveCfg();toast('Шрифт добавлен');close();lookForm()}else toast('Не удалось сохранить шрифт')};const fbt=el('button','s','📁 Свой шрифт (.woff2 / .ttf / .otf)');fbt.onclick=()=>ff.click();const gi=el('input');gi.placeholder='Google Font, например Unbounded';const gb=el('button','s','＋ Google');gb.onclick=()=>{const n=gi.value.trim();if(!n)return;CFG.gfonts=(CFG.gfonts||[]).filter(x=>x!==n).concat([n]);set('font','g:'+n);saveCfg();close();lookForm()};fb.append(fbt,ff,gi,gb);
  const rv=el('label'),ri=el('input');ri.type='number';ri.min=1;ri.value=localStorage.getItem('jrev')||10;ri.onchange=()=>{try{localStorage.setItem('jrev',ri.value)}catch(e){}};rv.append(el('span',null,'Интро: журнал на N-й секунде'),ri);g.append(rv);const ib=el('div','bar'),iu=el('button','s','🎬 Загрузить интро-видео'),ifl=el('input');ifl.type='file';ifl.accept='video/*';ifl.style.display='none';ifl.onchange=async()=>{const f=ifl.files[0];if(f)toast((await mput('intro',f))?'Интро сохранено':'Не удалось сохранить видео')};iu.onclick=()=>ifl.click();const idl=el('button','s','✕ Убрать интро');idl.onclick=async()=>{await mput('intro',null);toast('Интро убрано')};const irp=el('button','s','↻ Показать интро');irp.onclick=()=>{close();document.body.classList.add('pre');intro()};ib.append(iu,ifl,idl,irp);m.append(g,fb,el('h3',null,'Интро-видео'),ib,el('h3',null,'Луки'));
  const lb=el('div','bar'),draw=()=>{lb.replaceChildren();LOOKS.concat((CFG.looks||[]).map(x=>[x.name,x.look,1])).forEach(([n,lk,u])=>{const b=el('button','s',n);b.onclick=()=>{Object.assign(o,lk);CFG.look=o;applyLook();saveCfg();draw()};lb.append(b);if(u){const x=el('button','s','✕');x.onclick=()=>{CFG.looks=CFG.looks.filter(y=>y.name!==n);saveCfg();draw()};lb.append(x)}})};draw();m.append(lb);
  const sv=el('div','bar'),nm=el('input');nm.placeholder='Название лука';const sb=el('button','s','💾 Сохранить лук');sb.onclick=()=>{const n=nm.value.trim();if(!n)return;CFG.looks=(CFG.looks||[]).filter(y=>y.name!==n).concat([{name:n,look:JSON.parse(JSON.stringify(o))}]);saveCfg();draw();toast('Лук сохранён')};sv.append(nm,sb);m.append(sv);const ok=el('button','p','Готово');ok.onclick=()=>{CFG.look=o;saveCfg();close()};m.append(ok)})}
(function(){const b=el('button','s float','🎨');b.title='Оформление';b.onclick=lookForm2;document.body.append(b)})();
document.addEventListener('click',e=>{window._cp=[e.clientX,e.clientY]},true);
function goVT(k){if(k===view||window._go)return;const sw=()=>{view=k;render();window.scrollTo({top:0})};if(matchMedia('(prefers-reduced-motion:reduce)').matches){sw();return}window._go=1;const fin=()=>{document.body.classList.add('first');setTimeout(()=>{document.body.classList.remove('first');window._go=0},1200)};
  if(document.startViewTransition){const [x,y]=window._cp||[innerWidth/2,innerHeight/2],t=document.startViewTransition(sw);t.ready.then(()=>{const r=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y)),ease='cubic-bezier(.22,1,.36,1)';document.documentElement.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+r+'px at '+x+'px '+y+'px)']},{duration:950,easing:ease,pseudoElement:'::view-transition-new(root)'});document.documentElement.animate({transform:['scale(1)','scale(.95)'],filter:['blur(0px)','blur(10px)'],opacity:[1,.55]},{duration:950,easing:ease,pseudoElement:'::view-transition-old(root)'})}).catch(()=>{});t.finished.then(fin,fin);return}
  const v=$('#v');v.classList.add('out');setTimeout(()=>{sw();v.classList.remove('out');fin()},300)}
const loadX=()=>window.XLSX?Promise.resolve():new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.append(s)});
async function importFile(f){try{let rows=[];const nm=f.name.toLowerCase();
  if(/\.xlsx?$/.test(nm)){await loadX();const wb=XLSX.read(await f.arrayBuffer()),sn=wb.SheetNames.find(s=>/journal|trade|deal|position|history/i.test(s))||wb.SheetNames[0];rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,defval:''})}
  else{const tx=await f.text();if(/<table/i.test(tx)){rows=[...new DOMParser().parseFromString(tx,'text/html').querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>c.textContent.trim()))}else{const l0=tx.split(/\r?\n/)[0],sep=[';','\t',','].sort((a,b)=>l0.split(b).length-l0.split(a).length)[0];rows=tx.split(/\r?\n/).filter(Boolean).map(l=>{const o=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===sep&&!q){o.push(c.trim());c=''}else c+=ch}o.push(c.trim());return o})}}
  const KW=/symbol|instrument|contract|type|side|direction|volume|qty|size|profit|pnl|p&l|price|time|date|ticket|position|deal|order/i,hi=rows.findIndex(r=>r.filter(c=>KW.test(String(c))).length>=3);if(hi<0){toast('Не нашёл заголовки таблицы');return}
  const H=rows[hi].map(c=>String(c).toLowerCase()),ix=re=>H.map((c,i)=>re.test(c)?i:-1).filter(i=>i>=0),sym=ix(/symbol|instrument|contract|asset/)[0],sd=ix(/^(type|side|direction|buy\/sell)/)[0],pf=ix(/profit|pnl|p&l|net/)[0],tm=ix(/time|date/),pr=ix(/price/),idc=ix(/position|ticket|deal|order|^id/)[0];
  const cn=v=>{const n=parseFloat(String(v==null?'':v).replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:null},dt=s=>{s=String(s||'');let m=s.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];m=s.match(/(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})/);return m?m[3]+'-'+m[2]+'-'+m[1]:''},tmv=s=>{const m=String(s||'').match(/(\d{1,2}):(\d{2})/);return m?m[1].padStart(2,'0')+':'+m[2]:''},mi=s=>/^(M?NQ|US100|NAS|USTEC)/i.test(s)?'NQ':/^(M?ES|US500|SPX|SP500)/i.test(s)?'ES':String(s).toUpperCase();
  const have=new Set(T.map(t=>t.src).filter(Boolean)),out=[];
  rows.slice(hi+1).forEach(r=>{const s=sym!=null?String(r[sym]||'').trim():'';if(!s||s.toLowerCase()===String(rows[hi][sym]).toLowerCase())return;const p=pf!=null?cn(r[pf]):null,e=pr[0]!=null?cn(r[pr[0]]):null,x=pr[1]!=null?cn(r[pr[1]]):null;if(p===null&&e===null)return;
   const ot=tm[0]!=null?r[tm[0]]:'',ct=tm[1]!=null?r[tm[1]]:ot,sv=sd!=null?String(r[sd]):'',src=(idc!=null&&r[idc]?String(r[idc]):s+'|'+ot+'|'+e);if(have.has(src))return;have.add(src);
   out.push({inst:mi(s),date:dt(ct)||dt(ot)||today(),time:tmv(ot),side:/buy|long/i.test(sv)?'Long':/sell|short/i.test(sv)?'Short':'',entry:e==null?'':String(e),exit:x==null?'':String(x),res:p==null?'':p>0?'Тейк':p<0?'Стоп':'BE',pnl:p==null?'':String(p),src,imp:true})});
  if(!out.length){toast('Новых сделок не найдено');return}
  modal((m,close)=>{m.append(el('h3',null,'Импорт: найдено '+out.length+' новых сделок'),el('div','mu','Проверь превью. После импорта открой каждую сделку и отметь факторы (🆕 — ещё не размечена). RR у тейков заполни вручную.'));table(m,['Дата','Время','Инстр.','Напр.','Вход','Выход','Результат','PnL'],out.slice(0,12).map(o=>({cells:[o.date,o.time,o.inst,o.side,o.entry,o.exit,o.res,o.pnl]})));const b=el('div','bar'),ok=el('button','p','Импортировать '+out.length);ok.onclick=async()=>{ok.disabled=true;try{for(const o of out)await store.save('trades',o);await accountApi.flush();close();toast('Импортировано: '+out.length)}catch(error){ok.disabled=false;toast('Импорт не завершён: '+error.message)}};b.append(ok);m.append(b)})}catch(e){toast('Не удалось прочитать файл: '+(e.message||e))}}
function vReview(p){CFG.reviews=CFG.reviews||{};const st=window._rv=window._rv||{m:'week',o:0},bar=el('div','bar'),sm=el('select'),pv=el('button','s','‹'),nx=el('button','s','›');[['week','Неделя'],['month','Месяц']].forEach(([v,l])=>sm.append(new Option(l,v)));sm.value=st.m;sm.onchange=()=>{st.m=sm.value;st.o=0;render()};pv.onclick=()=>{st.o--;render()};nx.onclick=()=>{st.o++;render()};
  const n=new Date();let a,b,key,title;if(st.m==='week'){const d=new Date(n.getFullYear(),n.getMonth(),n.getDate()+st.o*7);a=new Date(d.getFullYear(),d.getMonth(),d.getDate()-(d.getDay()+6)%7);b=new Date(a.getFullYear(),a.getMonth(),a.getDate()+6);key='w:'+ymd(a);title='Неделя '+ymd(a)+' — '+ymd(b)}else{a=new Date(n.getFullYear(),n.getMonth()+st.o,1);b=new Date(a.getFullYear(),a.getMonth()+1,0);key='m:'+ymd(a).slice(0,7);title=a.toLocaleDateString('ru',{month:'long',year:'numeric'})}
  bar.append(sm,pv,el('b',null,title),nx);p.append(bar);const A=ymd(a),B=ymd(b),tr=cl().filter(t=>t.date>=A&&t.date<=B),all=T.filter(t=>t.date>=A&&t.date<=B),pl=P.filter(x=>x.date>=A&&x.date<=B),s=stats(tr);if(!all.length&&!pl.length)p.append(el('div','msg','За этот период записей нет.'));
  const days={};tr.forEach(t=>days[t.date]=(days[t.date]||0)+R(t));const de=Object.entries(days).sort((x,y)=>y[1]-x[1]),bd=de[0],wd=de[de.length-1],sm2=el('div','card');
  sm2.append(el('b',null,'📝 Автосводка'),el('div',null,tr.length?(st.m==='week'?'Неделя':'Месяц')+': '+tr.length+' сделок, винрейт '+fW(s.wr)+', итог '+fR(s.s)+', ср. R '+fR(s.avg)+(bd?'. Лучший день — '+bd[0]+' ('+fR(bd[1])+')':'')+(wd&&wd!==bd?', худший — '+wd[0]+' ('+fR(wd[1])+')':'')+'.':'Сделок с результатом нет.'));p.append(sm2);
  tiles(p,[[tr.length,'сделок'],[fW(s.wr),'винрейт'],[fR(s.s),'итого R',sg(s.s)],[s.pf==null?'—':s.pf===Infinity?'∞':f2(s.pf),'profit factor'],[Object.keys(days).length,'торговых дней'],[f2(s.dd)+'R','макс. просадка']]);const cc=el('div','card');curve(cc,series(tr,'R'),'R');p.append(cc);
  const g=el('div','ins'),c1=el('div','card'),c2=el('div','card'),pc={'Сбылся':0,'Частично':0,'Не сбылся':0};pl.forEach(x=>{if(pc[x.done]!=null)pc[x.done]++});c1.append(el('b',null,'📅 Планы'),el('div',null,'Сбылся: '+pc['Сбылся']+' · Частично: '+pc['Частично']+' · Не сбылся: '+pc['Не сбылся']+' · планов: '+pl.length));
  const er=all.filter(t=>t.err&&t.err.trim()),em={};all.forEach(t=>{if(t.emo)em[t.emo]=(em[t.emo]||0)+1});c2.append(el('b',null,'⚠️ Ошибки и состояние'),el('div',null,'Сделок с ошибками: '+er.length+' из '+all.length),el('div','mu',Object.entries(em).map(([k,v])=>k+' ×'+v).join(' · ')||'Состояния не отмечены'));er.slice(0,3).forEach(t=>c2.append(el('div','l','• '+t.date+': '+t.err.slice(0,90))));g.append(c1,c2);p.append(g);
  const gs=[];WK.forEach(([k,l])=>{const m={};tr.forEach(t=>{const v=gv(t,k);if(v)(m[v]=m[v]||[]).push(t)});for(const v in m)if(m[v].length>=2)gs.push({n:l+' · '+v,s:stats(m[v])})});gs.sort((x,y)=>y.s.s-x.s.s);
  const g2=el('div','ins');[['🟢 Что работало',gs.filter(x=>x.s.s>0).slice(0,3)],['🔴 Что сливало',gs.filter(x=>x.s.s<0).slice(-3).reverse()]].forEach(([h2,arr])=>{const c=el('div','card');c.append(el('b',null,h2));arr.forEach(x=>c.append(el('div',null,x.n+' — '+fW(x.s.wr)+', '+fR(x.s.s)+' ('+x.s.n+')')));if(!arr.length)c.append(el('div','mu','нужно ≥2 сделок в группе'));g2.append(c)});p.append(g2);
  const R0=CFG.reviews[key]||{},nc=el('div','card'),gsel=el('select'),ta=el('textarea');nc.append(el('b',null,'✍️ Моя заметка и оценка'));['—','A+','A','B','C'].forEach(v=>gsel.append(new Option(v,v==='—'?'':v)));gsel.value=R0.grade||'';ta.rows=5;ta.style.width='100%';ta.placeholder='Что получилось, что нет, что меняю на следующий период…';ta.value=R0.note||'';
  const sv=()=>{CFG.reviews[key]={note:ta.value,grade:gsel.value};saveCfg();toast('Сохранено ✓')};ta.onchange=sv;gsel.onchange=sv;nc.append(el('span','mu','Оценка периода: '),gsel,ta);p.append(nc)}
const _lf=new Set();
function loadFonts(){(CFG.fonts||[]).forEach(async n=>{if(_lf.has('f'+n)||!window.FontFace)return;_lf.add('f'+n);try{const b=await mget('font:'+n);if(!b)return;const ff=new FontFace(n,await b.arrayBuffer());await ff.load();document.fonts.add(ff)}catch(e){}});(CFG.gfonts||[]).forEach(n=>{if(_lf.has('g'+n))return;_lf.add('g'+n);const l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(n).replace(/%20/g,'+')+'&display=swap';document.head.append(l)})}
function goRing(k){if(k===view||window._go)return;const sw=()=>{view=k;render();window.scrollTo({top:0})};if(matchMedia('(prefers-reduced-motion:reduce)').matches){sw();return}window._go=1;
  const cp=window._cp||[innerWidth/2,innerHeight/2],x=cp[0],y=cp[1],R0=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y)),ease='cubic-bezier(.22,1,.36,1)',D=1000,ring=el('div','tr-ring'),wash=el('div','tr-wash');ring.style.left=wash.style.left=x+'px';ring.style.top=wash.style.top=y+'px';document.body.append(wash,ring);
  const run=()=>{if(!ring.animate)return;ring.animate([{transform:'translate(-50%,-50%) scale(0)',opacity:.95},{transform:'translate(-50%,-50%) scale('+(R0*2/60)+')',opacity:0}],{duration:D,easing:ease,fill:'forwards'});wash.animate([{transform:'translate(-50%,-50%) scale(0)',opacity:.75},{transform:'translate(-50%,-50%) scale('+(R0*2/100)+')',opacity:0}],{duration:D*1.15,easing:ease,fill:'forwards'})},done=()=>{ring.remove();wash.remove();window._go=0};
  if(document.startViewTransition){const t=document.startViewTransition(sw);t.ready.then(()=>{run();document.documentElement.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+R0+'px at '+x+'px '+y+'px)']},{duration:D,easing:ease,pseudoElement:'::view-transition-new(root)'});document.documentElement.animate({transform:['scale(1)','scale(.94)'],filter:['blur(0px) brightness(1)','blur(12px) brightness(.6)'],opacity:[1,.5]},{duration:D,easing:ease,pseudoElement:'::view-transition-old(root)'})}).catch(()=>{});t.finished.then(done,done);return}
  const v=$('#v');v.classList.add('out');run();setTimeout(()=>{sw();v.classList.remove('out')},320);setTimeout(done,D+100)}
function startMenu0(){if(document.querySelector('.start'))return;const B=document.body,s=el('div','start'),c=el('div','sc'),b1=el('button','p big2','Начать'),b2=el('button','s big2','Как пользоваться');c.append(el('b','sl','ID'),el('span','sub','Journal by myIDgod'),b1,b2);s.append(c);document.body.append(s);const st=()=>{if(s.classList.contains('out'))return;s.classList.add('out');B.classList.remove('pre');setTimeout(()=>s.remove(),900)};b1.onclick=st;b2.onclick=()=>guide(st)}
const GUIDE=[['🚀','Как всё устроено',['Журнал состоит из экранов: План на день, Статистика, Журнал, Граф, А что если, Сетапы, Разбор.','Переключайся кнопками сверху или клавишами 0–7.','Всё сохраняется автоматически. Резервная копия — кнопка внизу страницы.']],['📓','Журнал и сделки',['«＋ Сделка NQ/ES» открывает карточку: значения выбираются из списков, печатать почти ничего не нужно.','Скриншоты вставляются через Ctrl+V прямо в форму.','RR заполняй только у тейка. Стоп = −1R, BE = 0 считаются сами.','Клик по строке открывает сделку, «Копия» дублирует её.']],['📅','План на день',['Пиши план свободным текстом, а в конце дня выбери «Сбылся / Частично / Не сбылся» и напиши итог.','Клик по дню в календаре открывает экран дня: план, сделки, скриншоты.']],['📈','Статистика',['Кривая в R, % или $, винрейт по инструментам, срезы по каждому полю и конструктор срезов.','Блок «Что работает / Что сливает» сам находит сильные и слабые комбинации.','Лимиты проп-аккаунтов настраиваются кнопкой «⚙ Лимиты».']],['🧪','А что если и Сетапы',['Включи условия, например «только Tape = On» — кривая пересчитается без остальных сделок.','Удачные условия сохрани как сетап — журнал сам покажет его винрейт и кривую.']],['📆','Разбор недели и месяца',['Автосводка по периоду, твоя заметка и оценка от A+ до C.','Видно, что работало, что сливало, сколько было ошибок и какое было состояние.']],['🕸','Граф и «Поделиться»',['В графе инструменты связаны со сделками. Наведи курсор — узлы потянутся к нему, клик открывает сделку.','«Поделиться» в карточке сделки делает картинку или видео: форматы 1:1, 4:3, 3:4, 16:9, 9:16, свой видео-фон со звуком, скриншот и R.']],['🎨','Кастомизация',['Кнопка 🎨 справа сверху: цвета, шрифты (свои файлы и Google Fonts), фон, интро-видео и сохранённые луки.','Знак «?» рядом с названиями — подсказка по функции.']]];
function guide(after){const g=el('div','guide'),box=el('div','gb');g.append(box);g.addEventListener('mousedown',e=>{if(e.target===g)g.remove()});let i=0;const draw=()=>{box.replaceChildren();const it=GUIDE[i],c=el('div','gs');c.append(el('div','gi',it[0]),el('h2',null,it[1]));const ul=el('ul');it[2].forEach((b,k)=>{const li=el('li',null,b);li.style.animationDelay=(.15+k*.1)+'s';ul.append(li)});c.append(ul);box.append(c);
    const nv=el('div','bar gn'),pv=el('button','s','‹ Назад'),nx=el('button','p',i<GUIDE.length-1?'Далее ›':'Начать'),dots=el('div','dots'),xc=el('button','s','✕ Закрыть');GUIDE.forEach((_,k)=>{const d=el('i',k===i?'on':'');d.onclick=()=>{i=k;draw()};dots.append(d)});pv.disabled=i===0;pv.onclick=()=>{i--;draw()};nx.onclick=()=>{if(i<GUIDE.length-1){i++;draw()}else{g.remove();if(after)after()}};xc.onclick=()=>g.remove();nv.append(pv,dots,nx,xc);box.append(nv)};draw();document.body.append(g)}
(function(){const b=el('button','s float h','❓');b.title='Как пользоваться';b.onclick=()=>{const g=document.querySelector('.guide');if(g){g.remove();return}guide(null)};document.body.append(b)})();
addEventListener('keydown',e=>{if(e.key!=='Escape')return;const g=document.querySelector('.guide');if(g)g.remove()});
new MutationObserver(()=>{const h=document.querySelector('button.float.h'),a=document.querySelector('button.float:not(.h)');if(h)h.classList.toggle('on',!!document.querySelector('.guide'));if(a)a.classList.toggle('on',!!document.querySelector('.ov.look-ov'))}).observe(document.body,{childList:true});
const quickActions=el('div','quick-actions'),appearanceAction=document.querySelector('button.float:not(.h)'),helpAction=document.querySelector('button.float.h');if(appearanceAction)quickActions.append(appearanceAction);if(helpAction)quickActions.append(helpAction);document.body.append(quickActions);
const HINTS={'Результат':'Чем закончилась сделка: Тейк, BE (безубыток) или Стоп. От этого считается R.','RR (итог, для тейка)':'Итоговый R по сделке с учётом частичных фиксаций. Стоп всегда −1R, BE = 0 — считаются сами.','Риск %':'Риск на сделку от баланса счёта. По нему считается кривая в % и в $.','Тип':'Реверс — разворот от уровня, продолжение — вход по ходу движения.','CVD':'Состояние кумулятивной дельты на входе: Exhaustion — истощение, Absorption — поглощение.','Speed of Tape':'Скорость ленты в момент входа: On — сделки идут ускоренно, Off — нет.','Footprint: POC':'Где в футпринте бара находится POC: в теле или в тени.','Footprint: Zero':'Нулевая ячейка (zero print) у экстремума бара и с какой стороны.','IVB':'Opening range: 0 / 0.5 / 1 — уровень диапазона. Нет — не использовался.','IVB диапазон':'Какой диапазон натянут: первые 5 или 30 минут сессии NY.','Профиль RTH':'Форма профиля объёма текущей RTH-сессии: D, P, b или B.','Набрана от':'От какого уровня профиля набиралась позиция: VAH, VAL или POC.','LVN / HVN':'Вход от узла низкого (LVN) или высокого (HVN) объёма.','Направление':'Long или Short.','Цена входа':'Цена входа — нужна для карточки Поделиться.','Цена выхода':'Цена выхода — нужна для карточки Поделиться.','Время входа':'Нужно для разбора по часам и экрана дня.','Оценка сделки':'Твоя оценка исполнения сделки: A+, A, B, C.','Состояние':'Твоё состояние при входе: спокойно, FOMO, страх и так далее.','винрейт':'Доля тейков среди всех сделок с результатом. BE входят в знаменатель.','profit factor':'Сумма прибыльных R, делённая на сумму убыточных.','макс. просадка':'Самое большое падение кривой от пика, в R.','ожидание (ср. R)':'Средний результат одной сделки в R.','итого R':'Сумма R всех сделок.','макс. стопов подряд':'Самая длинная серия стопов (BE пропускаются).','Конструктор срезов':'Выбери одно или два поля и посмотри статистику по комбинациям.','Срезы по полям':'Винрейт и R по каждому значению каждого поля.','Проп-аккаунты':'Прогресс до цели и просадка до лимита по каждому счёту. Лимиты — кнопка ⚙.','Условия (все должны выполняться)':'Сделка проходит, если выполнены все условия. Кривая пересчитается без остальных.'};
const tipBox=el('div','tipbox');document.body.append(tipBox);
document.addEventListener('mouseover',e=>{const q=e.target.closest&&e.target.closest('.q');if(!q)return;tipBox.textContent=q.dataset.t;tipBox.style.display='block';const r=q.getBoundingClientRect();tipBox.style.left=Math.min(innerWidth-280,Math.max(8,r.left-100))+'px';tipBox.style.top=(r.bottom+8)+'px'});
document.addEventListener('mouseout',e=>{if(e.target.closest&&e.target.closest('.q'))tipBox.style.display='none'});
function scanHints(root){if(!root.querySelectorAll)return;root.querySelectorAll('span,b,h3,label>span,.tile>span').forEach(n=>{if(n.dataset.h||n.childElementCount)return;const h=HINTS[n.textContent.trim().replace(/:$/,'')];if(h){n.dataset.h='1';const q=el('i','q','?');q.dataset.t=h;n.append(q)}})}
new MutationObserver(ms=>ms.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scanHints(n)}))).observe(document.body,{childList:true,subtree:true});scanHints(document.body);
const hexRgb=h=>{const n=parseInt(String(h).slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255].join(',')};
function gfont(n){const key='g'+n;if(_lf.has(key))return;_lf.add(key);const l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(n).replace(/%20/g,'+')+'&display=swap';document.head.append(l)}
FONTS.tb='Outfit,Plus Jakarta Sans,ui-rounded,-apple-system,BlinkMacSystemFont,SF Pro Display,Inter,Segoe UI,sans-serif';
const WK0=WK.slice(),DEFO={};
function applyFields(){CFG.opts=CFG.opts||{};CFG.custom=CFG.custom||[];FIELDS.forEach(f=>{if(Array.isArray(f[2])&&!f[3]){if(!DEFO[f[0]])DEFO[f[0]]=f[2].slice();f[2]=(CFG.opts[f[0]]&&CFG.opts[f[0]].length)?CFG.opts[f[0]].slice():DEFO[f[0]].slice()}});for(let i=FIELDS.length-1;i>=0;i--)if(FIELDS[i][3])FIELDS.splice(i,1);CFG.custom.forEach(c=>FIELDS.push([c.key,c.label,c.opts,1]));WK.splice(0,WK.length,...WK0.concat(CFG.custom.map(c=>[c.key,c.label])));Object.keys(WKL).forEach(k=>delete WKL[k]);WK.forEach(([k,l])=>{WKL[k]=l})}
function fieldsForm(){modal((m,close)=>{const C=JSON.parse(JSON.stringify({opts:CFG.opts||{},custom:CFG.custom||[]})),parse=s=>s.split(',').map(x=>x.trim()).filter(Boolean);m.append(el('h3',null,'Триггеры и поля'),el('div','mu','Меняй списки вариантов у существующих полей или добавляй свои поля — они появятся в карточке сделки, срезах, «А что если» и сетапах. Варианты пиши через запятую.'));const box=el('div');m.append(box);
  const draw=()=>{box.replaceChildren();FIELDS.filter(f=>Array.isArray(f[2])&&!f[3]).forEach(f=>{const l=el('label'),i=el('input');i.style.width='100%';i.value=(C.opts[f[0]]||DEFO[f[0]]||f[2]).join(', ');i.onchange=()=>{C.opts[f[0]]=parse(i.value)};l.append(el('span',null,f[1]),i);box.append(l)});
    box.append(el('h3',null,'Мои поля'));C.custom.forEach((c,idx)=>{const g=el('div','fg card'),n=el('input'),o=el('input'),l1=el('label'),l2=el('label'),d=el('button','s','Удалить поле');n.value=c.label;o.value=c.opts.join(', ');n.oninput=()=>{c.label=n.value};o.onchange=()=>{c.opts=parse(o.value)};d.onclick=()=>two(d,()=>{C.custom.splice(idx,1);draw()});l1.append(el('span',null,'Название'),n);l2.append(el('span',null,'Варианты'),o);g.append(l1,l2,d);box.append(g)});
    const add=el('button','s','＋ Новое поле');add.onclick=()=>{C.custom.push({key:'c_'+Date.now().toString(36),label:'Новый триггер',opts:['Да','Нет']});draw()};box.append(add)};draw();
  const b=el('div','bar'),sv=el('button','p','Сохранить');sv.onclick=()=>{CFG.opts=C.opts;CFG.custom=C.custom;saveCfg();applyFields();close();render();toast('Сохранено ✓')};b.append(sv);m.append(b)})}
const saveCfgD=(()=>{let t;return()=>{clearTimeout(t);t=setTimeout(saveCfg,500)}})();
function lookForm2(){modal((m,close)=>{const cur=()=>Object.assign({},DL,CFG.look||{}),set=(k,v)=>{CFG.look=Object.assign(cur(),{[k]:v});applyLook();saveCfgD()};
  const draw=()=>{m.replaceChildren();const o=cur(),g=el('div','fg');m.append(el('h3',null,'Кастомизация'));
   const sel=(lb,k,ops)=>{const l=el('label'),s=el('select');ops.forEach(([v,t])=>s.append(new Option(t,v)));s.value=o[k];s.onchange=()=>set(k,s.value);l.append(el('span',null,lb),s);g.append(l)},col=(lb,k)=>{const l=el('label'),i=el('input');i.type='color';i.value=o[k];i.oninput=()=>set(k,i.value);l.append(el('span',null,lb),i);g.append(l)};
   sel('Стиль','style',[['night','Ночь: тёмный, как сайт'],['tb','TrustBit — неон-фиолет'],['classic','Классика — тёмное стекло'],['mono','Чёрно-белый (тёмный)'],['paper','Бумага: белый и чёрный, как на сайте']]);sel('Движение интерфейса','motion',[['light','Лёгкое (рекомендуется)'],['full','Полное'],['off','Выключено']]);sel('Положение компактного меню','nav',[['top','Сверху'],['bottom','Снизу'],['left','Слева'],['right','Справа']]);sel('Анимация переходов между вкладками','anim',[['fast','Быстрая (рекомендуется)'],['full','Полная, кинематографичная'],['off','Без анимации']]);col('Акцент','ac');col('Цвет прибыли','w');col('Цвет убытка','l');sel('Фон','bg',[['gradient','Переливающийся градиент'],['stars','Звёзды'],['particles','Частицы'],['off','Без эффектов']]);col('Градиент · цвет 1','bg1');col('Градиент · цвет 2','bg2');col('Градиент · цвет 3','bg3');
   sel('Шрифт','font',[['system','Системный'],['rounded','Округлый'],['serif','С засечками'],['mono','Моно'],...(CFG.fonts||[]).map(n=>['f:'+n,n+' (свой)']),...(CFG.gfonts||[]).map(n=>['g:'+n,n+' (Google)'])]);m.append(g);
   const fb=el('div','bar'),ff=el('input'),fbt=el('button','s','📁 Свой шрифт (.woff2 / .ttf / .otf)'),gi=el('input'),gb=el('button','s','＋ Google');ff.type='file';ff.accept='.woff2,.woff,.ttf,.otf';ff.style.display='none';gi.placeholder='Google Font, например Unbounded';
   ff.onchange=async()=>{const f=ff.files[0];if(!f)return;const n=f.name.replace(/\.[^.]+$/,'');if(await mput('font:'+n,f)){CFG.fonts=(CFG.fonts||[]).filter(x=>x!==n).concat([n]);set('font','f:'+n);saveCfg();toast('Шрифт добавлен');draw()}else toast('Не удалось сохранить шрифт')};fbt.onclick=()=>ff.click();gb.onclick=()=>{const n=gi.value.trim();if(!n)return;CFG.gfonts=(CFG.gfonts||[]).filter(x=>x!==n).concat([n]);set('font','g:'+n);saveCfg();draw()};fb.append(fbt,ff,gi,gb);m.append(fb);
   m.append(el('h3',null,'Интро-видео'));const ib=el('div','bar'),iu=el('button','s','🎬 Загрузить интро-видео'),ifl=el('input'),idl=el('button','s','✕ Убрать интро'),irp=el('button','s','↻ Показать интро'),rv=el('input');ifl.type='file';ifl.accept='video/*';ifl.style.display='none';
   ifl.onchange=async()=>{const f=ifl.files[0];if(f)toast((await mput('intro',f))?'Интро сохранено':'Не удалось сохранить видео')};iu.onclick=()=>ifl.click();idl.onclick=async()=>{await mput('intro',null);toast('Интро убрано')};irp.onclick=()=>{close();document.body.classList.add('pre');intro()};rv.type='number';rv.min=1;rv.style.width='90px';rv.value=localStorage.getItem('jrev')||10;rv.onchange=()=>{try{localStorage.setItem('jrev',rv.value)}catch(e){}};
   ib.append(iu,ifl,idl,irp);m.append(ib);const rl=el('label');rl.append(el('span',null,'Журнал появляется на N-й секунде видео'),rv);m.append(rl);
   m.append(el('h3',null,'Триггеры'));const tb=el('button','s','⚙ Триггеры и поля (свои варианты и новые поля)');tb.onclick=()=>{close();fieldsForm()};m.append(tb);
   m.append(el('h3',null,'Луки'));const lb=el('div','bar');LOOKS.concat((CFG.looks||[]).map(x=>[x.name,x.look,1])).forEach(([n,lk,u])=>{const b=el('button','s',n);b.onclick=()=>{CFG.look=Object.assign({},DL,lk);applyLook();saveCfg();draw()};lb.append(b);if(u){const x=el('button','s','✕');x.onclick=()=>{CFG.looks=CFG.looks.filter(y=>y.name!==n);saveCfg();draw()};lb.append(x)}});m.append(lb);
   const sv=el('div','bar'),nm=el('input'),sb=el('button','s','💾 Сохранить лук'),ok=el('button','p','Готово');nm.placeholder='Название лука';sb.onclick=()=>{const n=nm.value.trim();if(!n)return;CFG.looks=(CFG.looks||[]).filter(y=>y.name!==n).concat([{name:n,look:JSON.parse(JSON.stringify(cur()))}]);saveCfg();draw();toast('Лук сохранён')};ok.onclick=()=>{saveCfg();close()};sv.append(nm,sb);m.append(sv,ok)};draw()})}
const ICO={cal:`<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/>`,trend:`<path d='M23 6l-9.5 9.5-5-5L1 18'/><path d='M17 6h6v6'/>`,down:`<path d='M23 18l-9.5-9.5-5 5L1 6'/><path d='M17 18h6v-6'/>`,book:`<path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z'/><path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'/>`,net:`<circle cx='18' cy='5' r='3'/><circle cx='6' cy='12' r='3'/><circle cx='18' cy='19' r='3'/><path d='M8.6 13.5l6.8 4M15.4 6.5l-6.8 4'/>`,flask:`<path d='M9 3h6M10 3v6.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V3'/><path d='M7 15h10'/>`,target:`<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/>`,check:`<path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect x='8' y='2' width='8' height='4' rx='1'/><path d='M9 14l2 2 4-4'/>`,palette:`<circle cx='13.5' cy='6.5' r='1'/><circle cx='17.5' cy='10.5' r='1'/><circle cx='8.5' cy='7.5' r='1'/><circle cx='6.5' cy='12.5' r='1'/><path d='M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.9-4.5-9-10-9z'/>`,help:`<circle cx='12' cy='12' r='10'/><path d='M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01'/>`,video:`<rect x='2' y='5' width='14' height='14' rx='2'/><path d='M16 10l6-3v10l-6-3'/>`,vol:`<path d='M11 5L6 9H2v6h4l5 4z'/><path d='M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14'/>`,mute:`<path d='M11 5L6 9H2v6h4l5 4z'/><path d='M23 9l-6 6M17 9l6 6'/>`,img:`<rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><path d='M21 15l-5-5L5 21'/>`,dl:`<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3'/>`,ul:`<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'/>`,plus:`<path d='M12 5v14M5 12h14'/>`,x:`<path d='M18 6L6 18M6 6l12 12'/>`,edit:`<path d='M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z'/>`,gear:`<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/>`,save:`<path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'/><path d='M17 21v-8H7v8M7 3v5h8'/>`,file:`<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6M16 13H8M16 17H8'/>`,warn:`<path d='M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/><path d='M12 9v4M12 17h.01'/>`,bars:`<path d='M12 20V10M18 20V4M6 20v-4'/>`,clock:`<circle cx='12' cy='12' r='10'/><path d='M12 6v6l4 2'/>`,dotg:`<circle cx='12' cy='12' r='6' fill='currentColor' stroke='none'/>`,dotr:`<circle cx='12' cy='12' r='6' fill='currentColor' stroke='none'/>`,minus:`<circle cx='12' cy='12' r='10'/><path d='M8 12h8'/>`,okc:`<path d='M22 11.1V12a10 10 0 1 1-5.9-9.1'/><path d='M22 4L12 14l-3-3'/>`,xc:`<circle cx='12' cy='12' r='10'/><path d='M15 9l-6 6M9 9l6 6'/>`,alert:`<circle cx='12' cy='12' r='10'/><path d='M12 8v4M12 16h.01'/>`,star:`<path d='M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z'/>`,zap:`<path d='M13 2L3 14h9l-1 8 10-12h-9z'/>`,cloud:`<path d='M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'/>`,rec:`<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='3' fill='currentColor'/>`,play:`<path d='M6 4l14 8-14 8z'/>`,refresh:`<path d='M23 4v6h-6M1 20v-6h6'/><path d='M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15'/>`,film:`<rect x='2' y='2' width='20' height='20' rx='2.2'/><path d='M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5'/>`,folder:`<path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/>`,cam:`<path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'/><circle cx='12' cy='13' r='4'/>`,home:`<path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><path d='M9 22V12h6v10'/>`},
 EM={'📅':'cal','📈':'trend','📓':'book','🕸':'net','🧪':'flask','🎯':'target','📆':'check','🎨':'palette','❓':'help','🎬':'video','🔊':'vol','🔇':'mute','🖼':'img','⬇':'dl','⬆':'ul','＋':'plus','✕':'x','✎':'edit','⚙':'gear','💾':'save','📝':'file','✍':'file','⚠':'warn','📊':'bars','📉':'down','⏰':'clock','🟢':'dotg','🔴':'dotr','⚪':'minus','✅':'okc','❌':'xc','🟡':'alert','🆕':'star','🚀':'zap','🔥':'zap','❄':'cloud','⏺':'rec','▶':'play','↻':'refresh','🎞':'film','📁':'folder','📷':'cam','🏠':'home'};
const SV=n=>`<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>`+(ICO[n]||'')+`</svg>`,ER=new RegExp('('+Object.keys(EM).join('|')+')'+String.fromCharCode(65039)+'?','g'),ER1=new RegExp(ER.source);
function iconify(root){if(!root||root.nodeType!==1)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),ns=[];while(w.nextNode())ns.push(w.currentNode);ns.forEach(t=>{const p=t.parentNode;if(!p||/^(SCRIPT|STYLE|TEXTAREA|OPTION|TITLE)$/.test(p.nodeName)||!ER1.test(t.data))return;const f=document.createDocumentFragment();let last=0,m;ER.lastIndex=0;while((m=ER.exec(t.data))){f.append(t.data.slice(last,m.index));const s=el('span','ico '+EM[m[1]]);s.innerHTML=SV(EM[m[1]]);f.append(s);last=m.index+m[0].length}f.append(t.data.slice(last));p.replaceChild(f,t)})}
new MutationObserver(ms=>ms.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)iconify(n);else if(n.nodeType===3&&n.parentNode)iconify(n.parentNode)}))).observe(document.body,{childList:true,subtree:true});
function logoEl(){const d=el('div','logo-wrap');d.innerHTML=`<svg class='logo' viewBox='0 0 320 180'><defs><linearGradient id='lg1' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff'/><stop offset='.5' stop-color='#c4b5fd'/><stop offset='1' stop-color='#7c3aed'/></linearGradient><linearGradient id='lg2' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#c4b5fd' stop-opacity='0'/><stop offset='.5' stop-color='#e9d5ff'/><stop offset='1' stop-color='#8b5cf6' stop-opacity='0'/></linearGradient></defs><ellipse class='ring' cx='160' cy='90' rx='150' ry='58' pathLength='1'/><g class='pt' style='--fx:-90px;--fy:-30px;--fr:-40deg;--d:0s'><rect x='62' y='28' width='62' height='20' rx='10' fill='url(#lg1)'/></g><g class='pt' style='--fx:0px;--fy:-90px;--fr:20deg;--d:.12s'><rect x='82' y='40' width='22' height='100' rx='8' fill='url(#lg1)'/></g><g class='pt' style='--fx:90px;--fy:50px;--fr:40deg;--d:.24s'><rect x='62' y='132' width='62' height='20' rx='10' fill='url(#lg1)'/></g><g class='pt' style='--fx:0px;--fy:-110px;--fr:-25deg;--d:.36s'><rect x='152' y='28' width='22' height='124' rx='9' fill='url(#lg1)'/></g><g class='pt' style='--fx:150px;--fy:0px;--fr:90deg;--d:.5s'><path d='M174 38H200A52 52 0 0 1 200 142H174' fill='none' stroke='url(#lg1)' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/></g><circle class='sp' cx='30' cy='60' r='3' fill='#fff' style='--d:1s'/><circle class='sp' cx='290' cy='40' r='2.5' fill='#e9d5ff' style='--d:1.4s'/><circle class='sp' cx='275' cy='150' r='3' fill='#fff' style='--d:1.8s'/><circle class='sp' cx='45' cy='150' r='2' fill='#c4b5fd' style='--d:.6s'/><circle class='sp' cx='140' cy='14' r='2.5' fill='#fff' style='--d:2.2s'/><circle r='4' fill='#fff' class='orb'><animateMotion dur='7s' repeatCount='indefinite' path='M10 90A150 58 0 1 1 310 90A150 58 0 1 1 10 90'/></circle></svg>`;return d}
function coins(){[[140,{right:'7%',top:'15%'},0],[100,{left:'5%',bottom:'12%'},2],[62,{left:'13%',top:'30%'},4],[84,{right:'13%',bottom:'20%'},6]].forEach(([s,pos,dl])=>{const c=el('div','coin');c.style.width=c.style.height=s+'px';Object.assign(c.style,pos);c.style.animationDelay='-'+dl+'s';c.innerHTML=`<svg viewBox='0 0 24 24'><path d='M12 2l7 10-7 4-7-4zM12 22l-7-8 7 4 7-4z'/></svg>`;document.body.append(c)})}
const accountApi={
  user:null,online:false,enabled:false,applying:false,syncTimer:null,syncBusy:false,syncQueued:false,syncPromise:null,errorShown:false,storageSyncInstalled:false,cloud:false,sb:null,rev:0,base:null,access:null,readOnly:false,readOnlyShown:false,
  READ_ONLY:'Доступ закончился: журнал открыт только для просмотра и экспорта',
  supabaseConfig(){
    const config=window.JOURNAL_SUPABASE_CONFIG;
    return config&&typeof config.url==='string'&&/^https:\/\//.test(config.url)&&typeof config.key==='string'&&config.key.length>20&&!config.key.startsWith('PASTE_')?config:null
  },
  initializeSupabase(){
    const config=this.supabaseConfig();
    if(!config)return false;
    if(this.sb)return true;
    if(typeof supabase==='undefined'||!supabase.createClient)throw new Error('Не удалось загрузить модуль аккаунтов. Проверь подключение к интернету и обнови страницу.');
    this.sb=supabase.createClient(config.url,config.key,{auth:{flowType:'pkce',storageKey:'sb-journal-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    this.cloud=true;
    return true
  },
  // Keys that belong to this device, not to the journal: the sign-in session
  // ("sb-…") and "jowner", the account whose journal copy is stored here.
  // They are never synced, exported or wiped together with the journal data.
  isAuthKey(key){return typeof key==='string'&&(key.startsWith('sb-')||key==='jowner')},
  describe(error){
    const message=String(error&&error.message||error||'');
    if(/subscription_required/.test(message))return this.READ_ONLY;
    if(/Failed to fetch|NetworkError|Load failed/i.test(message))return 'Нет связи с сервером аккаунтов';
    return message||'Неизвестная ошибка'
  },
  async request(path,options={}){
    let response;
    try{response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}})}
    catch(error){throw new Error('Сервер аккаунтов недоступен.')}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Ошибка сервера ('+response.status+')');
    return data
  },
  snapshot(){
    const state={};
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key!==null&&key!=='jdirty'&&!this.isAuthKey(key))state[key]=localStorage.getItem(key)}
    return state
  },
  restore(state){
    this.applying=true;
    try{
      const stale=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key!==null&&!this.isAuthKey(key))stale.push(key)}
      stale.forEach(key=>localStorage.removeItem(key));
      Object.entries(state||{}).forEach(([key,value])=>{if(!this.isAuthKey(key))localStorage.setItem(key,String(value))});
      const trades=JSON.parse(localStorage.getItem('jt')||'[]'),plans=JSON.parse(localStorage.getItem('jp')||'[]');if(!Array.isArray(trades)||!Array.isArray(plans))throw new Error('В аккаунте сохранены некорректные данные журнала');
      T=trades;P=plans;ready=true;const saved=JSON.parse(localStorage.getItem('jcfg')||'null');if(saved&&saved.accts)CFG=saved;applyLook()
    }finally{this.applying=false}
  },
  // Three-way merge of two copies of the journal (this device and the cloud).
  // base is the last state both sides agreed on, or null when it is unknown.
  // Nothing that either side changed is dropped; on a true clash this device wins.
  mergeState(base,local,remote){
    const out={};
    for(const key of new Set([...Object.keys(local),...Object.keys(remote)])){
      if(this.isAuthKey(key)||key==='jdirty')continue;
      const l=local[key],r=remote[key],b=base?base[key]:undefined;let value;
      if(l===r)value=l;
      else if(base&&l===b)value=r;
      else if(base&&r===b)value=l;
      else if((key==='jt'||key==='jp')&&l!==undefined&&r!==undefined)value=this.mergeList(b,l,r);
      else value=l!==undefined?l:r;
      if(value!==undefined)out[key]=value
    }
    return out
  },
  mergeList(baseText,localText,remoteText){
    try{
      const parse=text=>{const list=text===undefined?[]:JSON.parse(text);if(!Array.isArray(list))throw new Error('not a list');return list};
      const index=list=>{if(list.some(item=>!item||item.id==null))throw new Error('record without id');return new Map(list.map(item=>[String(item.id),JSON.stringify(item)]))};
      const local=parse(localText),remote=parse(remoteText),known=baseText!==undefined,L=index(local),R=index(remote),B=known?index(parse(baseText)):null,out=[];
      for(const id of new Set([...local,...remote].map(item=>String(item.id)))){
        const l=L.get(id),r=R.get(id),b=known?B.get(id):undefined;let pick;
        if(l===r)pick=l;
        else if(known&&l===b)pick=r;
        else if(known&&r===b)pick=l;
        else pick=l!==undefined?l:r;
        if(pick!==undefined)out.push(JSON.parse(pick))
      }
      return JSON.stringify(out)
    }catch(error){return localText}
  },
  async readRemote(){
    const {data,error}=await this.sb.from('journal_state').select('state,rev').eq('user_id',this.user.uid).maybeSingle();
    if(error)throw new Error(this.describe(error));
    if(!data)return null;
    if(!data.state||typeof data.state!=='object'||Array.isArray(data.state))throw new Error('Некорректный формат истории аккаунта');
    return {state:data.state,rev:Number(data.rev)||0}
  },
  async readAccess(){
    const {data,error}=await this.sb.rpc('my_access');
    if(error)throw new Error(this.describe(error));
    return data&&typeof data.status==='string'?data:{status:'expired',until:null}
  },
  accessText(){
    const access=this.access;if(!access)return '';
    const until=access.until?new Date(access.until).toLocaleDateString('ru-RU'):'';
    return access.status==='admin'?'Статус: админ, без срока':access.status==='trial'?'Пробный период до '+until:access.status==='active'?'Подписка до '+until:'Доступ закончился: только просмотр и экспорт'
  },
  reasonText(){
    const a=this.access||{};
    return {denied_duplicate:'Пробный период не выдан: эта почта уже использовала пробный период.',denied_disposable:'Пробный период не выдан: одноразовые почтовые ящики не принимаются.',denied_no_email:'Пробный период не выдан: у аккаунта нет почты.',pending_review:'Пробный период ждёт одобрения администратора.',awaiting_confirmation:'Пробный период начнётся после подтверждения почты.',revoked:'Доступ отозван администратором.'}[a.trial]||(a.until?'Доступ закончился '+new Date(a.until).toLocaleDateString('ru-RU')+'.':'Доступ закончился.')
  },
  updateBanner(){
    let b=document.querySelector('.acc-banner');const a=this.access,show=this.user&&a&&a.status!=='admin';
    document.body.classList.toggle('ro',!!(this.user&&this.readOnly));
    if(!show){if(b)b.remove();return}
    if(!b){b=el('div','acc-banner');b.setAttribute('role','status');const nav=$('#nav');if(nav)nav.after(b);else return}
    b.replaceChildren();b.classList.toggle('bad',!!this.readOnly);
    if(this.readOnly){
      const c=(this.supabaseConfig()||{}).contact;
      b.append(el('b',null,this.reasonText()+' '),document.createTextNode('Журнал открыт только для просмотра и экспорта. Чтобы получить доступ, напиши '));
      if(typeof c==='string'&&/^https:\/\//.test(c)){const l=el('a',null,'администратору');l.href=c;l.target='_blank';l.rel='noopener';b.append(l,'.')}else b.append('администратору.')
    }else{
      const days=a.until?Math.ceil((new Date(a.until)-Date.now())/864e5):null;
      b.append(this.accessText()+(days!=null&&days>=0?' · осталось '+days+' '+(days%10===1&&days%100!==11?'день':days%10>=2&&days%10<=4&&(days%100<10||days%100>=20)?'дня':'дней'):''))
    }
  },
  setReadOnly(){
    this.readOnly=true;this.enabled=false;clearTimeout(this.syncTimer);this.syncTimer=null;this.access={status:'expired',until:this.access&&this.access.until||null,trial:this.access&&this.access.trial};this.updateBanner();
    if(this._rawRemove)this._rawRemove.call(localStorage,'jdirty');
    if(!this.readOnlyShown){this.readOnlyShown=true;toast(this.READ_ONLY)}
  },
  async writeState(state){
    if(!this.cloud)return this.request('/api/state',{method:'PUT',body:JSON.stringify({state})});
    if(this.readOnly)throw new Error(this.READ_ONLY);
    let next=state;
    for(let attempt=0;attempt<3;attempt++){
      if(new Blob([JSON.stringify(next)]).size>5*1024*1024)throw new Error('Данные аккаунта превышают лимит 5 МБ');
      const {data,error}=await this.sb.rpc('save_state',{expected_rev:this.rev,new_state:next});
      if(!error){this.rev=Number(data)||this.rev+1;this.base=next;return}
      if(error.code==='42501'||/subscription_required/.test(error.message||'')){this.setReadOnly();throw new Error(this.READ_ONLY)}
      if(error.code!=='40001'&&!/rev_conflict/.test(error.message||''))throw new Error(this.describe(error));
      // Another device saved first: reread, merge with what is on this device now, try again.
      const remote=await this.readRemote();
      if(!remote){this.rev=0;continue}
      next=this.mergeState(this.base,this.snapshot(),remote.state);this.rev=remote.rev;this.base=remote.state;
      this.restore(next);render()
    }
    throw new Error('Не удалось объединить изменения с другим устройством. Обнови страницу и попробуй ещё раз.')
  },
  oauthFailure(){
    const params=new URLSearchParams(location.search.slice(1)+'&'+location.hash.slice(1)),text=params.get('error_description')||params.get('error');
    if(!text)return '';
    try{history.replaceState(null,'',location.pathname)}catch(error){}
    return String(text).replace(/\+/g,' ').slice(0,200)
  },
  async begin(user){
    this.user={uid:user.id,email:user.email||''};
    // A journal left here by a different account must not leak into this one.
    const owner=localStorage.getItem('jowner');if(owner!==null&&owner!==user.id)this.restore({});
    if(this._rawSet)this._rawSet.call(localStorage,'jowner',user.id);
    const [remote,access]=await Promise.all([this.readRemote(),this.readAccess()]);
    this.access=access;this.readOnly=access.status==='expired';this.rev=remote?remote.rev:0;this.base=remote?remote.state:null;
    const local=this.snapshot(),hasLocal=Object.keys(local).length>0,hasRemote=!!remote&&Object.keys(remote.state).length>0,dirty=localStorage.getItem('jdirty')===this.user.uid;
    if(hasRemote&&!(dirty&&hasLocal))this.restore(remote.state);
    else if(hasRemote){const merged=this.mergeState(null,local,remote.state);this.restore(merged);if(!this.readOnly)await this.writeState(merged)}
    else if(hasLocal&&!this.readOnly)await this.writeState(local);
    if(this._rawRemove)this._rawRemove.call(localStorage,'jdirty');
    this.enabled=!this.readOnly;
    if(this.readOnly&&!this.readOnlyShown){this.readOnlyShown=true;toast(this.READ_ONLY)}
  },
  async init(){
    if(this.supabaseConfig()){
      try{
        const failure=this.oauthFailure();
        this.initializeSupabase();this.online=true;
        const {data,error}=await this.sb.auth.getSession();
        if(error)throw error;
        if(failure)toast('Вход не выполнен: '+failure);
        if(!data||!data.session)return false;
        await this.begin(data.session.user);
        return true
      }catch(error){
        console.warn('Account session could not be restored:',error&&error.message);
        if(this.user){this.enabled=!this.readOnly;toast('Не удалось синхронизировать аккаунт: '+this.describe(error)+'. Изменения останутся на этом устройстве и отправятся позже');return true}
        this.online=false;toast('Не удалось подключиться к аккаунту: '+this.describe(error));return false
      }
    }
    let data;
    try{data=await this.request('/api/session')}
    catch(error){this.online=false;console.warn('Account session could not be restored:',error.message);return false}
    this.online=true;if(!data.authenticated)return false;
    this.user={email:data.email};
    try{if(data.state!==null&&data.state!==undefined)this.restore(data.state);else if(Object.keys(this.snapshot()).length)await this.writeState(this.snapshot())}
    catch(error){toast('Не удалось синхронизировать аккаунт: '+error.message)}
    this.enabled=true;return true
  },
  installStorageSync(){
    if(this.storageSyncInstalled)return;this.storageSyncInstalled=true;
    const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,clear=Storage.prototype.clear,self=this;this._rawSet=set;this._rawRemove=remove;
    Storage.prototype.setItem=function(key,value){const result=set.call(this,key,value);if(this===localStorage&&!self.isAuthKey(key))self.schedule();return result};
    Storage.prototype.removeItem=function(key){const result=remove.call(this,key);if(this===localStorage&&!self.isAuthKey(key))self.schedule();return result};
    Storage.prototype.clear=function(){const result=clear.call(this);if(this===localStorage)self.schedule();return result}
  },
  schedule(){
    if(!this.enabled||this.applying||!this.user)return;
    this._ver=(this._ver||0)+1;if(this._rawSet)this._rawSet.call(localStorage,'jdirty',this.user.uid||'1');
    clearTimeout(this.syncTimer);this.syncTimer=setTimeout(()=>this.sync().catch(()=>{}),700)
  },
  async sync(){
    if(!this.enabled||!this.user)return;
    if(this.syncBusy){this.syncQueued=true;return this.syncPromise}
    this.syncBusy=true;
    this.syncPromise=(async()=>{try{const v0=this._ver||0;await this.writeState(this.snapshot());this.errorShown=false;if((this._ver||0)===v0&&this._rawRemove)this._rawRemove.call(localStorage,'jdirty')}
      catch(error){if(!this.errorShown&&!this.readOnly){toast('Не удалось синхронизировать аккаунт: '+error.message);this.errorShown=true}throw error}
      finally{this.syncBusy=false;this.syncPromise=null;if(this.syncQueued){this.syncQueued=false;this.schedule()}}})();
    return this.syncPromise
  },
  async flush(){
    if(!this.enabled||!this.user)return;
    clearTimeout(this.syncTimer);this.syncTimer=null;
    if(this.syncBusy){this.syncQueued=true;try{await this.syncPromise}catch{}}
    clearTimeout(this.syncTimer);this.syncTimer=null;
    return this.sync()
  },
  updateNav(){
    const nav=$('#nav');if(!nav)return;
    this.updateBanner();
    const old=nav.querySelector('.account-nav');if(old)old.remove();
    if(!this.user)return;
    const button=el('button','big account-nav');button.type='button';button.title='Аккаунт · '+this.user.email;button.setAttribute('aria-label','Аккаунт · '+this.user.email);
    button.innerHTML='<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></i>';
    button.onclick=()=>this.openProfile();nav.append(button)
  },
  async accept(data,registering,close){
    this.user={email:data.email};
    try{
      if(data.state!==null&&data.state!==undefined)this.restore(data.state);
      else await this.writeState(this.snapshot())
    }catch(error){toast('Аккаунт создан, но не удалось синхронизировать данные: '+error.message)}
    this.enabled=true;this.installStorageSync();if(close)close();
    const start=document.querySelector('.start');if(start){start.classList.add('out');document.body.classList.remove('pre');setTimeout(()=>start.remove(),900)}
    render();toast(registering?'Аккаунт создан ✓':'Вход выполнен ✓')
  },
  async signInWithGoogle(){
    this.initializeSupabase();
    const {error}=await this.sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:'select_account'}}});
    if(error)throw new Error(this.describe(error))
  },
  openAuth(mode='register'){
    modal((m,close)=>{
      m.closest('.ov').classList.add('auth-modal');
      if(this.supabaseConfig()){
        const box=el('div','account-form'),error=el('div','account-error'),google=el('button','p','Войти через Google');google.type='button';
        google.onclick=async()=>{error.textContent='';google.disabled=true;try{await this.signInWithGoogle()}catch(failure){error.textContent=failure.message;google.disabled=false}};
        box.append(error,google);
        m.append(el('h3',null,'Вход в Journal'),box,el('div','mu','Первый вход открывает пробный период на 14 дней, карта не нужна. Данные журнала синхронизируются с аккаунтом.'));const pl=el('a',null,'Политика конфиденциальности');pl.href='../privacy.html';pl.target='_blank';pl.rel='noopener';const pd=el('div','mu');pd.append('Входя, ты принимаешь ',pl,'.');m.append(pd);
        return
      }
      let registering=mode==='register';
      const draw=()=>{
        m.replaceChildren();m.append(el('h3',null,registering?'Создать аккаунт':'Войти в Journal'));
        const form=el('form','account-form'),error=el('div','account-error'),emailLabel=el('label'),email=el('input'),passLabel=el('label'),password=el('input');
        email.type='email';email.autocomplete='email';email.required=true;email.maxLength=254;email.placeholder='name@example.com';
        password.type='password';password.autocomplete=registering?'new-password':'current-password';password.required=true;password.minLength=registering?12:1;password.maxLength=1024;password.placeholder=registering?'Не менее 12 символов':'Пароль';
        emailLabel.append(el('span',null,'Электронная почта'),email);passLabel.append(el('span',null,'Пароль'),password);form.append(emailLabel,passLabel);
        let confirm=null;
        if(registering){const label=el('label');confirm=el('input');confirm.type='password';confirm.autocomplete='new-password';confirm.required=true;confirm.minLength=12;confirm.placeholder='Повтори пароль';label.append(el('span',null,'Подтверждение пароля'),confirm);form.append(label)}
        const submit=el('button','p',registering?'Зарегистрироваться':'Войти');submit.type='submit';const toggle=el('button','s',registering?'Уже есть аккаунт? Войти':'Создать новый аккаунт');toggle.type='button';
        form.append(error,submit,toggle);form.onsubmit=async event=>{
          event.preventDefault();error.textContent='';
          if(registering&&password.value!==confirm.value){error.textContent='Пароли не совпадают';return}
          submit.disabled=true;
          try{const data=await this.request(registering?'/api/register':'/api/login',{method:'POST',body:JSON.stringify({email:email.value,password:password.value})});await this.accept(data,registering,close)}
          catch(failure){error.textContent=failure.message}
          finally{submit.disabled=false}
        };
        toggle.onclick=()=>{registering=!registering;draw()};
        m.append(form,el('div','mu','Сессия на этом устройстве сохраняется на 30 дней. Данные журнала будут синхронизироваться с аккаунтом.'))
      };
      draw()
    })
  },
  // SHA-256 of stable browser traits; only the hash leaves the device. Described in privacy.html.
  async deviceHash(){
    const n=navigator,sc=screen||{};let gpu='';
    try{const g=document.createElement('canvas').getContext('webgl'),x=g&&g.getExtension('WEBGL_debug_renderer_info');if(x)gpu=g.getParameter(x.UNMASKED_VENDOR_WEBGL)+'|'+g.getParameter(x.UNMASKED_RENDERER_WEBGL)}catch(e){}
    const traits=[n.platform,n.hardwareConcurrency,n.deviceMemory,sc.width+'x'+sc.height,sc.colorDepth,window.devicePixelRatio,Intl.DateTimeFormat().resolvedOptions().timeZone,(n.languages||[n.language])[0],n.maxTouchPoints,gpu].join('~');
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('id-journal:'+traits));
    return Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('')
  },
  async registerDevice(){
    if(!this.cloud||!this.user||!(window.crypto&&crypto.subtle))return;
    const flag='device-registered:'+this.user.uid;
    try{
      if(await mget(flag))return;
      const {data,error}=await this.sb.rpc('register_device',{hash:await this.deviceHash()});
      if(error)throw new Error(this.describe(error));
      await mput(flag,1);
      if(data&&typeof data.status==='string'){this.access=data;if(data.status==='expired'&&!this.readOnly)this.setReadOnly();else this.updateBanner()}
    }catch(e){console.warn('Device registration failed',e)}
  },
  // One-time per device: screenshots that exist only in this browser (IndexedDB) are uploaded to the cloud bucket.
  async uploadOldShots(){
    if(!this.cloud||!this.user||this.readOnly)return;
    const uid=this.user.uid,flag='shots-uploaded:'+uid;
    try{
      if(await mget(flag))return;
      const have=new Set();
      for(let off=0;;off+=1000){const {data,error}=await this.sb.storage.from('shots').list(uid,{limit:1000,offset:off});if(error)throw error;(data||[]).forEach(f=>have.add(f.name));if(!data||data.length<1000)break}
      let sent=0,failed=0;
      for(const rec of[...T,...P])for(const s of rec.shots||[]){
        if(!s||!s.id||have.has(String(s.id)))continue;
        const v=await mget('shot:'+s.id);if(!v||!/^data:image\//.test(String(v)))continue;
        if(await SHOTS.put(s,v)){sent++;have.add(String(s.id))}else failed++
      }
      if(!failed)await mput(flag,1);
      if(sent)toast('Старые скриншоты загружены в облако: '+sent+(failed?', не удалось: '+failed:''));
      else if(failed)console.warn('Old screenshots not uploaded:',failed)
    }catch(e){console.warn('Old screenshot upload failed',e)}
  },
  openAdmin(){
    modal((m,close)=>{
      m.closest('.ov').classList.add('auth-modal');m.classList.add('admin-md');
      const head=el('div','bar'),x=el('button','s','✕ Закрыть');x.onclick=close;head.append(el('h3',null,'Админ-панель'),x);
      const users=el('div','tw'),doms=el('div');m.append(head,el('h3',null,'Пользователи'),users,el('h3',null,'Заблокированные домены почты'),doms);
      const rpc=async(name,args)=>{const {data,error}=await this.sb.rpc(name,args);if(error)throw new Error(this.describe(error));return data};
      const date=v=>v?new Date(v).toLocaleDateString('ru-RU'):'—';
      const TS={granted:'выдан',awaiting_confirmation:'ждёт подтверждения почты',denied_duplicate:'отказ: ящик уже был',denied_disposable:'отказ: одноразовая почта',denied_no_email:'отказ: нет почты',pending_review:'ждёт одобрения',revoked:'отозван'};
      const act=async(b,fn)=>{b.disabled=true;try{await fn();toast('Готово');await load()}catch(e){toast('Ошибка: '+e.message)}finally{b.disabled=false}};
      const load=async()=>{
        let list,blocked;
        try{[list,blocked]=await Promise.all([rpc('admin_list_users'),rpc('admin_blocked_domains')])}catch(e){users.replaceChildren(el('div','mu','Не удалось загрузить: '+e.message));return}
        const t=el('table'),hr=el('tr');['Почта','Доступ','Пробный','Подписка до','Сигналы','Вход','Действия'].forEach(h=>hr.append(el('th',null,h)));t.append(hr);
        (list||[]).forEach(u=>{
          const r=el('tr'),sig=[];if(u.same_mailbox_accounts>0)sig.push('⚠ тот же ящик: '+u.same_mailbox_accounts);if(u.same_device_accounts>0)sig.push('⚠ то же устройство: '+u.same_device_accounts);
          const a=el('td'),days=el('input');days.type='number';days.value='30';days.style.width='64px';days.title='Дней (минус сокращает)';
          const g=el('button','s','Выдать');g.onclick=()=>{const n=parseInt(days.value,10);if(!n)return toast('Укажи число дней');act(g,()=>rpc('admin_grant',{target:u.user_id,days:n,note:u.note||null}))};
          a.append(days,' ',g);
          if(u.trial_status==='pending_review'||/^denied_/.test(u.trial_status||'')){const ap=el('button','s','Одобрить пробный');ap.onclick=()=>act(ap,()=>rpc('admin_approve_trial',{target:u.user_id,days:14}));a.append(' ',ap)}
          if(u.has_access){const rv=el('button','s','Отозвать');rv.onclick=()=>{if(!rv._a){rv._a=1;rv.textContent='Точно отозвать?';rv.classList.add('bad');setTimeout(()=>{rv._a=0;rv.textContent='Отозвать';rv.classList.remove('bad')},3000);return}act(rv,()=>rpc('admin_revoke',{target:u.user_id}))};a.append(' ',rv)}
          [u.email||'—',u.has_access?'✅ есть':'⛔ нет',(TS[u.trial_status]||u.trial_status||'—')+' · до '+date(u.trial_ends_at),date(u.paid_until),sig.join(', ')||'—',date(u.last_sign_in_at)].forEach((v,i)=>{const c=el('td',i===4&&sig.length?'bad':null,v);r.append(c)});
          r.append(a);t.append(r)
        });
        users.replaceChildren(t,el('div','mu','Всего: '+(list||[]).length));
        const ul=el('div');(blocked||[]).forEach(d=>{const row=el('div','bar'),rm=el('button','s','Убрать');rm.onclick=()=>act(rm,()=>rpc('admin_unblock_domain',{domain:d.domain}));row.append(el('span',null,d.domain+(d.note?' · '+d.note:'')),rm);ul.append(row)});
        if(!(blocked||[]).length)ul.append(el('div','mu','Список пуст'));
        const f=el('div','bar'),di=el('input'),ni=el('input'),add=el('button','s','Заблокировать');di.placeholder='домен, например mailinator.com';ni.placeholder='заметка (необязательно)';
        add.onclick=()=>{const d=di.value.trim().toLowerCase();if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))return toast('Неверный домен');act(add,()=>rpc('admin_block_domain',{domain:d,note:ni.value.trim()||null}))};
        f.append(di,ni,add);doms.replaceChildren(ul,f)
      };
      users.append(el('div','mu','Загрузка…'));load()
    })
  },
  openProfile(){
    modal((m,close)=>{
      m.closest('.ov').classList.add('auth-modal');
      m.append(el('h3',null,'Аккаунт'),el('div','mu',this.user.email));
      const status=this.accessText();if(status)m.append(el('div','mu',status));if(this.readOnly)m.append(el('div','mu',this.reasonText()));{const pl=el('a',null,'Политика конфиденциальности');pl.href='../privacy.html';pl.target='_blank';pl.rel='noopener';const pd=el('div','mu');pd.append(pl);m.append(pd)}if(this.access&&this.access.status==='admin'){const ad=el('button','p','🛡 Админ-панель');ad.onclick=()=>{close();this.openAdmin()};m.append(ad)}
      const logout=el('button','s','Выйти из аккаунта');logout.onclick=async()=>{
        logout.disabled=true;
        try{clearTimeout(this.syncTimer);if(this.enabled)await this.sync();if(this.cloud){const {error}=await this.sb.auth.signOut({scope:'local'});if(error)console.warn('Sign-out request failed:',error.message)}else await this.request('/api/logout',{method:'POST',body:'{}'});this.enabled=false;this.user=null;this.rev=0;this.base=null;this.access=null;this.readOnly=false;this.readOnlyShown=false;this.applying=true;localStorage.clear();this.applying=false;T=[];P=[];CFG={accts:[{id:'fp',name:'FundingPips',bal:25000,dd:10,dl:5,tg:8},{id:'iq',name:'IQcapital',bal:50000,dd:10,dl:5,tg:8}]};applyLook();close();render();document.body.classList.add('pre');intro()}
        catch(error){logout.disabled=false;toast('Не удалось выйти: '+error.message)}
      };m.append(logout)
    })
  }
};
accountApi.installStorageSync();
function startMenu(){if(accountApi.user||document.querySelector('.start'))return;const B=document.body,s=el('div','start'),c=el('div','sc'),b1=el('button','p big2 bt','Начать'),b2=el('button','s big2 bt','Как пользоваться');c.append(logoEl(),el('span','sub','Journal by myIDgod'),el('p','tag','Дневник трейдера нового уровня: сделки, ордерфлоу, статистика и разбор — в одном месте.'),b1,b2);s.append(c);document.body.append(s);const st=()=>{if(s.classList.contains('out'))return;if(accountApi.user){s.classList.add('out');B.classList.remove('pre');setTimeout(()=>s.remove(),900)}else{accountApi.openAuth('register');s.classList.add('out');B.classList.remove('pre');setTimeout(()=>s.remove(),900)}};b1.onclick=st;b2.onclick=()=>guide(st)}
function go(k){if(k===view||window._go)return;const sw=()=>{window._lv=k;view=k;render();window.scrollTo({top:0})};if(motion()==='off'||!document.body.animate||(CFG.look||{}).anim==='off'){sw();return}window._go=1;
  const cp=window._cp||[innerWidth/2,innerHeight/2],x=cp[0],y=cp[1],R0=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y))+30,B=document.body,sl=ms=>new Promise(r=>setTimeout(r,ms)),cir=r=>'circle('+r+'px at '+x+'px '+y+'px)',ease='cubic-bezier(.65,0,.35,1)';
  if((motion()==='full'?((CFG.look||{}).anim||'fast'):'fast')==='fast'){sw();const v=$('#v');if(v&&v.animate)v.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});setTimeout(()=>{window._go=0},250);return}
  const cols=['linear-gradient(135deg,#ede9fe,#c4b5fd)','linear-gradient(135deg,#6d28d9,#8b5cf6)','linear-gradient(135deg,#0d0626,#1d0f4a)'],ls=cols.map((c,i)=>{const d=el('div','tl');d.style.background=c;d.style.zIndex=70+i;d.style.clipPath=cir(0);B.append(d);return d});
  const clean=()=>{ls.forEach(d=>d.remove());B.classList.remove('cine');window._go=0};setTimeout(()=>{if(window._go)clean()},4500);B.classList.add('cine');
  const brand=el('div','transition-brand');brand.append(logoEl());B.append(brand);
  (async()=>{try{ls.forEach((d,i)=>d.animate([{clipPath:cir(0)},{clipPath:cir(R0)}],{duration:560,delay:i*90,easing:ease,fill:'forwards'}));await sl(790);sw();brand.animate([{opacity:0,transform:'translate(-50%,-46%) scale(.72)',filter:'blur(12px)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',filter:'blur(0)'}],{duration:420,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});await sl(430);brand.animate([{opacity:1,transform:'translate(-50%,-50%) scale(1)'},{opacity:0,transform:'translate(-50%,-54%) scale(1.12)'}],{duration:240,easing:ease,fill:'forwards'});await sl(240);[$('#v'),$('#nav')].forEach(e=>e&&e.animate([{opacity:0,transform:'scale(1.06) translateY(14px)',filter:'blur(12px)'},{opacity:1,transform:'none',filter:'blur(0px)'}],{duration:1000,easing:'cubic-bezier(.22,1,.36,1)'}));ls.forEach((d,i)=>d.animate([{clipPath:cir(R0)},{clipPath:cir(0)}],{duration:600,delay:(2-i)*90,easing:ease,fill:'forwards'}));await sl(800)}finally{brand.remove();clean()}})()}
document.addEventListener('click',e=>{const q=e.target.closest&&e.target.closest('.q');if(!q)return;tipBox.textContent=q.dataset.t;tipBox.style.display='block';const r=q.getBoundingClientRect();tipBox.style.left=Math.min(innerWidth-280,Math.max(8,r.left-100))+'px';tipBox.style.top=(r.bottom+8)+'px';setTimeout(()=>{tipBox.style.display='none'},3200)});
Object.assign(HINTS,{'Длительность, с (пусто = по видео)':'Если выбран видео-фон, ролик записывается ровно длиной видео, с его начала и со звуком. Можно задать свою длительность.','Формат':'Соотношение сторон карточки: 1:1, 4:3, 3:4, 16:9 или 9:16.','Стиль':'TrustBit — яркий неон-фиолетовый стиль. Классика — тёмное стекло.'});
function logoEl(){const d=el('div','logo-wrap');d.innerHTML=`<svg class="logo" viewBox="0 0 360 260" role="img" aria-label="Логотип Journal by myIDgod"><defs><linearGradient id="lg1" x1=".08" y1=".1" x2=".92" y2=".95"><stop offset="0" stop-color="#fff"/><stop offset=".22" stop-color="#e7d8ff"/><stop offset=".47" stop-color="#9d4cff"/><stop offset=".72" stop-color="#f8efff"/><stop offset="1" stop-color="#5512bc"/></linearGradient><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b84cff" stop-opacity="0"/><stop offset=".48" stop-color="#fff"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#b967ff"/><stop offset="1" stop-color="#471080"/></linearGradient><radialGradient id="planet"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#efc7ff"/><stop offset=".7" stop-color="#a42fff"/><stop offset="1" stop-color="#360060"/></radialGradient><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path class="orbit orbit-back" d="M35 215C68 178 122 152 184 125S299 83 331 87c18 3 19 20 1 36" pathLength="1" stroke="url(#lg2)"/><g class="letter letter-i"><path d="M92 79l25-31 25 31-12 5v96l-13 22-13-22V84z" fill="url(#lg1)" stroke="url(#edge)" stroke-width="2"/><path class="facet" d="M92 79l25-31v154l-13-22V84z" fill="#fff" opacity=".32"/><path d="M117 48l25 31-15 5-10-12-10 12-15-5zM92 79l15 5v92l-15 17 12-20V84zM105 180l12-14 13 14-13 19z" fill="#d79aff" fill-opacity=".72" stroke="#f6e8ff" stroke-opacity=".8" stroke-width="1.2"/><path d="M103 85l14-9 13 9M117 76v90M105 180h25" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="1.5"/></g><g class="letter letter-d"><path d="M152 79l26-29 24 28h20c33 0 52 21 52 53s-19 53-52 53h-44l-26-26z" fill="url(#lg1)" stroke="url(#edge)" stroke-width="2"/><path d="M178 78l24 0c-13 13-16 29-16 53s3 40 16 53h-24l-26-26V105z" fill="#fff" fill-opacity=".19"/><path class="facet" d="M202 78h20c33 0 52 21 52 53 0 16-5 29-14 38 6-10 9-22 9-36 0-31-19-50-52-52z" fill="#fff" opacity=".42"/><path d="M202 78l-24-28M202 184h-24l-26-26M202 78c-13 13-16 29-16 53s3 40 16 53M202 78h20c33 0 52 21 52 53s-19 53-52 53h-20" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.5"/></g><path class="orbit orbit-line" d="M31 218C87 222 132 185 177 164S269 119 328 91" pathLength="1" stroke="url(#lg2)" filter="url(#glow)"/><path class="orbit orbit-front" d="M32 218C91 215 145 179 190 158S278 119 324 94" pathLength="1" stroke="#e9c4ff" stroke-width="2.1" filter="url(#glow)"/><g class="planet"><circle cx="307" cy="104" r="13" fill="url(#planet)" stroke="#fff" stroke-opacity=".85" stroke-width="1.2"/><circle cx="303" cy="100" r="3.1" fill="#fff" opacity=".95"/><circle cx="307" cy="104" r="18" fill="none" stroke="#c76cff" stroke-opacity=".82"/></g><g class="spark" style="--d:.1s" filter="url(#glow)"><path d="M181 10l5 65 5-65 6 72 8 6-8 6-6 63-5-63-7-6 7-6z" fill="url(#lg1)"/><path d="M36 93l47 6-47 6-46 6 46-5 8-7-8-6z" transform="translate(24 0)" fill="url(#lg1)"/></g><g class="spark" style="--d:.8s" filter="url(#glow)"><path d="M205 203l5 28 5-28 25-5-25-5-5-26-5 26-24 5zM94 221l3 18 4-18 17-4-17-3-4-17-3 17-17 3z" fill="url(#lg1)"/></g></svg>`;return d}
logoEl=function(){
  const d=el('div','logo-wrap'),id='id'+((window._logoSequence=(window._logoSequence||0)+1));
  d.innerHTML=`<svg class="logo id-logo" viewBox="0 0 360 260" role="img" aria-label="Монограмма ID — Journal by myIDgod">
    <defs>
      <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".25" stop-color="#e7dcff"/><stop offset=".58" stop-color="#a78bfa"/><stop offset=".82" stop-color="#f8f5ff"/><stop offset="1" stop-color="#7c5ce8"/></linearGradient>
      <linearGradient id="${id}-edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".48" stop-color="#b79bff"/><stop offset="1" stop-color="#6941c6"/></linearGradient>
      <linearGradient id="${id}-orbit" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#9b7aff" stop-opacity=".05"/><stop offset=".48" stop-color="#bca8ff" stop-opacity=".7"/><stop offset="1" stop-color="#7ee7ff" stop-opacity=".15"/></linearGradient>
      <linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a78bfa" stop-opacity="0"/><stop offset=".48" stop-color="#fff"/><stop offset="1" stop-color="#78e6ff" stop-opacity=".7"/></linearGradient>
      <radialGradient id="${id}-haze"><stop stop-color="#8b5cf6" stop-opacity=".2"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
      <filter id="${id}-edge" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <ellipse class="id-halo" cx="178" cy="132" rx="132" ry="92" fill="url(#${id}-haze)"/>
    <path class="id-orbit-back" stroke="url(#${id}-orbit)" pathLength="1" d="M48 183C90 106 210 54 305 78"/>
    <g class="id-i" filter="url(#${id}-edge)">
      <path d="M76 78h62v19h-20v70h20v19H76v-19h20V97H76z" fill="url(#${id}-metal)" stroke="url(#${id}-edge)" stroke-width="1.5" stroke-linejoin="round"/>
      <path class="id-cut" d="M82 84h17M132 84h-5M82 182h17M132 182h-5"/>
      <path d="M108 101v60" stroke="#fff" stroke-opacity=".38" stroke-width="1"/>
    </g>
    <g class="id-d" filter="url(#${id}-edge)">
      <path fill="url(#${id}-metal)" fill-rule="evenodd" stroke="url(#${id}-edge)" stroke-width="1.6" stroke-linejoin="round" d="M151 78h43c39 0 64 22 64 53s-25 55-64 55h-43zm22 20v68h21c26 0 41-13 41-35s-15-33-41-33z"/>
      <path d="M179 87h15c31 0 52 17 52 44 0 8-2 15-5 21" fill="none" stroke="#fff" stroke-opacity=".36" stroke-width="1.2"/>
      <path class="id-cut" d="M242 154l-8 9"/>
    </g>
    <path class="id-orbit-front" stroke="url(#${id}-shine)" pathLength="1" d="M55 186C113 160 204 107 305 77"/>
    <circle class="id-bead" cx="296" cy="80" r="4.3" fill="#fff" stroke="#bca8ff" stroke-width="3"/>
    <circle cx="61" cy="183" r="2" fill="#e2d9ff" opacity=".8"/>
  </svg>`;
  return d
};
const BASE_FIELDS=FIELDS.map(f=>[f[0],f[1],Array.isArray(f[2])?f[2].slice():f[2]]);
function applyFields(){CFG.opts=CFG.opts||{};CFG.custom=CFG.custom||[];const hidden=new Set(CFG.hiddenFields||[]);FIELDS.splice(0,FIELDS.length,...BASE_FIELDS.filter(f=>!hidden.has(f[0])).map(f=>[f[0],f[1],Array.isArray(f[2])?(Array.isArray(CFG.opts[f[0]])?CFG.opts[f[0]].slice():f[2].slice()):f[2]]),...CFG.custom.filter(c=>!hidden.has(c.key)).map(c=>[c.key,c.label,c.opts,1]));WK.splice(0,WK.length,...WK0.filter(([k])=>!hidden.has(k)),...CFG.custom.filter(c=>!hidden.has(c.key)).map(c=>[c.key,c.label]));Object.keys(WKL).forEach(k=>delete WKL[k]);WK.forEach(([k,l])=>{WKL[k]=l})}
function fieldsForm(){modal((m,close)=>{const C=JSON.parse(JSON.stringify({opts:CFG.opts||{},custom:CFG.custom||[],hidden:CFG.hiddenFields||[]})),parse=s=>s.split(',').map(x=>x.trim()).filter(Boolean);m.append(el('h3',null,'Триггеры и поля'),el('div','mu','Настраивай варианты существующих полей, скрывай ненужные и добавляй свои триггеры. Удаление поля скрывает его из новых сделок, но сохраняет ранее записанные данные.'));const box=el('div');m.append(box);const draw=()=>{box.replaceChildren();BASE_FIELDS.filter(f=>Array.isArray(f[2])).forEach(f=>{const row=el('div','field-edit'),l=el('label'),i=el('input'),hidden=C.hidden.includes(f[0]);i.value=(Array.isArray(C.opts[f[0]])?C.opts[f[0]]:f[2]).join(', ');i.placeholder='Варианты через запятую';i.oninput=()=>C.opts[f[0]]=parse(i.value);l.append(el('span',null,f[1]+' · варианты'),i);const b=el('button','s',hidden?'Вернуть поле':'Удалить поле');b.onclick=()=>{if(hidden)C.hidden=C.hidden.filter(k=>k!==f[0]);else two(b,()=>C.hidden.push(f[0]));draw()};row.append(l,b);box.append(row)});box.append(el('h3',null,'Мои поля'));C.custom.forEach((c,idx)=>{const g=el('div','fg card'),n=el('input'),o=el('input'),l1=el('label'),l2=el('label'),d=el('button','s','Удалить поле');n.value=c.label;o.value=c.opts.join(', ');n.oninput=()=>c.label=n.value;o.oninput=()=>c.opts=parse(o.value);l1.append(el('span',null,'Название'),n);l2.append(el('span',null,'Варианты через запятую'),o);d.onclick=()=>two(d,()=>{C.custom.splice(idx,1);draw()});g.append(l1,l2,d);box.append(g)});const add=el('button','s','＋ Новый триггер');add.onclick=()=>{C.custom.push({key:'c_'+Date.now().toString(36),label:'Новый триггер',opts:['Да','Нет']});draw()};box.append(add)};draw();const b=el('div','bar'),sv=el('button','p','Сохранить');sv.onclick=()=>{CFG.opts=C.opts;CFG.custom=C.custom;CFG.hiddenFields=C.hidden;saveCfg();applyFields();close();render();toast('Триггеры сохранены ✓')};b.append(sv);m.append(b)})}
const setCustomBackground=async blob=>{let layer=document.querySelector('.custom-background'),url=window._customBgUrl;if(url){URL.revokeObjectURL(url);window._customBgUrl=null}if(!blob){if(layer)layer.remove();document.body.classList.remove('custom-background-active');return}if(!layer){layer=el('div','custom-background');layer.setAttribute('aria-hidden','true');document.body.prepend(layer)}url=URL.createObjectURL(blob);window._customBgUrl=url;layer.replaceChildren();if(blob.type.startsWith('video/')){layer.style.backgroundImage='linear-gradient(rgba(3,2,8,.34),rgba(3,2,8,.58))';const video=el('video');video.src=url;video.muted=true;video.loop=true;video.autoplay=true;video.playsInline=true;video.setAttribute('playsinline','');video.preload='auto';layer.append(video);video.play().catch(()=>toast('Нажми на страницу, чтобы запустить видеофон'))}else{layer.style.backgroundImage='linear-gradient(rgba(3,2,8,.45),rgba(3,2,8,.68)),url("'+url+'")'}document.body.classList.add('custom-background-active')};
const originalLookForm2=lookForm2;lookForm2=function(){originalLookForm2();{const all=document.querySelectorAll('.ov');if(all.length)all[all.length-1].classList.add('look-ov')}const m=document.querySelector('.ov.look-ov .md');if(!m||m.querySelector('[data-custom-background]'))return;const section=el('section');section.dataset.customBackground='1';section.append(el('h3',null,'Свой фон'),el('div','mu','Видео сохраняется в исходном качестве и без перекодирования. MP4-карточка с анимацией кодируется отдельно.'));const file=el('input'),pick=el('button','s','🖼 Выбрать изображение или видео'),remove=el('button','s','Убрать свой фон');file.type='file';file.accept='image/*,video/*';file.hidden=true;file.onchange=async()=>{const source=file.files[0];if(!source)return;pick.disabled=true;try{const background=source;if(!await mput('custom-background',background))throw new Error('Не удалось сохранить фон. Проверь свободное место в браузере');await setCustomBackground(background);toast(source.type.startsWith('video/')?'Видео сохранено без перекодирования и установлено как фон':'Свой фон применён')}catch(error){toast(error.message||'Не удалось установить фон')}finally{pick.disabled=false}};pick.onclick=()=>file.click();remove.onclick=async()=>{if(!await mput('custom-background',null)){toast('Не удалось удалить сохранённый фон');return}await setCustomBackground(null);toast('Свой фон удалён')};const controls=el('div','bar');controls.append(pick,file,remove);section.append(controls);const restoreSection=()=>{if(!m.isConnected){observer.disconnect();return}if(!section.isConnected)m.insertBefore(section,m.lastElementChild)};const observer=new MutationObserver(restoreSection);observer.observe(m,{childList:true});m.insertBefore(section,m.lastElementChild)};const appearanceButton=document.querySelector('button.float:not(.h)');if(appearanceButton)appearanceButton.onclick=()=>{const o=document.querySelector('.ov.look-ov');if(o){o.remove();return}lookForm2()};
const originalRender=render;render=function(){originalRender();accountApi.updateNav();if(view==='home'&&ready){const v=$('#v');if(!v.querySelector('.home-watermark')){const mark=el('div','home-watermark');mark.style.opacity='.08';mark.style.animation='none';mark.append(logoEl());v.prepend(mark);v.style.position='relative';v.style.isolation='isolate'}}};
/* ---- Flight of cards, 3D headings and the motion switch (shared Fly module: ../fly.js) ---- */
const flyOn=()=>!!window.Fly&&motion()!=='off';
function split3d(h){if(!h||h.dataset.s3||h.children.length)return;const t=h.textContent;if(!t.trim())return;h.dataset.s3=1;h.setAttribute('aria-label',t);h.textContent='';let i=0;t.split(/(\s+)/).forEach(w=>{if(!w)return;if(/^\s+$/.test(w)){h.append(' ');return}const ws=el('span','wd3');ws.setAttribute('aria-hidden','true');[...w].forEach(c=>{const x=el('span','ch3',c);x.style.setProperty('--c',i++);ws.append(x)});h.append(ws)})}
let flyView=null,freshT=0;const renderFly=render;render=function(){renderFly();const v=$('#v');if(!v)return;const fresh=flyView!==view;flyView=view;v.querySelectorAll('h2,h3').forEach(split3d);
  if(fresh&&motion()!=='off'){v.classList.remove('v-fresh');void v.offsetWidth;v.classList.add('v-fresh');clearTimeout(freshT);freshT=setTimeout(()=>v.classList.remove('v-fresh'),1600)}
  if(window.Fly){Fly.enable(flyOn());if(flyOn())Fly.scan(v,'.card,.tiles>.tile,.tw',{intro:fresh})}};
const applyLookFly=applyLook;applyLook=function(){applyLookFly();document.body.classList.toggle('fly-on',flyOn());if(window.Fly)Fly.enable(flyOn());if(window._syncMotionBtn)window._syncMotionBtn()};
(function(){const t=$('#ttl');split3d(t);if(motion()!=='off'){t.classList.add('t-fresh');setTimeout(()=>t.classList.remove('t-fresh'),2600)}
  if(matchMedia('(pointer:fine)').matches){t.addEventListener('pointermove',ev=>{if(motion()==='off')return;t.querySelectorAll('.ch3').forEach(c=>{const r=c.getBoundingClientRect(),dx=r.left+r.width/2-ev.clientX,dy=r.top+r.height/2-ev.clientY,k=Math.exp(-(dx*dx+dy*dy)/5000);c.style.translate=k>.02?'0 '+(-k*6).toFixed(1)+'px '+(k*40).toFixed(1)+'px':''})});t.addEventListener('pointerleave',()=>t.querySelectorAll('.ch3').forEach(c=>{c.style.translate=''}))}
  const b=el('button','s float mt');b.title='Анимации: включить или выключить';b.setAttribute('aria-label','Анимации');b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="wv" d="M3 15c3-6 6-6 9 0s6 6 9 0"/><path class="wv" d="M3 9c3-6 6-6 9 0s6 6 9 0" opacity=".45"/><path class="x" d="M4 4l16 16"/></svg>';
  const sync=()=>b.setAttribute('aria-pressed',String(motion()!=='off'));sync();
  b.onclick=()=>{const L=Object.assign({},CFG.look||{}),cur=motion();if(cur==='off')L.motion=L.motionPrev&&L.motionPrev!=='off'?L.motionPrev:'light';else{L.motionPrev=cur;L.motion='off'}CFG.look=L;applyLook();saveCfgD();sync();flyView=null;render();toast(motion()==='off'?'Анимации выключены':'Анимации включены')};
  quickActions.append(b);window._syncMotionBtn=sync})();
coins();iconify(document.body);
document.body.classList.add('first');setTimeout(()=>document.body.classList.remove('first'),1700);
applyLook();render();try{window._introFresh=!sessionStorage.getItem('intro-seen');sessionStorage.setItem('intro-seen','1')}catch(e){window._introFresh=true}(async()=>{await accountApi.init();await store.init();await migrateShots();accountApi.registerDevice().then(()=>accountApi.uploadOldShots());if(db){try{const s=await db.collection('settings').doc('cfg').get();if(s.exists&&s.data().accts){CFG=s.data();applyLook();render()}}catch(e){console.warn('Could not load journal settings:',e)}}mget('custom-background').then(setCustomBackground);if(/[?&]login=1(&|$)/.test(location.search)&&!accountApi.user){try{history.replaceState(null,'',location.pathname)}catch(e){}accountApi.signInWithGoogle().catch(e=>{toast(e.message);intro()})}else if(window._introFresh)intro();else if(accountApi.user){document.querySelectorAll('.start').forEach(o=>o.remove());document.body.classList.remove('pre');render()}else intro()})();
