/* Graph3D: the trade graph in 3D, drawn on a 2D canvas as a monochrome point cloud.
   No dependencies, no WebGL. Public surface: window.Graph3D = { mount(host, opts), state() }. */
(function () {
  'use strict';

  var INK = '#0A0A0B', MUTED = '#5E6068', PAPER = '#F5F5F3';
  var TAU = Math.PI * 2, GOLDEN = 2.399963229728653;
  var CAM = 4.2;            // camera distance in model units at zoom 1
  var HUB_GAP = 2.3;        // distance between neighbouring hubs
  var DOT_STEP = 0.06;      // spacing of the dots that make an edge
  var YAW0 = 0.5, PITCH0 = 0.3;
  var AUTO_SPEED = 0.12, KEY_STEP = 0.12, ROT = 0.008;
  var ZMIN = 0.5, ZMAX = 3;
  var HIT = 14, HIT_TOUCH = 22, DRAG_PX = 5, DIM = 0.18, NEAR = 0.25;
  var FONT = '500 11px ui-monospace, Menlo, Consolas, monospace';

  var instances = [];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gcd(a, b) { while (b) { var r = a % b; a = b; b = r; } return a; }
  function num(v) { v = Number(v); return isFinite(v) && v > 0 ? v : 1; }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function kindOf(t) {
    var r = t && t.res;
    return r === 'Тейк' ? 1 : r === 'Стоп' ? 2 : r === 'BE' ? 3 : 0;
  }
  function sweep() {
    for (var i = instances.length - 1; i >= 0; i--) if (instances[i].stale()) instances[i].teardown();
  }

  function mount(host, opts) {
    sweep();
    if (!host) return;
    opts = opts || {};
    var tr = function (k) { return typeof opts.t === 'function' ? opts.t(k) : k; };
    var isReduced = function () { return typeof opts.reduced === 'function' ? !!opts.reduced() : false; };
    var isAlive = function () { return typeof opts.alive === 'function' ? !!opts.alive() : true; };
    var scale = opts.scale || { x: 1, y: 1, z: 1 };
    var insts = (opts.insts || []).slice();
    var trades = opts.trades || [];

    /* ---------- model ---------- */
    var hubs = insts.map(function (name, i) {
      return { name: name, label: String(name).toUpperCase(), x: (i - (insts.length - 1) / 2) * HUB_GAP,
        k: 1, baseR: 17, R: 17, cx: 0, cy: 0, cz: 0, sx: 0, sy: 0, p: 1, near: 0.5, vis: false };
    });
    var nodes = [];
    hubs.forEach(function (hub, hi) {
      var list = trades.filter(function (t) { return t && t.inst === hub.name; })
        .sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
      var n = list.length;
      if (!n) return;
      // Fibonacci sphere of n directions, walked with a coprime stride so that the radius
      // (which grows with age order) is not tied to the latitude: the trades fill a ball.
      var stride = Math.max(1, Math.round(n * 0.618));
      while (gcd(stride, n) !== 1) stride++;
      var fit = Math.min(1, 1.25 / (0.22 + 0.13 * Math.sqrt(n)));
      list.forEach(function (t, k) {
        var j = (k * stride) % n, y = 1 - 2 * (j + 0.5) / n, q = Math.sqrt(Math.max(0, 1 - y * y));
        var a = j * GOLDEN, r = (0.22 + 0.13 * Math.sqrt(k + 1)) * fit;
        nodes.push({ t: t, h: hi, kind: kindOf(t), dx: Math.cos(a) * q * r, dy: y * r, dz: Math.sin(a) * q * r,
          ph: k * 1.7, len: 0, cx: 0, cy: 0, cz: 0, sx: 0, sy: 0, p: 1, r: 3, near: 0.5, fade: 1, vis: false });
      });
    });
    var hubSpan = hubs.length ? Math.abs(hubs[0].x) : 0;
    var items = [];
    nodes.forEach(function (n) { items.push({ k: 0, o: n, z: 0 }); });
    nodes.forEach(function (n) { items.push({ k: 1, o: n, z: 0 }); });
    hubs.forEach(function (h, i) { items.push({ k: 2, o: h, i: i, z: 0 }); });
    var dotStep = DOT_STEP * (nodes.length > 600 ? 2 : 1);
    var roundDots = nodes.length <= 260;

    /* ---------- DOM ---------- */
    var hint = mk('div', 'mu g3-hint', tr('g3.hint'));
    var bar = mk('div', 'bar g3-bar');
    ['x', 'y', 'z'].forEach(function (axis) {
      var wrap = mk('label', 'graph-scale'), input = mk('input');
      input.type = 'range'; input.min = '.5'; input.max = '1.8'; input.step = '.1';
      input.value = String(clamp(num(scale[axis]), 0.5, 1.8));
      input.title = Number(input.value).toFixed(1) + '×';
      input.setAttribute('aria-label', tr('g3.scale') + ' ' + axis.toUpperCase());
      input.addEventListener('input', function () {
        scale[axis] = Number(input.value);
        input.title = scale[axis].toFixed(1) + '×';
        wake();
      });
      wrap.append(mk('span', 'mu', tr('g3.' + axis)), input);
      if (!nodes.length) wrap.style.display = 'none';
      bar.append(wrap);
    });
    var resetBtn = mk('button', 's g3-reset', tr('g3.reset'));
    resetBtn.type = 'button';
    bar.append(resetBtn);
    var card = mk('div', 'card g3-card');
    var cv = mk('canvas', 'g3-cv');
    cv.tabIndex = 0;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', tr('g3.aria'));
    cv.style.cssText = 'display:block;width:100%;height:clamp(360px,62vh,640px);touch-action:none;cursor:grab';
    var tip = mk('div', 'g3-tip');
    tip.hidden = true;
    card.append(cv, tip);
    host.append(hint, bar, card);
    if (!nodes.length) host.append(mk('div', 'msg', tr('g3.empty')));

    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.font = FONT;
    hubs.forEach(function (h) { h.baseR = Math.max(17, ctx.measureText(h.label).width / 2 + 8); });

    /* ---------- state ---------- */
    var yaw = YAW0, pitch = PITCH0, zoom = 1, auto = true;
    var vyaw = 0, vpitch = 0, inertia = false, bob = 0, clock = 0;
    var W = 0, H = 0, dpr = 1, F = 1, D = CAM;
    var raf = 0, last = 0, dirty = false, seen = false, tries = 0, dead = false, born = Date.now();
    var col = { tx: INK, mu: MUTED, bg: PAPER }, colT = 0;
    var hov = null, pinned = -1, kb = -1, tipW = 0, tipH = 0;
    var ptr = { x: 0, y: 0, inside: false, fine: false };
    var ptrs = {}, nptr = 0, drag = null, pinch = 0;
    var ro = null, mo = null;

    function wake() {
      dirty = true;
      if (!raf && !dead) raf = requestAnimationFrame(frame);
    }
    function stopAuto() { auto = false; }
    function setZoom(z) { zoom = clamp(z, ZMIN, ZMAX); wake(); }
    function resetView() { yaw = YAW0; pitch = PITCH0; zoom = 1; inertia = false; vyaw = vpitch = 0; stopAuto(); wake(); }
    function upside() { return Math.cos(pitch) < 0 ? -1 : 1; }

    function readColors(now) {
      colT = now || performance.now();
      var cs = null;
      try { cs = getComputedStyle(host); } catch (e) { cs = null; }
      var get = function (name, fb) { var v = cs ? String(cs.getPropertyValue(name) || '').trim() : ''; return v || fb; };
      col.tx = get('--tx', INK); col.mu = get('--mu', MUTED); col.bg = get('--bg', PAPER);
    }

    function resize() {
      var w = cv.clientWidth, h = cv.clientHeight, r = Math.min(2, window.devicePixelRatio || 1);
      if (!w || !h) { W = H = 0; return; }
      if (w !== W || h !== H || r !== dpr) {
        W = w; H = h; dpr = r;
        cv.width = Math.round(w * r); cv.height = Math.round(h * r);
      }
      wake();
    }

    /* ---------- projection ---------- */
    var sinY = 0, cosY = 1, sinP = 0, cosP = 1, ext = 1;
    function put(o, x, y, z) {
      var x1 = x * cosY + z * sinY, z1 = -x * sinY + z * cosY;
      var y2 = y * cosP - z1 * sinP, z2 = y * sinP + z1 * cosP, d = D - z2;
      o.cx = x1; o.cy = y2; o.cz = z2;
      o.near = clamp((z2 + ext) / (2 * ext), 0, 1);
      o.vis = d > NEAR;
      if (!o.vis) return;
      var s = F / d;
      o.sx = W / 2 + x1 * s; o.sy = H / 2 - y2 * s; o.p = CAM / d;
      o.fade = clamp((d - NEAR) / 0.55, 0, 1);
    }
    function project() {
      var kx = num(scale.x), ky = num(scale.y), kz = num(scale.z), i, n, h;
      sinY = Math.sin(yaw); cosY = Math.cos(yaw); sinP = Math.sin(pitch); cosP = Math.cos(pitch);
      D = CAM / zoom; F = Math.min(W * 0.9, H * 2);
      ext = hubSpan + 1.3 * Math.max(kx, ky, kz);
      for (i = 0; i < hubs.length; i++) {
        h = hubs[i];
        put(h, h.x, 0, 0);
        h.R = clamp(h.baseR * Math.pow(h.p, 0.6), 13, 30);
      }
      var amp = bob * 0.018;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var ex = n.dx, ey = n.dy, ez = n.dz;
        if (amp) {
          ex += Math.sin(clock * 0.8 + n.ph) * amp;
          ey += Math.cos(clock * 0.65 + n.ph * 1.3) * amp;
          ez += Math.sin(clock * 0.5 + n.ph * 0.7) * amp;
        }
        ex *= kx; ey *= ky; ez *= kz;
        n.len = Math.sqrt(ex * ex + ey * ey + ez * ez);
        put(n, hubs[n.h].x + ex, ey, ez);
        n.r = clamp(3.3 * Math.pow(n.p, 0.85), 1.2, 11);
      }
    }

    /* ---------- hit testing and hover ---------- */
    function pick(px, py, slop) {
      var best = null, bs = Infinity, i, d, s;
      for (i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.vis) continue;
        d = Math.hypot(n.sx - px, n.sy - py);
        if (d > slop) continue;
        s = d + (1 - n.near) * 3;
        if (s < bs) { bs = s; best = { type: 'trade', i: i }; }
      }
      for (i = 0; i < hubs.length; i++) {
        var h = hubs[i];
        if (!h.vis) continue;
        d = Math.hypot(h.sx - px, h.sy - py) - h.R;
        if (d > slop) continue;
        s = 6 + Math.max(0, d);
        if (s < bs) { bs = s; best = { type: 'hub', i: i }; }
      }
      return best;
    }
    function setCursor() {
      cv.style.cursor = drag && drag.moved ? 'grabbing' : hov && hov.type === 'trade' ? 'pointer' : 'grab';
    }
    function setHover(h) {
      if ((!h && !hov) || (h && hov && h.type === hov.type && h.i === hov.i)) return;
      hov = h;
      if (h && h.type === 'trade') {
        var t = nodes[h.i].t;
        tip.textContent = typeof opts.tip === 'function' ? String(opts.tip(t))
          : [t.date, t.inst, t.res].filter(Boolean).join(' ');
        tip.hidden = false;
        tipW = tip.offsetWidth; tipH = tip.offsetHeight;
        placeTip();
      } else tip.hidden = true;
      setCursor();
      wake();
    }
    function updateHover() {
      if (kb >= 0 || drag || !ptr.inside || !ptr.fine) return;
      setHover(pick(ptr.x, ptr.y, HIT));
    }
    function placeTip() {
      if (tip.hidden || !W) return;
      var ax = ptr.x, ay = ptr.y;
      if (kb >= 0 && nodes[kb]) { ax = nodes[kb].sx; ay = nodes[kb].sy; }
      var x = ax + 14, y = ay + 16;
      if (x + tipW > W - 6) x = ax - tipW - 12;
      if (y + tipH > H - 6) y = ay - tipH - 12;
      tip.style.transform = 'translate(' + Math.round(Math.max(6, x)) + 'px,' + Math.round(Math.max(6, y)) + 'px)';
    }
    function highlight() { return hov && hov.type === 'hub' ? hov.i : pinned; }
    function openTrade(i) { if (nodes[i] && typeof opts.open === 'function') opts.open(nodes[i].t); }

    /* ---------- drawing ---------- */
    function drawEdge(n) {
      var h = hubs[n.h], len = n.len, end = len - 0.035;
      if (end <= dotStep * 2) return;
      ctx.globalAlpha = (0.3 + 0.6 * (h.near + n.near) / 2) * h.k;
      ctx.fillStyle = col.mu;
      ctx.beginPath();
      for (var s = dotStep * 2; s < end; s += dotStep) {
        var f = s / len, z = h.cz + (n.cz - h.cz) * f, d = D - z;
        if (d <= NEAR) continue;
        var q = F / d, px = W / 2 + (h.cx + (n.cx - h.cx) * f) * q, py = H / 2 - (h.cy + (n.cy - h.cy) * f) * q;
        var sz = clamp(0.62 * CAM / d, 0.5, 1.3);
        if (roundDots) { ctx.moveTo(px + sz, py); ctx.arc(px, py, sz, 0, TAU); }
        else ctx.rect(px - sz, py - sz, sz * 2, sz * 2);
      }
      ctx.fill();
    }
    function drawNode(n) {
      if (!n.vis || n.fade <= 0) return;
      var x = n.sx, y = n.sy, r = n.r;
      ctx.globalAlpha = (0.28 + 0.72 * n.near) * n.fade * hubs[n.h].k;
      ctx.fillStyle = ctx.strokeStyle = col.tx;
      ctx.lineWidth = Math.max(1, r * 0.3);
      ctx.beginPath();
      if (n.kind === 1) {                       // take: filled dot
        ctx.arc(x, y, r, 0, TAU); ctx.fill();
      } else if (n.kind === 2) {                // stop: hollow ring with a diagonal stroke
        var e = r * 1.2;
        ctx.arc(x, y, r, 0, TAU);
        ctx.moveTo(x - e, y + e); ctx.lineTo(x + e, y - e);
        ctx.stroke();
      } else if (n.kind === 3) {                // break-even: half-filled dot
        ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
      } else {                                  // anything else: small faint dot
        ctx.globalAlpha *= 0.75;
        ctx.fillStyle = col.mu;
        ctx.arc(x, y, Math.max(1, r * 0.55), 0, TAU); ctx.fill();
      }
    }
    function drawHub(h, on) {
      if (!h.vis || h.fade <= 0) return;
      var x = h.sx, y = h.sy, R = h.R;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';   // the hub hides what is behind it
      ctx.beginPath(); ctx.arc(x, y, R + 2, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (0.6 + 0.4 * h.near) * h.fade;
      ctx.fillStyle = ctx.strokeStyle = col.tx;
      ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(x, y, R, 0, TAU);
      if (on) { ctx.fill(); ctx.fillStyle = col.bg; } else ctx.stroke();
      ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(h.label, x, y + 0.5);
    }
    function draw(hl) {
      var i, it;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';
      for (i = 0; i < items.length; i++) {
        it = items[i];
        it.z = it.k === 0 ? (it.o.cz + hubs[it.o.h].cz) / 2 - 1e-4 : it.o.cz;
      }
      items.sort(function (a, b) { return a.z - b.z; });
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (it.k === 0) drawEdge(it.o); else if (it.k === 1) drawNode(it.o); else drawHub(it.o, it.i === hl);
      }
      if (hov && hov.type === 'trade' && nodes[hov.i] && nodes[hov.i].vis) {
        var n = nodes[hov.i];
        ctx.globalAlpha = 1; ctx.strokeStyle = col.tx; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(n.sx, n.sy, n.r + 5, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- loop ---------- */
    function frame(now) {
      raf = 0;
      if (dead) return;
      if (!cv.isConnected) {
        if (seen || ++tries > 120) teardown(); else raf = requestAnimationFrame(frame);
        return;
      }
      seen = true;
      if (!isAlive() || document.hidden) { last = 0; return; }
      if (!W || !H) { resize(); if (!W || !H) { last = 0; dirty = false; return; } }
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now; dirty = false;
      if (now - colT > 1000) readColors(now);
      var red = isReduced(), moving = false, i;
      if (auto && !red) { if (!hov && !drag) yaw += AUTO_SPEED * dt; moving = true; }
      if (inertia) {
        if (red) inertia = false;
        else {
          var f = Math.exp(-4.5 * dt);
          yaw += vyaw * dt; pitch += vpitch * dt; vyaw *= f; vpitch *= f;
          if (Math.hypot(vyaw, vpitch) < 0.03) inertia = false; else moving = true;
        }
      }
      var bt = auto && !red ? 1 : 0;   // idle bobbing lives only as long as the auto-rotation
      if (red) bob = 0;
      else if (bob !== bt) {
        bob += (bt - bob) * Math.min(1, dt * 3);
        if (Math.abs(bt - bob) < 0.005) bob = bt; else moving = true;
      }
      if (bob > 0) clock += dt;
      project();
      updateHover();
      var hl = highlight();
      for (i = 0; i < hubs.length; i++) {
        var h = hubs[i], target = hl < 0 || hl === i ? 1 : DIM;
        if (red || Math.abs(target - h.k) < 0.01) h.k = target;
        else { h.k += (target - h.k) * Math.min(1, dt * 12); moving = true; }
      }
      draw(hl);
      placeTip();
      if (moving || dirty) { if (!raf) raf = requestAnimationFrame(frame); }
      else last = 0;
    }

    /* ---------- input ---------- */
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function spread() {
      var a = null, b = null;
      for (var id in ptrs) { if (!a) a = ptrs[id]; else if (!b) b = ptrs[id]; }
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var p = pos(e);
      if (!ptrs[e.pointerId]) nptr++;
      ptrs[e.pointerId] = p;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers cannot be captured */ }
      stopAuto(); inertia = false; vyaw = vpitch = 0; kb = -1;
      if (nptr === 1) {
        drag = { x0: p.x, y0: p.y, lx: p.x, ly: p.y, lt: e.timeStamp, moved: false, sign: upside(), touch: e.pointerType === 'touch' };
      } else {
        if (drag) drag.moved = true;
        pinch = spread();
        setHover(null);
      }
      wake();
    }
    function onMove(e) {
      var p = pos(e);
      if (ptrs[e.pointerId]) {
        ptrs[e.pointerId] = p;
        if (nptr >= 2) {
          var d = spread();
          if (pinch > 0 && d > 0) setZoom(zoom * d / pinch);
          pinch = d;
          return;
        }
        if (!drag) return;
        if (!drag.moved) {
          if (Math.hypot(p.x - drag.x0, p.y - drag.y0) <= DRAG_PX) return;
          drag.moved = true;
          setHover(null); setCursor();
        }
        var dt = Math.max(1, e.timeStamp - drag.lt) / 1000;
        var dyaw = (p.x - drag.lx) * ROT * drag.sign, dpitch = (p.y - drag.ly) * ROT;
        yaw += dyaw; pitch += dpitch;
        vyaw = vyaw * 0.4 + (dyaw / dt) * 0.6; vpitch = vpitch * 0.4 + (dpitch / dt) * 0.6;
        drag.lx = p.x; drag.ly = p.y; drag.lt = e.timeStamp;
        wake();
        return;
      }
      ptr.x = p.x; ptr.y = p.y; ptr.inside = true; ptr.fine = e.pointerType !== 'touch';
      if (ptr.fine) { kb = -1; updateHover(); placeTip(); }
    }
    function onUp(e) {
      if (!ptrs[e.pointerId]) return;
      var cancelled = e.type === 'pointercancel', p = pos(e), id;
      delete ptrs[e.pointerId]; nptr = Math.max(0, nptr - 1);
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (nptr > 0) {                           // a pinch ended, one finger keeps rotating
        pinch = 0;
        for (id in ptrs) { if (drag) { drag.lx = ptrs[id].x; drag.ly = ptrs[id].y; drag.lt = e.timeStamp; drag.moved = true; } break; }
        return;
      }
      var d = drag;
      drag = null; pinch = 0;
      if (d && !d.moved) {
        if (!cancelled) tap(p, d.touch);
      } else if (d && !cancelled && !isReduced() && e.timeStamp - d.lt < 90 && Math.hypot(vyaw, vpitch) > 0.25) {
        vyaw = clamp(vyaw, -6, 6); vpitch = clamp(vpitch, -6, 6); inertia = true;
      } else { vyaw = vpitch = 0; }
      ptr.x = p.x; ptr.y = p.y;
      setCursor();
      wake();
    }
    function tap(p, touch) {
      var h = pick(p.x, p.y, touch ? HIT_TOUCH : HIT);
      if (h && h.type === 'trade') { openTrade(h.i); return; }
      if (touch) { pinned = h && h.type === 'hub' && pinned !== h.i ? h.i : -1; wake(); }
    }
    function onLeave() { ptr.inside = false; if (kb < 0 && !drag) setHover(null); }
    function onWheel(e) {
      e.preventDefault();
      stopAuto();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      setZoom(zoom * Math.exp(-dy * 0.0015));
    }
    function stepKb(dir) {
      if (!nodes.length) return;
      kb = kb < 0 ? (dir > 0 ? 0 : nodes.length - 1) : (kb + dir + nodes.length) % nodes.length;
      setHover({ type: 'trade', i: kb });
    }
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key, c = e.code;
      if (k === 'ArrowLeft') yaw -= KEY_STEP * upside();
      else if (k === 'ArrowRight') yaw += KEY_STEP * upside();
      else if (k === 'ArrowUp') pitch -= KEY_STEP;
      else if (k === 'ArrowDown') pitch += KEY_STEP;
      else if (k === '+' || k === '=' || c === 'NumpadAdd') setZoom(zoom * 1.15);
      else if (k === '-' || k === '_' || c === 'NumpadSubtract') setZoom(zoom / 1.15);
      else if (k === '0' || c === 'Digit0' || c === 'Numpad0') resetView();
      else if (c === 'BracketRight' || k === 'PageDown') stepKb(1);
      else if (c === 'BracketLeft' || k === 'PageUp') stepKb(-1);
      else if (k === 'Enter' || k === ' ') {
        if (!(hov && hov.type === 'trade')) return;
        e.preventDefault();
        openTrade(hov.i);
        return;
      } else if (k === 'Escape') {
        if (kb < 0 && pinned < 0) return;
        kb = -1; pinned = -1; setHover(null);
      } else return;
      e.preventDefault();
      stopAuto(); inertia = false;
      wake();
    }
    function onBlur() { if (kb >= 0) { kb = -1; setHover(null); } }
    function onVisible() {
      if (!cv.isConnected) { if (seen) teardown(); return; }
      if (!document.hidden) wake();
    }
    function onTheme() {
      if (!cv.isConnected) { if (seen) teardown(); return; }
      readColors(); wake();
    }

    function teardown() {
      if (dead) return;
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (mo) mo.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      var i = instances.indexOf(api);
      if (i >= 0) instances.splice(i, 1);
    }

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('keydown', onKey);
    cv.addEventListener('blur', onBlur);
    resetBtn.addEventListener('click', resetView);
    document.addEventListener('visibilitychange', onVisible);
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(resize); ro.observe(cv); }
    else window.addEventListener('resize', resize);
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(onTheme);
      var watch = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
      mo.observe(document.documentElement, watch);
      if (document.body) mo.observe(document.body, watch);
    }

    var api = {
      cv: cv,
      teardown: teardown,
      stale: function () { return !cv.isConnected && (seen || Date.now() - born > 5000); },
      state: function () {
        var h = null;
        if (hov && hov.type === 'hub' && hubs[hov.i]) h = { type: 'hub', inst: hubs[hov.i].name };
        else if (hov && nodes[hov.i]) h = { type: 'trade', id: nodes[hov.i].t.id, inst: nodes[hov.i].t.inst };
        return { yaw: yaw, pitch: pitch, zoom: zoom, auto: auto && !isReduced(), nodes: nodes.length, hover: h };
      }
    };
    instances.push(api);
    readColors();
    resize();
    wake();
  }

  function state() {
    for (var i = instances.length - 1; i >= 0; i--) if (instances[i].cv.isConnected) return instances[i].state();
    return null;
  }

  window.Graph3D = { mount: mount, state: state };
})();
