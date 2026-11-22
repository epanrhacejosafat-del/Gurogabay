// GuroGabay sheet reader, pure JavaScript (no native modules, works in Expo Go).
// readPhoto(gray, width, height, layouts) -> { n, answers, studentId, reviewUri }
// Steps: even out lighting -> find the side stripes (any size, any rotation, some may be missing)
//        -> perspective fix: homography from sheet to photo, checked and refined on every stripe that is seen
//        -> if the stripes are too damaged, find the paper's four edges instead and fix the perspective from those
//        -> measure bubble darkness against the sheet's own empty-bubble level.

const S = 3;            // sampling pixels per point on the straightened sheet
const THRS = [130, 165, 100]; // ink thresholds tried in turn when finding stripes (after the lighting fix)
const AREA = 0.65;      // how rectangle-like a stripe must be (lower = more forgiving of blur)
// Reading is relative: a bubble counts when it is clearly darker than the empty bubbles on the same sheet.
const MARK = 0.22;      // darkness above the empty level that counts as marked (pencil is enough)
const FAINT = 0.12;     // lighter than MARK but above this = a light mark, suggested to the teacher
const DOM = 0.55;       // a second bubble only counts if it is at least this share as dark as the darkest one
const GAP = 0.3;        // if the darkest bubble beats the next by this much, the next is just an erased smudge
const STRAY = 0.3;      // dark share of the space between bubbles that counts as a mark outside the circles

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
  // The paper brightness is smooth, so it is estimated on a 1/3-size copy and scaled back up (about 9x less work).
  const k = (Math.floor(0.02 * Math.max(w, h))) | 1, r = (k - 1) >> 1;
  const f = 3, sw = Math.ceil(w / f), sh = Math.ceil(h / f), rs = Math.max(1, Math.round(r / f));
  const small = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let m = 0;
    for (let dy = 0; dy < f && y * f + dy < h; dy++) for (let dx = 0; dx < f && x * f + dx < w; dx++) {
      const v = gray[(y * f + dy) * w + x * f + dx]; if (v > m) m = v;
    }
    small[y * sw + x] = m;
  }
  const bg = Float32Array.from(morph(morph(small, sw, sh, rs, true), sw, sh, rs, false));
  for (let i = 0; i < 3; i++) boxBlur(bg, sw, sh, rs);
  const norm = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1.001, y / f), y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1.001, x / f), x0 = fx | 0, tx = fx - x0, i = y0 * sw + x0;
      const bv = (bg[i] * (1 - tx) + bg[i + 1] * tx) * (1 - ty) + (bg[i + sw] * (1 - tx) + bg[i + sw + 1] * tx) * ty;
      const v = (gray[y * w + x] / Math.max(bv, 1)) * 255;
      norm[y * w + x] = v > 255 ? 255 : v;
    }
  }
  return norm;
}

// ---------- stripe finding ----------
const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return d > Math.PI / 2 ? Math.PI - d : d; };

// Dark bar-shaped blobs. Sizes are judged against the image, not fixed numbers, so the sheet can be small or large in the frame.
function blobs(norm, w, h, thr) {
  const n = w * h, D = Math.max(w, h), seen = new Uint8Array(n), stack = new Int32Array(n), out = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (norm[p0] >= thr || seen[p0]) continue;
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
          if (!seen[q] && norm[q] < thr) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if (cnt < 10) continue;
    const mx = sx / cnt, my = sy / cnt;
    const cxx = sxx / cnt - mx * mx + 1 / 12, cyy = syy / cnt - my * my + 1 / 12, cxy = sxy / cnt - mx * my;
    const m = (cxx + cyy) / 2, d = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const hi = Math.sqrt(12 * (m + d)), lo = Math.sqrt(12 * Math.max(m - d, 1e-6));
    if (lo < 1.6 || lo > 0.03 * D || hi > 0.12 * D || hi < 1.4 * lo || hi > 14 * lo) continue;
    if (cnt < AREA * lo * hi) continue;
    out.push({ x: mx, y: my, hi, lo, ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) });
  }
  return out;
}
// The stripes are many near-identical bars. Keep the biggest family of look-alikes and drop everything else (text, smudges, edges).
function dominant(bl) {
  if (bl.length > 1500) bl = bl.sort((a, b) => b.hi * b.lo - a.hi * a.lo).slice(0, 1500);
  const same = (a, b) => { const r = b.hi / a.hi, q = b.lo / a.lo; return r > 0.5 && r < 2 && q > 0.35 && q < 2.8 && angDiff(a.ang, b.ang) < 0.6; };
  let best = null, bn = 0;
  for (const a of bl) { let k = 0; for (const b of bl) if (same(a, b)) k++; if (k > bn) { bn = k; best = a; } }
  return best ? bl.filter((b) => same(best, b)) : [];
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
// Finds the two straight rows of stripes (left and right edge of the sheet) wherever they are in the photo and however they are
// turned. Each row only needs 6 stripes to be seen, the rest may be missing.
function findLines(cs, D) {
  if (cs.length < 12) return null;
  const set = cs.length > 320 ? cs.slice(0, 320) : cs;
  let sx = 0, sy = 0;
  for (const c of cs) { sx += Math.cos(2 * c.ang); sy += Math.sin(2 * c.ang); }
  const th = 0.5 * Math.atan2(sy, sx), lx = -Math.sin(th), ly = Math.cos(th); // the rows run across the stripes
  const tol = Math.max(3, 0.009 * D), minLen = 0.12 * D;
  const dist = (l, c) => Math.abs((c.x - l.x0) * l.vy - (c.y - l.y0) * l.vx);
  const ransac = (pool, ref) => {
    let best = null, bn = 0;
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const dx = pool[j].x - pool[i].x, dy = pool[j].y - pool[i].y, len = Math.hypot(dx, dy);
      if (len < minLen) continue;
      const vx = dx / len, vy = dy / len;
      if (Math.abs(vx * lx + vy * ly) < 0.82) continue;                        // must run across the stripes (35 degrees of slack for perspective)
      if (ref && Math.abs(vx * ref.vx + vy * ref.vy) < 0.88) continue;        // second row leans at most ~28 degrees from the first (the rows converge when the phone is tilted)
      const l = { x0: pool[i].x, y0: pool[i].y, vx, vy };
      let n = 0; for (const c of pool) if (dist(l, c) < tol) n++;
      if (n > bn) { bn = n; best = l; }
    }
    return best ? { l: best, n: bn } : null;
  };
  const settle = (l, pool) => {
    let keep = pool.filter((c) => dist(l, c) < tol);
    for (let k = 0; k < 2 && keep.length >= 6; k++) { l = fitLine(keep.map((c) => [c.x, c.y])); keep = pool.filter((c) => dist(l, c) < tol); }
    return { l, pts: keep };
  };
  const r1 = ransac(set, null);
  if (!r1 || r1.n < 6) return null;
  const a = settle(r1.l, cs);
  if (a.pts.length < 6) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of a.pts) { const t = (c.x - a.l.x0) * a.l.vx + (c.y - a.l.y0) * a.l.vy; if (t < lo) lo = t; if (t > hi) hi = t; }
  const other = cs.filter((c) => dist(a.l, c) > 3 * tol);
  const r2 = ransac(other.length > 320 ? other.slice(0, 320) : other, a.l);
  if (!r2 || r2.n < 6) return null;
  const b = settle(r2.l, other);
  if (b.pts.length < 6) return null;
  const mean = (s) => ({ x: s.pts.reduce((t, c) => t + c.x, 0) / s.pts.length, y: s.pts.reduce((t, c) => t + c.y, 0) / s.pts.length });
  const ca = mean(a), cb = mean(b);
  if (dist(a.l, cb) < 0.35 * (hi - lo)) return null; // the two rows must be a sheet-width apart
  const sg = b.l.vx * a.l.vx + b.l.vy * a.l.vy >= 0 ? 1 : -1;
  let vx = a.l.vx + sg * b.l.vx, vy = a.l.vy + sg * b.l.vy; const len = Math.hypot(vx, vy) || 1; vx /= len; vy /= len;
  return { ax: vx, ay: vy, sides: [{ pts: a.pts, cx: ca.x, cy: ca.y }, { pts: b.pts, cx: cb.x, cy: cb.y }] };
}

// ---------- matching the stripes to the printed sheet ----------
const sheetMarks = (lay) => ({
  L: lay.marks.left.map((m) => [(m.x + m.len / 2) * S, m.y * S]),
  R: lay.marks.right.map((m) => [(m.x + m.len / 2) * S, m.y * S]),
});
function makeGrid(cs, cell) {
  const g = new Map();
  cs.forEach((c, i) => { const k = ((c.x / cell) | 0) * 100003 + ((c.y / cell) | 0); const a = g.get(k); if (a) a.push(i); else g.set(k, [i]); });
  return { g, cell };
}
function nearest(grid, x, y, tol, cs, used, st) {
  const cx = (x / grid.cell) | 0, cy = (y / grid.cell) | 0; let bi = -1, bd = tol * tol;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const a = grid.g.get((cx + dx) * 100003 + (cy + dy)); if (!a) continue;
    for (const i of a) {
      if (used[i] === st) continue;
      const d = (cs[i].x - x) ** 2 + (cs[i].y - y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
  }
  return bi;
}
// Predicts where every printed stripe should be in the photo and counts how many have a real stripe there.
function evaluate(Hi, ML, MR, ctx, tf, keep) {
  const { cs, grid, used, D } = ctx, st = ++ctx.stamp;
  const p0 = apply(Hi, ML[0][0], ML[0][1]), p1 = apply(Hi, ML[1][0], ML[1][1]);
  const sp = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const res = { cnt: 0, nl: 0, nr: 0, m: keep ? [] : null };
  if (!isFinite(sp)) return res;
  const tol = Math.min(0.016 * D, Math.max(3, tf * sp));
  for (let s = 0; s < 2; s++) {
    const M = s ? MR : ML;
    for (let k = 0; k < M.length; k++) {
      const p = apply(Hi, M[k][0], M[k][1]);
      if (!isFinite(p[0]) || !isFinite(p[1])) continue;
      const i = nearest(grid, p[0], p[1], tol, cs, used, st);
      if (i < 0) continue;
      used[i] = st; res.cnt++; if (s) res.nr++; else res.nl++;
      if (keep) res.m.push({ s, k, i });
    }
  }
  return res;
}
// Re-fits the perspective on every stripe that is found, dropping odd ones, with a tighter match each round.
function refine(Hi, ML, MR, ctx) {
  let cur = Hi;
  for (const tf of [0.3, 0.2, 0.15, 0.12]) {
    const ev = evaluate(cur, ML, MR, ctx, tf, true);
    if (ev.m.length < 8) break;
    const src = ev.m.map((e) => (e.s ? MR : ML)[e.k]), dst = ev.m.map((e) => [ctx.cs[e.i].x, ctx.cs[e.i].y]);
    let Hn = homography(src, dst);
    if (!Hn) break;
    const err = src.map((p, i) => { const q = apply(Hn, p[0], p[1]); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]); });
    const med = err.slice().sort((x, y) => x - y)[err.length >> 1], lim = Math.max(1.5, 2.5 * med), keep = [];
    err.forEach((e, i) => { if (e <= lim) keep.push(i); });
    if (keep.length >= 8 && keep.length < err.length) { const H2 = homography(keep.map((i) => src[i]), keep.map((i) => dst[i])); if (H2) Hn = H2; }
    cur = Hn;
  }
  return cur;
}
// End stripes of one side: the first and last stripe seen, allowing one stray extra at either end and up to two missing at either end.
function endVariants(P, M) {
  const out = [], ns = M.length;
  for (let di = 0; di <= 1; di++) for (let dj = 0; dj <= 1; dj++) {
    if (P.length - di - dj < 3) continue;
    const p0 = P[di], p1 = P[P.length - 1 - dj];
    for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) {
      const m0 = M[a], m1 = M[ns - 1 - b];
      out.push({ p0: [p0.x, p0.y], p1: [p1.x, p1.y], m0, m1, cost: di + dj + a + b, sc: Math.hypot(p1.x - p0.x, p1.y - p0.y) / Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) });
    }
  }
  return out;
}
// Tries every sheet form, both ways up and every plausible pair of end stripes, simplest guess first (nothing missing at the ends)
// and stops as soon as one explains nearly every printed stripe. The best guess is the one where the most printed stripes land on
// a real stripe, so missing or extra stripes do not matter. The winner is then refined on all of them.
function fitSheet(ln, cs, layouts, D) {
  const forms = Object.keys(layouts).map(Number);
  const ctx = { cs, grid: makeGrid(cs, Math.max(8, 0.016 * D)), used: new Int32Array(cs.length), stamp: 0, D };
  const byCost = (v) => { const out = []; v.forEach((x) => (out[x.cost] = out[x.cost] || []).push(x)); return out; };
  const plans = [];
  for (const o of [1, -1]) {
    const dx = o * ln.ax, dy = o * ln.ay, rx = dy, ry = -dx; // "down the page" and "to the right of the page" as seen in the photo
    const proj = (c) => c.x * dx + c.y * dy;
    const sides = ln.sides.map((s) => s.pts.slice().sort((p, q) => proj(p) - proj(q)));
    const li = ln.sides[0].cx * rx + ln.sides[0].cy * ry < ln.sides[1].cx * rx + ln.sides[1].cy * ry ? 0 : 1;
    for (const n of forms) {
      const { L: ML, R: MR } = sheetMarks(layouts[n]);
      plans.push({ n, ML, MR, VL: byCost(endVariants(sides[li], ML)), VR: byCost(endVariants(sides[1 - li], MR)) });
    }
  }
  let best = null;
  const total = (pl) => pl.ML.length + pl.MR.length;
  for (let level = 0; level <= 8; level++) {
    for (const pl of plans) {
      for (let ca = 0; ca <= level; ca++) {
        const A = pl.VL[ca], B = pl.VR[level - ca];
        if (!A || !B) continue;
        for (const a of A) for (const b of B) {
          const r = a.sc / b.sc; if (r > 2 || r < 0.5) continue;
          const Hi = homography([a.m0, a.m1, b.m0, b.m1], [a.p0, a.p1, b.p0, b.p1]);
          if (!Hi) continue;
          const score = evaluate(Hi, pl.ML, pl.MR, ctx, 0.3, false).cnt - 0.3 * level;
          if (!best || score > best.score) best = { score, Hi, n: pl.n, ML: pl.ML, MR: pl.MR };
        }
      }
    }
    if (best && best.score >= 0.85 * (best.ML.length + best.MR.length)) break;
  }
  if (!best) return null;
  const Hf = refine(best.Hi, best.ML, best.MR, ctx), ev = evaluate(Hf, best.ML, best.MR, ctx, 0.15, false);
  if (ev.cnt >= 0.5 * (best.ML.length + best.MR.length) && ev.nl >= 0.35 * best.ML.length && ev.nr >= 0.35 * best.MR.length) {
    return { n: best.n, lay: layouts[best.n], Hi: Hf, how: 'stripes', matched: ev.cnt };
  }
  return null;
}

// ---------- paper edges (backup when the stripes are damaged) ----------
function lineHit(a, b) { // intersection of two lines given as point + direction
  const den = a.vx * b.vy - a.vy * b.vx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.x0 - a.x0) * b.vy - (b.y0 - a.y0) * b.vx) / den;
  return [a.x0 + t * a.vx, a.y0 + t * a.vy];
}
// Finds the four corners of the white paper in the photo: bright shape -> its four edges -> where the edges meet.
// Returned top-left, top-right, bottom-right, bottom-left as they appear in the photo (the sheet may be turned any way).
function paperCorners(raw, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 320)), sw = Math.floor(w / f), sh = Math.floor(h / f);
  if (sw < 20 || sh < 20) return null;
  const N = sw * sh, sm = new Uint8Array(N);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let t = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) t += raw[(y * f + dy) * w + x * f + dx];
    sm[y * sw + x] = t / (f * f);
  }
  const hist = new Float64Array(256); let sumAll = 0;
  for (let i = 0; i < N; i++) { hist[sm[i]]++; sumAll += sm[i]; }
  let wB = 0, sB = 0, thr = 128, bv = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sumAll - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bv) { bv = v; thr = t; }
  }
  const lab = new Int32Array(N), stack = new Int32Array(N); let bestId = 0, bestA = 0, id = 0;
  const flood = (p0, ok, mark) => {
    let sp = 0, cnt = 0; stack[sp++] = p0; lab[p0] = mark;
    while (sp) {
      const p = stack[--sp], y = (p / sw) | 0, x = p - y * sw; cnt++;
      if (x > 0 && !lab[p - 1] && ok(p - 1)) { lab[p - 1] = mark; stack[sp++] = p - 1; }
      if (x < sw - 1 && !lab[p + 1] && ok(p + 1)) { lab[p + 1] = mark; stack[sp++] = p + 1; }
      if (y > 0 && !lab[p - sw] && ok(p - sw)) { lab[p - sw] = mark; stack[sp++] = p - sw; }
      if (y < sh - 1 && !lab[p + sw] && ok(p + sw)) { lab[p + sw] = mark; stack[sp++] = p + sw; }
    }
    return cnt;
  };
  const bright = (p) => sm[p] > thr;
  for (let p = 0; p < N; p++) if (!lab[p] && bright(p)) { id++; const a = flood(p, bright, id); if (a > bestA) { bestA = a; bestId = id; } }
  if (bestA < 0.1 * N || bestA > 0.97 * N) return null;
  // everything not paper that touches the picture's border is "outside"; dark marks inside the paper are not
  const outside = new Uint8Array(N), notPaper = (p) => lab[p] !== bestId;
  const seen = new Uint8Array(N);
  const stk = new Int32Array(N);
  let sp = 0;
  const push = (p) => { if (!seen[p] && notPaper(p)) { seen[p] = 1; outside[p] = 1; stk[sp++] = p; } };
  for (let x = 0; x < sw; x++) { push(x); push((sh - 1) * sw + x); }
  for (let y = 0; y < sh; y++) { push(y * sw); push(y * sw + sw - 1); }
  while (sp) {
    const p = stk[--sp], y = (p / sw) | 0, x = p - y * sw;
    if (x > 0) push(p - 1); if (x < sw - 1) push(p + 1); if (y > 0) push(p - sw); if (y < sh - 1) push(p + sw);
  }
  const edge = [];
  for (let p = 0; p < N; p++) {
    if (outside[p] || lab[p] !== bestId) continue;
    const y = (p / sw) | 0, x = p - y * sw;
    if ((x > 0 && outside[p - 1]) || (x < sw - 1 && outside[p + 1]) || (y > 0 && outside[p - sw]) || (y < sh - 1 && outside[p + sw])) edge.push([x, y]);
  }
  if (edge.length < 40) return null;
  let tl = edge[0], tr = edge[0], br = edge[0], bl = edge[0];
  for (const p of edge) {
    if (p[0] + p[1] < tl[0] + tl[1]) tl = p; if (p[0] + p[1] > br[0] + br[1]) br = p;
    if (p[0] - p[1] > tr[0] - tr[1]) tr = p; if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
  }
  const rough = [tl, tr, br, bl], groups = [[], [], [], []], reach = 0.07 * Math.max(sw, sh);
  for (const p of edge) {
    let bi = -1, bd = reach;
    for (let k = 0; k < 4; k++) {
      const a = rough[k], b = rough[(k + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1;
      const t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (el * el), d = Math.abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / el;
      if (t > 0.15 && t < 0.85 && d < bd) { bd = d; bi = k; }
    }
    if (bi >= 0) groups[bi].push(p);
  }
  if (groups.some((g) => g.length < 10)) return null;
  const lines = groups.map(fitLine), pts = [];
  for (let k = 0; k < 4; k++) { const q = lineHit(lines[(k + 3) % 4], lines[k]); if (!q) return null; pts.push([(q[0] + 0.5) * f, (q[1] + 0.5) * f]); }
  return pts; // [top-left, top-right, bottom-right, bottom-left]
}
// How much darker the printed stripe positions are than the paper between them. High = the perspective fix is right.
function inkScore(Hi, ML, MR, norm, w, h) {
  let c = 0, m = 0, nc = 0, nm = 0;
  for (const M of [ML, MR]) for (let k = 0; k < M.length; k++) {
    let v = 255;
    for (const dy of [-1.5 * S, 0, 1.5 * S]) { const p = apply(Hi, M[k][0], M[k][1] + dy); v = Math.min(v, sample(norm, w, h, p[0], p[1])); }
    c += v; nc++;
    if (k + 1 < M.length) { const p = apply(Hi, M[k][0], (M[k][1] + M[k + 1][1]) / 2); m += sample(norm, w, h, p[0], p[1]); nm++; }
  }
  return m / nm - c / nc;
}
function fitPaper(quad, norm, cs, layouts, D, w, h) {
  const ctx = { cs, grid: makeGrid(cs, Math.max(8, 0.016 * D)), used: new Int32Array(cs.length), stamp: 0, D };
  let best = null;
  for (const n of Object.keys(layouts).map(Number)) {
    const lay = layouts[n], { L: ML, R: MR } = sheetMarks(lay), [pw, ph] = lay.page;
    const src = [[0, 0], [pw * S, 0], [pw * S, ph * S], [0, ph * S]];
    for (let r = 0; r < 4; r++) {
      let Hi = homography(src, [0, 1, 2, 3].map((k) => quad[(k + r) % 4]));
      if (!Hi) continue;
      if (cs.length >= 8) Hi = refine(Hi, ML, MR, ctx);
      const sc = inkScore(Hi, ML, MR, norm, w, h);
      if (isFinite(sc) && (!best || sc > best.sc)) best = { sc, Hi, n };
    }
  }
  if (!best || best.sc < 70) return null;
  return { n: best.n, lay: layouts[best.n], Hi: best.Hi, how: 'paper', matched: 0 };
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
// Soft darkness: paper = 0, solid ink = 1, pencil in between. Light pencil still counts, nothing hinges on one cut-off value.
const soft = (v) => (v >= 200 ? 0 : v <= 70 ? 1 : (200 - v) / 130);
const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

// What the student did in one row, from how much darker each bubble is than an empty one (adj).
function pick(adj) {
  const best = Math.max(...adj), bi = adj.indexOf(best), on = [];
  adj.forEach((v, i) => { if (v >= MARK && v >= DOM * best) on.push(i); });
  if (on.length === 1) return { st: 'ok', on, best: bi };
  if (on.length > 1) {
    const s = adj.slice().sort((a, b) => b - a);
    if (s[0] - s[1] >= GAP) return { st: 'ok', on: [bi], best: bi }; // one clearly darker: the other is an erased smudge
    return { st: 'multiple', on, best: bi };
  }
  return { st: best >= FAINT ? 'faint' : 'blank', on: [], best: bi };
}
// A cross has ink only on the two diagonals of the bubble.
const isCross = (p) => Math.min(p.d1, p.d2) >= 0.2 && p.off <= 0.08 && p.fill >= 0.06 && p.fill <= 0.6;
// Anything that is not one clearly shaded bubble comes back with a reason and a best guess. Light marks, crosses and marks beside
// the bubble are accepted automatically by the app; only rows with two real marks need the teacher.
function judge(ps, adj, choices) {
  const r = pick(adj);
  const out = (status, idx, reason) => ({ status, on: status === 'multiple' ? r.on : [], suggest: idx === null ? null : choices[idx], reason });
  if (r.st === 'ok') return isCross(ps[r.on[0]]) ? out('cross', r.on[0], 'Cross mark instead of shading') : { status: 'ok', on: r.on, suggest: null, reason: '' };
  if (r.st === 'multiple') return out('multiple', r.best, 'More than one bubble is shaded');
  const cross = ps.findIndex(isCross);
  if (cross >= 0) return out('cross', cross, 'Cross mark instead of shading');
  if (r.st === 'faint') return out('faint', r.best, 'Light mark, not fully shaded');
  return { status: 'blank', on: [], suggest: null, reason: '' };
}

function locate(norm, raw, w, h, layouts) {
  const D = Math.max(w, h), dbg = { norm, w, h, cands: [], L0: [], R0: [] };
  let sol = null, bestCs = [], sawRows = false;
  for (const thr of THRS) {
    const cs = dominant(blobs(norm, w, h, thr));
    if (cs.length > bestCs.length) { bestCs = cs; dbg.cands = cs.map((c) => [c.x, c.y]); }
    const ln = findLines(cs, D);
    if (!ln) continue;
    sawRows = true;
    dbg.cands = cs.map((c) => [c.x, c.y]); dbg.L0 = ln.sides[0].pts.map((c) => [c.x, c.y]); dbg.R0 = ln.sides[1].pts.map((c) => [c.x, c.y]);
    sol = fitSheet(ln, cs, layouts, D);
    if (sol) break;
  }
  if (!sol && raw) {
    const quad = paperCorners(raw, w, h);
    if (quad) sol = fitPaper(quad, norm, bestCs, layouts, D, w, h);
  }
  if (sol) return sol;
  const e = new ScanError(sawRows
    ? 'Found the side stripes but they do not match a GuroGabay sheet. Keep hands and shadows off the stripes and fit the whole sheet in view.'
    : `Could not see the side stripes (found ${bestCs.length}). Fit the whole sheet in view and keep it well lit.`);
  e.dbg = dbg; return e;
}

// How sharp the sheet looks: about 1 when crisp, under 0.5 when blurred (focus or motion). For every clear edge it compares the steepest
// 1-pixel step with the whole step across 6 pixels. A crisp edge changes in one pixel, a blurred one is spread over many.
function sharpness(g, w, h, quad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  quad.forEach(([x, y]) => { x0 = Math.min(x0, x * w); x1 = Math.max(x1, x * w); y0 = Math.min(y0, y * h); y1 = Math.max(y1, y * h); });
  const mx = (x1 - x0) * 0.15, my = (y1 - y0) * 0.15; // look at the middle of the sheet only
  x0 = Math.max(4, Math.ceil(x0 + mx)); x1 = Math.min(w - 6, Math.floor(x1 - mx)); y0 = Math.max(4, Math.ceil(y0 + my)); y1 = Math.min(h - 6, Math.floor(y1 - my));
  if (x1 - x0 < 40 || y1 - y0 < 40) return null;
  const median = (bins, tot) => { let acc = 0; for (let i = 0; i < bins.length; i++) { acc += bins[i]; if (acc * 2 >= tot) return i / 100; } return 1; };
  const bh = new Uint32Array(151), bv = new Uint32Array(151); let nh = 0, nv = 0;
  for (let y = y0; y < y1; y += 2) {
    const o = y * w;
    for (let x = x0; x < x1; x++) {
      const p = o + x, a = g[p], d = Math.abs(g[p + 1] - a);
      if (d > 30 && d > Math.abs(a - g[p - 1]) && d >= Math.abs(g[p + 2] - g[p + 1])) { bh[Math.min(150, Math.floor((100 * d) / Math.max(1, Math.abs(g[p + 4] - g[p - 2]))))]++; nh++; }
      const e = Math.abs(g[p + w] - a);
      if (e > 30 && e > Math.abs(a - g[p - w]) && e >= Math.abs(g[p + 2 * w] - g[p + w])) { bv[Math.min(150, Math.floor((100 * e) / Math.max(1, Math.abs(g[p + 4 * w] - g[p - 2 * w]))))]++; nv++; }
    }
  }
  if (nh < 150 || nv < 150) return 0.1; // almost no clear edges left on a sheet full of printing: very blurry
  return Math.min(median(bh, nh), median(bv, nv));
}

function run(norm, raw, w, h, layouts) {
  const found = locate(norm, raw, w, h, layouts);
  if (found instanceof ScanError) throw found;
  const { n, lay, Hi } = found;

  // Guard: every bubble must land inside the photo. If the sheet is cut off, the repeating stripes can lock on one row out,
  // which reads every answer shifted without any error. Better to ask for a new photo than to grade the wrong rows.
  {
    const pts = lay.answers.bubbles.map((b) => [b.x, b.y]);
    for (let j = 0; j < lay.id.cols; j++) for (const d of [0, 9]) pts.push([lay.id.x0 + j * lay.id.pitchX, lay.id.y0 + d * lay.id.pitchY]);
    const m = 2;
    for (const [x, y] of pts) {
      const p = apply(Hi, x * S, y * S);
      if (!(p[0] >= m && p[1] >= m && p[0] <= w - 1 - m && p[1] <= h - 1 - m)) throw new ScanError('Part of the sheet is outside the photo. Move back a little so all four edges of the paper are in view.');
    }
  }

  // probe: fill = soft darkness inside the bubble. d1 / d2 / off = dark share along each diagonal / everywhere else (a cross has ink only on the diagonals).
  const probe = (x, y, r) => {
    const cx = Math.floor(x * S), cy = Math.floor(y * S), rr = Math.floor(r * S * 0.7), band = Math.max(1, rr * 0.22);
    let dark = 0, tot = 0, a1 = 0, n1 = 0, a2 = 0, n2 = 0, od = 0, ot = 0;
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy > rr * rr) continue;
      const p = apply(Hi, cx + dx, cy + dy), v = sample(norm, w, h, p[0], p[1]), bin = v < 150 ? 1 : 0;
      tot++; dark += soft(v);
      const on1 = Math.abs(dx - dy) <= band, on2 = Math.abs(dx + dy) <= band;
      if (on1) { n1++; a1 += bin; }
      if (on2) { n2++; a2 += bin; }
      if (!on1 && !on2) { ot++; od += bin; }
    }
    return { fill: dark / tot, d1: n1 ? a1 / n1 : 0, d2: n2 ? a2 / n2 : 0, off: ot ? od / ot : 0 };
  };
  const a = lay.answers, per = {};
  for (const b of a.bubbles) (per[b.q] = per[b.q] || {})[b.choice] = [b.x, b.y];
  // Looks at the space between the bubbles of one row. Ink there (not a tiny speck) means the student marked outside the circles.
  const gapMark = (q) => {
    const cs = a.choices, rowY = per[q][cs[0]][1], step = 2 / S; let best = null;
    for (let k = 0; k < cs.length - 1; k++) {
      const x0 = per[q][cs[k]][0] + a.radius * 1.2, x1 = per[q][cs[k + 1]][0] - a.radius * 1.2;
      let dark = 0, tot = 0, sx = 0;
      for (let yy = rowY - a.radius * 0.9; yy <= rowY + a.radius * 0.9; yy += step) for (let xx = x0; xx <= x1; xx += step) {
        const p = apply(Hi, xx * S, yy * S); tot++;
        if (sample(norm, w, h, p[0], p[1]) < 130) { dark++; sx += xx; }
      }
      if (tot && dark / tot >= STRAY && (!best || dark / tot > best.v)) best = { v: dark / tot, x: sx / dark };
    }
    if (!best) return null;
    let near = cs[0], d = 1e9;
    cs.forEach((c) => { const dd = Math.abs(per[q][c][0] - best.x); if (dd < d) { d = dd; near = c; } });
    return near;
  };

  // Read every bubble first, then learn what an EMPTY bubble looks like on this particular sheet (paper, printing, lighting)
  // and measure every bubble against that. This is what makes light pencil work without letting smudges count.
  const probes = [];
  for (let q = 1; q <= n; q++) probes.push(a.choices.map((c) => probe(per[q][c][0], per[q][c][1], a.radius)));
  const all = [].concat(...probes).map((p) => p.fill), empty = pct(all, 0.25);
  const base = a.choices.map((_, c) => Math.min(pct(probes.map((r) => r[c].fill), 0.25), empty + 0.08));
  const answers = [];
  for (let q = 1; q <= n; q++) {
    const ps = probes[q - 1], j = judge(ps, ps.map((p, c) => p.fill - base[c]), a.choices);
    if (j.status === 'blank') { const s2 = gapMark(q); if (s2) { j.status = 'stray'; j.suggest = s2; j.reason = 'Mark outside the bubble'; } }
    answers.push({ q, status: j.status, choice: j.on.map((k) => a.choices[k]), suggest: j.suggest, reason: j.reason });
  }
  const id = lay.id; let studentId = '';
  for (let j = 0; j < id.cols; j++) {
    const fr = [];
    for (let d = 0; d < 10; d++) fr.push(probe(id.x0 + j * id.pitchX, id.y0 + d * id.pitchY, id.radius).fill);
    const lvl = Math.min(pct(fr, 0.5), empty + 0.08), r = pick(fr.map((v) => v - lvl));
    if (r.st === 'ok') studentId += r.on[0]; else if (r.st !== 'blank') studentId += '?';
  }
  // Where the sheet sits in the photo (corners as 0..1 of the photo, in sheet order) and how sharp it is. Auto-scan uses this to wait for a good picture.
  const [PW, PH] = lay.page;
  const quad = [[0, 0], [PW, 0], [PW, PH], [0, PH]].map(([x, y]) => { const p = apply(Hi, x * S, y * S); return [p[0] / w, p[1] / h]; });
  let sharp = null; try { sharp = sharpness(raw || norm, w, h, quad); } catch (_) { /* optional */ }
  return { n, answers, studentId, reviewUri: scanImage(norm, w, h, Hi, lay), method: found.how, geom: { quad, w, h, ratio: PH / PW, sharp } };
}
export function readSheet(gray, w, h, layouts, isNorm) {
  return isNorm ? run(gray, null, w, h, layouts) : run(normalize(gray, w, h), gray, w, h, layouts);
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

// ---------- the scanned sheet, straightened, as a small PNG ----------
// 4 gray shades and real compression keep it near 30 KB, so every scanned paper can be kept and shown again.
const SCAN_RS = 1.25; // pixels per point of the printed sheet
function scanImage(norm, w, h, Hi, lay) {
  const pw = Math.round(lay.page[0] * SCAN_RS), ph = Math.round(lay.page[1] * SCAN_RS);
  const px = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const p = apply(Hi, (x / SCAN_RS) * S, (y / SCAN_RS) * S);
    px[y * pw + x] = Math.max(0, Math.min(255, sample(norm, w, h, p[0], p[1])));
  }
  return 'data:image/png;base64,' + toBase64(pngGray2(px, pw, ph));
}
// Deflate with one fixed-Huffman block. Runs of equal bytes (the blank paper) become single matches.
function deflateFixed(raw) {
  const out = []; let buf = 0, cnt = 0;
  const put = (v, n) => { buf |= v << cnt; cnt += n; while (cnt >= 8) { out.push(buf & 255); buf >>>= 8; cnt -= 8; } };
  const code = (c, n) => { let r = 0; for (let i = 0; i < n; i++) r |= ((c >> i) & 1) << (n - 1 - i); put(r, n); }; // Huffman codes are sent most significant bit first
  const lit = (v) => { if (v < 144) code(0x30 + v, 8); else code(0x190 + v - 144, 9); };
  const sym = (s2) => { if (s2 < 256) lit(s2); else if (s2 < 280) code(s2 - 256, 7); else code(0xc0 + s2 - 280, 8); };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  put(1, 1); put(1, 2);
  for (let i = 0, n = raw.length; i < n;) {
    const v = raw[i]; let run = 1; while (i + run < n && raw[i + run] === v && run < 259) run++;
    lit(v);
    if (run >= 4) { const len = run - 1; let k = LB.length - 1; while (LB[k] > len) k--; sym(257 + k); if (LE[k]) put(len - LB[k], LE[k]); code(0, 5); i += run; } else i++;
  }
  sym(256); if (cnt > 0) out.push(buf & 255);
  return Uint8Array.from(out);
}
// 2-bit grayscale PNG. Each row is stored as the difference from the row above, so blank areas become zeros.
function pngGray2(px, w, h) {
  const rowBytes = Math.ceil(w / 4), line = new Uint8Array(rowBytes), prev = new Uint8Array(rowBytes), raw = new Uint8Array((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    line.fill(0);
    for (let x = 0; x < w; x++) { const v = px[y * w + x], q = v < 100 ? 0 : v < 150 ? 1 : v < 200 ? 2 : 3; line[x >> 2] |= q << (6 - 2 * (x & 3)); }
    const o = y * (rowBytes + 1); raw[o] = 2;
    for (let i = 0; i < rowBytes; i++) raw[o + 1 + i] = (line[i] - prev[i]) & 255;
    prev.set(line);
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const d = deflateFixed(raw), z = new Uint8Array(2 + d.length + 4);
  z[0] = 0x78; z[1] = 0x01; z.set(d, 2);
  const ad = ((b << 16) | a) >>> 0, e = 2 + d.length; z[e] = ad >>> 24; z[e + 1] = (ad >>> 16) & 255; z[e + 2] = (ad >>> 8) & 255; z[e + 3] = ad & 255;
  const chunk = (type, data) => {
    const o2 = new Uint8Array(12 + data.length), dv = new DataView(o2.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) o2[4 + i] = type.charCodeAt(i);
    o2.set(data, 8); dv.setUint32(8 + data.length, crc32(o2.subarray(4, 8 + data.length))); return o2;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 2; ihdr[9] = 0;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const res = new Uint8Array(parts.reduce((s2, p2) => s2 + p2.length, 0)); let q = 0;
  for (const p2 of parts) { res.set(p2, q); q += p2.length; }
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
// Reads a photo of a sheet. No need to turn it: the stripes are found wherever they are and whichever way up the sheet is.
// The lighting fix is the slow part, so it runs once.
export function readPhoto(gray, w, h, layouts, quiet) { // quiet = skip the debug picture on failure (used by auto-scan)
  const norm = normalize(gray, w, h);
  try { return run(norm, gray, w, h, layouts); }
  catch (e) {
    if (!(e instanceof ScanError)) throw e;
    if (e.dbg) {
      if (!quiet) { try { const d = debugImage(e.dbg); e.debugUri = d.uri; e.debugRatio = d.ratio; } catch (_) { /* picture is optional */ } }
      delete e.dbg;
    }
    throw e;
  }
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