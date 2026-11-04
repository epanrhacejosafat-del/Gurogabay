// Grading rules from the DepEd SHS e-Class Record (DO 8 s.2015 / DO 15 s.2026) and the MPS workbook.
// Pure functions only. No student data lives here.

const LET = ['A', 'B', 'C', 'D', 'E'];
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const r2 = (x) => Math.round(x * 100) / 100;

// Weights of Written Works / Performance Tasks / Term Exam by subject track (Grade 12 SHS).
export const TRACKS = [
  { k: 'core', n: 'Core (all tracks)', w: [0.25, 0.5, 0.25] },
  { k: 'academic', n: 'Academic (except immersion)', w: [0.25, 0.45, 0.3] },
  { k: 'immersion', n: 'Work immersion / culminating', w: [0.35, 0.4, 0.25] },
  { k: 'tvl', n: 'TVL / Sports / Arts & Design', w: [0.2, 0.6, 0.2] },
];
// Inside the Examinations component: Summative Test 1, Summative Test 2, Term Exam.
export const EXAM_W = [30, 30, 40];
export const NCOL = { ww: 10, pt: 10, ex: 3 };

// Adjusted transmutation table: [initial grade min, max, transmuted grade].
const TRANSMUTE = [[99.5, 100, 100], [98.32, 99.49, 99], [97.14, 98.31, 98], [95.96, 97.13, 97], [94.78, 95.95, 96], [93.6, 94.77, 95],
  [92.42, 93.59, 94], [91.24, 92.41, 93], [90.06, 91.23, 92], [88.88, 90.05, 91], [87.7, 88.87, 90], [86.52, 87.69, 89], [85.34, 86.51, 88],
  [84.16, 85.33, 87], [82.98, 84.15, 86], [81.8, 82.97, 85], [80.62, 81.79, 84], [79.44, 80.61, 83], [78.26, 79.43, 82], [77.08, 78.25, 81],
  [75.9, 77.07, 80], [74.72, 75.89, 79], [73.54, 74.71, 78], [72.36, 73.53, 77], [71.18, 72.35, 76], [70, 71.17, 75], [65.34, 69.99, 74],
  [60.67, 65.33, 73], [56.01, 60.66, 72], [51.34, 56, 71], [46.67, 51.33, 70], [42.01, 46.66, 69], [37.34, 42, 68], [32.68, 37.33, 67],
  [28.01, 32.67, 66], [23.35, 28, 65], [18.68, 23.34, 64], [14.01, 18.67, 63], [9.35, 14, 62], [4.68, 9.34, 61], [0, 4.67, 60]];
export function transmute(ig) {
  if (ig === null || ig === undefined || isNaN(ig)) return null;
  for (const [min, , g] of TRANSMUTE) if (ig >= min) return g;
  return 60;
}
export function descriptor(g) {
  if (g === null || g === undefined) return '';
  if (g >= 90) return 'Advancing';
  if (g >= 80) return 'Benchmarking';
  if (g >= 75) return 'Connecting';
  if (g >= 65) return 'Developing';
  return 'Emerging';
}

const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

// One written-works or performance-task component. hps / sc are arrays of 10 (number, '' or null).
function component(hps, sc, weight) {
  let hTot = 0; let sTot = 0; let any = false;
  hps.forEach((h, i) => {
    const hv = num(h); if (!hv || hv <= 0) return; hTot += hv;
    const sv = num(sc[i]); if (sv !== null) { sTot += sv; any = true; }
  });
  if (!hTot || !any) return { total: null, hps: hTot || null, ps: null, ws: null };
  const ps = r2((sTot / hTot) * 100);
  return { total: sTot, hps: hTot, ps, ws: r2(ps * weight) };
}

// One learner's term result. hps = {ww:[10], pt:[10], ex:[3]}, sc = same shape.
export function termCalc(trackKey, hps, sc) {
  const t = TRACKS.find((x) => x.k === trackKey) || TRACKS[0];
  const [wW, wP, wE] = t.w;
  const ww = component(hps.ww, sc.ww, wW);
  const pt = component(hps.pt, sc.pt, wP);
  let exWs = 0; let exAny = false;
  EXAM_W.forEach((w, i) => {
    const h = num(hps.ex[i]); const s = num(sc.ex[i]);
    if (h && h > 0 && s !== null) { exWs += r2((s / h) * w); exAny = true; }
  });
  const exPs = exAny ? exWs : null; // weights add up to 100, so the sum is already the percentage score
  const exWsFinal = exAny ? r2(exPs * wE) : null;
  const ig = ww.ws !== null && pt.ws !== null && exWsFinal !== null ? r2(ww.ws + pt.ws + exWsFinal) : null;
  return { ww, pt, ex: { ps: exPs, ws: exWsFinal }, ig, tg: transmute(ig) };
}

// Final grade = average of all term grades, shown only when every term the subject runs has a grade.
export function finalCalc(tgs, nTerms) {
  const got = tgs.slice(0, nTerms).filter((g) => typeof g === 'number');
  if (!nTerms || got.length !== nTerms) return { fg: null, desc: '', remark: '' };
  const fg = Math.round(sum(got) / got.length);
  return { fg, desc: descriptor(fg), remark: fg >= 75 ? 'PASSED' : 'FAILED' };
}

// ---------------- MPS workbook ----------------
export const LEVELS = [
  { k: 'NP', n: 'Not Proficient' }, { k: 'LP', n: 'Low Proficient' }, { k: 'NRP', n: 'Nearly Proficient' },
  { k: 'P', n: 'Proficient' }, { k: 'HP', n: 'Highly Proficient' },
];
export function levelOf(pct) {
  if (pct >= 89.5) return LEVELS[4];
  if (pct >= 74.5) return LEVELS[3];
  if (pct >= 49.5) return LEVELS[2];
  if (pct >= 24.5) return LEVELS[1];
  return LEVELS[0];
}

// The "individual score" sheet: one row per learner, 1 = correct, 0 = wrong or blank, one column per item.
export function individualScores(z) {
  const rows = z.res.map((r) => {
    const marks = z.key.map((k, i) => (r.ans[i] === LET[k] ? 1 : 0));
    return { id: r.id, name: r.name, marks, total: sum(marks) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const cases = rows.length;
  const correct = z.key.map((_, i) => sum(rows.map((r) => r.marks[i])));
  const pct = correct.map((c) => (cases ? (c / cases) * 100 : 0));
  return { n: z.f, rows, cases, correct, pct, lp: pct.map((p) => levelOf(p)) };
}

// MPS for one section / quiz. Every scanned paper counts as a case.
export function mpsSummary(totals, hps) {
  const n = totals.length; if (!n) return null;
  const mean = sum(totals) / n; const bands = { NP: 0, LP: 0, NRP: 0, P: 0, HP: 0 };
  totals.forEach((x) => { bands[levelOf((x / hps) * 100).k] += 1; });
  return { cases: n, hps, hso: Math.max(...totals), lso: Math.min(...totals), mean, mps: (mean / hps) * 100, bands };
}

// ---------------- CSV ----------------
const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const csv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n');
