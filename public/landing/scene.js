/* Landing page fly-through, raw WebGL, points only. Loaded lazily by the landing page (never by /app/).
   One long world along -z: contour terrain, a peak, viewfinder gates, two candlestick rows (NQ / ES),
   a ring tunnel in a canyon, a rotating globe, cubes, pillars, dust and flowing "tape" streaks.
   Scroll drives the camera along a spline through all of it; the cursor bends the points around it.
   Light modes: prefers-reduced-motion = still frames that cross-fade per section; weak devices get
   fewer points and lower resolution; frame time is watched and quality steps down by itself. */
(function () {
  'use strict';
  var D = document, W = window, root = D.documentElement, cv = D.getElementById('scene');
  if (!cv) return;
  var mm = function (q) { return !!(W.matchMedia && W.matchMedia(q).matches); };
  var reduce = mm('(prefers-reduced-motion: reduce)'), fine = mm('(pointer: fine)'), nav = navigator, F = W.SCENE_FORCE || {};
  var lite = !F.full && ((nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4);
  var small = Math.min(W.innerWidth, W.innerHeight) < 700;
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: true, powerPreference: lite ? 'default' : 'high-performance' });
  if (!gl) { root.classList.add('noscene'); return; }
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, exp = Math.exp, min = Math.min, max = Math.max, PI = Math.PI, floor = Math.floor;

  // ---- world maths (cx / cy are mirrored in the vertex shader) ----
  function prng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(i, j) { var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
  function noise(x, z) {
    var i = floor(x), j = floor(z), fx = x - i, fz = z - j; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function fbm(x, z) { var s = 0, amp = .5; for (var o = 0; o < 4; o++) { s += amp * noise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; amp *= .5; } return s; }
  function sm(a, b, x) { var t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function cx(z) { return 1.6 * sin(z * .085) + .7 * sin(z * .19 + 1.3); }
  function cy(z) { return 1.7 + .35 * sin(z * .13); }
  var L = 5, SR = 3, SC = [cx(-78) + 1, 3.6, -78];
  var PEAKS = [[3.4, 1.5, 2.3, 4.5], [-7.5, -18, 1.8, 7], [8.5, -27, 2.2, 9], [-9, -71, 2, 10], [9.5, -88, 2.4, 9], [-6, 6, 1.4, 6]];
  function H(x, z) {
    var d = abs(x - cx(z)), h = fbm(x * .21 + 11, z * .21 + 7) * 1.7 * (.22 + 1.35 * sm(1, 7, d));
    h += sm(-34, -40, z) * sm(-64, -58, z) * sm(2.5, 5.5, d) * 2.6;                      // canyon walls around the ring tunnel
    for (var i = 0; i < PEAKS.length; i++) { var q = PEAKS[i], a = x - q[0], b = z - q[1]; h += q[2] * exp(-(a * a + b * b) / q[3]); }
    var a2 = x - SC[0], b2 = z - SC[2]; return h * (1 - .75 * exp(-(a2 * a2 + b2 * b2) / 40));
  }

  // ---- point cloud, built in small time slices so the page never stalls ----
  // Each point: x, y, z, kind + seed. Kinds: 0 terrain, 1 solid objects, 2 stream, 3 dust, 4 globe group, 5 line work.
  var den = F.den || (lite ? .34 : small ? .5 : 1), rnd = prng(7);
  var Z0 = 14, Z1 = -96, NB = 28, BW = (Z0 - Z1) / NB;
  var cap = floor(900000 * den) + 80000, buf = new Float32Array(cap * 4), bk = new Uint8Array(cap), n = 0, anchors = [], tasks = [];
  function add(x, y, z, k, sd, bz) {
    if (n >= cap) return; var o = n * 4; buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = k + min(.999, max(0, sd));
    bk[n++] = k === 6 ? NB + 1 : k === 2 ? NB : min(NB - 1, max(0, floor((Z0 - (bz === undefined ? z : bz)) / BW)));
  }
  function seg(a, b, step, k, s0, s1, bz) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], m = max(2, Math.ceil(Math.hypot(dx, dy, dz) / step * den));
    for (var i = 0; i <= m; i++) { var t = i / m; add(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t, k, s0 + (s1 - s0) * rnd(), bz); }
  }
  // terrain, slab by slab; denser where the camera flies high (start and globe)
  (function () {
    var NT = 360000 * den, SL = 43, sw = [], sum = 0, i;
    for (i = 0; i < SL; i++) { var zc = 11.5 - (i + .5) * 2.5, w = zc > -9 ? 2.6 : zc < -64 ? 1.5 : 1; sw.push(w); sum += w; }
    sw.forEach(function (w, i) {
      tasks.push(function () {
        var cnt = floor(NT * w / sum), got = 0, tr = 0, zs = 11.5 - i * 2.5;
        while (got < cnt && tr < cnt * 14) {
          tr++; var z = zs - rnd() * 2.5, x = cx(z) + (rnd() < .5 ? -1 : 1) * 12.5 * Math.pow(rnd(), 1.5), h = H(x, z), t = h * L;
          var sh = min(1, max(0, .42 + (H(x + .17, z + .22) - h) * 3.2));   // light from +x+z: slopes facing away are darker
          if (abs(t - Math.round(t)) < .07 || rnd() < .04 + .34 * sh * sh) { add(x, h, z, 0, sh); got++; }
        }
      });
    });
  })();
  // ground mesh under the points: grey hillshade so the relief reads as a surface, darker trail along the path
  var mesh = null;
  tasks.push(function () {
    var STP = den < .6 ? .34 : .25, nx = Math.round(25 / STP) + 1, nz = Math.round((Z0 - Z1) / STP) + 1, V = new Float32Array(nx * nz * 4), o = 0, i, j;
    var Lx = .55, Ly = .7, Lz = .45, ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    for (j = 0; j < nz; j++) {
      var z = Z0 - j * STP, c0 = cx(z);
      for (i = 0; i < nx; i++) {
        var dx = -12.5 + i * STP, x = c0 + dx, h = H(x, z), gx = (H(x + .12, z) - H(x - .12, z)) / .24, gz = (H(x, z + .12) - h) / .12;
        var nl = Math.hypot(gx, 1, gz), lit = (-gx * Lx + Ly - gz * Lz) / nl;
        var g = .968 - .24 * (1 - sm(.25, .95, lit)) - .05 * sm(1.5, 0, h);
        g -= .2 * (1 - sm(.35, 1.5, abs(dx)));                                   // the trail
        g = g + (.961 - g) * sm(8.5, 12.4, abs(dx));
        V[o++] = x; V[o++] = h; V[o++] = z; V[o++] = g;
      }
    }
    var I = new Uint16Array((nx - 1) * (nz - 1) * 6), q = 0;
    for (j = 0; j < nz - 1; j++) for (i = 0; i < nx - 1; i++) { var a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d; }
    mesh = { v: V, i: I, n: I.length };
  });
  // floor marks along the trail: entry chevrons and dashed stop lines with an x
  tasks.push(function () {
    for (var z = 11, k = 0; z > -72; z -= 1.6, k++) {
      var c = cx(z), Y = function (x, zz) { return H(x, zz) + .02; };
      if (k % 5 === 4) {
        for (var x = c - 1.2; x < c + 1.2; x += .16) seg([x, Y(x, z), z], [x + .09, Y(x + .09, z), z], .012, 5, .85, 1);
        var ex = c + 1.35; seg([ex - .1, Y(ex, z), z - .1], [ex + .1, Y(ex, z), z + .1], .012, 5, .9, 1); seg([ex - .1, Y(ex, z), z + .1], [ex + .1, Y(ex, z), z - .1], .012, 5, .9, 1);
      } else {
        seg([c - .32, Y(c - .32, z + .22), z + .22], [c, Y(c, z), z], .012, 5, .8, 1); seg([c, Y(c, z), z], [c + .32, Y(c + .32, z + .22), z + .22], .012, 5, .8, 1);
      }
    }
  });
  // main peak pin
  tasks.push(function () { anchors[0] = [PEAKS[0][0], H(PEAKS[0][0], PEAKS[0][1]) + .03, PEAKS[0][1]]; });
  // viewfinder gates the camera dives through
  tasks.push(function () {
    [-1.5, -4, -6.5].forEach(function (z, gi) {
      var w = 1.9 - gi * .25, h = 1.35 - gi * .15, x0 = cx(z), y0 = 1.75, c = .5;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
        var X = x0 + q[0] * w, Y = y0 + q[1] * h;
        seg([X, Y, z], [X - q[0] * c, Y, z], .012, 5, .6, 1); seg([X, Y, z], [X, Y - q[1] * c, z], .012, 5, .6, 1);
      });
      for (var i = 0; i < 4; i++) { var a = i * PI / 2; seg([x0 + cos(a) * .1, y0 + sin(a) * .1, z], [x0 + cos(a) * .24, y0 + sin(a) * .24, z], .012, 5, .4, .8); }
    });
  });
  // two candlestick rows: hollow = up candle, filled = down candle
  [[1.55, 3, 1, 16, 38], [-1.7, 5, 2, 26, -1]].forEach(function (row) {
    tasks.push(function () {
      var r2 = prng(row[1] * 97), price = 1.7, i, j;
      for (i = 0; i < 44; i++) {
        var z = -7 - i * .7, x = cx(z) + row[0], o = price, c = min(3.5, max(.8, o + (r2() - .47) * .8));
        if (abs(c - o) < .08) c = o + (c >= o ? .08 : -.08);
        var lo = min(o, c), hi = max(o, c), wl = lo - r2() * .4, wh = hi + r2() * .4, hw = .25; price = c;
        seg([x, wl, z], [x, wh, z], .014, 1, .25, .55);
        if (c > o) {
          for (j = 0; j < 4; j++) {
            var sx = j & 1 ? hw : -hw, sz = j & 2 ? hw : -hw;
            seg([x + sx, lo, z + sz], [x + sx, hi, z + sz], .014, 1, .5, .9);
            seg([x - hw, j & 1 ? lo : hi, z + sz], [x + hw, j & 1 ? lo : hi, z + sz], .014, 1, .5, .9);
            seg([x + sx, j & 2 ? lo : hi, z - hw], [x + sx, j & 2 ? lo : hi, z + hw], .014, 1, .5, .9);
          }
        } else {
          var m = Math.ceil((hi - lo) * 2600 * den) + 40;
          for (j = 0; j < m; j++) add(x + (r2() * 2 - 1) * hw, lo + r2() * (hi - lo), z + (r2() * 2 - 1) * hw, 1, .55 + .45 * r2());
        }
        if (i === row[3]) anchors[row[2]] = [x, wh + .05, z];
        if (i === row[4]) anchors[3] = [x, wh + .05, z];
      }
    });
  });
  // floor under the candle corridor: a footprint carpet, cell density = traded volume, darkest cell framed (POC)
  tasks.push(function () {
    var r3 = prng(41), COLS = 7, CW = .34, RH = .42;
    for (var zr = -6; zr > -38; zr -= RH) {
      var best = -1, bi = 0, vols = [];
      for (var c = 0; c < COLS; c++) { var v = Math.pow(noise(c * .9 + 3, zr * .7), 2) * (1.2 - abs(c - 3) * .13) * (.6 + .6 * r3()); vols.push(v); if (v > best) { best = v; bi = c; } }
      for (c = 0; c < COLS; c++) {
        var x0 = cx(zr) + (c - (COLS - 1) / 2) * CW, m = floor(vols[c] * 260 * den) + 6;
        for (var j = 0; j < m; j++) { var px = x0 + (r3() - .5) * CW * .86, pz = zr - r3() * RH * .86 - RH * .07; add(px, H(px, pz) + .02, pz, 5, .18 + .45 * vols[c]); }
        if (c === bi) {
          var a = [x0 - CW / 2, zr], b = [x0 + CW / 2, zr - RH];
          [[a[0], a[1], b[0], a[1]], [b[0], a[1], b[0], b[1]], [b[0], b[1], a[0], b[1]], [a[0], b[1], a[0], a[1]]].forEach(function (e) {
            seg([e[0], H(e[0], e[1]) + .03, e[1]], [e[2], H(e[2], e[3]) + .03, e[3]], .012, 5, .8, 1);
          });
        }
      }
      for (c = 0; c <= COLS; c++) { var gx = cx(zr) + (c - COLS / 2) * CW; add(gx, H(gx, zr) + .02, zr, 5, .45); }
    }
  });
  // chart grid walls beside the candles: price levels and time ticks
  tasks.push(function () {
    [-3.3, 3.1].forEach(function (off) {
      [.9, 1.6, 2.3, 3].forEach(function (y) { for (var z = -5; z > -38; z -= .05 / den) add(cx(z) + off, y, z, 5, .25 + .5 * rnd()); });
      for (var z = -6; z > -38; z -= 2.1) seg([cx(z) + off, .9, z], [cx(z) + off, 3, z], .035, 5, .2, .6);
    });
  });
  // ring tunnel
  tasks.push(function () {
    for (var i = 0; i < 9; i++) {
      var z = -39 - i * 2.7, c = [cx(z), cy(z), z], R = 2 + .25 * sin(i * 1.7);
      var tx = cx(z - .1) - cx(z + .1), ty = cy(z - .1) - cy(z + .1), tl = Math.hypot(tx, ty, .2), t = [tx / tl, ty / tl, -.2 / tl];
      var ul = Math.hypot(t[2], t[0]), u = [-t[2] / ul, 0, t[0] / ul], v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      if (v[1] < 0) v = [-v[0], -v[1], -v[2]];
      var P = function (a, r) { return [c[0] + (u[0] * cos(a) + v[0] * sin(a)) * r, c[1] + (u[1] * cos(a) + v[1] * sin(a)) * r, c[2] + (u[2] * cos(a) + v[2] * sin(a)) * r]; };
      var m = floor(1000 * den), j, q;
      for (j = 0; j < m; j++) { q = P(rnd() * 2 * PI, R + (rnd() - .5) * .03); add(q[0], q[1], q[2], 5, .5 + .5 * rnd()); }
      if (i % 3 === 0) for (j = 0; j < m * .5; j++) { q = P(rnd() * 2 * PI, R + .2); add(q[0], q[1], q[2], 5, .2 + .4 * rnd()); }
      if (i % 3 === 1) for (j = 0; j < 48; j++) seg(P(j / 48 * 2 * PI, R + .1), P(j / 48 * 2 * PI, R + .3), .02, 5, .3, .8);
      if (i % 3 === 2) for (j = 0; j < m * .8; j++) { q = P(i + rnd() * 4.4, R + .3 + (rnd() - .5) * .06); add(q[0], q[1], q[2], 5, .5 + .5 * rnd()); }
      if (i === 3) anchors[4] = P(PI / 2, R); if (i === 7) anchors[5] = P(PI / 2, R);
    }
  });
  // globe with core, orbits and a moon (rotates in the shader)
  tasks.push(function () {
    var z = SC[2], j, a, lat;
    var S = function (x, y, zz, sd) { add(SC[0] + x, SC[1] + y, SC[2] + zz, 4, sd, z); };
    for (lat = -80; lat <= 80; lat += 10) {
      var y = SR * sin(lat * PI / 180), rr = SR * cos(lat * PI / 180), m = floor(2 * PI * rr / .032 * den);
      for (j = 0; j < m; j++) { a = rnd() * 2 * PI; S(rr * cos(a), y, rr * sin(a), .72 + .27 * rnd()); }
    }
    for (var k = 0; k < 12; k++) for (j = 0; j < 190 * den; j++) { a = (rnd() - .5) * PI; S(SR * cos(a) * cos(k * PI / 6), SR * sin(a), SR * cos(a) * sin(k * PI / 6), .45 + .35 * rnd()); }
    for (j = 0; j < 3600 * den; j++) {
      var yy = rnd() * 2 - 1, r1 = Math.sqrt(1 - yy * yy), core = j % 3 === 0, rad = core ? 1.15 : SR; a = rnd() * 2 * PI;
      S(rad * r1 * cos(a), rad * yy, rad * r1 * sin(a), core ? .12 + .2 * rnd() : .15 + .3 * rnd());
    }
    [[4.3, .45, 0], [5.2, 0, -.7]].forEach(function (o) {
      for (j = 0; j < 1500 * den; j++) {
        a = rnd() * 2 * PI; var r = o[0] + (rnd() - .5) * .05, x = r * cos(a), zz = r * sin(a);
        var y1 = -zz * sin(o[1]), z1 = zz * cos(o[1]), x2 = x * cos(o[2]) - y1 * sin(o[2]), y2 = x * sin(o[2]) + y1 * cos(o[2]);
        S(x2, y2, z1, .7 + .29 * rnd());
      }
    });
    var mo = [5.2 * cos(1) * cos(-.7), 5.2 * cos(1) * sin(-.7), 5.2 * sin(1)];
    for (j = 0; j < 500 * den; j++) { var m2 = rnd() * 2 - 1, r3 = Math.sqrt(1 - m2 * m2) * .3; a = rnd() * 2 * PI; S(mo[0] + r3 * cos(a), mo[1] + m2 * .3, mo[2] + r3 * sin(a), .6 + .4 * rnd()); }
    anchors[6] = [SC[0], SC[1] + SR + .1, SC[2]];
    // the ID mark (same drawing as the header logo), seed = position along the stroke for a travelling highlight
    var E = [cx(-67.5) - 2.6, 4.6, -67.5], nv = norm([E[0] - SC[0], E[1] - SC[1], E[2] - SC[2]]), uv = norm(cross([0, 1, 0], nv)), vv = cross(nv, uv), sc2 = 1.05 / 21;
    var P2 = function (x, y) { return [SC[0] + (uv[0] * x + vv[0] * y) * sc2, SC[1] + (uv[1] * x + vv[1] * y) * sc2, SC[2] + (uv[2] * x + vv[2] * y) * sc2]; }, len = 0;
    var LG = function (pts, t0, t1) { for (var i2 = 0; i2 < pts.length - 1; i2++) { var A2 = pts[i2], B2 = pts[i2 + 1], mm = max(4, Math.ceil(Math.hypot(B2[0] - A2[0], B2[1] - A2[1]) * 14 * den)); for (var k2 = 0; k2 <= mm; k2++) { var tt = k2 / mm, w2 = P2(A2[0] + (B2[0] - A2[0]) * tt, A2[1] + (B2[1] - A2[1]) * tt); for (var rep = 0; rep < 3; rep++) add(w2[0] + (rnd() - .5) * .012, w2[1] + (rnd() - .5) * .012, w2[2], 7, t0 + (t1 - t0) * (i2 + tt) / (pts.length - 1)); } } };
    var circ = []; for (j = 0; j <= 96; j++) circ.push([21 * cos(j / 96 * 2 * PI + PI / 2), 21 * sin(j / 96 * 2 * PI + PI / 2)]);
    var dA = [[-2, 9], [-2, -9], [3, -9]]; for (j = 0; j <= 24; j++) { var an2 = -PI / 2 + j / 24 * PI; dA.push([3 + 9 * cos(an2), 9 * sin(an2)]); } dA.push([-2, 9]);
    LG(circ, 0, .5); LG([[-9, 9], [-9, -9]], .5, .62); LG(dA, .62, .999);
  });
  // floating wire cubes, pillars, ground crosses
  tasks.push(function () {
    var E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]], i, j;
    for (i = 0; i < 46; i++) {
      var z = -3 - rnd() * 88, sd = rnd() < .5 ? -1 : 1, x = cx(z) + sd * (2.9 + rnd() * 5.5), y = H(x, z) + .8 + rnd() * 3.4, s = .22 + rnd() * .5, ya = rnd() * PI, pa = rnd() * PI;
      var V = []; for (j = 0; j < 8; j++) {
        var a = (j & 1 ? s : -s), b = (j & 2 ? s : -s), c = (j & 4 ? s : -s), b1 = b * cos(pa) - c * sin(pa), c1 = b * sin(pa) + c * cos(pa);
        V.push([x + a * cos(ya) + c1 * sin(ya), y + b1, z - a * sin(ya) + c1 * cos(ya)]);
      }
      for (j = 0; j < 12; j++) seg(V[E[j][0]], V[E[j][1]], .016, 1, .3, .8, z);
      var gh = H(x, z), sm2 = s * (1 + (y - gh) * .25), mm = floor(420 * den * s);
      for (j = 0; j < mm; j++) { var ra2 = sm2 * Math.sqrt(-2 * Math.log(rnd() + 1e-6)) * .5, aa = rnd() * 2 * PI, qx = x - (y - gh) * .25 + cos(aa) * ra2, qz = z - (y - gh) * .3 + sin(aa) * ra2; add(qx, H(qx, qz) + .015, qz, 5, .25 + .35 * rnd()); }
    }
    for (i = 0; i < 70; i++) {
      var pz = 4 - rnd() * 96, ps = rnd() < .5 ? -1 : 1, px = cx(pz) + ps * (2.6 + rnd() * 8), g = H(px, pz), ph = 1 + rnd() * 3.2;
      seg([px, g, pz], [px, g + ph, pz], .02, 1, .2, .7);
      for (j = 0; j < 90 * den; j++) { var sr = .05 + rnd() * .22, sx2 = px - sr * .9 - .02, sz2 = pz - sr * 1.1 + (rnd() - .5) * .08; add(sx2, H(sx2, sz2) + .015, sz2, 5, .3 + .3 * rnd()); }
      seg([px - .09, g + ph, pz], [px + .09, g + ph, pz], .012, 1, .6, 1); seg([px, g + ph, pz - .09], [px, g + ph, pz + .09], .012, 1, .6, 1);
    }
    for (i = 0; i < 260; i++) {
      var kz = 8 - rnd() * 100, kx = cx(kz) + (rnd() * 2 - 1) * 7, ky = H(kx, kz) + .02;
      seg([kx - .07, ky, kz], [kx + .07, ky, kz], .02, 5, .5, 1); seg([kx, ky, kz - .07], [kx, ky, kz + .07], .02, 5, .5, 1);
    }
  });
  // dust
  for (var di = 0; di < 4; di++) tasks.push(function () {
    for (var i = 0; i < 9000 * den; i++) { var z = Z0 - 2 - rnd() * 106, x = cx(z) + (rnd() + rnd() - 1) * 10; add(x, .3 + Math.pow(rnd(), 1.5) * 6.5, z, 3, rnd()); }
  });
  // sky: directions around the camera (it never gets closer): horizon haze, three ridge layers, a striped sun, dome arcs
  function sky(az, el, sd) { var ce = cos(el); add(sin(az) * ce * 50, sin(el) * 50, -cos(az) * ce * 50, 6, sd); }
  var DG = PI / 180;
  tasks.push(function () {
    for (var i = 0; i < 34000 * den; i++) { var el = (Math.pow(rnd(), 2.2) * 15 - 1.5) * DG; sky(rnd() * 2 * PI, el, .05 + .2 * (1 - el / (15 * DG))); }
    for (var a = 0; a < 2 * PI; a += .004 / den) if (rnd() < .5) sky(a, 26 * DG + (rnd() - .5) * .002, .22);
    for (a = 0; a < 2 * PI; a += .006 / den) if ((a * 40 | 0) % 2) sky(a, 44 * DG, .15);
  });
  [0, 1, 2].forEach(function (Ly) {
    tasks.push(function () {
      var top = function (az) { return (1.4 + (2 - Ly) * 1.6 + fbm(az * (2.2 + Ly) + Ly * 13, Ly * 7.3) * (5 - Ly) - 1.2) * DG; };
      var al = [.16, .27, .42][Ly], m = floor([24000, 30000, 38000][Ly] * den), i = 0, tr = 0;
      while (i < m && tr < m * 4) { tr++; var az = rnd() * 2 * PI, t = top(az), el = -3 * DG + rnd() * 16 * DG; if (el > t) continue; sky(az, el, al * (.55 + .45 * (el + 3 * DG) / (t + 3 * DG))); i++; }
      for (az = 0; az < 2 * PI; az += .0025 / den) sky(az, top(az), min(.95, al * 2.6));
    });
  });
  tasks.push(function () {
    var SA = .32, SE = 9 * DG, SRd = 8.5 * DG, i;
    for (i = 0; i < 20000 * den; i++) {
      var rr = SRd * Math.sqrt(rnd()), an = rnd() * 2 * PI, dy = sin(an) * rr, dx = cos(an) * rr, f = (dy + SRd) / (2 * SRd);
      var band = (dy / SRd + 1) * 7, cut = .62 - f * .62;                   // stripes widen toward the bottom of the sun
      if (band - floor(band) < cut) continue; sky(SA + dx / cos(SE), SE + dy, .16 + .3 * f);
    }
    [1.25, 1.55].forEach(function (k, j) { for (var a = 0; a < 2 * PI; a += .01 / den) if (j === 0 || (a * 18 | 0) % 2) sky(SA + cos(a) * SRd * k / cos(SE), SE + sin(a) * SRd * k, .2 - j * .07); });
    anchors[7] = null;
  });
  // tape streaks flowing against the flight: (angle, radius, phase)
  tasks.push(function () {
    for (var i = 0; i < 1900 * den; i++) { var th = rnd() * 2 * PI, r = .5 + 5.5 * Math.pow(rnd(), .8), u = rnd(); for (var j = 0; j < 12; j++) add(th, r, u + j * .0006, 2, j / 11.01); }
  });

  // ---- GL ----
  var VS = 'attribute vec4 p;uniform mat4 m;uniform vec4 u0,u1,u2,u3;uniform vec3 lay,sc,eye;varying float a;' +
    'float cxf(float z){return 1.6*sin(z*.085)+.7*sin(z*.19+1.3);}float cyf(float z){return 1.7+.35*sin(z*.13);}' +
    'void main(){float k=floor(p.w),sd=fract(p.w);vec3 q=p.xyz;float al=0.,sz=1.;' +
    'if(k<.5){float tt=q.y*u0.y;float ix=floor(tt+.5);float d=abs(tt-ix);float mj=step(mod(ix+400.,4.),.5);float ln=(1.-smoothstep(0.,.05+.035*mj,d))*(.15+.85*lay.y);al=(.05+.5*sd*sd)*(.3+.7*lay.x)+(.7+.3*mj)*ln;sz=.85+.25*sd+(.7+.5*mj)*ln;}' +
    'else if(k<1.5){al=(.3+.6*sd)*(.15+.85*lay.x);}' +
    'else if(k<2.5){float sp=.7+.6*fract(q.x*3.7);float u=fract(q.z+u0.w*.011*sp);float z=-96.+u*110.;float th=q.x+z*.3;' +
    'q=vec3(cxf(z)+q.y*cos(th),cyf(z)-.45+abs(q.y*sin(th))*.75,z);al=(.12+.8*sd)*(.08+.92*lay.z)*smoothstep(0.,.03,u)*(1.-smoothstep(.97,1.,u));sz=.7+.7*sd;}' +
    'else if(k<3.5){q.x+=sin(u0.z*.3+sd*40.)*.15;q.y+=sin(u0.z*.23+sd*70.)*.12;al=.1+.32*(.5+.5*sin(u0.z*(.5+sd)+sd*90.));sz=.6+sd;}' +
    'else if(k<4.5){vec3 r=q-sc;float an=u0.z*.07;float c=cos(an),s=sin(an);q=sc+vec3(r.x*c+r.z*s,r.y,r.z*c-r.x*s);al=(.3+.55*sd)*(.2+.8*lay.x);}' +
    'else if(k<5.5){al=(.3+.55*sd)*(.12+.88*lay.y);}else if(k<6.5){q+=eye;al=sd;sz=6.;}else{q=sc+(q-sc)*(1.+.035*sin(u0.z*1.7));float hl=fract(u0.z*.28);float dd2=min(abs(sd-hl),1.-abs(sd-hl));al=.55+.45*exp(-dd2*dd2*90.);sz=1.5+exp(-dd2*dd2*90.);}' +
    'vec4 c=m*vec4(q,1.);c.xy+=u2.xy*c.w;float w=max(c.w,.001);vec2 asp=vec2(u1.x,1.);vec2 nd=c.xy/w;' +
    'vec2 dv=(nd-u2.zw)*asp;float dd=dot(dv,dv);float inf=exp(-dd/.045)*u1.w;' +                       // cursor lens
    'vec2 rv=(nd-u3.xy)*asp;float rd=length(rv);float rq=(rd-u3.z*1.7)/.13;float rw=exp(-rq*rq)*max(0.,1.-u3.z/1.3);' + // click ripple
    'c.xy+=(dv/max(sqrt(dd),.0001)*inf*.024+rv/max(rd,.0001)*rw*.035)/asp*w;gl_Position=c;' +
    'float fog=(k>5.5&&k<6.5)?1.:(1.-smoothstep(u1.y,u1.z,w))*smoothstep(.1,.6,w);float ps=u0.x*sz/w*(1.+inf*.3+rw*.7);float big=max(ps/(u0.x*.22),1.);' +
    'gl_PointSize=clamp(ps,u3.w,u0.x*.9);a=min(1.,al*(1.+inf*.35+rw*.6))*fog/pow(big,1.25);}';
  var FS = 'precision mediump float;varying float a;void main(){vec2 q=gl_PointCoord-.5;float r=dot(q,q);if(r>.25)discard;gl_FragColor=vec4(.04,.04,.045,a*(1.-smoothstep(.1,.25,r)));}';
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var prog, U = {};
  try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link'); }
  catch (e) { if (W.console) console.warn('Landing scene is off:', e.message); root.classList.add('noscene'); return; }
  var MVS = 'attribute vec4 a;uniform mat4 m;uniform vec4 u2;uniform vec2 fv;varying float g;void main(){vec4 c=m*vec4(a.xyz,1.);c.xy+=u2.xy*c.w;gl_Position=c;g=mix(.961,a.w,1.-smoothstep(fv.x,fv.y,c.w));}';
  var MFS = 'precision mediump float;varying float g;void main(){gl_FragColor=vec4(g,g,g-.006,1.);}';
  var mprog = null, MU = {}, mbuf, ibuf, mn = 0, pbuf, AP, MA;
  try { mprog = gl.createProgram(); gl.attachShader(mprog, sh(gl.VERTEX_SHADER, MVS)); gl.attachShader(mprog, sh(gl.FRAGMENT_SHADER, MFS)); gl.linkProgram(mprog); if (!gl.getProgramParameter(mprog, gl.LINK_STATUS)) mprog = null; } catch (e) { mprog = null; }
  if (mprog) ['m', 'u2', 'fv'].forEach(function (k) { MU[k] = gl.getUniformLocation(mprog, k); });
  gl.useProgram(prog);
  ['m', 'u0', 'u1', 'u2', 'u3', 'lay', 'sc', 'eye'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
  gl.uniform3f(U.sc, SC[0], SC[1], SC[2]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(.961, .961, .953, 1); gl.depthFunc(gl.LEQUAL); gl.polygonOffset(2, 6);

  // ---- camera ----
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function persp(f, a, nr, fr) { var t = 1 / Math.tan(f / 2), nf = 1 / (nr - fr); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + nr) * nf, -1, 0, 0, 2 * fr * nr * nf, 0]; }
  function look(e, c, r) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    if (r) { var cr = cos(r), sr = sin(r), x2 = [x[0] * cr + y[0] * sr, x[1] * cr + y[1] * sr, x[2] * cr + y[2] * sr]; y = [y[0] * cr - x[0] * sr, y[1] * cr - x[1] * sr, y[2] * cr - x[2] * sr]; x = x2; }
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var q = 0; q < 4; q++) s += a[q * 4 + j] * b[i * 4 + q]; o[i * 4 + j] = s; } return o; }
  // Flight keys, three per section: z, side offset, height, look-ahead dz, look side, look height, roll, fov,
  // lens shift x (wide screens: scene moves away from the text), lens shift y (tall screens).
  var KEY = [
    [9, -1.6, 5.4, -9.5, 2.2, .7, 0, 42, .40, -.36],
    [3, -.9, 3, -8, 1.2, 1, -.1, 46, .2, -.1],
    [-5, .2, 1.7, -8, .3, 1.5, .08, 50, .1, .1],
    [-13, 0, 2.25, -9, 0, 1.6, 0, 46, .36, .5],
    [-22, -.7, 2.5, -8, .5, 1.6, .16, 50, .15, .1],
    [-31, .6, 1.5, -8, -.2, 1.7, -.2, 52, .1, .1],
    [-41, 0, 1.95, -9, 0, 1.8, 0, 48, .36, .5],
    [-50, .3, 1.7, -8, 0, 1.7, .35, 54, .12, .1],
    [-60, -.4, 2.4, -9, .4, 2.8, -.2, 50, -.1, .1],
    [-67.5, -2.6, 4.6, -10.5, 1, 3.6, 0, 42, -.38, .5]
  ];
  var VIEW = ['ПИК', 'СВЕЧИ', 'ПОТОК', 'ОРБИТА'], kv = new Array(10);
  function keysAt(p) {
    var i = min(2, max(0, floor(p))), fr = min(1, max(0, p - i)), u = (i + fr * .4 + fr * fr * (3 - 2 * fr) * .6) * 3, j = min(8, max(0, floor(u))), t = u - j;
    var a = KEY[max(0, j - 1)], b = KEY[j], c = KEY[j + 1], d = KEY[min(9, j + 2)], t2 = t * t, t3 = t2 * t;
    for (var q = 0; q < 10; q++) kv[q] = .5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 + (3 * b[q] - 3 * c[q] + d[q] - a[q]) * t3);
    return kv;
  }

  // ---- layout and scroll ----
  var secs = [].slice.call(D.querySelectorAll('[data-k]')), blocks = secs.map(function (s) { return s.querySelector('.panel,.hero-txt'); });
  var hudEl = D.querySelector('.hud'), fixedR = null, A = [0], rects = [], end = 1e9, cssW = 1, cssH = 1, dprCap = lite ? 1 : small ? 1.5 : 1.75, veil = D.querySelector('.veil'), veilLast = -1;
  function measure() {
    var sy = W.scrollY, vh = W.innerHeight;
    // layout boxes (ignore the fly-in transforms, which make bounding rects huge)
    rects = blocks.map(function (b) { if (!b) return null; var t = 0, l = 0, e = b; while (e) { t += e.offsetTop; l += e.offsetLeft; e = e.offsetParent; } return { l: l, r: l + b.offsetWidth, t: t, b: t + b.offsetHeight }; });
    var hr = hudEl && hudEl.getBoundingClientRect(); fixedR = hr && hr.width ? hr : null;
    var narrow = W.innerWidth <= 820;                    // narrow screens: text sits at the bottom, the scene above it
    A = secs.map(function (s, i) { var q = rects[i]; return !i || !q ? 0 : max(1, narrow && q.b - q.t < vh - 150 ? q.b - vh + 28 : narrow ? q.t - 100 : (q.t + q.b) / 2 - vh / 2); });
    for (var i = 1; i < A.length; i++) if (A[i] <= A[i - 1]) A[i] = A[i - 1] + 1;
    var last = secs[secs.length - 1]; end = last.getBoundingClientRect().top + sy + last.offsetHeight;
  }
  function resize() {
    cssW = cv.clientWidth || W.innerWidth; cssH = cv.clientHeight || W.innerHeight;
    var dpr = min(W.devicePixelRatio || 1, dprCap);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); gl.viewport(0, 0, cv.width, cv.height);
    measure(); kick();
  }
  function scrollP() {
    var y = W.scrollY; if (y <= A[0]) return 0;
    for (var i = 0; i < A.length - 1; i++) if (y < A[i + 1]) return i + (y - A[i]) / (A[i + 1] - A[i]);
    return A.length - 1;
  }

  // ---- pins and HUD ----
  var pins = [].slice.call(D.querySelectorAll('#pins .pin')).map(function (el, i) { return { el: el, i: i, o: 0, shown: -1, flip: false }; });
  var hud = { v: D.getElementById('hv'), a: D.getElementById('ha'), t: D.getElementById('ht'), n: D.getElementById('hn') }, hudLast = '';
  var layers = W.landingLayers || { dots: 1, lines: 1, pins: 1 }, lay = { dots: 1, lines: 1, pins: 1 };
  W.addEventListener('landing:layers', function () { layers = W.landingLayers || layers; kick(); });
  W.addEventListener('landing:lang', function () { hudLast = ''; kick(); });

  // ---- state ----
  var N = 0, st = [], cnt = [], ready = false, cur = 0, vel = 0, T = 0, ST = 0, fovK = 0, running = false, last = 0, visible = true, shown = false;
  var level = 0, frac = 1, acc = 0, fcn = 0, swapping = false;
  var mx = 0, my = 0, tmx = 0, tmy = 0, mpx = 9, mpy = 9, ms = 0, mst = 0, rpx = 9, rpy = 9, ra = 9;

  function draw(dt) {
    var k = keysAt(cur), wide = cssW / cssH, port = wide < 1, z = k[0], tz = z + k[3];
    var e = [cx(z) + k[1] + mx * .22, k[2] - my * .08, z], tg = [cx(tz) + k[4] + mx * .4, k[5] - my * .22, tz];
    if (!reduce) { e[0] += sin(T * .21) * .07; e[1] += sin(T * .17) * .05; }
    e[1] = max(e[1], H(e[0], e[2]) + .45);
    var f = (k[7] + fovK) * PI / 180; if (port) f = 2 * Math.atan(Math.tan(f / 2) * min(1.9, .78 / wide));
    var M = mul(persp(f, wide, .05, 80), look(e, tg, k[6] + mx * .035));
    var ox = port ? 0 : k[8] * min(1, max(0, (wide - 1) / .5)), oy = port ? k[9] : 0;
    ['dots', 'lines', 'pins'].forEach(function (key) { lay[key] += ((layers[key] ? 1 : 0) - lay[key]) * (reduce ? 1 : min(1, dt * 9)); });
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.vertexAttribPointer(AP, 4, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.m, false, M);
    gl.uniform4f(U.u0, (port ? .025 : .016) * cv.height / (2 * Math.tan(f / 2)), L, T, ST);
    gl.uniform4f(U.u1, wide, 13, 30, ms);
    gl.uniform4f(U.u2, ox, oy, mpx, mpy);
    gl.uniform4f(U.u3, rpx, rpy, ra, 1.25 * cv.height / cssH);
    gl.uniform3f(U.lay, lay.dots, lay.lines, lay.pins); gl.uniform3f(U.eye, e[0], e[1], e[2]);
    gl.disable(gl.DEPTH_TEST); c = floor(cnt[NB + 1] * frac); if (c) gl.drawArrays(gl.POINTS, st[NB + 1], c);
    if (mprog && mn) {
      gl.useProgram(mprog); gl.uniformMatrix4fv(MU.m, false, M); gl.uniform4f(MU.u2, ox, oy, 0, 0); gl.uniform2f(MU.fv, 13, 30);
      gl.bindBuffer(gl.ARRAY_BUFFER, mbuf); gl.vertexAttribPointer(MA, 4, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND);
      gl.drawElements(gl.TRIANGLES, mn, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.BLEND); gl.depthMask(false);
      gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.vertexAttribPointer(AP, 4, gl.FLOAT, false, 0, 0);
    }
    var b0 = max(0, floor((Z0 - (e[2] + 8)) / BW)), b1 = min(NB - 1, floor((Z0 - (e[2] - 33)) / BW)), b, c;
    for (b = b0; b <= b1; b++) { c = floor(cnt[b] * frac); if (c) gl.drawArrays(gl.POINTS, st[b], c); }
    c = floor(cnt[NB] * frac); if (c) gl.drawArrays(gl.POINTS, st[NB], c);
    // pins: every factor fades, and the result is eased, so nothing pops while scrolling
    var sy = W.scrollY, ease = reduce ? 1 : min(1, dt * 7);
    pins.forEach(function (pin) {
      var p = anchors[pin.i], o = 0; if (!p) return;
      var w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15], px = pin.x || 0, py = pin.y || 0;
      if (w > .3) {
        px = ((M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]) / w + ox) * .5 * cssW + .5 * cssW;
        py = .5 * cssH - ((M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]) / w + oy) * .5 * cssH;
        var hd = function (x0) { return fixedR ? Math.hypot(max(fixedR.left - (x0 + 190), x0 - fixedR.right, 0), max(fixedR.top - (py + 12), (py - 88) - fixedR.bottom, 0)) : 1e9; };
        var dR = hd(px - 10), dL = hd(px - 180);          // the label flips to the left near the right edge or the HUD
        if (!pin.flip && (px > cssW - 200 || (dR < 30 && dL > dR))) pin.flip = true; else if (pin.flip && px < cssW - 270 && dR > 70) pin.flip = false;
        var lx = pin.flip ? px - 180 : px - 10, near = 1e9;
        for (var i = 0; i < rects.length; i++) {
          var r = rects[i]; if (!r) continue; var t = r.t - sy, bt = r.b - sy; if (bt < -60 || t > cssH + 60) continue;
          near = min(near, Math.hypot(max(r.l - (lx + 190), lx - r.r, 0), max(t - (py + 12), (py - 88) - bt, 0)));
        }
        near = min(near, pin.flip ? dL : dR);
        o = sm(1.1, 2.6, w) * (1 - sm(11, 17, w)) * sm(0, 46, near) * sm(6, 40, px) * sm(6, 40, cssW - px) * sm(96, 130, py) * sm(0, 30, cssH - py) * lay.pins;
        pin.x = px; pin.y = py;
      }
      pin.o += (o - pin.o) * ease;
      var q = Math.round(pin.o * 50) / 50;
      if (q > 0 || pin.shown > 0) pin.el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
      if (q !== pin.shown) { pin.el.style.opacity = q; pin.el.classList.toggle('flip', pin.flip); pin.shown = q; }
    });
    var dir = norm([tg[0] - e[0], tg[1] - e[1], tg[2] - e[2]]);
    var s = (W.LANDING_VIEW || VIEW)[min(3, Math.round(cur))] + '|' + Math.round(e[1] * 40) + (W.LANDING_UNIT || ' М') + '|' + (Math.asin(-dir[1]) * 180 / PI).toFixed(1) + '°';
    if (s !== hudLast && hud.v) { var h = s.split('|'); hud.v.textContent = h[0]; hud.a.textContent = h[1]; hud.t.textContent = h[2]; hudLast = s; }
    var vo = Math.round((1 - sm(.12, .6, cur)) * 50) / 50; if (veil && vo !== veilLast) { veil.style.opacity = vo; veilLast = vo; }
    if (!shown) { shown = true; root.classList.add('scene-on'); }
  }
  function quality(dt) {
    if (F.full || level >= 3 || T < 1.5) return; acc += dt; fcn++;
    if (fcn < 50) return; var avg = acc / fcn; acc = fcn = 0; if (avg <= .03) return;
    level++; if (level === 1 && dprCap > 1) { dprCap = 1; resize(); } else if (level <= 2) { level = 2; frac = .6; } else frac = .35;
  }
  function frame(now) {
    if (!visible || !ready) { running = false; return; }
    var dt = min(.1, (now - last) / 1000); last = now;
    var prev = cur; cur += (scrollP() - cur) * (1 - exp(-dt * 5));
    vel += ((cur - prev) / max(dt, .001) - vel) * (1 - exp(-dt * 8));
    fovK += (min(13, abs(vel) * 10) - fovK) * (1 - exp(-dt * 6));
    T += dt; ST += dt * (1 + min(9, abs(vel) * 8));
    mx += (tmx - mx) * (1 - exp(-dt * 3)); my += (tmy - my) * (1 - exp(-dt * 3));
    mst += (0 - mst) * (1 - exp(-dt * 2.5)); ms += ((mpx < 5 ? .4 + mst : 0) - ms) * (1 - exp(-dt * 8)); ra += dt;
    draw(dt); if (dt > 0) quality(dt);
    W.requestAnimationFrame(frame);
  }
  function still() {                                    // reduced motion: one frame per section, cross-faded
    var idx = Math.round(scrollP()); if (!ready || swapping) return;
    if (!shown) { cur = idx; draw(1); return; }
    if (idx === cur) return;
    swapping = true; root.classList.add('scene-swap');
    setTimeout(function () { cur = idx; draw(1); root.classList.remove('scene-swap'); swapping = false; still(); }, 280);
  }
  function kick() {
    if (!ready || !visible) return;
    if (reduce) { if (shown) draw(1); still(); return; }
    if (!running) { running = true; last = performance.now(); W.requestAnimationFrame(frame); }
  }
  function onScroll() { var v = W.scrollY < end; if (v !== visible) { visible = v; root.classList.toggle('scene-off', !v); } kick(); }
  W.addEventListener('scroll', onScroll, { passive: true });
  var rt; W.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
  if (!reduce) {
    var lpx = 0, lpy = 0;
    W.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var x = ev.clientX / W.innerWidth * 2 - 1, y = 1 - ev.clientY / W.innerHeight * 2;
      mst = min(.45, mst + Math.hypot(x - lpx, y - lpy) * 1.2); lpx = x; lpy = y; mpx = x; mpy = y;
      if (fine) { tmx = x; tmy = -y; }
    }, { passive: true });
    D.addEventListener('pointerleave', function () { mpx = 9; mpy = 9; });
    W.addEventListener('pointerdown', function (ev) { rpx = ev.clientX / W.innerWidth * 2 - 1; rpy = 1 - ev.clientY / W.innerHeight * 2; ra = 0; }, { passive: true });
  }
  cv.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); root.classList.add('noscene'); ready = false; });
  W.addEventListener('load', function () { if (ready) { measure(); kick(); } });

  // ---- build, then start ----
  function finish() {
    var i, b, total = NB + 2; N = n; cnt = new Array(total); st = new Array(total);
    for (b = 0; b < total; b++) cnt[b] = 0;
    for (i = 0; i < N; i++) cnt[bk[i]]++;
    var s = 0; for (b = 0; b < total; b++) { st[b] = s; s += cnt[b]; }
    var fill = st.slice(), idx = new Uint32Array(N); for (i = 0; i < N; i++) idx[fill[bk[i]]++] = i;
    var r2 = prng(99);                                  // shuffle inside each bucket: any prefix is an even sample
    for (b = 0; b < total; b++) for (i = cnt[b] - 1; i > 0; i--) { var j = floor(r2() * (i + 1)), a = st[b] + i, c = st[b] + j, t = idx[a]; idx[a] = idx[c]; idx[c] = t; }
    var out = new Float32Array(N * 4); for (i = 0; i < N; i++) { var o = idx[i] * 4, d = i * 4; out[d] = buf[o]; out[d + 1] = buf[o + 1]; out[d + 2] = buf[o + 2]; out[d + 3] = buf[o + 3]; }
    buf = bk = null;
    pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    AP = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(AP);
    if (mprog && mesh) {
      MA = gl.getAttribLocation(mprog, 'a'); gl.enableVertexAttribArray(MA);
      mbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mbuf); gl.bufferData(gl.ARRAY_BUFFER, mesh.v, gl.STATIC_DRAW);
      ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.i, gl.STATIC_DRAW); mn = mesh.n; mesh = null;
    }
    if (hud.n) hud.n.textContent = N.toLocaleString('ru-RU');
    ready = true; resize(); cur = reduce ? Math.round(scrollP()) : scrollP(); onScroll();
  }
  (function pump() {
    var t0 = performance.now();
    while (tasks.length && performance.now() - t0 < 7) tasks.shift()();
    if (tasks.length) W.requestAnimationFrame(pump); else finish();
  })();
  W.__scene = { get points() { return N; }, get level() { return level; }, get ready() { return ready; }, get p() { return cur; }, reduce: reduce, lite: lite };
})();
