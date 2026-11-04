// GuroGabay sheet reader, pure JavaScript (no native modules, works in Expo Go).
// readSheet(gray, width, height, layouts) -> { n, answers, studentId, reviewUri }
// Steps: even out lighting -> find side stripes -> sheet size and orientation
//        -> homography (photo -> sheet) -> measure bubble darkness.

const S = 3;            // sampling pixels per point on the straightened sheet
const FILLED = 0.33;    // share of dark pixels that counts as a filled bubble
const THR = 130;        // darker than this (after lighting fix) counts as ink when finding stripes
const AREA = 0.75;      // how rectangle-like a stripe must be
const SIZES = { 25: [30, 15], 30: [60, 20], 35: [100, 25] }; // stripes per side -> [questions, rows]
const RS = 1.1;         // pixels per point in the review picture

export class ScanError extends Error {
  constructor(m) { super(m); this.name = 'ScanError'; }
}

// ---------- lighting normalisation ----------
function slide(src, dst, off, stride, len, r, isMax, dq) {
  let head = 0, tail = 0, next = 0;
  for (let i = 0; i < len; i++) {
    const hi = Math.min(len - 1, i + r);
    while (next <= hi) {
      const v = src[off + next * stride];
      while (tail > head) {
        const b = src[off + dq[tail - 1] * stride];
        if (isMax ? b <= v : b >= v) tail--; else break;
      }
      dq[tail++] = next; next++;
    }
    while (dq[head] < i - r) head++;
    dst[off + i * stride] = src[off + dq[head] * stride];
  }
}
function morph(src, w, h, r, isMax) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), dq = new Int32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) slide(src, tmp, y * w, 1, w, r, isMax, dq);
  for (let x = 0; x < w; x++) slide(tmp, out, x, w, h, r, isMax, dq);
  return out;
}
function boxBlur(a, w, h, r) {
  const line = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; line[0] = 0;
    for (let i = 0; i < w; i++) line[i + 1] = line[i] + a[o + i];
    for (let i = 0; i < w; i++) { const lo = Math.max(0, i - r), hi = Math.min(w - 1, i + r); a[o + i] = (line[hi + 1] - line[lo]) / (hi - lo + 1); }
  }
  for (let x = 0; x < w; x++) {
    line[0] = 0;
    for (let i = 0; i < h; i++) line[i + 1] = line[i] + a[i * w + x];
    for (let i = 0; i < h; i++) { const lo = Math.max(0, i - r), hi = Math.min(h - 1, i + r); a[i * w + x] = (line[hi + 1] - line[lo]) / (hi - lo + 1); }
  }
}
function normalize(gray, w, h) {
  const k = (Math.floor(0.02 * Math.max(w, h))) | 1, r = (k - 1) >> 1;
  const closed = morph(morph(gray, w, h, r, true), w, h, r, false);
  const bg = Float32Array.from(closed);
  for (let i = 0; i < 3; i++) boxBlur(bg, w, h, r);
  const norm = new Uint8Array(w * h);
  for (let i = 0; i < norm.length; i++) {
    const v = (gray[i] / Math.max(bg[i], 1)) * 255;
    norm[i] = v > 255 ? 255 : v;
  }
  return norm;
}

// ---------- stripe finding ----------
function candidates(norm, w, h) {
  const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n), out = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (norm[p0] >= THR || seen[p0]) continue;
    let sp = 0, cnt = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack[sp++] = p0; seen[p0] = 1;
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
      cnt++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!seen[q] && norm[q] < THR) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if (cnt < 12) continue;
    const mx = sx / cnt, my = sy / cnt;
    const cxx = sxx / cnt - mx * mx + 1 / 12, cyy = syy / cnt - my * my + 1 / 12, cxy = sxy / cnt - mx * my;
    const m = (cxx + cyy) / 2, d = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const hi = Math.sqrt(12 * (m + d)), lo = Math.sqrt(12 * Math.max(m - d, 1e-6));
    if (lo < 0.0024 * h || lo > 0.015 * h || hi > 0.05 * h || hi < 1.5 * lo || hi > 8 * lo) continue;
    if (cnt < AREA * lo * hi) continue;
    out.push([mx, my]);
  }
  return out;
}
function fitLine(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x0: mx, y0: my, vx: Math.cos(ang), vy: Math.sin(ang) };
}
// Picks the straight line with the most candidate stripes on it (robust to stray marks).
function side(cands, w, left) {
  const p = cands.filter((c) => (left ? c[0] < 0.3 * w : c[0] > 0.7 * w));
  if (p.length < 8) return p;
  const tol = 0.012 * w;
  const near = (l, c) => Math.abs((c[0] - l.x0) * l.vy - (c[1] - l.y0) * l.vx) < tol;
  let best = null, bestN = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1], len = Math.hypot(dx, dy);
    if (len < 100) continue;
    const l = { x0: p[i][0], y0: p[i][1], vx: dx / len, vy: dy / len };
    let n = 0;
    for (const c of p) if (near(l, c)) n++;
    if (n > bestN) { bestN = n; best = l; }
  }
  if (!best) return [];
  let keep = p.filter((c) => near(best, c));
  for (let k = 0; k < 2 && keep.length >= 8; k++) {
    const l = fitLine(keep);
    keep = p.filter((c) => Math.abs((c[0] - l.x0) * l.vy - (c[1] - l.y0) * l.vx) < tol);
  }
  return keep.sort((a, b) => a[1] - b[1]);
}

// A stray dark blob at the very top or bottom of a side can look like a stripe, so allow
// dropping up to two end stripes from either side. Returns every valid pairing, cheapest first.
function pairs(L, R) {
  const variants = (p) => {
    const out = [];
    for (let i = 0; i <= 2; i++) for (let j = 0; i + j <= 2; j++) {
      const q = p.slice(i, p.length - j);
      if (SIZES[q.length]) out.push({ q, cost: i + j });
    }
    return out;
  };
  const all = [];
  for (const a of variants(L)) for (const b of variants(R)) if (a.q.length === b.q.length) all.push({ pair: [a.q, b.q], cost: a.cost + b.cost });
  return all.sort((x, y) => x.cost - y.cost).map((x) => x.pair);
}

// ---------- homography ----------
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
function norm2d(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - cx, p[1] - cy);
  d /= pts.length;
  const s = Math.SQRT2 / d;
  return { T: [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]], pts: pts.map((p) => [(p[0] - cx) * s, (p[1] - cy) * s]) };
}
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = [].concat(...m);
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
          [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
          [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
}
function homography(src, dst) {
  const a = norm2d(src), b = norm2d(dst);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  for (let k = 0; k < src.length; k++) {
    const [x, y] = a.pts[k], [u, v] = b.pts[k];
    for (const [row, t] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]]) {
      for (let i = 0; i < 8; i++) { Atb[i] += row[i] * t; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; }
    }
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const Ti = inv3(b.T);
  return Ti ? mul(mul(Ti, Hn), a.T) : null;
}
const apply = (H, x, y) => { const z = H[2][0] * x + H[2][1] * y + H[2][2]; return [(H[0][0] * x + H[0][1] * y + H[0][2]) / z, (H[1][0] * x + H[1][1] * y + H[1][2]) / z]; };

// ---------- reading ----------
function sample(img, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 255;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (img[i] * (1 - fx) + img[i + 1] * fx) * (1 - fy) + (img[i + w] * (1 - fx) + img[i + w + 1] * fx) * fy;
}
function classify(fr) {
  const on = [];
  fr.forEach((f, i) => { if (f > FILLED) on.push(i); });
  if (on.length === 1) return ['ok', on];
  if (on.length > 1) return ['multiple', on];
  return [Math.max(...fr) > 0.2 ? 'faint' : 'blank', []];
}

function align(L, R, layouts) {
  const [n, rows] = SIZES[L.length];
  let gi = 0, gmax = -1;
  for (let i = 0; i < L.length - 1; i++) { const g = L[i + 1][1] - L[i][1]; if (g > gmax) { gmax = g; gi = i; } }
  let sl, sr;
  if (gi === 9) { sl = L; sr = R; }
  else if (gi === rows - 1) { sl = R.slice().reverse(); sr = L.slice().reverse(); }
  else return 'Could not tell which way up the sheet is.';
  const lay = layouts[n];
  const dst = lay.marks.left.concat(lay.marks.right).map((m) => [(m.x + m.len / 2) * S, m.y * S]);
  const src = sl.concat(sr);
  const H = homography(src, dst);
  if (!H) return 'Stripes do not line up with the sheet layout.';
  let good = 0;
  src.forEach((p, i) => { const q = apply(H, p[0], p[1]); if (Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]) < 4) good++; });
  if (good < 0.8 * dst.length) return 'Stripes do not line up with the sheet layout.';
  return { n, lay, H };
}

export function readSheet(gray, w, h, layouts, isNorm) {
  const norm = isNorm ? gray : normalize(gray, w, h);
  const cands = candidates(norm, w, h);
  const L0 = side(cands, w, true), R0 = side(cands, w, false);
  const fail = (m) => { const e = new ScanError(m); e.dbg = { norm, w, h, cands, L0, R0 }; return e; };
  const options = pairs(L0, R0);
  if (!options.length) {
    throw fail(`Could not see all the side stripes (left ${L0.length}, right ${R0.length}). Fit the whole sheet in view.`);
  }
  let found = null, why = '';
  for (const [L, R] of options) {
    const r = align(L, R, layouts);
    if (typeof r === 'string') why = why || r; else { found = r; break; }
  }
  if (!found) throw fail(why);
  const { n, lay, H } = found;
  const Hi = inv3(H);

  const fill = (x, y, r) => {
    const cx = Math.floor(x * S), cy = Math.floor(y * S), rr = Math.floor(r * S * 0.7);
    let dark = 0, tot = 0;
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy > rr * rr) continue;
      const p = apply(Hi, cx + dx, cy + dy);
      if (sample(norm, w, h, p[0], p[1]) < 140) dark++;
      tot++;
    }
    return dark / tot;
  };
  const a = lay.answers, per = {};
  for (const b of a.bubbles) (per[b.q] = per[b.q] || {})[b.choice] = [b.x, b.y];
  const answers = [];
  for (let q = 1; q <= n; q++) {
    const fr = a.choices.map((c) => fill(per[q][c][0], per[q][c][1], a.radius));
    const [status, on] = classify(fr);
    answers.push({ q, status, choice: on.map((k) => a.choices[k]) });
  }
  const id = lay.id; let studentId = '';
  for (let j = 0; j < id.cols; j++) {
    const fr = [];
    for (let d = 0; d < 10; d++) fr.push(fill(id.x0 + j * id.pitchX, id.y0 + d * id.pitchY, id.radius));
    const [st, on] = classify(fr);
    if (st === 'ok') studentId += on[0]; else if (st !== 'blank') studentId += '?';
  }
  return { n, answers, studentId, reviewUri: reviewImage(norm, w, h, Hi, lay, answers, per) };
}

// ---------- review picture (straightened sheet with rings), as a PNG data URI ----------
function reviewImage(norm, w, h, Hi, lay, answers, per) {
  const pw = Math.round(lay.page[0] * RS), ph = Math.round(lay.page[1] * RS);
  const px = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const p = apply(Hi, (x / RS) * S, (y / RS) * S);
    px[y * pw + x] = Math.min(250, (sample(norm, w, h, p[0], p[1]) * 250) / 255);
  }
  const ring = (cx, cy, rad, idx) => {
    const c = Math.round(cx * RS), d = Math.round(cy * RS), R = rad * RS;
    for (let y = Math.floor(d - R - 2); y <= d + R + 2; y++) for (let x = Math.floor(c - R - 2); x <= c + R + 2; x++) {
      if (x < 0 || y < 0 || x >= pw || y >= ph) continue;
      const dist = Math.hypot(x - c, y - d);
      if (dist >= R - 1 && dist <= R + 1) px[y * pw + x] = idx;
    }
  };
  return 'data:image/png;base64,' + toBase64(pngIndexed(px, pw, ph));
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngIndexed(px, w, h) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const blocks = Math.ceil(raw.length / 65535), z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0; z[o++] = 0x78; z[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const s = i * 65535, len = Math.min(65535, raw.length - s);
    z[o++] = i === blocks - 1 ? 1 : 0; z[o++] = len & 255; z[o++] = len >> 8; z[o++] = ~len & 255; z[o++] = (~len >> 8) & 255;
    z.set(raw.subarray(s, s + len), o); o += len;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const ad = ((b << 16) | a) >>> 0; z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
  const pal = new Uint8Array(768);
  for (let i = 0; i <= 250; i++) { const g = Math.round((i * 255) / 250); pal[i * 3] = pal[i * 3 + 1] = pal[i * 3 + 2] = g; }
  pal.set([0, 170, 0], 252 * 3); pal.set([230, 0, 0], 253 * 3);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 3;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', pal), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const res = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let q = 0;
  for (const p of parts) { res.set(p, q); q += p.length; }
  return res;
}

// ---------- helpers ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(b) {
  const out = [];
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out.push(B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '='));
  }
  return out.join('');
}
export function fromBase64(s) {
  const lut = new Uint8Array(128); for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9+/]/g, ''), n = Math.floor((clean.length * 3) / 4), out = new Uint8Array(n);
  for (let i = 0, o = 0; i < clean.length; i += 4) {
    const v = (lut[clean.charCodeAt(i)] << 18) | (lut[clean.charCodeAt(i + 1)] << 12) | (lut[clean.charCodeAt(i + 2)] << 6) | lut[clean.charCodeAt(i + 3)];
    if (o < n) out[o++] = v >> 16; if (o < n) out[o++] = (v >> 8) & 255; if (o < n) out[o++] = v & 255;
  }
  return out;
}
export function rgbaToGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return g;
}
export function rotateGray(g, w, h, cw) {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[cw ? x * h + (h - 1 - y) : (w - 1 - x) * h + y] = g[y * w + x];
  return { gray: o, w: h, h: w };
}
// Draws the failed photo with boxes: green = stripes found on the sheet edges, red = other dark marks.
function debugImage({ norm, w, h, cands, L0, R0 }) {
  const sc = Math.min(1, 560 / w), pw = Math.max(2, Math.round(w * sc)), ph = Math.max(2, Math.round(h * sc));
  const px = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.floor(y / sc)) * w;
    for (let x = 0; x < pw; x++) px[y * pw + x] = Math.min(250, (norm[sy + Math.min(w - 1, Math.floor(x / sc))] * 250) / 255);
  }
  const box = (c, r, idx) => {
    const cx = Math.round(c[0] * sc), cy = Math.round(c[1] * sc);
    for (let d = -r; d <= r; d++) {
      for (const [x, y] of [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]]) {
        if (x >= 0 && y >= 0 && x < pw && y < ph) px[y * pw + x] = idx;
      }
    }
  };
  const r = Math.max(4, Math.round(0.014 * h * sc));
  for (const c of cands) box(c, r, 253);
  for (const c of L0.concat(R0)) box(c, r + 1, 252);
  return { uri: 'data:image/png;base64,' + toBase64(pngIndexed(px, pw, ph)), ratio: pw / ph };
}
// Tries the photo as is, then turned a quarter turn each way (phones can save photos sideways).
// The lighting fix is the slow part and does not depend on rotation, so it runs once.
export function readPhoto(gray, w, h, layouts) {
  const norm = normalize(gray, w, h);
  const tries = w > h ? ['cw', 'ccw', 'none'] : ['none', 'cw', 'ccw'];
  let best = null;
  for (const t of tries) {
    const im = t === 'none' ? { gray: norm, w, h } : rotateGray(norm, w, h, t === 'cw');
    try { return readSheet(im.gray, im.w, im.h, layouts, true); }
    catch (e) {
      if (!(e instanceof ScanError)) throw e;
      const sc = e.dbg ? Math.min(e.dbg.L0.length, e.dbg.R0.length) : -1;
      if (!best || sc > best.sc) best = { e, sc };
    }
  }
  const e = best.e;
  if (e.dbg) {
    try { const d = debugImage(e.dbg); e.debugUri = d.uri; e.debugRatio = d.ratio; } catch (_) { /* picture is optional */ }
    delete e.dbg;
  }
  throw e;
}
// Digits marked in the ID grid, blank columns skipped. '?' means a column was unclear.
export const cleanId = (s) => s;
export function grade(answers, key) {
  let score = 0; const review = [];
  answers.forEach((a, i) => {
    if (a.status === 'ok') { if (a.choice[0] === key[i]) score++; }
    else review.push(a.q);
  });
  return { score, review };
}
