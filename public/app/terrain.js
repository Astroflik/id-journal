/* Journal world: the landing page's terrain recipe (landing/scene.js) as one place with eight stations.
   Raw WebGL, no dependencies: an even cloud of points over a height field, a grey hillshade mesh under it
   (points behind a hill fail the depth test), contour lines made of points snapped onto the isolines
   (so their width on the ground is constant and they exist only on slopes), fog, a cursor lens, a slow scan wave.
   Every tab is a station: a hill, a dashed ghost frame of the panel above it, a ring on the ground, a pin.
   The tab's content stays ordinary DOM. At rest it has no transform at all; during a flight it gets a
   matrix3d built from the very camera that draws the scene (same eye, same basis, same focal length),
   so the panel is nailed to its place above its hill.
   World.init({content, canvas, keys, label:k=>text, sub:k=>text, reduced:()=>bool, pick:k=>void, pins:el, hud:{v,a,t,n}})
   World.at(k)   jump without motion      World.fly(k, swap) -> Promise   swap() runs mid-flight
   World.quality(q)  0 = scene off, .5 = light (fewer points, nothing moves at rest), 1 = full
   World.hide(bool)  scene hidden (custom background)     World.redraw()     World.on(fn)  fn(fromKey,toKey,t)
   World.dock(bar, {set})  drag the bar to an edge     World.info()  numbers for the tests */
(function () {
  'use strict';
  var W = window, D = document, root = D.documentElement;
  var sin = Math.sin, cos = Math.cos, abs = Math.abs, exp = Math.exp, min = Math.min, max = Math.max, PI = Math.PI, floor = Math.floor, hypot = Math.hypot;
  var mm = function (q) { return !!(W.matchMedia && W.matchMedia(q).matches); };
  var nav = navigator, F = W.SCENE_FORCE || {};
  var lite = !F.full && ((nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4);
  var small = min(W.innerWidth, W.innerHeight) < 700;

  // ---- world maths (same functions as the landing) ----
  function prng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(i, j) { var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
  function noise(x, z) {
    var i = floor(x), j = floor(z), fx = x - i, fz = z - j; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function fbm(x, z) { var s = 0, amp = .5; for (var o = 0; o < 4; o++) { s += amp * noise(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; amp *= .5; } return s; }
  function sm(a, b, x) { var t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // ---- the place: bounds, eight station hills (x, z, height, spread, camera heading), a few more hills between them ----
  var X0 = -27, X1 = 27, Z0 = 9, Z1 = -40, GS = .125, CS = 6, CL = 4, SKYL = .86, DIST = 6, PITCH = .14, FOV = 46, FOG0 = 12, FOG1 = 28;
  var SPOT = [[-16.5, -5, 2.3, 5.5, .2], [-5.5, -5, 1.9, 7, -.12], [5.5, -5, 2.5, 5, .14], [16.5, -5, 2.1, 8, -.22],
              [16.5, -19, 2.4, 6, -.28], [5.5, -19, 2, 7.5, .16], [-5.5, -19, 2.6, 5, -.14], [-16.5, -19, 2.2, 6.5, .26]];
  var MORE = [[-11, -12.5, 1.2, 6], [0, -12, 1.5, 9], [11, -12.5, 1.1, 5], [-22, -29, 1.6, 9], [22, -30, 1.9, 10], [0, -30, 1.4, 8], [-24, 3, 1.2, 7], [24, 4, 1.3, 8], [1, 5, .8, 6], [-10, -34, 1.7, 7], [12, -36, 1.5, 9]];
  function Hf(x, z) {
    var b = fbm(x * .21 + 11, z * .21 + 7), h = b * b * 2.7 + .18 * fbm(x * .8 + 3, z * .8 + 5), i, q, a, c;   // squared: the low ground lies flat
    for (i = 0; i < SPOT.length; i++) { q = SPOT[i]; a = x - q[0]; c = z - q[1]; h += q[2] * exp(-(a * a + c * c) / q[3]); }
    for (i = 0; i < MORE.length; i++) { q = MORE[i]; a = x - q[0]; c = z - q[1]; h += q[2] * exp(-(a * a + c * c) / q[3]); }
    return h;
  }
  // height grid: the point cloud, the mesh and the camera all read the same sampled field (bilinear)
  var gnx = Math.round((X1 - X0) / GS) + 1, gnz = Math.round((Z0 - Z1) / GS) + 1, G = new Float32Array(gnx * gnz), gridReady = false;
  function Hg(x, z) {
    if (!gridReady) return Hf(x, z);
    var fx = min(gnx - 1.001, max(0, (x - X0) / GS)), fz = min(gnz - 1.001, max(0, (Z0 - z) / GS)), i = floor(fx), j = floor(fz), o = j * gnx + i;
    fx -= i; fz -= j; var a = G[o], b = G[o + 1], c = G[o + gnx], d = G[o + gnx + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  // ---- stations: rest pose of the camera and the plane of the panel ----
  var keys = [], ST = {}, label = function (k) { return k; }, sub = function () { return ''; }, reduced = function () { return false; }, pick = null;
  function station(k, i) {
    var q = SPOT[i % SPOT.length], a = q[4], top = [q[0], Hf(q[0], q[1]), q[1]];
    var fw = [sin(a) * cos(PITCH), -sin(PITCH), -cos(a) * cos(PITCH)], A = [top[0], top[1] + 1.5, top[2]], E = [A[0] - fw[0] * DIST, A[1] - fw[1] * DIST, A[2] - fw[2] * DIST];
    var z = [-fw[0], -fw[1], -fw[2]], R = norm(cross([0, 1, 0], z)), U = cross(z, R);
    return { k: k, i: i, top: top, A: A, E: E, R: R, U: U, F: fw };
  }

  // ---- point cloud, built in small time slices so the journal never stalls while it opens ----
  // Each point: x, y, z, kind + seed. Kinds: 0 terrain dot, 1 contour line, 2 line work, 3 dust, 4 sky.
  var den = F.den || (lite ? .3 : small ? .42 : 1), rnd = prng(7), DENS = 760;
  var ncx = Math.ceil((X1 - X0) / CS), ncz = Math.ceil((Z0 - Z1) / CS), NB = ncx * ncz, SKYB = NB;
  var cap = floor((X1 - X0) * (Z0 - Z1) * DENS * den * 1.02) + 260000, buf = null, bk = null, n = 0, tasks = [], mesh = null;
  function add(x, y, z, k, sd, b) {
    if (n >= cap) return; var o = n * 4; buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = k + min(.999, max(0, sd));
    bk[n++] = b !== undefined ? b : min(ncz - 1, max(0, floor((Z0 - z) / CS))) * ncx + min(ncx - 1, max(0, floor((x - X0) / CS)));
  }
  function seg(a, b, step, k, s0, s1) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], m = max(2, Math.ceil(hypot(dx, dy, dz) / step * max(.5, den)));
    for (var i = 0; i <= m; i++) { var t = i / m; add(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t, k, s0 + (s1 - s0) * rnd()); }
  }
  function edge(x, z) { return sm(0, 5, x - X0) * sm(0, 5, X1 - x) * sm(0, 5, z - Z1) * sm(0, 4, Z0 - z); }
  function plan() {
    buf = new Float32Array(cap * 4); bk = new Uint8Array(cap);
    var j, ROWS = 24;
    for (j = 0; j < gnz; j += ROWS) (function (j0) { tasks.push(function () { for (var j2 = j0; j2 < min(gnz, j0 + ROWS); j2++) { var z = Z0 - j2 * GS, o = j2 * gnx; for (var i = 0; i < gnx; i++) G[o + i] = Hf(X0 + i * GS, z); } }); })(j);
    tasks.push(function () { gridReady = true; });
    // terrain: a jittered grid, so the cover is even everywhere (no clumps, no bald spots)
    var sp = 1 / Math.sqrt(DENS * den), strip = 1.4;
    for (var zs = Z0; zs > Z1; zs -= strip) (function (zs) {
      tasks.push(function () {
        for (var z0 = zs; z0 > max(Z1, zs - strip); z0 -= sp) for (var x0 = X0; x0 < X1; x0 += sp) {
          var x = x0 + rnd() * sp, z = z0 - rnd() * sp, e = edge(x, z); if (e < 1 && rnd() > e) continue;
          var h = Hg(x, z); add(x, h, z, 0, min(1, max(0, .42 + (Hg(x + .17, z + .22) - h) * 3.2)));   // light from +x+z: slopes facing away are darker
        }
      });
    })(zs);
    // contour lines: candidates near an isoline are moved onto it along the gradient. The band is measured on the
    // ground (height difference / steepness), so a line is equally wide on a cliff and on a gentle slope,
    // and where the ground is flat there is no line at all.
    var spc = 1 / Math.sqrt(520 * den);
    for (zs = Z0; zs > Z1; zs -= strip) (function (zs) {
      tasks.push(function () {
        for (var z0 = zs; z0 > max(Z1, zs - strip); z0 -= spc) for (var x0 = X0; x0 < X1; x0 += spc) {
          var x = x0 + rnd() * spc, z = z0 - rnd() * spc, h = Hg(x, z), gx = (Hg(x + .06, z) - Hg(x - .06, z)) / .12, gz = (Hg(x, z + .06) - Hg(x, z - .06)) / .12, g2 = gx * gx + gz * gz;
          if (g2 < .012) continue; var g = Math.sqrt(g2), lv = Math.round(h * CL), dh = h - lv / CL; if (abs(dh) / g > .065) continue;
          var k = sm(.11, .26, g) * edge(x, z); if (rnd() > k) continue;
          x -= dh * gx / g2; z -= dh * gz / g2; var h2 = Hg(x, z), d2 = h2 - lv / CL; x -= d2 * gx / g2; z -= d2 * gz / g2;   // two steps land on the line
          x += (rnd() - .5) * .014; z += (rnd() - .5) * .014;
          add(x, Hg(x, z) + .006, z, 1, (((lv % 4) + 4) % 4 === 0 ? .74 : .3) + .25 * rnd());
        }
      });
    })(zs);
    // ground mesh under the points: grey hillshade so the relief reads as a surface. a.w = shade below the sky tone.
    tasks.push(function () {
      var STP = .25, nx = Math.round((X1 - X0) / STP) + 1, nz = Math.round((Z0 - Z1) / STP) + 1, V = new Float32Array(nx * nz * 4), o = 0, i, j;
      var Lx = .55, Ly = .7, Lz = .45, ll = hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
      for (j = 0; j < nz; j++) {
        var z = Z0 - j * STP;
        for (i = 0; i < nx; i++) {
          var x = X0 + i * STP, h = Hg(x, z), gx = (Hg(x + .12, z) - Hg(x - .12, z)) / .24, gz = (Hg(x, z + .12) - h) / .12;
          var nl = hypot(gx, 1, gz), lit = (-gx * Lx + Ly - gz * Lz) / nl;
          V[o++] = x; V[o++] = h; V[o++] = z; V[o++] = (.04 * (1 - sm(.25, .95, lit)) + .02 * sm(1.5, 0, h)) * edge(x, z);
        }
      }
      var I = new Uint16Array((nx - 1) * (nz - 1) * 6), q = 0;
      for (j = 0; j < nz - 1; j++) for (i = 0; i < nx - 1; i++) { var a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d; }
      mesh = { v: V, i: I, n: I.length };
    });
    // every station: dashed ghost frame of the panel, corner marks, a stem down to the hill, a ring on the ground
    keys.forEach(function (k) {
      tasks.push(function () {
        var s = ST[k], hw = 3.1, hh = 1.85, P = function (u, v) { return [s.A[0] + s.R[0] * u + s.U[0] * v, s.A[1] + s.R[1] * u + s.U[1] * v, s.A[2] + s.R[2] * u + s.U[2] * v]; }, t, a;
        var dash = function (u0, v0, u1, v1) { var len = hypot(u1 - u0, v1 - v0), m = Math.round(len / .3); for (var i = 0; i < m; i++) { var a0 = i / m, a1 = (i + .55) / m; seg(P(u0 + (u1 - u0) * a0, v0 + (v1 - v0) * a0), P(u0 + (u1 - u0) * a1, v0 + (v1 - v0) * a1), .014, 2, .3, .6); } };
        dash(-hw, hh, hw, hh); dash(hw, hh, hw, -hh); dash(hw, -hh, -hw, -hh); dash(-hw, -hh, -hw, hh);
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { seg(P(c[0] * hw, c[1] * hh), P(c[0] * (hw - .5), c[1] * hh), .011, 2, .75, 1); seg(P(c[0] * hw, c[1] * hh), P(c[0] * hw, c[1] * (hh - .5)), .011, 2, .75, 1); });
        for (t = 0; t < 1; t += .08) seg([s.top[0], s.top[1] + .04 + t * 1.42, s.top[2]], [s.top[0], s.top[1] + .04 + (t + .04) * 1.42, s.top[2]], .012, 2, .5, .9);
        var ring = function (r, on, s0, s1) { var m = Math.round(2 * PI * r / .26); for (var i = 0; i < m; i++) { var a0 = i / m * 2 * PI, a1 = (i + on) / m * 2 * PI, st = max(3, Math.ceil((a1 - a0) * r / .013 * max(.5, den))); for (var q = 0; q <= st; q++) { var an = a0 + (a1 - a0) * q / st, x = s.top[0] + cos(an) * r, z = s.top[2] + sin(an) * r; add(x, Hg(x, z) + .03, z, 2, s0 + (s1 - s0) * rnd()); } } };
        ring(3.4, .55, .45, .85); ring(.55, 1, .7, 1);
        for (a = 0; a < 12; a++) { var an = a * PI / 6, c = cos(an), sn = sin(an), p0 = [s.top[0] + c * 3.55, 0, s.top[2] + sn * 3.55], p1 = [s.top[0] + c * 3.85, 0, s.top[2] + sn * 3.85]; p0[1] = Hg(p0[0], p0[2]) + .03; p1[1] = Hg(p1[0], p1[2]) + .03; seg(p0, p1, .013, 2, .5, .9); }
      });
    });
    // survey crosses on the ground, dust in the air
    tasks.push(function () {
      for (var i = 0; i < 240; i++) { var x = X0 + 4 + rnd() * (X1 - X0 - 8), z = Z1 + 4 + rnd() * (Z0 - Z1 - 8), y = Hg(x, z) + .025; seg([x - .08, y, z], [x + .08, y, z], .016, 2, .45, .9); seg([x, y, z - .08], [x, y, z + .08], .016, 2, .45, .9); }
      for (i = 0; i < 26000 * den; i++) { x = X0 + rnd() * (X1 - X0); z = Z1 + rnd() * (Z0 - Z1); add(x, Hg(x, z) + .3 + Math.pow(rnd(), 1.5) * 6, z, 3, rnd()); }
    });
    // sky: directions around the camera (it never gets closer): horizon haze, three ridge layers, a striped sun
    var DG = PI / 180, sky = function (az, el, sd) { var ce = cos(el); add(sin(az) * ce * 50, sin(el) * 50, -cos(az) * ce * 50, 4, sd, SKYB); };
    tasks.push(function () {
      for (var i = 0; i < 26000 * den; i++) { var el = (Math.pow(rnd(), 2.2) * 15 - 1.5) * DG; sky(rnd() * 2 * PI, el, .05 + .2 * (1 - el / (15 * DG))); }
      for (var a = 0; a < 2 * PI; a += .004 / den) if (rnd() < .5) sky(a, 26 * DG + (rnd() - .5) * .002, .22);
    });
    [0, 1, 2].forEach(function (Ly) {
      tasks.push(function () {
        var top = function (az) { return (1.4 + (2 - Ly) * 1.6 + fbm(az * (2.2 + Ly) + Ly * 13, Ly * 7.3) * (5 - Ly) - 1.2) * DG; };
        var al = [.16, .27, .42][Ly], m = floor([18000, 22000, 28000][Ly] * den), i = 0, tr = 0, az;
        while (i < m && tr < m * 4) { tr++; az = rnd() * 2 * PI; var t = top(az), el = -3 * DG + rnd() * 16 * DG; if (el > t) continue; sky(az, el, al * (.55 + .45 * (el + 3 * DG) / (t + 3 * DG))); i++; }
        for (az = 0; az < 2 * PI; az += .0025 / den) sky(az, top(az), min(.95, al * 2.6));
      });
    });
    tasks.push(function () {
      var SA = -.5, SE = 9 * DG, SRd = 8.5 * DG;
      for (var i = 0; i < 16000 * den; i++) {
        var rr = SRd * Math.sqrt(rnd()), an = rnd() * 2 * PI, dy = sin(an) * rr, dx = cos(an) * rr, f = (dy + SRd) / (2 * SRd), band = (dy / SRd + 1) * 7;
        if (band - floor(band) < .62 - f * .62) continue; sky(SA + dx / cos(SE), SE + dy, .16 + .3 * f);
      }
      [1.25, 1.55].forEach(function (k, j) { for (var a = 0; a < 2 * PI; a += .01 / den) if (j === 0 || (a * 18 | 0) % 2) sky(SA + cos(a) * SRd * k / cos(SE), SE + sin(a) * SRd * k, .2 - j * .07); });
    });
  }

  // ---- GL ----
  var cv = null, gl = null, prog = null, mprog = null, U = {}, MU = {}, pbuf, mbuf, ibuf, mn = 0, AP, MA, st = [], cnt = [], N = 0, ready = false;
  var VS = 'attribute vec4 p;uniform mat4 m;uniform vec4 u0,u1,u2,u3;uniform vec3 eye,sc;uniform float gn;varying float a;' +
    'void main(){float k=floor(p.w),sd=fract(p.w);vec3 q=p.xyz;float al=0.,sz=1.;' +
    'float sn=exp(-pow((length(q.xz-sc.xy)-u0.z)/1.3,2.))*sc.z;' +
    'if(k<.5){al=.17+.46*sd*sd+.38*sn;sz=.78+.28*sd+.55*sn;}' +
    'else if(k<1.5){al=.5+.5*sd+.3*sn;sz=.95+.75*sd+.4*sn;}' +
    'else if(k<2.5){al=.28+.66*sd;}' +
    'else if(k<3.5){q.x+=sin(u0.y*.3+sd*40.)*.15;q.y+=sin(u0.y*.23+sd*70.)*.12;al=.1+.32*(.5+.5*sin(u0.y*(.5+sd)+sd*90.));sz=.6+sd;}' +
    'else{q+=eye;al=sd;sz=6.;}' +
    'vec4 c=m*vec4(q,1.);float w=max(c.w,.001);vec2 asp=vec2(u1.x,1.);vec2 nd=c.xy/w;' +
    'vec2 dv=(nd-u2.zw)*asp;float dd=dot(dv,dv);float inf=exp(-dd/.045)*u1.w;' +                                     // cursor lens
    'vec2 rv=(nd-u3.xy)*asp;float rd=length(rv);float rq=(rd-u3.z*1.7)/.13;float rw=exp(-rq*rq)*max(0.,1.-u3.z/1.3);' + // click ripple
    'c.xy+=(dv/max(sqrt(dd),.0001)*inf*.024+rv/max(rd,.0001)*rw*.035)/asp*w;gl_Position=c;' +
    'float fog=k>3.5?1.:(1.-smoothstep(u1.y,u1.z,w))*smoothstep(.1,.6,w);float ps=u0.x*sz/w*(1.+inf*.3+rw*.7);float big=max(ps/(u0.x*.22),1.);' +
    'gl_PointSize=clamp(ps,u3.w,u0.x*.9);a=min(1.,al*(1.+inf*.35+rw*.6))*fog*gn/pow(big,1.25);}';
  var FS = 'precision mediump float;varying float a;uniform vec3 ink;void main(){vec2 q=gl_PointCoord-.5;float r=dot(q,q);if(r>.25)discard;gl_FragColor=vec4(ink,a*(1.-smoothstep(.1,.25,r)));}';
  var MVS = 'attribute vec4 a;uniform mat4 m;uniform vec2 fv;varying float g;void main(){vec4 c=m*vec4(a.xyz,1.);gl_Position=c;g=a.w*(1.-smoothstep(fv.x,fv.y,c.w));}';
  var MFS = 'precision mediump float;varying float g;uniform vec4 sk;void main(){float v=sk.x+g*sk.w;gl_FragColor=vec4(v,v,v+sk.y,1.);}';
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  function link(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link'); return p; }
  function glInit() {
    if (!cv || !cv.getContext) return false;
    try {
      gl = cv.getContext('webgl', { antialias: false, alpha: false, depth: true, powerPreference: lite ? 'default' : 'high-performance' });
      if (!gl) return false;
      prog = link(VS, FS); mprog = link(MVS, MFS);
    } catch (e) { if (W.console) console.warn('Journal scene is off:', e.message); gl = null; return false; }
    ['m', 'u0', 'u1', 'u2', 'u3', 'eye', 'sc', 'gn', 'ink'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    ['m', 'fv', 'sk'].forEach(function (k) { MU[k] = gl.getUniformLocation(mprog, k); });
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthFunc(gl.LEQUAL); gl.polygonOffset(2, 6);
    cv.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); ready = false; gl = null; root.classList.add('noscene'); root.classList.remove('scene-on'); });
    return true;
  }
  function persp(f, a, nr, fr) { var t = 1 / Math.tan(f / 2), nf = 1 / (nr - fr); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + nr) * nf, -1, 0, 0, 2 * fr * nr * nf, 0]; }
  function mul(a, b) { var o = new Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var q = 0; q < 4; q++) s += a[q * 4 + j] * b[i * 4 + q]; o[i * 4 + j] = s; } return o; }

  // ---- camera: eye, target, roll, extra fov -> basis; one object is shared by WebGL, the DOM panel, the pins and the HUD ----
  var cam = { e: [0, 4, 6], tg: [0, 2, 0], roll: 0, fk: 0 }, B = null, shown = null, flight = null, subs = [];
  var cssW = 1, cssH = 1, dprCap = lite ? 1 : small ? 1.5 : 1.75, q = 1, hidden = false, dark = false;
  function basis(c) {
    var z = norm([c.e[0] - c.tg[0], c.e[1] - c.tg[1], c.e[2] - c.tg[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    if (c.roll) { var cr = cos(c.roll), sr = sin(c.roll), x2 = [x[0] * cr + y[0] * sr, x[1] * cr + y[1] * sr, x[2] * cr + y[2] * sr]; y = [y[0] * cr - x[0] * sr, y[1] * cr - x[1] * sr, y[2] * cr - x[2] * sr]; x = x2; }
    var wide = cssW / cssH, f = FOV * PI / 180; if (wide < 1) f = 2 * Math.atan(Math.tan(f / 2) * min(1.9, .78 / wide));
    var f0 = f; f += c.fk * PI / 180;
    return { x: x, y: y, z: z, fw: [-z[0], -z[1], -z[2]], f: f, wide: wide, FL: cssH / 2 / Math.tan(f / 2), FL0: cssH / 2 / Math.tan(f0 / 2) };
  }
  function matrix(c, b) {
    var e = c.e, x = b.x, y = b.y, z = b.z;
    return mul(persp(b.f, b.wide, .05, 90), [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  function pose(k) { var s = ST[k]; return { e: s.E.slice(), tg: s.A.slice(), roll: 0, fk: 0 }; }

  // ---- the tab's DOM panel, projected by that camera ----
  var content = null;
  function origin() { if (!content) return; content.style.transform = ''; var r = content.getBoundingClientRect(); content.style.transformOrigin = (cssW / 2 - r.left) + 'px ' + (cssH / 2 - r.top) + 'px'; content._r = r; }
  function place(b) {
    if (!content || !shown || !ST[shown]) return;
    var s = ST[shown], px = b.FL0 / DIST, sF = b.FL / DIST, T0 = [s.A[0] - cam.e[0], s.A[1] - cam.e[1], s.A[2] - cam.e[2]];
    var a = [s.R[0] / px, s.R[1] / px, s.R[2] / px], u = [-s.U[0] / px, -s.U[1] / px, -s.U[2] / px], c = [-s.F[0] / px, -s.F[1] / px, -s.F[2] / px];
    var m = [sF * dot(a, b.x), -sF * dot(a, b.y), 0, dot(a, b.fw) / DIST,
             sF * dot(u, b.x), -sF * dot(u, b.y), 0, dot(u, b.fw) / DIST,
             sF * dot(c, b.x), -sF * dot(c, b.y), 1, dot(c, b.fw) / DIST,
             sF * dot(T0, b.x), -sF * dot(T0, b.y), 0, dot(T0, b.fw) / DIST];
    // the panel must be wholly in front of the eye: check the four corners of the tab
    var r = content._r || { left: 0, top: 0, width: cssW, height: cssH }, x0 = r.left - cssW / 2, y0 = r.top - cssH / 2, x1 = x0 + r.width, y1 = y0 + min(r.height, cssH * 3), wmin = 1e9;
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(function (p) { wmin = min(wmin, m[3] * p[0] + m[7] * p[1] + m[15]); });
    var far = hypot(T0[0], T0[1], T0[2]);
    if (wmin < .12 || far > FOG1 * 1.2) { content.style.setProperty('--wo', '0'); content.style.visibility = 'hidden'; return; }
    content.style.visibility = '';
    content.style.transform = 'matrix3d(' + m.map(function (v) { return v.toFixed(6); }).join(',') + ')';
    content.style.setProperty('--wo', min(1, max(0, 1.25 - far / (FOG0 * 1.5))).toFixed(3));
  }
  function rest() {
    if (!content) return; content.classList.remove('flying'); content.style.transform = ''; content.style.visibility = ''; content.style.opacity = '';
    content.style.removeProperty('--wo'); content.style.removeProperty('--wk'); content.style.removeProperty('--wa'); content.style.transformOrigin = ''; content.removeAttribute('inert'); content._r = null;
  }

  // ---- pins (same markup as the landing) and HUD ----
  var pinBox = null, pins = [], hud = null, hudLast = '';
  function makePins() {
    if (!pinBox) return; pinBox.textContent = ''; pins = [];
    keys.forEach(function (k, i) {
      var el = D.createElement('button'); el.type = 'button'; el.className = 'pin'; el.dataset.k = k; el.tabIndex = -1;
      el.innerHTML = '<s></s><i></i><b><em></em><span></span></b>'; el.onclick = function () { if (pick) pick(k); };
      pinBox.appendChild(el); pins.push({ el: el, k: k, o: 0, shown: -1, flip: false, x: 0, y: 0, num: (i < 9 ? '0' : '') + (i + 1) });
    });
    names();
  }
  function names() { pins.forEach(function (p) { p.el.querySelector('em').textContent = p.num + ' / ' + label(p.k); p.el.querySelector('span').textContent = sub(p.k); p.el.setAttribute('aria-label', label(p.k)); var b = p.el.querySelector('b'); p.w = b.offsetWidth || 190; p.h = b.offsetHeight || 44; }); hudLast = ''; }
  function drawPins(M, snap) {
    var cr = !flight && content && content.getBoundingClientRect ? content.getBoundingClientRect() : null;
    pins.forEach(function (pin) {
      var p = ST[pin.k].top, o = 0, w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15], px = pin.x, py = pin.y;
      if (w > .3) {
        px = (M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]) / w * .5 * cssW + .5 * cssW;
        py = .5 * cssH - (M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]) / w * .5 * cssH;
        if (!pin.flip && px > cssW - 220) pin.flip = true; else if (pin.flip && px < cssW - 290) pin.flip = false;
        o = sm(1.6, 3.2, w) * (1 - sm(FOG0 + 6, FOG1 - 2, w)) * sm(6, 40, px) * sm(6, 40, cssW - px) * sm(96, 130, py) * sm(0, 30, cssH - py);
        if (pin.k === shown && !flight) o = 0;                     // the open tab covers its own hill
        if (cr && o > 0) { var lx0 = pin.flip ? px - 8 - pin.w : px - 8, lx1 = pin.flip ? px + 8 : px + 8 + pin.w; if (lx1 > cr.left - 8 && lx0 < cr.right + 8 && py + 8 > cr.top - 8 && py - 62 - pin.h < cr.bottom + 8) o = 0; }
        pin.x = px; pin.y = py;
      }
      pin.o = snap ? o : pin.o + (o - pin.o) * .2;
      var v = Math.round(pin.o * 50) / 50;
      if (v > 0 || pin.shown > 0) pin.el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
      if (v !== pin.shown) { pin.el.style.opacity = v; pin.el.style.pointerEvents = v > .5 ? '' : 'none'; pin.el.classList.toggle('flip', pin.flip); pin.shown = v; }
    });
  }
  function drawHud(b) {
    if (!hud) return;
    var k = flight ? flight.k : shown, s = (k ? label(k) : '') + '|' + Math.round(cam.e[1] * 40) + '|' + (Math.asin(-b.fw[1]) * 180 / PI).toFixed(1) + '°';
    if (s === hudLast) return; hudLast = s; var h = s.split('|');
    if (hud.v) hud.v.textContent = h[0]; if (hud.a) hud.a.textContent = h[1] + (hud.unit || ' м'); if (hud.t) hud.t.textContent = h[2];
  }

  // ---- draw ----
  var T = 0, level = 0, frac = 1, acc = 0, fcn = 0, mpx = 9, mpy = 9, ms = 0, mst = 0, rpx = 9, rpy = 9, ra = 9, scanR = 99, scanOn = 0, frames = 0;
  function draw(snap) {
    B = basis(cam); var M = matrix(cam, B);
    drawPins(M, snap); drawHud(B);
    if (!gl || !ready || q <= 0 || hidden) return;
    var e = cam.e, sky = dark ? .04 : SKYL, fr = frac * (q < 1 ? .4 : 1), c;
    gl.clearColor(sky, sky, sky + (dark ? .004 : -.006), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.vertexAttribPointer(AP, 4, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.m, false, M);
    gl.uniform4f(U.u0, (B.wide < 1 ? .025 : .016) * cv.height / (2 * Math.tan(B.f / 2)), T, scanR, 0);
    gl.uniform4f(U.u1, B.wide, FOG0, FOG1, ms);
    gl.uniform4f(U.u2, 0, 0, mpx, mpy);
    gl.uniform4f(U.u3, rpx, rpy, ra, 1.25 * cv.height / cssH);
    gl.uniform3f(U.eye, e[0], e[1], e[2]);
    var sc = shown && ST[shown] ? ST[shown].top : [0, 0, 0]; gl.uniform3f(U.sc, sc[0], sc[2], scanOn);
    gl.uniform1f(U.gn, dark ? .78 : 1);
    if (dark) gl.uniform3f(U.ink, .84, .835, .815); else gl.uniform3f(U.ink, .04, .04, .045);
    gl.disable(gl.DEPTH_TEST); c = floor(cnt[SKYB] * fr); if (c) gl.drawArrays(gl.POINTS, st[SKYB], c);
    if (mn) {
      gl.useProgram(mprog); gl.uniformMatrix4fv(MU.m, false, M); gl.uniform2f(MU.fv, FOG0, FOG1); gl.uniform4f(MU.sk, sky, dark ? .004 : -.006, 0, dark ? 1.5 : -1);
      gl.bindBuffer(gl.ARRAY_BUFFER, mbuf); gl.vertexAttribPointer(MA, 4, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND);
      gl.drawElements(gl.TRIANGLES, mn, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.BLEND); gl.depthMask(false);
      gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.vertexAttribPointer(AP, 4, gl.FLOAT, false, 0, 0);
    }
    // only the cells in front of the camera and inside the fog
    var rad = CS * .75, kx = 1 / Math.tan(B.f / 2) / B.wide;
    for (var cz = 0; cz < ncz; cz++) for (var cx = 0; cx < ncx; cx++) {
      var b = cz * ncx + cx; if (!cnt[b]) continue;
      var x = X0 + (cx + .5) * CS - e[0], y = 1.5 - e[1], z = Z0 - (cz + .5) * CS - e[2], w = x * B.fw[0] + y * B.fw[1] + z * B.fw[2];
      if (w < -rad || w - rad > FOG1) continue;
      if (abs(x * B.x[0] + y * B.x[1] + z * B.x[2]) * kx > w + rad * (1 + kx) * 1.2) continue;
      c = floor(cnt[b] * fr); if (c) gl.drawArrays(gl.POINTS, st[b], c);
    }
    frames++;
    if (!root.classList.contains('scene-on')) root.classList.add('scene-on');
  }
  function quality(dt) {            // slow frames during a flight: fewer pixels first, then fewer points
    if (F.full || level >= 3) return; acc += dt; fcn++;
    if (fcn < 40) return; var avg = acc / fcn; acc = fcn = 0; if (avg <= .03) return;
    level++; if (level === 1 && dprCap > 1) { dprCap = 1; size(); } else if (level <= 2) { level = 2; frac = .6; } else frac = .35;
  }
  function size() {
    cssW = W.innerWidth; cssH = W.innerHeight;
    if (cv && gl) { var dpr = min(W.devicePixelRatio || 1, q < 1 ? 1 : dprCap); cv.width = Math.round(cssW * dpr); cv.height = Math.round((cv.clientHeight || cssH) * dpr); gl.viewport(0, 0, cv.width, cv.height); }
  }
  function theme() { dark = D.body.classList.contains('night'); }

  // ---- loop: runs only while something moves ----
  var raf = 0, last = 0, lastIdle = 0, idleT = 0;
  function still() { return reduced() || q < 1 || hidden || !gl || !ready; }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function frame(now) {
    raf = 0; var dt = min(.1, (now - last) / 1000); last = now;
    if (flight) {
      var f = flight, t = min(1, max(0, (now - f.t0) / f.dur)), k = ease(t), kt = ease(min(1, t * 1.22)), bow = sin(PI * t);
      var e = lerp3(f.from.e, f.to.e, k); e[1] += f.arc * bow;
      e[1] = max(e[1], Hg(e[0], e[2]) + 1.25, Hg(e[0] + f.dir[0] * 1.2, e[2] + f.dir[2] * 1.2) + 1.05);      // never through the ground, nor into the hill ahead
      cam = { e: e, tg: lerp3(f.from.tg, f.to.tg, kt), roll: f.bank * bow * (1 - t), fk: 7 * bow };
      if (!f.swapped && t >= .5) { f.swapped = true; content.style.transform = ''; content.style.visibility = ''; try { f.swap && f.swap(); } catch (err) { console.error(err); } shown = f.k; origin(); }
      T += dt; draw(false); place(B); content.style.setProperty('--wk', bow.toFixed(3)); content.style.setProperty('--wa', f.swapped ? ((t - .5) * 2).toFixed(3) : '1'); emit(f.fromK, f.k, t); if (dt > 0) quality(dt);
      if (t >= 1) { cam = pose(f.k); flight = null; rest(); scanStart(); draw(true); f.resolve(); }
      loop(); return;
    }
    if (still() || D.hidden) return;
    T += dt; mst += (0 - mst) * (1 - exp(-dt * 2.5)); ms += ((mpx < 5 ? .4 + mst : 0) - ms) * (1 - exp(-dt * 8)); ra += dt;
    if (scanOn) { scanR += dt * 4.2; if (scanR > FOG1) { scanOn = 0; clearTimeout(idleT); idleT = setTimeout(scanStart, 9000); } }
    draw(false);
    if (scanOn || ms > .004 || ra < 1.4 || mpx < 5 && mst > .004) loop();
  }
  function loop() { if (raf) return; raf = W.requestAnimationFrame(function (t) { if (!flight && t - lastIdle < 32) { raf = 0; return loop(); } lastIdle = t; frame(t); }); }
  function kick() { last = performance.now(); loop(); }
  function scanStart() { clearTimeout(idleT); if (still() || D.hidden || flight) return; scanR = 0; scanOn = 1; kick(); }
  function emit(a, b, t) { subs.forEach(function (f) { try { f(a, b, t); } catch (e) { } }); }

  function at(k) { if (!ST[k]) return; cam = pose(k); shown = k; flight = null; rest(); draw(true); emit(k, k, 1); scanStart(); }
  function fly(k, swap) {
    return new Promise(function (resolve) {
      if (!ST[k] || !content) { swap && swap(); shown = k; resolve(); return; }
      if (flight) { var old = flight; flight = null; old.swap = null; old.resolve(); }
      var to = pose(k), from = { e: cam.e.slice(), tg: cam.tg.slice() }, dist = hypot(to.e[0] - from.e[0], to.e[1] - from.e[1], to.e[2] - from.e[2]), fromK = shown;
      if (reduced() || dist < .01 || !gl || !ready || q <= 0 || hidden) {       // no scene to fly over (no WebGL, performance mode, custom background, still building)
        // no flight: a short cross-fade only (opacity, never transform)
        rest(); swap && swap(); shown = k; cam = to; draw(true); emit(fromK, k, 1);
        if (content.animate) content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
        resolve(); return;
      }
      var dir = norm([to.e[0] - from.e[0], 0, to.e[2] - from.e[2]]), side = dir[0] * B.fw[2] - dir[2] * B.fw[0];
      size(); origin(); content.classList.add('flying'); content.setAttribute('inert', ''); scanOn = 0; clearTimeout(idleT);
      flight = { from: from, to: to, k: k, fromK: fromK, swap: swap, swapped: false, resolve: resolve, t0: performance.now(), dir: dir,
        dur: (1050 + min(dist, 40) * 34) * (small ? .7 : 1), arc: min(4.6, 1.1 + dist * .13), bank: max(-.2, min(.2, side * .28)) };
      kick();
    });
  }

  // ---- bar docking: drag the grip to an edge, or arrow keys on the grip ----
  function dock(bar, o) {
    if (!bar || bar._dock) return; bar._dock = 1; var drag = null, zones = null;
    function edgeAt(x, y) { var d = [['left', x], ['right', cssW - x], ['top', y], ['bottom', cssH - y]]; d.sort(function (a, b) { return a[1] - b[1]; }); return d[0][0]; }
    function showZones(e) {
      if (!zones) { zones = D.createElement('div'); zones.className = 'dock-zones'; zones.setAttribute('aria-hidden', 'true'); ['top', 'right', 'bottom', 'left'].forEach(function (s) { var z = D.createElement('i'); z.dataset.e = s; zones.append(z); }); D.body.append(zones); }
      zones.querySelectorAll('i').forEach(function (z) { z.classList.toggle('on', z.dataset.e === e); });
    }
    bar.addEventListener('pointerdown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.dock-grip'); if (!g || ev.button > 0) return;
      var r = bar.getBoundingClientRect(); drag = { id: ev.pointerId, dx: ev.clientX - r.left, dy: ev.clientY - r.top, x0: ev.clientX, y0: ev.clientY, on: false }; g.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    bar.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      if (!drag.on && abs(ev.clientX - drag.x0) + abs(ev.clientY - drag.y0) < 5) return;
      if (!drag.on) { drag.on = true; D.body.classList.add('dock-drag'); }
      bar.style.left = (ev.clientX - drag.dx) + 'px'; bar.style.top = (ev.clientY - drag.dy) + 'px'; bar.style.right = 'auto'; bar.style.bottom = 'auto'; bar.style.transform = 'none'; showZones(edgeAt(ev.clientX, ev.clientY));
    });
    function end(ev) {
      if (!drag || ev.pointerId !== drag.id) return; var was = drag.on; drag = null; D.body.classList.remove('dock-drag');
      bar.style.left = bar.style.top = bar.style.right = bar.style.bottom = bar.style.transform = ''; if (zones) { zones.remove(); zones = null; }
      if (was && ev.type === 'pointerup') o.set(edgeAt(ev.clientX, ev.clientY));
    }
    bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', function (ev) {
      var g = ev.target.closest && ev.target.closest('.dock-grip'); if (!g) return;
      var m = { ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' }[ev.key]; if (m) { ev.preventDefault(); o.set(m); }
    });
  }

  // ---- build, then start ----
  function finish() {
    var i, b, total = NB + 1, idx, fill; N = n; cnt = new Array(total); st = new Array(total);
    tasks.push(function () {
      for (b = 0; b < total; b++) cnt[b] = 0;
      for (i = 0; i < N; i++) cnt[bk[i]]++;
      var s = 0; for (b = 0; b < total; b++) { st[b] = s; s += cnt[b]; }
      fill = st.slice(); idx = new Uint32Array(N); for (i = 0; i < N; i++) idx[fill[bk[i]]++] = i;
    });
    tasks.push(function () {                              // shuffle inside each cell: any prefix is an even sample
      var r2 = prng(99); for (b = 0; b < total; b++) for (i = cnt[b] - 1; i > 0; i--) { var j = floor(r2() * (i + 1)), a = st[b] + i, c = st[b] + j, t = idx[a]; idx[a] = idx[c]; idx[c] = t; }
    });
    tasks.push(function () {
      var out = new Float32Array(N * 4); for (i = 0; i < N; i++) { var o = idx[i] * 4, d = i * 4; out[d] = buf[o]; out[d + 1] = buf[o + 1]; out[d + 2] = buf[o + 2]; out[d + 3] = buf[o + 3]; }
      buf = bk = null;
      pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
      AP = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(AP);
      MA = gl.getAttribLocation(mprog, 'a'); gl.enableVertexAttribArray(MA);
      mbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mbuf); gl.bufferData(gl.ARRAY_BUFFER, mesh.v, gl.STATIC_DRAW);
      ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.i, gl.STATIC_DRAW); mn = mesh.n; mesh = null;
      if (hud && hud.n) hud.n.textContent = N.toLocaleString('ru-RU');
      ready = true; built = Math.round(performance.now() - t0b); size(); theme(); draw(true); scanStart();
    });
    pump(null);
  }
  var t0b = 0, built = 0;
  function pump(done) {
    (function step() {
      if (!gl) return; var t0 = performance.now();
      while (tasks.length && performance.now() - t0 < (D.body.classList.contains('pre') ? 16 : 10)) tasks.shift()();   // the intro covers the page: build faster
      if (tasks.length) W.requestAnimationFrame(step); else if (done) done();
    })();
  }

  function init(o) {
    content = o.content; cv = o.canvas || null; keys = o.keys || []; pinBox = o.pins || null; hud = o.hud || null; pick = o.pick || null;
    if (o.label) label = o.label; if (o.sub) sub = o.sub; if (o.reduced) reduced = o.reduced;
    ST = {}; keys.forEach(function (k, i) { ST[k] = station(k, i); });
    cssW = W.innerWidth; cssH = W.innerHeight; theme(); makePins(); B = basis(cam);
    if (glInit()) { size(); t0b = performance.now(); plan(); pump(finish); } else root.classList.add('noscene');
    var rt; W.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { size(); if (flight) origin(); draw(true); }, 120); });
    D.addEventListener('visibilitychange', function () { if (!D.hidden) { draw(true); scanStart(); } });
    var st0 = 0; W.addEventListener('scroll', function () { if (st0 || flight) return; st0 = W.requestAnimationFrame(function () { st0 = 0; if (!flight) drawPins(matrix(cam, B), true); }); }, { passive: true });   // labels give way to the tab as it scrolls
    W.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch' || still()) return;
      var x = ev.clientX / cssW * 2 - 1, y = 1 - ev.clientY / cssH * 2; mst = min(.45, mst + hypot(x - mpx, y - mpy) * 1.2); mpx = x; mpy = y; if (!raf) kick();
    }, { passive: true });
    D.addEventListener('pointerleave', function () { mpx = 9; mpy = 9; });
    W.addEventListener('pointerdown', function (ev) { if (still()) return; rpx = ev.clientX / cssW * 2 - 1; rpy = 1 - ev.clientY / cssH * 2; ra = 0; if (!raf) kick(); }, { passive: true });
  }
  W.World = {
    init: init, at: at, fly: fly, dock: dock, on: function (f) { subs.push(f); },
    quality: function (v) { v = +v || 0; v = v <= 0 ? 0 : v < 1 ? .5 : 1; if (v === q) return; q = v; if (cv) cv.hidden = q <= 0 || hidden; size(); draw(true); if (q >= 1) scanStart(); else { scanOn = 0; clearTimeout(idleT); } },
    hide: function (v) { v = !!v; if (v === hidden) return; hidden = v; if (cv) cv.hidden = q <= 0 || hidden; D.body.classList.toggle('scene-hidden', hidden); if (!hidden) { size(); draw(true); scanStart(); } },
    redraw: function () { theme(); names(); size(); draw(true); },
    current: function () { return shown; }, flying: function () { return !!flight; },
    info: function () { return { built: built, points: N, ready: ready, gl: !!gl, q: q, frac: frac * (q < 1 ? .4 : 1), level: level, hidden: hidden, dark: dark, scan: scanOn, frames: frames, looping: !!raf, lite: lite, den: den, eye: cam.e.slice(), ground: Hg(cam.e[0], cam.e[2]), keys: keys.slice() }; }
  };
})();
