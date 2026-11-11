/* World: the journal as one 3D space. No dependencies, one rAF loop that runs only while something moves.
   Every tab is a station with a fixed pose {x,y,z,ry} in the world. The camera flies straight to the chosen
   station (rising and pulling back a little on the way) and passes other stations without stopping.
   Tab content stays ordinary DOM: at rest it carries no transform (sharp text, normal focus, scroll and clicks);
   during a flight it is projected by the same camera as the background canvas, so both move as one space.
   Coordinates follow CSS: x right, y down, z toward the viewer; the camera looks along -z.
   World.init({content, canvas, stations:{k:pose}, label:k=>text, reduced:()=>bool})
   World.at(k)            jump without motion          World.fly(k, swap) -> Promise   swap() runs mid-flight
   World.quality(q)       0 = no canvas, .5 = light, 1 = full                World.redraw()
   World.on(fn)           fn(fromKey, toKey, t) on every flight frame and once with t = 1
   World.dock(nav, {label, set})   drag the tab bar to any edge; set(edge) saves it */
(function(){
  var P=1100,ST={},keys=[],content=null,cv=null,ctx=null,label=function(k){return k},reduced=function(){return false};
  var cam={x:0,y:0,z:0,ry:0},shown=null,flight=null,raf=0,W=0,H=0,dpr=1,q=1,pts=null,subs=[],idle=0,lastIdle=0,ink='10,10,11';
  var clamp=function(x,a,b){return x<a?a:x>b?b:x},ease=function(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2};
  function rot(v,a){var c=Math.cos(a),s=Math.sin(a);return {x:v.x*c+v.z*s,y:v.y,z:-v.x*s+v.z*c}}
  function sub(a,b){return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}}
  function view(p,c){return rot(sub(p,c),-c.ry)}                       /* world point -> camera frame */
  function center(s){var o=rot({x:0,y:0,z:-P},s.ry);return {x:s.x+o.x,y:s.y+o.y,z:s.z+o.z}}  /* middle of a station's page */
  function wrapA(a){while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a}

  /* ---------- content projection ---------- */
  function origin(){if(!content)return;content.style.transform='';var r=content.getBoundingClientRect();content.style.transformOrigin=(W/2-r.left)+'px '+(H/2-r.top)+'px'}
  function place(c){
    if(!content||!shown||!ST[shown])return;var s=ST[shown],v=view(center(s),c),z=v.z+P,d=Math.sqrt(v.x*v.x+v.y*v.y+z*z);
    if(z>P*.82){content.style.opacity='0';return}
    content.style.transform='perspective('+P+'px) translate3d('+v.x.toFixed(1)+'px,'+v.y.toFixed(1)+'px,'+z.toFixed(1)+'px) rotateY('+wrapA(s.ry-c.ry).toFixed(4)+'rad)';
    content.style.opacity=String(clamp(1-d/(2.4*P),0,1).toFixed(3));
  }
  function rest(){if(!content)return;content.classList.remove('flying');content.style.transform='';content.style.opacity='';content.style.transformOrigin='';content.removeAttribute('inert')}

  /* ---------- background: stations as viewfinder frames, contour islands, dust ---------- */
  function rand(i){var x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x)}
  function build(){
    var a=[],add=function(p,k){a.push(p.x,p.y,p.z,k)},fw=Math.min(W*.86,1100),fh=Math.min(H*.78,760);
    keys.forEach(function(k,si){
      var s=ST[k],c=center(s),step=fw>700?14:11;
      /* viewfinder corners of the page plane (bright) */
      [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(g){for(var i=0;i<=9;i++){var d=i*step;
        add(addv(c,rot({x:g[0]*fw/2-g[0]*d,y:g[1]*fh/2,z:0},s.ry)),0);add(addv(c,rot({x:g[0]*fw/2,y:g[1]*fh/2-g[1]*d,z:0},s.ry)),0)}});
      /* contour island on the ground below the station (mid) */
      var gy=c.y+fh/2+260;for(var r=1;r<=5;r++){var R=r*170*(1+rand(si*7+r)*.25),m=Math.round(R/(q<1?26:16));
        for(var j=0;j<m;j++){var t=j/m*Math.PI*2,w=1+.12*Math.sin(t*3+si+r);add({x:c.x+Math.cos(t)*R*w*1.5,y:gy+r*10,z:c.z+Math.sin(t)*R*w},1)}}
    });
    /* dust along the whole route (faint) */
    var b=bounds(),cnt=Math.round((q<1?500:1400));for(var i=0;i<cnt;i++)add({x:b.x0+(b.x1-b.x0)*rand(i*3+1),y:-700+1600*rand(i*3+2),z:b.z0+(b.z1-b.z0)*rand(i*3+3)},2);
    pts=new Float32Array(a)
  }
  function addv(a,b){return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}}
  function bounds(){var b={x0:1e9,x1:-1e9,z0:1e9,z1:-1e9};keys.forEach(function(k){var s=ST[k];b.x0=Math.min(b.x0,s.x-2200);b.x1=Math.max(b.x1,s.x+2200);b.z0=Math.min(b.z0,s.z-3000);b.z1=Math.max(b.z1,s.z+1500)});return b}
  function draw(c){
    if(!ctx||q<=0)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);if(!pts)build();
    var cx=W/2,cy=H/2,cs=Math.cos(-c.ry),sn=Math.sin(-c.ry),far=7000,base=[.62,.34,.2],size=[1.5,1.3,1.1];
    ctx.fillStyle='rgb('+ink+')';
    for(var i=0;i<pts.length;i+=4){
      var dx=pts[i]-c.x,dy=pts[i+1]-c.y,dz=pts[i+2]-c.z,x=dx*cs+dz*sn,z=-dx*sn+dz*cs;if(z>-40)continue;
      var k=pts[i+3],sc=P/-z,sx=cx+x*sc,sy=cy+dy*sc;if(sx<-4||sx>W+4||sy<-4||sy>H+4)continue;
      var a=base[k]*(1-clamp(-z/far,0,1));if(a<.02)continue;var r=Math.max(.6,size[k]*Math.min(sc,2.4));
      ctx.globalAlpha=a;ctx.fillRect(sx-r/2,sy-r/2,r,r);
    }
    /* station names next to their frames */
    ctx.globalAlpha=1;ctx.textBaseline='bottom';
    keys.forEach(function(k,i){var s=ST[k],cc=center(s),fw=Math.min(W*.86,1100),fh=Math.min(H*.78,760),p=view(addv(cc,rot({x:-fw/2,y:-fh/2-14,z:0},s.ry)),c);
      if(p.z>-60||k===shown&&!flight)return;var sc=P/-p.z;if(sc<.08)return;
      ctx.globalAlpha=clamp(.85*(1-(-p.z)/far),0,.85);ctx.font='500 '+Math.round(clamp(15*sc,6,22))+'px Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
      ctx.fillText(label(k),cx+p.x*sc,cy+p.y*sc)});
    ctx.globalAlpha=1;
  }
  function size(){
    W=innerWidth;H=innerHeight;if(!cv)return;dpr=Math.min(devicePixelRatio||1,q<1?1:1.75);
    cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);pts=null;
    try{ink=getComputedStyle(document.body).getPropertyValue('--wink').trim()||(document.body.classList.contains('paper')?'10,10,11':'214,213,208')}catch(e){}
  }

  /* ---------- loop ---------- */
  function idleCam(t){if(flight||reduced()||q<1||document.hidden)return cam;var a=t/1000;return {x:cam.x+Math.sin(a*.21)*26,y:cam.y+Math.sin(a*.17+1)*12,z:cam.z+Math.sin(a*.13+2)*18,ry:cam.ry+Math.sin(a*.11)*.006}}
  function frame(now){
    raf=0;
    if(flight){
      var f=flight,t=clamp((now-f.t0)/f.dur,0,1),e=ease(t),b=Math.sin(Math.PI*t),ry=f.from.ry+wrapA(f.to.ry-f.from.ry)*e,back=rot({x:0,y:0,z:1},ry);
      cam={x:f.from.x+(f.to.x-f.from.x)*e+back.x*f.pull*b,y:f.from.y+(f.to.y-f.from.y)*e-f.arc*b,z:f.from.z+(f.to.z-f.from.z)*e+back.z*f.pull*b,ry:ry};
      if(!f.swapped&&t>=.5){f.swapped=true;content.style.transform='';try{f.swap&&f.swap()}catch(err){console.error(err)}shown=f.k;origin()}
      place(cam);draw(cam);emit(f.fromK,f.k,t);
      if(t>=1){cam={x:f.to.x,y:f.to.y,z:f.to.z,ry:f.to.ry};flight=null;rest();draw(cam);f.resolve()}
    }else if(idle){draw(idleCam(now));lastIdle=now}
    if(flight||idle&&!document.hidden)loop();
  }
  function loop(){if(!raf)raf=requestAnimationFrame(function(t){if(!flight&&idle&&t-lastIdle<48){raf=0;return loop()}frame(t)})}
  function emit(a,b,t){subs.forEach(function(f){try{f(a,b,t)}catch(e){}})}
  function setIdle(){idle=!reduced()&&q>=1&&!!cv;if(idle)loop()}

  function at(k){if(!ST[k])return;var s=ST[k];cam={x:s.x,y:s.y,z:s.z,ry:s.ry};shown=k;flight=null;rest();draw(cam);emit(k,k,1)}
  function fly(k,swap){
    return new Promise(function(resolve){
      if(!ST[k]||!content){swap&&swap();shown=k;resolve();return}
      if(flight){var old=flight;flight=null;if(!old.swapped){try{old.swap=null}catch(e){}}old.resolve()}
      var s=ST[k],to={x:s.x,y:s.y,z:s.z,ry:s.ry},from={x:cam.x,y:cam.y,z:cam.z,ry:cam.ry},dist=Math.sqrt(Math.pow(to.x-from.x,2)+Math.pow(to.y-from.y,2)+Math.pow(to.z-from.z,2)),fromK=shown;
      if(reduced()||dist<1){
        /* no flight: a short cross-fade only (opacity, never transform) */
        rest();swap&&swap();shown=k;cam=to;draw(cam);emit(fromK,k,1);
        if(content.animate)content.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease-out'});
        resolve();return;
      }
      origin();content.classList.add('flying');content.setAttribute('inert','');
      flight={from:from,to:to,k:k,fromK:fromK,swap:swap,swapped:false,resolve:resolve,t0:performance.now(),
        dur:820+Math.min(dist,6000)*.09,arc:Math.min(dist*.12,520),pull:Math.min(dist*.35,1600)+200};
      loop();
    });
  }

  /* ---------- tab bar docking: drag to an edge, or arrow keys on the grip ---------- */
  function dock(nav,o){
    if(!nav||nav._dock)return;nav._dock=1;var drag=null,zones=null;
    function edgeAt(x,y){var d=[['left',x],['right',W-x],['top',y],['bottom',H-y]];d.sort(function(a,b){return a[1]-b[1]});return d[0][0]}
    function showZones(e){if(!zones){zones=document.createElement('div');zones.className='dock-zones';zones.setAttribute('aria-hidden','true');['top','right','bottom','left'].forEach(function(s){var z=document.createElement('i');z.dataset.e=s;zones.append(z)});document.body.append(zones)}
      zones.querySelectorAll('i').forEach(function(z){z.classList.toggle('on',z.dataset.e===e)})}
    nav.addEventListener('pointerdown',function(ev){var g=ev.target.closest&&ev.target.closest('.dock-grip');if(!g||ev.button>0)return;
      var r=nav.getBoundingClientRect();drag={id:ev.pointerId,dx:ev.clientX-r.left,dy:ev.clientY-r.top,x0:ev.clientX,y0:ev.clientY,on:false};g.setPointerCapture(ev.pointerId);ev.preventDefault()});
    nav.addEventListener('pointermove',function(ev){if(!drag||ev.pointerId!==drag.id)return;
      if(!drag.on&&Math.abs(ev.clientX-drag.x0)+Math.abs(ev.clientY-drag.y0)<5)return;
      if(!drag.on){drag.on=true;document.body.classList.add('dock-drag')}
      nav.style.left=(ev.clientX-drag.dx)+'px';nav.style.top=(ev.clientY-drag.dy)+'px';nav.style.right='auto';nav.style.bottom='auto';showZones(edgeAt(ev.clientX,ev.clientY))});
    function end(ev){if(!drag||ev.pointerId!==drag.id)return;var was=drag.on;drag=null;document.body.classList.remove('dock-drag');
      nav.style.left=nav.style.top=nav.style.right=nav.style.bottom='';if(zones){zones.remove();zones=null}
      if(was&&ev.type==='pointerup')o.set(edgeAt(ev.clientX,ev.clientY))}
    nav.addEventListener('pointerup',end);nav.addEventListener('pointercancel',end);
    nav.addEventListener('keydown',function(ev){var g=ev.target.closest&&ev.target.closest('.dock-grip');if(!g)return;
      var m={ArrowUp:'top',ArrowDown:'bottom',ArrowLeft:'left',ArrowRight:'right'}[ev.key];if(m){ev.preventDefault();o.set(m)}});
  }

  function init(o){
    content=o.content;cv=o.canvas||null;ctx=cv&&cv.getContext?cv.getContext('2d'):null;if(!ctx)cv=null;
    ST=o.stations||{};keys=Object.keys(ST);if(o.label)label=o.label;if(o.reduced)reduced=o.reduced;
    size();addEventListener('resize',function(){size();if(flight)origin();draw(flight?cam:cam)});
    document.addEventListener('visibilitychange',function(){if(!document.hidden)setIdle()});
    setIdle();
  }
  window.World={init:init,at:at,fly:fly,on:function(f){subs.push(f)},dock:dock,
    quality:function(v){q=clamp(+v||0,0,1);if(cv)cv.hidden=q<=0;size();draw(cam);setIdle()},
    redraw:function(){size();draw(cam);setIdle()},current:function(){return shown},flying:function(){return !!flight}};
})();
