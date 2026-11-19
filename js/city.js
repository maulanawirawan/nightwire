// nightwire: procedural city in metres. 10 x 10 blocks, 100 m pitch, streets every 100 m.
(() => {
const NW = window.NW = window.NW || {};
let seed = 20261119;
const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
NW.rnd = rnd;
const HALF = 500, PITCH = 100, EDGE = 10;

/* ---------- neon text atlas: R = tube core, G = glow ---------- */
const HW = ['HOTEL', 'KOPI', 'RAMEN', 'BAR', '24H', 'SECAI', 'WARUNG', 'APOTEK', 'KARAOKE', 'NETJAGA', 'PROOF', 'OPEN', 'NOODLE', 'LAUNDRY',
  'CYBER', 'PHO', 'SUSHI', 'MOTEL', 'DIMSUM', 'NASI GORENG', 'CLUB', 'TATTOO', 'BAKSO', 'SATE', 'MARTABAK', 'PIJAT', 'ES TEH', 'LIVE MUSIC',
  'CAFE', 'BEER', 'HOSTEL', 'PULSA', 'SERVIS HP', 'KOPI SUSU', 'ARCADE', 'GADAI', 'BENGKEL', 'ラーメン', 'カラオケ', 'L3 VERIFIED'];
const VW = ['HOTEL', 'KOPI', 'BAR', 'RAMEN', 'SUSHI', 'CLUB', 'SATE', 'PIJAT', 'MOTEL', 'CAFE', 'SECAI', 'BAKSO', 'OPEN', '24H', '酒場', 'ホテル'];
const atlas = document.createElement('canvas');
atlas.width = 2048; atlas.height = 2048;
const g = atlas.getContext('2d');
g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048);
g.globalCompositeOperation = 'lighter';
g.textAlign = 'center'; g.textBaseline = 'middle';
const FONT = '"Arial Narrow","Helvetica Neue",Arial,"Yu Gothic","Hiragino Sans","Noto Sans CJK JP",Meiryo,sans-serif';
function tube(txt, x, y) {
  g.shadowColor = 'rgb(0,255,0)'; g.shadowBlur = 26; g.fillStyle = 'rgb(0,150,0)'; g.fillText(txt, x, y);
  g.shadowBlur = 10; g.fillStyle = 'rgb(0,255,0)'; g.fillText(txt, x, y);
  g.shadowBlur = 0; g.fillStyle = 'rgb(255,0,0)'; g.fillText(txt, x, y);
}
const RH = [], RV = [];
HW.forEach((w, i) => {
  const cx = (i % 4) * 512, cy = Math.floor(i / 4) * 128;
  g.font = 'bold 76px ' + FONT;
  const tw = g.measureText(w).width, sc = Math.min(1, 430 / tw);
  g.save(); g.translate(cx + 256, cy + 66); g.scale(sc, 1); tube(w, 0, 0); g.restore();
  const wpx = tw * sc + 56;
  RH.push([(cx + 256 - wpx / 2) / 2048, cy / 2048, (cx + 256 + wpx / 2) / 2048, (cy + 128) / 2048, wpx / 128]);
});
VW.forEach((w, i) => {
  const chars = [...w], cx = i * 128, cy = 1280, H = chars.length * 78 + 46;
  g.font = 'bold 70px ' + FONT;
  chars.forEach((ch, k) => tube(ch, cx + 64, cy + 50 + k * 78));
  RV.push([cx / 2048, cy / 2048, (cx + 128) / 2048, (cy + H) / 2048, chars.length]);
});
NW.atlas = atlas;

/* ---------- buildings ---------- */
const B = [];              // {x,z,w,d,y0,top,mat}
const boxes = [];          // 12 floats per instance: x,y0,z,bid  w,h,d,mat  seed,bay,shop,0
const signs = [];          // 16 floats: cx,cy,cz,w  rx,rz,h,col  u0,v0,u1,v1  flick,type,u0,u1
const box = (x, y0, z, w, h, d, mat, bid, s, bay, shop) => boxes.push(x, y0, z, bid, w, h, d, mat, s, bay, shop, 0);

function addSigns(x, z, w, d, h, nx, nz) {
  const fx = x + nx * w / 2, fz = z + nz * d / 2, L = nx ? d : w;
  const rx = nz, rz = -nx;                  // reads correctly from the street
  const col = () => [0, 1, 2, 3, 2, 1, 4][rnd() * 7 | 0];
  if (rnd() < 0.62) {
    const r = RH[rnd() * RH.length | 0], hs = 0.85 + rnd() * 0.45, ws = Math.min(L * 0.72, hs * r[4]);
    const hh = ws / r[4];
    const off = (rnd() - 0.5) * (L - ws) * 0.6;
    signs.push(fx + nx * 0.07 + rx * off, 4.15 + hh / 2, fz + nz * 0.07 + rz * off, ws, rx, rz, hh, col(), r[0], r[1], r[2], r[3], rnd(), 0, r[0], r[2]);
  }
  if (h > 12 && rnd() < 0.5) {
    const r = RV[rnd() * RV.length | 0], hs = r[4] * 0.95 + 0.6, ws = 1.2;
    const off = (rnd() - 0.5) * L * 0.7;
    const y = 6.2 + rnd() * Math.max(0, Math.min(9, h - hs - 7)) + hs / 2;
    signs.push(fx + nx * (0.15 + ws / 2) + rx * off, y, fz + nz * (0.15 + ws / 2) + rz * off, ws, nx, nz, hs, col(), r[0], r[1], r[2], r[3], rnd(), 1, r[0], r[2]);
  }
}

function building(x, z, w, d, h, mat, faces, y0 = 0, shopP = 0.8) {
  const bid = B.length, s = rnd();
  const bay = mat === 0 || mat === 5 ? 1.5 : mat === 1 ? 1.8 + rnd() * 0.6 : 2.2;
  const shop = y0 === 0 && rnd() < (mat === 0 ? 0.5 : shopP) ? 1 : 0;
  let top = y0 + h;
  if (h > 70 && rnd() < 0.55 && mat !== 5) {
    const h1 = h * (0.55 + rnd() * 0.15);
    box(x, y0, z, w, h1, d, mat, bid, s, bay, shop);
    box(x, y0 + h1, z, w * 0.72, h - h1, d * 0.72, mat, bid, s, bay, 0);
  } else box(x, y0, z, w, h, d, mat, bid, s, bay, shop);
  if (h > 14) box(x + (rnd() - 0.5) * w * 0.25, top, z + (rnd() - 0.5) * d * 0.25, w * 0.28 + 2, 1.5 + rnd() * 2.5, d * 0.24 + 2, 3, -1, rnd(), 1, 0);
  if ((h > 110 && rnd() < 0.5) || mat === 5) { const ah = mat === 5 ? 34 : 8 + rnd() * 14; box(x, top, z, 0.35, ah, 0.35, 4, -1, rnd(), 1, 0); top += ah; }
  B.push({x, z, w, d, y0, top, mat});
  if (shop) for (const [nx, nz] of faces) addSigns(x, z, w, d, h, nx, nz);
  return bid;
}

const SPIRE_BLOCK = [6, 6];
for (let bi = 0; bi < 10; bi++) for (let bj = 0; bj < 10; bj++) {
  const x0 = -HALF + bi * PITCH + EDGE, x1 = x0 + 80, z0 = -HALF + bj * PITCH + EDGE, z1 = z0 + 80;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, f = Math.exp(-Math.hypot(cx, cz) / 260);
  if (bi === SPIRE_BLOCK[0] && bj === SPIRE_BLOCK[1]) {      // the core
    building(cx, cz, 80, 80, 12, 1, [[0, -1], [0, 1], [-1, 0], [1, 0]]);
    NW.spire = building(cx, cz, 38, 38, 300, 5, [], 12);
    continue;
  }
  if (f > 0.5 && rnd() < 0.6) {                              // downtown: towers on a podium
    const ph = 9 + rnd() * 7;
    building(cx, cz, 80, 80, ph, rnd() < 0.5 ? 1 : 0, [[0, -1], [0, 1], [-1, 0], [1, 0]], 0, 0.95);
    const n = 1 + (rnd() < 0.5);
    for (let k = 0; k < n; k++) {
      const tw = 26 + rnd() * 14, td = 26 + rnd() * 14;
      const ox = n === 1 ? 0 : (k ? 1 : -1) * (40 - tw / 2 - 2), oz = (rnd() - 0.5) * (80 - td - 4);
      building(cx + ox, cz + oz, tw, td, Math.min(250, 90 + rnd() * 160 * f), rnd() < 0.8 ? 0 : 1, [], ph);
    }
    continue;
  }
  const height = () => 8 + Math.pow(rnd(), 1.4) * (20 + 150 * f);
  const matFor = h => h > 45 ? (rnd() < 0.7 ? 0 : 1) : h < 22 && rnd() < 0.5 ? 2 : 1;
  for (const [zz, nz] of [[z0, -1], [z1, 1]]) {              // rows facing the north/south streets
    let x = x0;
    while (x < x1 - 4) {
      const fw = Math.min(x1 - x, 10 + rnd() * 13), dd = 18 + rnd() * 14, h = height();
      building(x + fw / 2, nz < 0 ? zz + dd / 2 : zz - dd / 2, fw - 0.3, dd, h, matFor(h), [[0, nz]]);
      x += fw;
    }
  }
  for (const [xx, nx] of [[x0, -1], [x1, 1]]) {              // rows facing the east/west streets
    let z = z0 + 32;
    while (z < z1 - 32 - 4) {
      const fw = Math.min(z1 - 32 - z, 10 + rnd() * 10), dd = 18 + rnd() * 12, h = height();
      building(xx + (nx < 0 ? dd / 2 : -dd / 2), z + fw / 2, dd, fw - 0.3, h, matFor(h), [[nx, 0]]);
      z += fw;
    }
  }
  if (f > 0.25 && rnd() < 0.5) building(cx, cz, 14, 14, 30 + rnd() * 90 * f, 0, []);
}

/* ---------- street lamps (positions must match lamps() in the shader) ---------- */
const cones = [];
const tintOf = (c, ax) => { const k = Math.floor(c / 100 + 5.5); return ax === 0 ? (((k % 3) + 3) % 3 === 1) : (((k % 4) + 4) % 4 === 2); };
for (let c = -HALF; c <= HALF; c += PITCH) for (const [sd, of] of [[-1, 0], [1, 15]]) {
  for (let a = -HALF + of; a <= HALF; a += 30) {
    if (Math.abs(a - 100 * Math.round(a / 100)) < 11) continue;
    for (const ax of [0, 1]) {
      const px = ax === 0 ? c + sd * 7.6 : a, pz = ax === 0 ? a : c + sd * 7.6;
      const hx = ax === 0 ? c + sd * 5.6 : a, hz = ax === 0 ? a : c + sd * 5.6;
      box(px, 0, pz, 0.16, 7.8, 0.16, 6, -1, 0, 1, 0);
      box((px + hx) / 2, 7.72, (pz + hz) / 2, ax === 0 ? 2.1 : 0.12, 0.1, ax === 0 ? 0.12 : 2.1, 6, -1, 0, 1, 0);
      box(hx, 7.62, hz, ax === 0 ? 0.75 : 0.32, 0.12, ax === 0 ? 0.32 : 0.75, 7, -1, 0, 1, 0);
      cones.push(hx, 7.6, hz, tintOf(c, ax) ? 1 : 0);
    }
  }
}

/* ---------- cars: moving lanes + parked along the curbs ---------- */
const cars = [];
for (let c = -HALF; c <= HALF; c += PITCH) {
  for (const ax of [0, 1]) {
    const lanes = ax === 0 ? [[c - 1.8, 1], [c + 1.8, -1]] : [[c + 1.8, 1], [c - 1.8, -1]];
    for (const [line, dir] of lanes) {
      if (ax === 0 && c === 0 && dir === 1) continue;        // the camera drives this lane
      const n = 24;
      for (let k = 0; k < n; k++) cars.push(line, ax, dir, 9 + rnd() * 6, k * 1000 / n + rnd() * 20, rnd(), 0, 0);
    }
    for (const sd of [-1, 1]) {
      let a = -HALF + 6 + rnd() * 5;
      while (a < HALF - 6) {
        if (Math.abs(a - 100 * Math.round(a / 100)) > 16 && rnd() < 0.62) cars.push(c + sd * 5.7, ax, rnd() < 0.5 ? 1 : -1, 0, a, rnd(), 1, 0);
        a += 6.4 + rnd() * 3;
      }
    }
  }
}
cars.push(0, 0, 1, 0, 0, 0.55, 2, 0);                         // the lead car the tour follows

/* ---------- spatial hash for picking and collisions ---------- */
const grid = new Map();
B.forEach((b, i) => {
  for (let x = Math.floor((b.x - b.w / 2) / 10); x <= Math.floor((b.x + b.w / 2) / 10); x++)
    for (let z = Math.floor((b.z - b.d / 2) / 10); z <= Math.floor((b.z + b.d / 2) / 10); z++) {
      const k = x + ',' + z; (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
});

NW.city = {B, boxes: new Float32Array(boxes), signs: new Float32Array(signs), cones: new Float32Array(cones), cars: new Float32Array(cars), grid, HALF};
})();
