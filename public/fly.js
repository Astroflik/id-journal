/* Fly: scroll-linked 3D flight shared by the landing and the journal.
   An element catches up from behind the viewer as it enters, stays put while it is read,
   then flies away into the distance as it leaves. No dependencies, one rAF per scroll frame.
   Fly.add(el, {pin:true, sec:section})  pin: held at the screen centre for its whole life (landing panels)
   Fly.scan(root, selector, {intro:true}) tracks matching top-level elements, intro = time-based entry for those on screen
   Fly.enable(bool) turns everything on or off; off clears every inline style it set. */
(function(){
  var items=new Set(),near=new Set(),on=true,raf=0,io=null,timeAnim=false;
  var clamp=function(x){return x<0?0:x>1?1:x},outC=function(t){return 1-Math.pow(1-t,3)},inC=function(t){return t*t*t};
  /* a pinned panel is observed through its section: section._fly points back at the panel */
  if('IntersectionObserver' in window)io=new IntersectionObserver(function(es){es.forEach(function(en){var t=en.target._fly||en.target;if(en.isIntersecting)near.add(t);else near.delete(t)});kick()},{rootMargin:'35% 0px 35% 0px'});
  function clear(e){e.style.transform='';e.style.opacity='';e.style.filter='';e.style.transition='';e.style.willChange='';e.classList.remove('fly-hold')}
  function measure(e){if(!e._pin)return;var t=e.style.transform;e.style.transition='none';e.style.transform='none';var s=e._sec.getBoundingClientRect(),r=e.getBoundingClientRect();e._off=r.top-s.top;e._h=r.height;e.style.transform=t}
  function frame(now){raf=0;if(!on)return;var vh=innerHeight,vw=innerWidth,maxY=document.documentElement.scrollHeight-vh,atEnd=scrollY>=maxY-2,busy=false;
    (io?near:items).forEach(function(e){if(!e.isConnected){forget(e);return}
      var p,x,ty=0,side=e._side;
      if(e._pin){var s=e._sec.getBoundingClientRect(),q=(vh-s.top)/(s.height+vh),top=s.top+e._off,h=e._h,want=h>vh*.9?vh*.05:(vh-h)/2;
        /* enter q .06-.34, hold to .64, leave by .92 */
        p=outC(clamp((q-.06)/.28));x=inC(clamp((q-.64)/.28));ty=want-top;
        if(q<=0||q>=1){p=q<=0?0:1;x=q>=1?1:0}
      }else{var r=e.getBoundingClientRect(),h2=r.height;
        /* untransformed edges are close enough: the transform is mostly depth */
        p=outC(clamp((vh-r.top)/(vh*.2)));x=inC(clamp(1-(r.bottom)/(vh*.24)));if(atEnd)p=1;
        if(e._t0){var k=clamp((now-e._t0)/900);if(k<1){busy=true;p=Math.min(p,outC(k))}else e._t0=0}
        if(side==null){var cx=r.left+r.width/2;side=e._side=Math.abs(cx-vw/2)<vw*.12?0:cx<vw/2?-1:1}
        var amp=Math.min(1,vh/Math.max(1,h2));p=1-(1-p)*amp;x=x*amp}
      if(p>=1&&x<=0&&!e._pin){if(e._dirty){clear(e);e._dirty=0}return}
      var k1=1-p,deep=e._pin?860:620;
      e.style.transition='none';e.style.willChange='transform,opacity';
      e.style.transform='perspective(1000px) translate3d('+(side*12*k1).toFixed(2)+'vw,'+ty.toFixed(1)+'px,0) translate3d(0,'+(20*k1-10*x).toFixed(2)+'vh,'+(deep*k1-700*x).toFixed(0)+'px) rotateY('+(-side*15*k1).toFixed(2)+'deg) rotateX('+(10*k1-16*x).toFixed(2)+'deg) rotateZ('+(-side*3*k1).toFixed(2)+'deg)';
      e.style.opacity=String(Math.min(1,p*1.8)*(1-x)).slice(0,5);
      e.style.filter=e._pin&&(k1>.02||x>.02)?'blur('+((k1+x)*7).toFixed(1)+'px)':'';
      e.classList.toggle('fly-hold',p>.98&&x<.02);e._dirty=1});
    if(busy)kick()}
  function kick(){if(!raf&&on)raf=requestAnimationFrame(frame)}
  function forget(e){items.delete(e);near.delete(e);if(io)io.unobserve(e._pin?e._sec:e);clear(e)}
  function add(e,o){o=o||{};if(items.has(e))return;e._pin=!!o.pin;e._sec=o.sec||e.parentNode;e._side=o.side;items.add(e);if(e._pin){e._sec._fly=e;measure(e)}if(io)io.observe(e._pin?e._sec:e);kick()}
  function scan(root,sel,o){o=o||{};if(!root)return;var all=[].slice.call(root.querySelectorAll(sel)),set=new Set(all),vh=innerHeight,n=0,now=performance.now();
    items.forEach(function(e){if(!e._pin&&(!e.isConnected||!root.contains(e)))forget(e)});
    all.forEach(function(e){for(var a=e.parentElement;a&&a!==root;a=a.parentElement)if(set.has(a))return;
      var fresh=!items.has(e);e._side=null;add(e);
      if(on&&o.intro&&fresh){var r=e.getBoundingClientRect();if(r.top<vh&&r.bottom>0&&n<14){e._t0=now+n*70;n++}}});kick()}
  function enable(v){on=!!v;if(!on){if(raf)cancelAnimationFrame(raf);raf=0;items.forEach(clear)}else{items.forEach(measure);kick()}}
  addEventListener('scroll',kick,{passive:true});addEventListener('load',function(){items.forEach(measure);kick()});addEventListener('resize',function(){items.forEach(function(e){e._side=null;measure(e)});kick()});
  window.Fly={add:add,scan:scan,enable:enable,get on(){return on},kick:kick};
})();
