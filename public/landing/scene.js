/* Landing page camera fly-through: a dotted contour terrain drawn with raw WebGL.
   Loaded lazily by the landing page only (never by the journal in /app/).
   Scroll moves the camera through keyframes: plan -> oblique -> fly-over -> wide.
   Light mode: prefers-reduced-motion = one static frame; weak devices = fewer points,
   lower resolution, and the frame rate is watched so quality drops automatically. */
(function () {
  'use strict';
  var D = document, W = window, root = D.documentElement, cv = D.getElementById('scene');
  if (!cv) return;
  var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var nav = navigator, lite = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4;
  var small = Math.min(W.innerWidth, W.innerHeight) < 700;
  var fine = W.matchMedia && W.matchMedia('(pointer: fine)').matches;
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'default' });
  if (!gl) { root.classList.add('noscene'); return; }

  // ---- terrain: seeded value noise + a main peak ----
  function prng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(i, j) { var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
  function noise(x, z) {
    var i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function fbm(x, z) { var s = 0, amp = .5; for (var o = 0; o < 5; o++) { s += amp * noise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; amp *= .5; } return s; }
  var PX = 1.6, PZ = -0.6, R = 9, L = 6.5;
  function H(x, z) {
    var dp = (x - PX) * (x - PX) + (z - PZ) * (z - PZ), d2 = (x + 2.6) * (x + 2.6) + (z - 2.2) * (z - 2.2);
    return fbm(x * .3 + 11, z * .3 + 7) * 1.3 + 1.2 * Math.exp(-dp / 2.2) + .35 * Math.exp(-d2 / 3);
  }

  var N = reduce ? 110000 : lite ? 90000 : small ? 130000 : 260000;
  var pos = new Float32Array(N * 3), rnd = prng(7), k = 0, tries = 0;
  while (k < N && tries < N * 10) {
    tries++;
    var r = R * Math.sqrt(rnd()), an = rnd() * 6.2832, x = r * Math.cos(an), z = r * Math.sin(an), h = H(x, z), t = h * L;
    // Keep every point near a contour level and a third of the rest, so the iso-lines read as ribbons.
    if (Math.abs(t - Math.round(t)) < .06 || rnd() < .2) { pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; k++; }
  }
  N = k;

  // ---- GL program ----
  var VS = 'attribute vec3 p;uniform mat4 m;uniform float s,L,fn,ff,R,base,line;varying float a;' +
    'void main(){vec4 c=m*vec4(p,1.);gl_Position=c;float t=p.y*L;float d=abs(t-floor(t+.5));' +
    'float ln=(1.-smoothstep(.0,.06,d))*line;float w=max(c.w,.001);' +
    'float fog=(1.-smoothstep(fn,ff,w))*(1.-smoothstep(R*.55,R*.98,length(p.xz)));' +
    'gl_PointSize=clamp(s*(.85+.75*ln)/w,1.3,4.6);a=min(1.,(base+.62*ln)*fog);}';
  var FS = 'precision mediump float;varying float a;uniform vec3 col;' +
    'void main(){vec2 q=gl_PointCoord-.5;float r=dot(q,q);if(r>.25)discard;gl_FragColor=vec4(col,a*(1.-smoothstep(.12,.25,r)));}';
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var prog;
  try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link'); }
  catch (e) { root.classList.add('noscene'); return; }
  gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, N * 3), gl.STATIC_DRAW);
  var ap = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
  var U = {}; ['m', 's', 'L', 'fn', 'ff', 'R', 'base', 'line', 'col'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
  gl.uniform1f(U.L, L); gl.uniform1f(U.R, R); gl.uniform3f(U.col, .04, .04, .045);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(.961, .961, .953, 1);

  // ---- maths ----
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function persp(f, a, n, fr) { var t = 1 / Math.tan(f / 2), nf = 1 / (n - fr); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + n) * nf, -1, 0, 0, 2 * fr * n * nf, 0]; }
  function look(e, c) { var z = norm(sub(e, c)), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; }
  function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var q = 0; q < 4; q++) s += a[q * 4 + j] * b[i * 4 + q]; o[i * 4 + j] = s; } return o; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // Camera keyframes, one per scenic section (data-k): eye, target, vertical field of view.
  var K = [
    { e: [-0.2, 10.5, 1.3], c: [-0.2, 0, 0], f: 40 },
    { e: [-0.6, 5.4, 7.6], c: [0.4, 0.4, 0], f: 40 },
    { e: [-3.3, 2.9, 3.6], c: [PX, .75, PZ - .3], f: 46 },
    { e: [5.8, 3.4, 3.6], c: [-0.3, 0.4, -1.6], f: 42 }
  ];
  var VIEW = ['ПЛАН', 'НАКЛОН', 'ПОЛЁТ', 'ОБЗОР'];
  function camAt(p) {
    var i = Math.min(K.length - 2, Math.max(0, Math.floor(p))), t = Math.min(1, Math.max(0, p - i)); t = t * t * (3 - 2 * t);
    var a = K[i], b = K[i + 1]; return { e: mix(a.e, b.e, t), c: mix(a.c, b.c, t), f: a.f + (b.f - a.f) * t };
  }

  // ---- layout, scroll ----
  var secs = [].slice.call(D.querySelectorAll('[data-k]')), A = [], end = 1e9, cssW = 1, cssH = 1, dprCap = lite || small ? 1.5 : 1.75, dpr = 1;
  if (lite) dprCap = 1;
  function measure() {
    A = secs.map(function (s) { return s.getBoundingClientRect().top + W.scrollY; });
    var last = secs[secs.length - 1]; end = A[A.length - 1] + last.offsetHeight;
  }
  function resize() {
    cssW = cv.clientWidth || W.innerWidth; cssH = cv.clientHeight || W.innerHeight;
    dpr = Math.min(W.devicePixelRatio || 1, dprCap);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); gl.viewport(0, 0, cv.width, cv.height);
    measure(); kick();
  }
  function scrollP() {
    var y = W.scrollY; if (y <= A[0]) return 0;
    for (var i = 0; i < A.length - 1; i++) if (y < A[i + 1]) return i + (y - A[i]) / Math.max(1, A[i + 1] - A[i]);
    return A.length - 1;
  }

  // ---- pins (DOM markers attached to terrain points) and HUD ----
  var pins = [].slice.call(D.querySelectorAll('#pins .pin')).map(function (el) {
    var x = +el.dataset.x, z = +el.dataset.z; return { el: el, p: [x, H(x, z), z], main: el.hasAttribute('data-main'), o: -1 };
  });
  var panels = secs.map(function (s) { return s.querySelector('.panel,.hero-txt'); });
  var hud = { v: D.getElementById('hv'), a: D.getElementById('ha'), t: D.getElementById('ht'), n: D.getElementById('hn') }, hudLast = '';
  if (hud.n) hud.n.textContent = N.toLocaleString('ru-RU');
  var layers = W.landingLayers || { dots: 1, lines: 1, pins: 1 }, lay = { dots: 1, lines: 1, pins: 1 };
  W.addEventListener('landing:layers', function () { layers = W.landingLayers || layers; kick(); });
  W.addEventListener('landing:lang', function () { hudLast = ''; kick(); });

  // ---- render loop ----
  var cur = reduce ? 1 : scrollP(), mx = 0, my = 0, tmx = 0, tmy = 0, running = false, last = 0, visible = true, n = N, level = 0, acc = 0, cnt = 0, shown = false, T0 = performance.now();
  var drift = !reduce && !lite && !small;
  function draw(time) {
    var c = camAt(cur), e = c.e.slice(), tg = c.c.slice();
    if (drift) { e[0] += Math.sin(time * .13) * .09; e[1] += Math.sin(time * .17) * .05; e[2] += Math.cos(time * .11) * .09; }
    tg[0] += mx * .35; tg[1] -= my * .18; e[0] += mx * .15;
    var aspect = cssW / cssH, f = c.f * Math.PI / 180;
    if (aspect < 1) f = 2 * Math.atan(Math.tan(f / 2) * Math.min(1.9, .78 / aspect));
    var M = mul(persp(f, aspect, .05, 40), look(e, tg));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix4fv(U.m, false, M);
    gl.uniform1f(U.s, .016 * cv.height / (2 * Math.tan(f / 2)));
    var dist = Math.hypot(e[0] - tg[0], e[1] - tg[1], e[2] - tg[2]);
    gl.uniform1f(U.fn, dist * 1.15); gl.uniform1f(U.ff, dist * 2.4);
    // Layer switches fade instead of popping.
    ['dots', 'lines', 'pins'].forEach(function (key) { lay[key] += ((layers[key] ? 1 : 0) - lay[key]) * (reduce ? 1 : .18); });
    gl.uniform1f(U.base, .06 + .3 * lay.dots); gl.uniform1f(U.line, .15 + .85 * lay.lines);
    gl.drawArrays(gl.POINTS, 0, n);
    pins.forEach(function (pin) {
      var p = pin.p, cw = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15], o = 0, sx = 0, sy = 0;
      if (cw > .1) {
        sx = ((M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]) / cw * .5 + .5) * cssW;
        sy = (.5 - (M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]) / cw * .5) * cssH;
        var reveal = pin.main ? 1 : Math.min(1, Math.max(0, (cur - .55) / .35));
        var inside = sx > 14 && sx < cssW - 14 && sy > 90 && sy < cssH - 20 ? 1 : 0;
        var flip = sx > cssW - 190, lx = flip ? sx - 175 : sx - 12, ob = panels[Math.min(3, Math.round(cur))], rc = ob && ob.getBoundingClientRect();
        if (flip !== pin.f) { pin.el.classList.toggle('flip', flip); pin.f = flip; }
        if (rc && lx + 187 > rc.left - 16 && lx < rc.right + 16 && sy + 12 > rc.top - 16 && sy - 80 < rc.bottom + 16) inside = 0;
        o = reveal * inside * lay.pins * (1 - Math.min(1, Math.max(0, (cw - dist * 1.2) / (dist * .5))));
      }
      o = Math.round(o * 100) / 100;
      pin.el.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
      if (o !== pin.o) { pin.el.style.opacity = o; pin.o = o; }
    });
    var dir = norm(sub(tg, e)), s = (W.LANDING_VIEW || VIEW)[Math.min(3, Math.round(cur))] + '|' + Math.round(e[1] * 40) + (W.LANDING_UNIT || ' М') + '|' + (Math.asin(-dir[1]) * 180 / Math.PI).toFixed(1) + '°';
    if (s !== hudLast && hud.v) { var q = s.split('|'); hud.v.textContent = q[0]; hud.a.textContent = q[1]; hud.t.textContent = q[2]; hudLast = s; }
    if (!shown) { shown = true; root.classList.add('scene-on'); }
  }
  function quality(dt) {
    // Watch real frame times; step down resolution, then point count, if the device struggles.
    if (reduce || level >= 2) return;
    acc += dt; cnt++;
    if (cnt >= 45) { var avg = acc / cnt; acc = cnt = 0; if (avg > .03) { level++; if (level === 1 && dprCap > 1) { dprCap = 1; resize(); } else { level = 2; n = Math.floor(N * .5); } } }
  }
  function frame(now) {
    var dt = Math.min(.1, (now - last) / 1000); last = now;
    var tp = reduce ? 1 : scrollP();
    cur += (tp - cur) * (reduce ? 1 : 1 - Math.exp(-dt * 4.5));
    mx += (tmx - mx) * (1 - Math.exp(-dt * 3)); my += (tmy - my) * (1 - Math.exp(-dt * 3));
    if (!visible) { running = false; return; }
    draw((now - T0) / 1000);
    var moving = Math.abs(tp - cur) > 1e-4 || Math.abs(tmx - mx) > 1e-3 || Math.abs(tmy - my) > 1e-3 ||
      Math.abs(lay.dots - (layers.dots ? 1 : 0)) > .01 || Math.abs(lay.lines - (layers.lines ? 1 : 0)) > .01 || Math.abs(lay.pins - (layers.pins ? 1 : 0)) > .01;
    if (moving || drift) { if (dt > 0) quality(dt); W.requestAnimationFrame(frame); } else running = false;
  }
  function kick() { if (!running && visible) { running = true; last = performance.now(); W.requestAnimationFrame(frame); } }
  function onScroll() {
    var v = W.scrollY < end; if (v !== visible) { visible = v; root.classList.toggle('scene-off', !v); }
    kick();
  }
  W.addEventListener('scroll', onScroll, { passive: true });
  var rt; W.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
  if (fine && !reduce) W.addEventListener('pointermove', function (e) { tmx = e.clientX / W.innerWidth * 2 - 1; tmy = e.clientY / W.innerHeight * 2 - 1; kick(); }, { passive: true });
  cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); root.classList.add('noscene'); running = false; visible = false; });
  W.addEventListener('load', measure);
  W.__scene = { get points() { return n; }, total: N, get level() { return level; }, reduce: reduce, lite: lite };
  resize(); onScroll();
})();
