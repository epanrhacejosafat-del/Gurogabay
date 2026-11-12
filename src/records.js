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
export function termCalc(trackKey, hps, sc, custom) {
  const t = TRACKS.find((x) => x.k === trackKey) || TRACKS[0];
  const [wW, wP, wE] = Array.isArray(custom) && custom.length === 3 ? custom : t.w; // custom = teacher's own weights as fractions
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
    return { uid: r.uid, id: r.id, name: r.name, marks, total: sum(marks) };
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

// ---------------- CSV layouts of the MPS workbook ----------------
// A quiz can be given to several classes. Each class is one "section"; papers whose student is in no class go to "No class".
export function quizSections(z, classes) {
  const rows = individualScores(z).rows;
  const cls = (z.c || []).map((id) => classes.find((c) => c.id === id)).filter(Boolean);
  if (!cls.length) return [{ name: z.n, rows }];
  const secs = cls.map((c) => ({ name: c.n, rows: [] })); const loose = [];
  rows.forEach((r) => { const i = cls.findIndex((c) => r.id && c.s.includes(r.id)); (i >= 0 ? secs[i].rows : loose).push(r); });
  const out = secs.filter((s) => s.rows.length); if (loose.length) out.push({ name: 'No class', rows: loose });
  return out.length ? out : [{ name: z.n, rows: [] }];
}

// "individual score" sheet: A = number, B = learner, C = total, then one 1/0 column per item. The section name sits in B of the header row.
export function individualCsvRows(z, sections) {
  const out = [];
  sections.forEach((s, k) => {
    if (k) out.push([]);
    out.push(['', s.name, '', ...z.key.map((_, i) => i + 1)]);
    s.rows.forEach((r, i) => out.push([i + 1, r.name, r.total, ...r.marks]));
  });
  return out;
}

// "MPS Computation" sheet: sections side by side, 4 columns each (number, learner, score, spacer), up to 5 per band,
// then Cases / HPS / HSO / LSO / Mean / MPS and the five proficiency bands with their percentages.
const BAND_LABELS = ['0-24', '25-49', '50-74', '75-89', '90-100'];
export function mpsCsvRows(z, sections) {
  const out = []; const hps = z.f;
  for (let b = 0; b < sections.length; b += 5) {
    const band = sections.slice(b, b + 5); const most = Math.max(0, ...band.map((s) => s.rows.length));
    const stats = band.map((s) => mpsSummary(s.rows.map((r) => r.total), hps));
    const line = (fn) => band.flatMap((s, i) => fn(s, i));
    if (b) out.push([]);
    out.push(line((s, i) => [b === 0 && i === 0 ? 'Sec' : '', s.name, 'Score', '']));
    for (let i = 0; i < most; i++) out.push(line((s) => { const r = s.rows[i]; return r ? [i + 1, r.name, r.total, ''] : [i + 1, '', '', '']; }));
    const stat = (label, get) => out.push(line((s, i) => ['', label, stats[i] ? get(stats[i]) : '', '']));
    stat('Cases', (m) => m.cases); stat('HPS', () => hps); stat('HSO', (m) => m.hso); stat('LSO', (m) => m.lso);
    stat('Mean', (m) => m.mean.toFixed(2)); stat('MPS', (m) => m.mps.toFixed(2));
    LEVELS.forEach((lv, k) => {
      stat(BAND_LABELS[k], (m) => m.bands[lv.k]);
      stat('%', (m) => ((m.bands[lv.k] / m.cases) * 100).toFixed(2));
    });
  }
  return out;
}

// ---------------- Table of specification (TOS) and competency analysis ----------------
export const TOS_LEVELS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
export const MASTERY = 75; // percent of correct answers on a competency that counts as mastered

// "1-4, 12, 17-19, 22" -> { items: [1,2,3,4,12,17,18,19,22], bad: [] }. Accepts hyphens, en dashes and "to"; items outside 1..max are reported.
export function parseItems(text, max) {
  const items = new Set(); const bad = [];
  String(text || '').split(/[,;\n]+/).map((t) => t.trim().replace(/\s*(?:to|[\u2013\u2014\u2212-])\s*/gi, '-')).filter(Boolean).forEach((tok) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) { bad.push(tok); return; }
    const a = Number(m[1]); const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < a || b > max) { bad.push(tok); return; }
    for (let i = a; i <= b; i++) items.add(i);
  });
  return { items: [...items].sort((x, y) => x - y), bad };
}
// [1,2,3,4,12,17,18,19,22] -> "1-4, 12, 17-19, 22"
export function itemsText(items) {
  const out = []; let i = 0;
  while (i < items.length) { let j = i; while (j + 1 < items.length && items[j + 1] === items[j] + 1) j++; out.push(j - i >= 2 ? items[i] + '-' + items[j] : items.slice(i, j + 1).join(', ')); i = j + 1; }
  return out.join(', ');
}
// Problems with a TOS: items used by two competencies, items no competency covers, level counts that do not add up.
export function tosCheck(z) {
  const comps = (z.tos && z.tos.comps) || []; const owner = {}; const dup = new Set();
  comps.forEach((c, k) => c.items.forEach((it) => { if (owner[it] !== undefined && owner[it] !== k) dup.add(it); else owner[it] = k; }));
  const missing = []; for (let i = 1; i <= z.f; i++) if (owner[i] === undefined) missing.push(i);
  const levelMismatch = comps.map((c, k) => (c.lv && c.lv.some((v) => v) && sum(c.lv) !== c.items.length ? k : -1)).filter((k) => k >= 0);
  const lv = TOS_LEVELS.map((_, i) => sum(comps.map((c) => (c.lv && c.lv[i]) || 0)));
  return { dup: [...dup].sort((a, b) => a - b), missing, levelMismatch, lv, easy: lv[0] + lv[1], average: lv[2] + lv[3], difficult: lv[4] + lv[5], total: sum(comps.map((c) => c.items.length)) };
}

// Mastery of each competency from the scanned papers, lowest first.
export function competencyStats(z) {
  const comps = (z.tos && z.tos.comps) || []; const d = individualScores(z); const cases = d.cases;
  if (!comps.length || !cases) return [];
  return comps.map((c, k) => {
    const items = c.items.map((it) => {
      const wrong = {}; z.res.forEach((r) => { const m = r.ans[it - 1] || '-'; if (m !== LET[z.key[it - 1]]) wrong[m] = (wrong[m] || 0) + 1; });
      const top = Object.keys(wrong).sort((a, b) => wrong[b] - wrong[a])[0];
      return { item: it, pct: d.pct[it - 1], correct: d.correct[it - 1], wrongTop: top ? { l: top, n: wrong[top] } : null };
    });
    const correct = sum(items.map((x) => x.correct)); const pct = (correct / (items.length * cases)) * 100;
    const learners = d.rows.map((r) => { const got = sum(c.items.map((it) => r.marks[it - 1])); return { uid: r.uid, name: r.name, pct: (got / items.length) * 100 }; })
      .filter((x) => x.pct < MASTERY).sort((a, b) => a.pct - b.pct);
    return { k, name: c.n, items, itemsText: itemsText(c.items), count: items.length, correct, cases, pct, level: levelOf(pct), mastered: pct >= MASTERY, learners };
  }).sort((a, b) => a.pct - b.pct);
}

// Same layout as the TOS on paper: competency, number of items, weight, levels of thinking, item placement, total row.
export function tosCsvRows(z) {
  const comps = (z.tos && z.tos.comps) || []; const chk = tosCheck(z);
  const pct = (n) => (z.f ? ((n / z.f) * 100).toFixed(1) + '%' : '');
  return [
    ['Table of Specifications', z.n], [],
    ['Objectives / Learning Competencies', 'No. of Items', 'Weight', ...TOS_LEVELS, 'Item Placement'],
    ...comps.map((c, i) => [(i + 1) + '. ' + c.n, c.items.length, pct(c.items.length), ...TOS_LEVELS.map((_, l) => (c.lv ? c.lv[l] || 0 : '')), itemsText(c.items)]),
    ['TOTAL', chk.total, pct(chk.total), chk.easy + ' (' + pct(chk.easy) + ') EASY', '', chk.average + ' (' + pct(chk.average) + ') AVERAGE', '', chk.difficult + ' (' + pct(chk.difficult) + ') DIFFICULT', '', '1-' + z.f],
  ];
}
// Like the CR&LP sheet: correct responses and percent mastery per section, then overall.
export function competencyCsvRows(z, sections) {
  const stats = competencyStats(z); const head = ['Learning competency', 'Item placement', 'No. of items'];
  const secCols = sections.flatMap((s) => [s.name + ' correct', s.name + ' %']);
  const out = [['Competency analysis', z.n], [], [...head, ...secCols, 'Total correct', 'Cases', '% mastery', 'Level', 'Remark']];
  stats.forEach((c) => {
    const per = sections.flatMap((s) => {
      const got = sum(c.items.map((x) => sum(s.rows.map((r) => r.marks[x.item - 1])))); const den = c.count * s.rows.length;
      return [got, den ? ((got / den) * 100).toFixed(2) : ''];
    });
    out.push([c.name, c.itemsText, c.count, ...per, c.correct, c.cases, c.pct.toFixed(2), c.level.n, c.mastered ? 'Mastered' : 'Needs reteaching']);
  });
  return out;
}