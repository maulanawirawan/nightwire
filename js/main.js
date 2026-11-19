// nightwire: renderer, camera, interaction.
(() => {
'use strict';
const NW = window.NW, SH = NW.SH, CITY = NW.city, B = CITY.B;
const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const $ = id => document.getElementById(id);
const cv = $('c');
const gl = cv.getContext('webgl2', {antialias: false, alpha: false, depth: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance'});
if (!gl) { $('err').style.display = 'flex'; return; }
const HDR = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');
if (CAPTURE) document.body.classList.add('hidehud');
const rnd = NW.rnd;
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

/* ---------- real detections ---------- */
let DET = [[17890, 'CVE-2026-88995', 'Bookit'], [17883, 'CVE-2026-81197', 'MasterStudy LMS'], [17882, 'CVE-2026-87916', 'WPBot'], [17853, 'CVE-2026-75918', 'phpMyFAQ'],
  [17852, 'CVE-2026-19715', 'WP OAuth Server'], [17848, 'CVE-2026-86538', 'knowns'], [17845, 'CVE-2026-104476', 'Backdrop CMS'], [17821, 'CVE-2026-129131', 'Gameyfin'],
  [17820, 'CVE-2026-121853', 'AppPresser'], [17805, 'CVE-2026-64858', 'vulnerability-operator'], [17797, 'CVE-2026-119302', 'NotificationX'], [17748, 'CVE-2026-125357', 'Munin munin-httpd'],
  [17743, 'CVE-2026-120409', 'All-in-One Video Gallery'], [17727, 'CVE-2026-102657', 'esm.sh web handler'], [17722, 'CVE-2026-124027', 'ChatWiki'], [17720, 'CVE-2026-62850', 'FreeScout'],
  [17719, 'CVE-2026-123655', 'Moodle'], [17691, 'CVE-2026-115574', 'Zulip Server'], [17685, 'CVE-2026-118523', 'EventPrime'], [17676, 'CVE-2026-120442', 'ape-volo-admin'],
  [17675, 'CVE-2026-120446', 'madong-admin-saas'], [17673, 'CVE-2026-119485', 'Dokan Lite'], [17672, 'CVE-2026-120597', 'Welcart e-Commerce'], [17669, 'CVE-2026-119495', 'Better Search'],
  [17651, 'CVE-2026-96654', 'Plex Media Server']];
if (!CAPTURE) fetch('https://api.github.com/search/issues?per_page=100&q=' + encodeURIComponent('author:maulanawirawan type:pr is:merged repo:projectdiscovery/nuclei-templates'))
  .then(r => r.ok ? r.json() : null).then(d => {
    if (!d || !d.items) return;
    const out = [];
    for (const it of d.items) {
      const m = it.title.match(/(CVE-\d{4}-\d+)(?:\.yaml)?\s*[-:–]?\s*(.*)/i); if (!m) continue;
      let name = m[2].split(/\s(?:<=?|>=?|-|unauthenticated|missing|authentication|via)\s/i)[0].trim();
      if (name.length > 26) name = name.slice(0, 25) + '…';
      out.push([it.number, m[1].toUpperCase(), name || m[1]]);
    }
    if (out.length >= 5) DET = out;
  }).catch(() => {});

/* ---------- gl helpers ---------- */
function prog([vs, fs]) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t); gl.shaderSource(sh, SH.HEAD + s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const L = {};
  return {p, u: n => (n in L) ? L[n] : (L[n] = gl.getUniformLocation(p, n))};
}
const buf = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
const attr = (loc, size, stride, off, div) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(loc, div || 0); };
const P = {};
for (const k of ['SKY', 'BLD', 'CAR', 'POOL', 'SIGN', 'CONE', 'GROUND', 'RAIN', 'BEAM', 'ATK', 'BRIGHT', 'BLUR', 'COMP']) P[k] = prog(SH[k]);

/* ---------- geometry ---------- */
const empty = gl.createVertexArray();
// unit box: x,z in [-.5,.5], y in [0,1], with bottom face (lamp heads light downward)
const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0], [.5, 0, .5]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], [-.5, 0, -.5]], [[0, 0, 1], [1, 0, 0], [0, 1, 0], [-.5, 0, .5]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0], [.5, 0, -.5]], [[0, 1, 0], [1, 0, 0], [0, 0, -1], [-.5, 1, .5]], [[0, -1, 0], [1, 0, 0], [0, 0, 1], [-.5, 0, -.5]]];
const cubeV = [], cubeI = [];
faces.forEach(([n, U, V, O], f) => {
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v]) => cubeV.push(O[0] + U[0] * u + V[0] * v, O[1] + U[1] * u + V[1] * v, O[2] + U[2] * u + V[2] * v, ...n, u, v));
  const b = f * 4; cubeI.push(b, b + 1, b + 2, b, b + 2, b + 3);
});
const vaoB = gl.createVertexArray(); gl.bindVertexArray(vaoB);
buf(new Float32Array(cubeV)); attr(0, 3, 32, 0); attr(1, 3, 32, 12); attr(2, 2, 32, 24);
const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cubeI), gl.STATIC_DRAW);
buf(CITY.boxes); attr(3, 4, 48, 0, 1); attr(4, 4, 48, 16, 1); attr(5, 4, 48, 32, 1);
const NBOX = CITY.boxes.length / 12;

// car: body with a sloped nose + glass cabin + dark wheel band, flat-shaded triangles
function carMesh() {
  const out = [];
  const quad = (a, b, c, d, part) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    for (const p of [a, b, c, a, c, d]) out.push(...p, ...n, part);
  };
  const hexa = (lo, hi, part, skipBottom) => {      // lo/hi: [[x0,x1],[z0,z1],y] bottom and top rectangles
    const [bx, bz, by] = lo, [tx, tz, ty] = hi;
    const b = [[bx[0], by, bz[0]], [bx[1], by, bz[0]], [bx[1], by, bz[1]], [bx[0], by, bz[1]]];
    const t = [[tx[0], ty, tz[0]], [tx[1], ty, tz[0]], [tx[1], ty, tz[1]], [tx[0], ty, tz[1]]];
    quad(t[0], t[3], t[2], t[1], part);
    quad(b[0], b[1], t[1], t[0], part); quad(b[1], b[2], t[2], t[1], part); quad(b[2], b[3], t[3], t[2], part); quad(b[3], b[0], t[0], t[3], part);
    if (!skipBottom) quad(b[0], b[3], b[2], b[1], part);
  };
  hexa([[-.78, .78], [-2.05, 1.95], .02], [[-.78, .78], [-2.05, 1.95], .36], 2, true);
  hexa([[-.92, .92], [-2.28, 2.28], .32], [[-.9, .9], [-2.22, 2.05], .92], 0);
  hexa([[-.82, .82], [-1.5, 1.05], .92], [[-.7, .7], [-1.15, .3], 1.42], 1, true);
  return new Float32Array(out);
}
const carV = carMesh();
const vaoC = gl.createVertexArray(); gl.bindVertexArray(vaoC);
buf(carV); attr(0, 3, 28, 0); attr(1, 3, 28, 12); attr(2, 1, 28, 24);
const carBuf = buf(CITY.cars); attr(3, 4, 32, 0, 1); attr(4, 4, 32, 16, 1);
const NCAR = CITY.cars.length / 8;
const vaoPool = gl.createVertexArray(); gl.bindVertexArray(vaoPool);
gl.bindBuffer(gl.ARRAY_BUFFER, carBuf); attr(3, 4, 32, 0, 1); attr(4, 4, 32, 16, 1);

const vaoS = gl.createVertexArray(); gl.bindVertexArray(vaoS);
buf(CITY.signs); for (let k = 0; k < 4; k++) attr(k, 4, 64, k * 16, 1);
const NSIGN = CITY.signs.length / 16;

// open cone for lamp light: apex at 0, base radius 6.5 at y=-1 (scaled to lamp height in the shader)
const coneV = [];
for (let i = 0; i < 20; i++) {
  const a0 = i / 20 * Math.PI * 2, a1 = (i + 1) / 20 * Math.PI * 2;
  const pt = (a, t) => { const r = .25 + t * 6.3; return [Math.cos(a) * r, -t, Math.sin(a) * r]; };
  const nn = a => [Math.cos(a), .2, Math.sin(a)];
  for (const [a, t] of [[a0, 0], [a1, 0], [a1, 1], [a0, 0], [a1, 1], [a0, 1]]) coneV.push(...pt(a, t), ...nn(a));
}
const vaoK = gl.createVertexArray(); gl.bindVertexArray(vaoK);
buf(new Float32Array(coneV)); attr(0, 3, 24, 0); attr(1, 3, 24, 12);
buf(CITY.cones); attr(3, 4, 16, 0, 1);
const NCONE = CITY.cones.length / 4;

const vaoG = gl.createVertexArray(); gl.bindVertexArray(vaoG);
const GS = 3000; buf(new Float32Array([-GS, -GS, GS, GS, GS, -GS, -GS, -GS, -GS, GS, GS, GS])); attr(0, 2, 8, 0);

const MAXATK = 64; let nAtk = 0;
const vaoA = gl.createVertexArray(); gl.bindVertexArray(vaoA);
const atkBuf = buf(new Float32Array(MAXATK * 10), gl.DYNAMIC_DRAW); attr(0, 3, 40, 0, 1); attr(1, 3, 40, 12, 1); attr(2, 4, 40, 24, 1);
const MAXBEAM = 128, beams = new Float32Array(MAXBEAM * 4); let nBeam = 0;
const vaoBm = gl.createVertexArray(); gl.bindVertexArray(vaoBm);
const beamBuf = buf(beams, gl.DYNAMIC_DRAW); attr(0, 4, 16, 0, 1);
gl.bindVertexArray(null);

/* ---------- textures ---------- */
const proofTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, proofTex);
const proofData = new Float32Array(1024 * 4).fill(-1);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1024, 4, 0, gl.RED, gl.FLOAT, proofData);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
const atlasTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, NW.atlas);
gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);

/* ---------- framebuffers ---------- */
const FMT = HDR ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
function target(w, h, depth, mips) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, FMT[0], w, h, 0, gl.RGBA, FMT[1], null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  let rb = null;
  if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
  return {f, t, w, h, rb, rbs: []};
}
function msTarget(w, h) {
  const max = gl.getParameter(gl.MAX_SAMPLES);
  const samples = Math.min(4, max);
  if (samples < 2 || Q.has('noaa')) return null;
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  const c = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, FMT[0], w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
  const d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
  return {f, t: null, w, h, rb: null, rbs: [c, d]};
}
let FB = null, W = 0, H = 0, scale = Q.get('q') === 'low' ? .55 : 1;
const free = o => { if (!o) return; gl.deleteFramebuffer(o.f); if (o.t) gl.deleteTexture(o.t); if (o.rb) gl.deleteRenderbuffer(o.rb); o.rbs.forEach(r => gl.deleteRenderbuffer(r)); };
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5) * scale;
  W = Math.max(2, Math.round(cv.clientWidth * dpr)); H = Math.max(2, Math.round(cv.clientHeight * dpr));
  cv.width = W; cv.height = H;
  if (FB) Object.values(FB).forEach(free);
  const q = k => [Math.max(1, W >> k), Math.max(1, H >> k)];
  FB = {s: target(W, H, true), m: target(...q(1), true, true), a1: target(...q(2)), a2: target(...q(2)), b1: target(...q(3)), b2: target(...q(3)), c1: target(...q(4)), c2: target(...q(4))};
  FB.ms = msTarget(W, H);
}
addEventListener('resize', resize); resize();

/* ---------- math ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const Hyp = a => Math.hypot(...a), norm = a => mul(a, 1 / (Hyp(a) || 1)), lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function persp(fy, a, n, f) { const t = 1 / Math.tan(fy / 2), nf = 1 / (n - f); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; }
function look(e, c, up) { const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; }
function mm(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function inv(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
    b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
}
const MIRROR = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/* ---------- tour: drive the avenue at street level, crane up, sweep the skyline, come back down ---------- */
const K = [[-1.8, 2.3, -470], [-1.8, 2.3, -300], [-1.8, 2.3, -60], [-1.8, 2.4, 180], [-1.8, 2.8, 400], [-1.8, 20, 560], [40, 120, 640],
  [360, 380, 420], [520, 380, -100], [300, 300, -600], [0, 90, -690], [-1.8, 10, -580]];
const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return [0, 1, 2].map(i => .5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)); };
const rawPath = u => { const n = K.length, i = Math.floor(u) % n, t = u - Math.floor(u); return cr(K[(i - 1 + n) % n], K[i], K[(i + 1) % n], K[(i + 2) % n], t); };
const STEPS = 6000, LUT = [0];
{ let prev = rawPath(0), acc = 0; for (let k = 1; k <= STEPS; k++) { const p = rawPath(k / STEPS * K.length); acc += Hyp(sub(p, prev)); LUT.push(acc); prev = p; } }
const PATHLEN = LUT[STEPS];
function pathAt(s) {
  s = ((s % PATHLEN) + PATHLEN) % PATHLEN;
  let lo = 0, hi = STEPS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (LUT[m] < s) lo = m; else hi = m; }
  return rawPath((lo + (s - LUT[lo]) / ((LUT[hi] - LUT[lo]) || 1)) / STEPS * K.length);
}
const cam = {mode: 'tour', s: Q.has('s') ? +Q.get('s') : 0, pos: [-1.8, 2.3, -470], fwd: [0, 0, 1], yaw: Math.PI / 2, pitch: 0, vel: [0, 0, 0], speed: 1, blend: 1, from: null, roll: 0};
function tourPose(s) {
  const p = pathAt(s), ahead = pathAt(s + 14), low = p[1] < 6;
  let f = norm(sub(ahead, p));
  if (!low) f = norm(lerp3(f, norm(sub([80, 30, 60], p)), clamp((p[1] - 12) / 70, 0, 1) * .8));
  f[1] = clamp(f[1], -.45, low ? .05 : p[1] > 60 ? -.12 : .05);
  return {pos: p, fwd: norm(f)};
}
const tourSpeed = y => 13 + clamp((y - 6) / 120, 0, 1) * 42;
const keys = new Set();
const bm = $('bm'), bs = $('bs'), ba = $('ba');
function toFree() {
  if (cam.mode === 'free') return;
  cam.mode = 'free'; cam.yaw = Math.atan2(cam.fwd[2], cam.fwd[0]); cam.pitch = Math.asin(clamp(cam.fwd[1], -1, 1)); cam.vel = [0, 0, 0];
  bm.textContent = 'fly'; bm.classList.add('on');
}
function toTour() {
  if (cam.mode === 'tour') return;
  cam.from = {pos: cam.pos.slice(), fwd: cam.fwd.slice()}; cam.blend = 0; cam.mode = 'tour';
  let best = 0, bd = 1e9; for (let s = 0; s < PATHLEN; s += 5) { const d = Hyp(sub(pathAt(s), cam.pos)); if (d < bd) { bd = d; best = s; } }
  cam.s = best; bm.textContent = 'tour'; bm.classList.remove('on');
}
function cellIds(x, z) { return CITY.grid.get(Math.floor(x / 10) + ',' + Math.floor(z / 10)) || []; }
function insideB(p, m) {
  for (const i of cellIds(p[0], p[2])) { const b = B[i]; if (Math.abs(p[0] - b.x) < b.w / 2 + m && Math.abs(p[2] - b.z) < b.d / 2 + m && p[1] < b.top + m && p[1] > b.y0 - m) return i; }
  return -1;
}
function collide(p) {
  p[1] = Math.max(p[1], 1.4);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const i of cellIds(p[0] + dx * 10, p[2] + dz * 10)) {
    const b = B[i], m = .8;
    const x0 = b.x - b.w / 2 - m, x1 = b.x + b.w / 2 + m, z0 = b.z - b.d / 2 - m, z1 = b.z + b.d / 2 + m, y1 = b.top + m;
    if (p[0] > x0 && p[0] < x1 && p[2] > z0 && p[2] < z1 && p[1] < y1 && p[1] > b.y0 - m) {
      const o = [[p[0] - x0, 0, x0], [x1 - p[0], 0, x1], [p[2] - z0, 2, z0], [z1 - p[2], 2, z1], [y1 - p[1], 1, y1]].sort((a, c) => a[0] - c[0])[0];
      p[o[1]] = o[2];
    }
  }
  p[0] = clamp(p[0], -1400, 1400); p[2] = clamp(p[2], -1400, 1400); p[1] = Math.min(p[1], 900);
}
let touchFwd = false;
function updateCam(dt) {
  if (cam.mode === 'tour') {
    cam.s += tourSpeed(cam.pos[1]) * dt;
    const t = tourPose(cam.s);
    if (cam.blend < 1) {
      cam.blend = Math.min(1, cam.blend + dt / 2.5); const e = cam.blend * cam.blend * (3 - 2 * cam.blend);
      cam.pos = lerp3(cam.from.pos, t.pos, e); cam.fwd = norm(lerp3(cam.from.fwd, t.fwd, e));
    } else { cam.pos = t.pos; cam.fwd = t.fwd; }
    return;
  }
  const cp = Math.cos(cam.pitch);
  cam.fwd = [cp * Math.cos(cam.yaw), Math.sin(cam.pitch), cp * Math.sin(cam.yaw)];
  const right = norm(cross(cam.fwd, [0, 1, 0]));
  let mv = [0, 0, 0];
  const k = c => keys.has(c);
  if (k('KeyW') || k('ArrowUp') || touchFwd) mv = add(mv, cam.fwd);
  if (k('KeyS') || k('ArrowDown')) mv = sub(mv, cam.fwd);
  if (k('KeyD') || k('ArrowRight')) mv = add(mv, right);
  if (k('KeyA') || k('ArrowLeft')) mv = sub(mv, right);
  if (k('KeyE') || k('Space')) mv[1] += 1;
  if (k('KeyQ') || k('ControlLeft')) mv[1] -= 1;
  const sp = 16 * cam.speed * (k('ShiftLeft') || k('ShiftRight') ? 4 : 1);
  cam.vel = lerp3(cam.vel, mul(norm(mv), Hyp(mv) > 0 ? sp : 0), 1 - Math.exp(-dt * 4));
  cam.pos = add(cam.pos, mul(cam.vel, dt));
  collide(cam.pos);
}

/* ---------- labels: the evidence ladder ---------- */
const labels = [];
const STEPS_SCAN = [['L0', 'OBSERVED', 'l0'], ['L1', 'SUSPECTED', 'l1'], ['L2', 'REPRODUCED', 'l2'], ['L3', 'VERIFIED ✓', '']];
const STEPS_ATK = [['L0', '⚠ ANOMALY', 'atk'], ['L1', '⚠ SUSPECTED INTRUSION', 'atk'], ['L2', '⚠ REPRODUCED', 'atk'], ['L3', 'INTRUSION BLOCKED ✓', '']];
const ipOf = k => k === NW.spire ? '10.0.0.1 · core' : `10.${(k >> 8) & 255}.${k & 255}.${(k * 37) & 255}`;
const detOf = k => DET[(k * 7919) % DET.length];
function anchorOf(k) {
  const b = B[k], p = cam.pos;
  const x = clamp(p[0], b.x - b.w / 2, b.x + b.w / 2), z = clamp(p[2], b.z - b.d / 2, b.z + b.d / 2);
  return [x, clamp(p[1] + 6, b.y0 + 3, b.top - 1), z];
}
function addLabel(k, steps, times, life, tail) {
  const el = document.createElement('div'); el.className = 'lab'; document.body.appendChild(el);
  labels.push({el, k, t0: T, steps, times, life, tail, step: -1, anchor: anchorOf(k)});
  while (labels.length > 6) labels.shift().el.remove();
}

/* ---------- scanning ---------- */
let proofs = 0, blocked = 0;
const pending = [];
function prove(k) {
  if (proofData[k] >= 0) return;
  const b = B[k];
  proofData[k] = T;
  gl.bindTexture(gl.TEXTURE_2D, proofTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, k % 1024, (k / 1024) | 0, 1, 1, gl.RED, gl.FLOAT, new Float32Array([T]));
  proofs++; $('pc').textContent = proofs;
  if (nBeam >= MAXBEAM) { beams.copyWithin(0, 4); nBeam--; }
  beams.set([b.x, b.top, b.z, T], nBeam * 4); nBeam++;
  gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, beams.subarray(0, nBeam * 4));
}
function scan(k) {
  const [pr, cve, name] = detOf(k);
  addLabel(k, STEPS_SCAN, [0, .4, .8, 1.2], 5.5, [ipOf(k), `${cve} · ${name}`]);
  pending.push([k, T + 1.2, pr, cve, name]);
  audio.ping(0);
}
function pick(px, py) {
  const r = cv.getBoundingClientRect();
  const nx = (px - r.left) / r.width * 2 - 1, ny = 1 - (py - r.top) / r.height * 2;
  const right = norm(cross(cam.fwd, [0, 1, 0])), up = cross(right, cam.fwd), th = Math.tan(FOV / 2);
  const d = norm(add(cam.fwd, add(mul(right, nx * th * (r.width / r.height)), mul(up, ny * th))));
  for (let t = 0; t < 900; t += .6) {
    const p = add(cam.pos, mul(d, t)); if (p[1] < 0) return -1;
    const k = insideB(p, 0); if (k >= 0) return k;
  }
  return -1;
}
function bestAhead(dMin, dMax, minDot) {
  let best = -1, bs = -1;
  for (let k = 0; k < B.length; k++) {
    const b = B[k]; if (proofData[k] >= 0 || k === NW.spire) continue;
    const a = anchorOf(k), v = sub(a, cam.pos), d = Hyp(v); if (d < dMin || d > dMax) continue;
    const c = dot(norm(v), cam.fwd); if (c < minDot) continue;
    const s = c * 2 - d / dMax + rnd() * .3; if (s > bs) { bs = s; best = k; }
  }
  return best;
}

/* ---------- intrusion ---------- */
let atk = null;
function launchAttack(k) {
  if (k == null || k < 0) k = bestAhead(40, 400, .9);
  if (k < 0 || atk) return;
  const b = B[k], d = [];
  for (let n = 0; n < 46; n++) {
    const a = rnd() * Math.PI * 2, R = 800 + rnd() * 300, src = [Math.cos(a) * R, 80 + rnd() * 200, Math.sin(a) * R];
    const dist = Math.hypot(src[0] - b.x, src[2] - b.z), dur = 2.4 + rnd() * 1.7, delay = rnd() * 1.1;
    d.push(...src, b.x, b.top + .3, b.z, 1 / dur, delay / dur, 5, dist * .15);
  }
  const sp = B[NW.spire];
  for (let n = 0; n < 16; n++) { const dur = .8 + rnd() * .4, delay = 3.3 + rnd() * 1.1; d.push(sp.x, sp.top, sp.z, b.x, b.top + .3, b.z, 1 / dur, delay / dur, 0, Math.max(20, Hyp([b.x - sp.x, 0, b.z - sp.z]) * .25)); }
  nAtk = d.length / 10;
  gl.bindBuffer(gl.ARRAY_BUFFER, atkBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(d));
  atk = {k, t0: T, stage: 0};
  audio.whoosh();
}
function updateAttack() {
  if (!atk) return;
  const a = T - atk.t0;
  if (atk.stage === 0 && a >= 1.2) { atk.stage = 1; addLabel(atk.k, STEPS_ATK, [0, .8, 1.8, 3.4], 7.5, [ipOf(atk.k), 'quarantined by core']); audio.alarm(); }
  if (atk.stage === 1 && a >= 4.6) { atk.stage = 2; prove(atk.k); blocked++; $('ic').textContent = blocked; audio.ping(3); }
  if (a > 9.5) atk = null;
}

/* ---------- audio: synthesized rain, drone, chimes ---------- */
const audio = (() => {
  let ctx = null, master, delay, on = false;
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 4; lp.connect(master);
    [55, 82.41, 110.5].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 7; const g = ctx.createGain(); g.gain.value = .035; o.connect(g).connect(lp); o.start(); });
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = nb.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const rg = ctx.createGain(); rg.gain.value = .05; ns.connect(hp).connect(rg).connect(master);
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 180;
    const tg = ctx.createGain(); tg.gain.value = .05; ns.connect(bp).connect(tg).connect(master); ns.start();
    delay = ctx.createDelay(); delay.delayTime.value = .32; const fb = ctx.createGain(); fb.gain.value = .35; const wet = ctx.createGain(); wet.gain.value = .45;
    delay.connect(fb).connect(delay); delay.connect(wet).connect(master);
  }
  function tone(f, t, len, vol, type, glide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (glide || 1.5), t + len * .4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    o.connect(g); g.connect(master); g.connect(delay); o.start(t); o.stop(t + len + .05);
  }
  const NOTES = [392, 440, 523.25, 587.33];
  const ok = () => on && ctx;
  return {
    toggle() { if (!ctx) init(); on = !on; if (on) ctx.resume(); master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(on ? .6 : 0, ctx.currentTime + .6); return on; },
    ping(level) { if (!ok()) return; const t = ctx.currentTime; if (level < 3) tone(NOTES[level], t, .35, .07); else { tone(523.25, t, 1.2, .06); tone(783.99, t + .06, 1.4, .045); tone(1046.5, t + .12, 1.6, .03, 'triangle'); } },
    alarm() { if (!ok()) return; const t = ctx.currentTime; for (let i = 0; i < 6; i++) tone(i % 2 ? 233 : 311, t + i * .28, .26, .03, 'square', 1.01); },
    whoosh() { if (!ok()) return; tone(90, ctx.currentTime, 2.4, .05, 'sawtooth', .6); },
  };
})();

/* ---------- input ---------- */
let rainOn = !Q.has('dry'), rain = rainOn ? 1 : 0;
bm.onclick = () => cam.mode === 'tour' ? toFree() : toTour();
bs.onclick = () => { const on = audio.toggle(); bs.textContent = 'sound: ' + (on ? 'on' : 'off'); bs.classList.toggle('on', on); };
ba.onclick = () => launchAttack(cam.mode === 'free' ? pick(innerWidth / 2, innerHeight / 2) : -1);
addEventListener('keydown', e => {
  if (e.code === 'KeyC') return toTour();
  if (e.code === 'KeyH') return document.body.classList.toggle('hidehud');
  if (e.code === 'KeyM') return bs.onclick();
  if (e.code === 'KeyX') return ba.onclick();
  if (e.code === 'KeyR') { rainOn = !rainOn; return; }
  if (/^(Key[WASDQE]|Arrow|Space|Shift|Control)/.test(e.code)) { if (!/Shift|Control/.test(e.code)) toFree(); keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const ptrs = new Map(); let drag = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); drag = {x: e.clientX, y: e.clientY, moved: false}; if (ptrs.size >= 2) { toFree(); touchFwd = true; } });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !drag) return;
  const [px, py] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) { drag.moved = true; toFree(); }
  if (drag.moved && ptrs.size === 1) { cam.yaw += (e.clientX - px) * .0032; cam.pitch = clamp(cam.pitch - (e.clientY - py) * .0032, -1.45, 1.45); }
});
const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) touchFwd = false; if (drag && !drag.moved && ptrs.size === 0) { const k = pick(e.clientX, e.clientY); if (k >= 0) scan(k); } if (ptrs.size === 0) drag = null; };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); touchFwd = false; drag = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); cam.speed = clamp(cam.speed * (e.deltaY > 0 ? .9 : 1.1), .2, 8); }, {passive: false});

/* ---------- render ---------- */
const FOV = 1.0;
let T = Q.has('t') ? +Q.get('t') : 0;
const PAL = new Float32Array([.2, 1, .07, 0, .85, 1, 1, .12, .5, .55, .18, 1, 1, .42, .06, 1, .05, .12]);
let lead = [0, 0, 0, 0];
function common(p, vp, low) {
  gl.useProgram(p.p);
  gl.uniformMatrix4fv(p.u('uVP'), false, vp); gl.uniform3fv(p.u('uCam'), cam.pos);
  gl.uniform1f(p.u('uT'), T); gl.uniform1f(p.u('uRain'), rain); gl.uniform1f(p.u('uWet'), .55 + .45 * rain); gl.uniform1f(p.u('uLow'), low ? 1 : 0);
  gl.uniform3fv(p.u('uPal'), PAL);
  gl.uniform1f(p.u('uAlertId'), atk ? atk.k : -9); gl.uniform1f(p.u('uAlertAge'), atk ? T - atk.t0 : 0);
}
function drawScene(vp, mirror) {
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE); gl.frontFace(mirror ? gl.CW : gl.CCW);
  gl.bindVertexArray(vaoB); common(P.BLD, vp, mirror);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, proofTex); gl.uniform1i(P.BLD.u('uProof'), 0);
  gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, NBOX);
  gl.bindVertexArray(vaoC); common(P.CAR, vp, mirror); gl.uniform4fv(P.CAR.u('uLead'), lead);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, carV.length / 7, NCAR);
  gl.disable(gl.CULL_FACE); gl.frontFace(gl.CCW);
  gl.bindVertexArray(vaoS); common(P.SIGN, vp, mirror);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(P.SIGN.u('uAtlas'), 0);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, NSIGN);
}
function drawAdditive(vp) {
  gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
  gl.bindVertexArray(vaoPool); common(P.POOL, vp); gl.uniform4fv(P.POOL.u('uLead'), lead); gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, NCAR);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.bindVertexArray(vaoK); common(P.CONE, vp); gl.drawArraysInstanced(gl.TRIANGLES, 0, 120, NCONE);
  if (atk) { gl.bindVertexArray(vaoA); common(P.ATK, vp); gl.uniform1f(P.ATK.u('uAge'), T - atk.t0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nAtk); }
  if (nBeam) { gl.bindVertexArray(vaoBm); common(P.BEAM, vp); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nBeam); }
  if (rain > .01) { gl.bindVertexArray(empty); common(P.RAIN, vp); gl.drawArraysInstanced(gl.LINES, 0, 2, 3500); }
  gl.depthMask(true); gl.disable(gl.BLEND);
}
function pass(p, out, tex, set) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.f : null); gl.viewport(0, 0, out ? out.w : W, out ? out.h : H);
  gl.useProgram(p.p); tex.forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.u(name), i); });
  set && set(p); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
const FOGC = [.032, .026, .034];
function render() {
  const up = [Math.sin(cam.roll), Math.cos(cam.roll), 0];
  const proj = persp(FOV, W / H, .15, 5000), view = look(cam.pos, add(cam.pos, cam.fwd), [0, 1, 0]), vp = mm(proj, view);
  // 1. mirrored city at half resolution, mipmapped: the wet-street reflection
  gl.bindFramebuffer(gl.FRAMEBUFFER, FB.m.f); gl.viewport(0, 0, FB.m.w, FB.m.h);
  gl.clearColor(FOGC[0] * .7, FOGC[1] * .7, FOGC[2] * .7, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawScene(mm(vp, MIRROR), true);
  gl.bindTexture(gl.TEXTURE_2D, FB.m.t); gl.generateMipmap(gl.TEXTURE_2D);
  // 2. the scene, multisampled when available
  const tgt = FB.ms || FB.s;
  gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.f); gl.viewport(0, 0, W, H);
  gl.clearColor(FOGC[0], FOGC[1], FOGC[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(empty); common(P.SKY, vp); gl.uniformMatrix4fv(P.SKY.u('uInv'), false, inv(vp)); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST);
  gl.bindVertexArray(vaoG); common(P.GROUND, vp);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, FB.m.t); gl.uniform1i(P.GROUND.u('uRefl'), 0); gl.uniform2f(P.GROUND.u('uRes'), W, H);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  drawScene(vp, false);
  drawAdditive(vp);
  gl.disable(gl.DEPTH_TEST);
  if (FB.ms) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, FB.ms.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, FB.s.f);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  // 3. bloom chain and grade
  gl.bindVertexArray(empty);
  pass(P.BRIGHT, FB.a1, [['uTex', FB.s.t]], p => { gl.uniform2f(p.u('uTx'), 1 / W, 1 / H); gl.uniform1f(p.u('uThr'), HDR ? 1. : .6); });
  pass(P.BLUR, FB.a2, [['uTex', FB.a1.t]], p => gl.uniform2f(p.u('uDir'), 1 / FB.a1.w, 0));
  pass(P.BLUR, FB.a1, [['uTex', FB.a2.t]], p => gl.uniform2f(p.u('uDir'), 0, 1 / FB.a1.h));
  pass(P.BRIGHT, FB.b1, [['uTex', FB.a1.t]], p => { gl.uniform2f(p.u('uTx'), 1 / FB.a1.w, 1 / FB.a1.h); gl.uniform1f(p.u('uThr'), 0); });
  pass(P.BLUR, FB.b2, [['uTex', FB.b1.t]], p => gl.uniform2f(p.u('uDir'), 1.5 / FB.b1.w, 0));
  pass(P.BLUR, FB.b1, [['uTex', FB.b2.t]], p => gl.uniform2f(p.u('uDir'), 0, 1.5 / FB.b1.h));
  pass(P.BRIGHT, FB.c1, [['uTex', FB.b1.t]], p => { gl.uniform2f(p.u('uTx'), 1 / FB.b1.w, 1 / FB.b1.h); gl.uniform1f(p.u('uThr'), 0); });
  pass(P.BLUR, FB.c2, [['uTex', FB.c1.t]], p => gl.uniform2f(p.u('uDir'), 2 / FB.c1.w, 0));
  pass(P.BLUR, FB.c1, [['uTex', FB.c2.t]], p => gl.uniform2f(p.u('uDir'), 0, 2 / FB.c1.h));
  const aAge = atk ? T - atk.t0 : 0, alarm = atk && aAge > 1.2 && aAge < 4.6 ? .5 + .5 * Math.sin(aAge * 9) : 0;
  pass(P.COMP, null, [['uS', FB.s.t], ['uB1', FB.a1.t], ['uB2', FB.b1.t], ['uB3', FB.c1.t]], p => {
    gl.uniform1f(p.u('uT'), T); gl.uniform1f(p.u('uGrain'), CAPTURE ? 0 : 1); gl.uniform1f(p.u('uAlarm'), alarm); gl.uniform1f(p.u('uExpo'), 1.15);
    gl.uniform3fv(p.u('uPal'), PAL);
  });
  return vp;
}
function updateLabels(vp) {
  const r = cv.getBoundingClientRect();
  for (let n = labels.length - 1; n >= 0; n--) {
    const L = labels[n], age = T - L.t0;
    if (age > L.life) { L.el.remove(); labels.splice(n, 1); continue; }
    let step = 0; while (step < 3 && age >= L.times[step + 1]) step++;
    if (step !== L.step) {
      const [lv, name, cls] = L.steps[step];
      L.el.className = 'lab ' + cls; L.el.innerHTML = `<i>${lv}</i>${esc(name)}<s>${esc(step === 3 ? L.tail[1] : L.tail[0])}</s>`;
      if (step > 0 && L.steps === STEPS_SCAN) audio.ping(step);
      L.step = step;
    }
    const p = L.anchor;
    const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (cw <= .1) { L.el.style.opacity = 0; continue; }
    const sx = clamp((cx / cw * .5 + .5) * r.width, 120, r.width - 120), sy = clamp((1 - (cy / cw * .5 + .5)) * r.height, 70, r.height - 30);
    L.el.style.opacity = Math.min(1, (L.life - age) * 1.5);
    L.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-130%)`;
  }
}
let nextAuto = 4, nextAttack = CAPTURE ? Infinity : 14;
function step(dt) {
  T += dt; updateCam(dt);
  rain += ((rainOn ? 1 : 0) - rain) * Math.min(1, dt * 1.5);
  // lead car: 24 m ahead of the camera while the tour is at street level
  if (cam.mode === 'tour') { const p = pathAt(cam.s + 24); lead = [p[0], p[2], p[1] < 4 && cam.pos[1] < 4 ? 1 : 0, 0]; } else lead = [0, 0, 0, 0];
  for (let n = pending.length - 1; n >= 0; n--) {
    const [k, at, pr, cve, name] = pending[n]; if (T < at) continue;
    pending.splice(n, 1); prove(k);
    $('lm').innerHTML = `last match <a href="https://github.com/projectdiscovery/nuclei-templates/pull/${Number(pr) | 0}" target="_blank" rel="noopener">${esc(cve)} · ${esc(name)} ↗</a>`;
  }
  if (cam.mode === 'tour' && T > nextAuto) { const k = bestAhead(20, 160, .86); if (k >= 0) scan(k); nextAuto = T + 2.6 + rnd() * 2; }
  if (cam.mode === 'tour' && T > nextAttack && !atk) { launchAttack(-1); nextAttack = T + 24 + rnd() * 10; }
  updateAttack();
  updateLabels(render());
}
let last = performance.now(), acc = 0, frames = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  step(dt);
  acc += dt; frames++;
  if (acc > 2) {
    const avg = acc / frames; acc = 0; frames = 0;
    if (avg > 1 / 34 && scale > .45) { scale = Math.max(.45, scale - .12); resize(); }
    else if (avg < 1 / 57 && scale < 1) { scale = Math.min(1, scale + .08); resize(); }
  }
  requestAnimationFrame(frame);
}
$('hc').textContent = B.length.toLocaleString('en');
window.__nw = {step, seek: s => { cam.s = s; }, pathLen: PATHLEN, path: pathAt, attack: launchAttack, scan, inside: (x, y, z) => insideB([x, y, z], .8),
  pose: () => ({pos: cam.pos, fwd: cam.fwd, s: cam.s}), stats: () => ({boxes: NBOX, cars: NCAR, signs: NSIGN, cones: NCONE, buildings: B.length, msaa: !!FB.ms, hdr: HDR})};
if (CAPTURE) step(0); else requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
})();
