// Builds the MPS Term Examination workbook (CR&LP Computation, MPS, Correct Response, Unmastered) as a formatted .xlsx, ready to print.
import { createBook, colName } from './xlsxLite';
import { individualScores, mpsSummary, levelOf, LEVELS, quizSections, competencyStats } from './records';
import { DEPED, SEAL_A, SEAL_B } from './logos';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const BLUE = 'DCE6F1'; const YELLOW = 'FFFF00';
const px = (w) => Math.round(w * 7 + 5);
const lines = (text, chars) => Math.max(1, Math.ceil(String(text || '').length / chars));

// Figures out which column and offset puts a picture of width `w` at the right edge of the sheet.
function rightEdge(sh, lastCol, w) {
  let total = 0; for (let c = 1; c <= lastCol; c++) total += px(sh.widths[c] || 8.43);
  const target = Math.max(0, total - w - 8); let acc = 0;
  for (let c = 1; c <= lastCol; c++) { const cw = px(sh.widths[c] || 8.43); if (acc + cw > target) return { col: c, dx: target - acc }; acc += cw; }
  return { col: lastCol, dx: 0 };
}
function logos(book, sh, ids, lastCol, seal, leftCol = 1, rows = 8) {
  const H = Math.min(rows * 20 - 10, 100); const sw = Math.round((seal.w / seal.h) * H);
  sh.image(ids.deped, leftCol, 1, H, H, 6, 4);
  const r = rightEdge(sh, lastCol, sw); sh.image(ids[seal === SEAL_A ? 'a' : 'b'], r.col, 1, sw, H, r.dx, 4);
}
function heading(sh, lastCol, o, z, title, first) {
  const rows = [
    first ? ['Republic  of  the  Philippines', {}] : null, first ? ['Department  of  Education', {}] : null,
    [o.region || '', {}], [o.division || '', {}], [(o.school || '').toUpperCase(), { b: true }],
    ['TEST  RESULTS  IN  ' + String(o.subject || z.n).toUpperCase(), { b: true }], [z.n, {}], ['School  Year:  ' + (o.schoolYear || ''), {}],
  ].filter(Boolean);
  rows.forEach(([t, st], i) => sh.merge(i + 1, 1, i + 1, lastCol, t, { h: 'center', ...st }));
  return rows.length;
}
function signatures(sh, row, cols, o) {
  const P = [['Prepared by', o.teacher, o.teacherTitle || 'Teacher'], ['Checked by:', o.checkedBy, o.checkedTitle], ['Noted by:', o.notedBy, o.notedTitle]];
  P.forEach(([lab, name, title], i) => {
    sh.set(row, cols[i], lab, {}); sh.set(row + 2, cols[i], String(name || '').toUpperCase(), { b: true }); sh.set(row + 3, cols[i], title || '', {});
  });
}
function interpretation(o, z, secs, stats, all) {
  const lv = levelOf(all.mps); const desc = { HP: 'a high level of performance', P: 'a proficient level of performance', NRP: 'a nearly proficient level of performance', LP: 'a low level of performance', NP: 'a level of performance that has not yet reached proficiency' }[lv.k];
  let t = 'The Term Examination in ' + (o.subject || z.n) + ' revealed an overall MPS of ' + all.mps.toFixed(2) + '%, indicating ' + desc + '. ';
  if (secs.length > 1) {
    const ranked = secs.map((s, i) => ({ n: s.name, m: stats[i].mps })).sort((a, b) => b.m - a.m);
    t += 'Among ' + secs.length + ' sections, ' + ranked[0].n + ' obtained the highest MPS (' + ranked[0].m.toFixed(2) + '%) and ' + ranked[ranked.length - 1].n + ' the lowest (' + ranked[ranked.length - 1].m.toFixed(2) + '%). ';
  }
  const top = ((all.bands.P + all.bands.HP) / all.cases) * 100; const low = ((all.bands.LP + all.bands.NP) / all.cases) * 100;
  t += top.toFixed(2) + '% of the learners were classified as Proficient or Highly Proficient, while ' + low.toFixed(2) + '% were Low Proficient or Not Proficient. ';
  t += low > 0 ? 'Targeted reinforcement is recommended for the learners who have not yet reached mastery.' : 'Overall, the learners show a strong foundational understanding of the subject.';
  return t;
}

export async function buildMpsWorkbook(z, classes, opts = {}) {
  const o = opts; const secs = quizSections(z, classes); const f = z.f; const d = individualScores(z);
  if (!d.cases) throw new Error('No scanned papers to export.');
  const book = createBook();
  const ids = { deped: book.addImage(DEPED.ext, DEPED.b64), a: book.addImage(SEAL_A.ext, SEAL_A.b64), b: book.addImage(SEAL_B.ext, SEAL_B.b64) };
  const n = secs.length;
  const secCorrect = secs.map((s) => z.key.map((_, i) => sum(s.rows.map((r) => r.marks[i]))));
  const stats = secs.map((s) => mpsSummary(s.rows.map((r) => r.total), f));
  const all = mpsSummary(d.rows.map((r) => r.total), f);
  const itemTot = z.key.map((_, i) => sum(secCorrect.map((c) => c[i])));
  const comps = competencyStats(z).sort((a, b) => a.k - b.k);
  const cellH = { h: 'center', border: true }; const head = { h: 'center', b: true, border: true, fill: BLUE, wrap: true };

  // ---- individual score (the data the other sheets are built from)
  const ind = book.addSheet('individual score', { landscape: true, grid: true });
  ind.width(1, 5).width(2, 32).width(3, 7); for (let i = 0; i < f; i++) ind.width(4 + i, 4.6);
  let r = 1;
  secs.forEach((s, k) => {
    ind.set(r, 2, s.name, { b: true, fill: BLUE, border: true }); ind.set(r, 3, 'Score', head);
    for (let i = 0; i < f; i++) ind.set(r, 4 + i, i + 1, head);
    s.rows.forEach((x, i) => { r++; ind.set(r, 1, i + 1, cellH); ind.set(r, 2, x.name, { border: true }); ind.set(r, 3, x.total, cellH); x.marks.forEach((m, j) => ind.set(r, 4 + j, m, cellH)); });
    r++; ind.set(r, 2, 'TOTAL (correct)', { b: true, border: true }); ind.set(r, 3, '', cellH); secCorrect[k].forEach((c, j) => ind.set(r, 4 + j, c, { ...cellH, b: true }));
    r += 2;
  });

  // ---- CR&LP Computation
  const cl = book.addSheet('CR&LP Computation', { landscape: true, grid: true });
  const rc0 = n + 4; // first column of the competency table
  cl.width(1, 8); for (let i = 0; i < n; i++) cl.width(2 + i, 11); cl.width(n + 2, 9); cl.width(n + 3, 3);
  [58, 9, 16, 10, 10, 8, 18].forEach((w, i) => cl.width(rc0 + i, w));
  cl.merge(1, 1, 1, rc0 + 6, 'CORRECT RESPONSES AND LEVEL OF PROFICIENCY (CR&LP) COMPUTATION  -  ' + z.n, { b: true, sz: 12, h: 'center' });
  cl.height(3, 42);
  cl.set(3, 1, 'Item No.', head); secs.forEach((s, i) => cl.set(3, 2 + i, s.name, head)); cl.set(3, n + 2, 'TOTAL', head);
  z.key.forEach((_, i) => { cl.set(4 + i, 1, i + 1, { ...cellH, b: true }); secs.forEach((s, k) => cl.set(4 + i, 2 + k, secCorrect[k][i], cellH)); cl.set(4 + i, n + 2, itemTot[i], { ...cellH, b: true }); });
  cl.set(4 + f, 1, 'Cases', { ...cellH, b: true, fill: BLUE }); secs.forEach((s, k) => cl.set(4 + f, 2 + k, s.rows.length, { ...cellH, b: true, fill: BLUE })); cl.set(4 + f, n + 2, d.cases, { ...cellH, b: true, fill: BLUE });
  ['Learning Competencies', 'Number of Items', 'Test Placement', 'HPTS (items x cases)', 'APTS (correct responses)', '%', 'Level of Proficiency'].forEach((t, i) => cl.set(3, rc0 + i, t, head));
  if (!comps.length) cl.merge(4, rc0, 4, rc0 + 6, 'No table of specification yet. Set it on the quiz to see the competency analysis.', { wrap: true });
  comps.forEach((c, i) => {
    const row = 4 + i; cl.height(row, 13 * lines(c.name, 62) + 4);
    cl.set(row, rc0, c.name, { border: true, wrap: true }); cl.set(row, rc0 + 1, c.count, cellH); cl.set(row, rc0 + 2, c.itemsText, { ...cellH, wrap: true });
    cl.set(row, rc0 + 3, c.count * c.cases, cellH); cl.set(row, rc0 + 4, c.correct, cellH); cl.set(row, rc0 + 5, c.pct, { ...cellH, fmt: '0.00' }); cl.set(row, rc0 + 6, c.level.n, cellH);
  });

  // ---- MPS
  const mp = book.addSheet('MPS', { landscape: true, tab: YELLOW });
  [16, 8, 5.5, 5.9, 5.5, 7.5, 7, 4.4, 6.5, 5.5, 6.5, 4.4, 6.5, 4.4, 6.5, 6.5, 10].forEach((w, i) => mp.width(i + 1, w));
  heading(mp, 17, o, z, '', true); logos(book, mp, ids, 17, SEAL_A, 1, 8);
  const hr = 10; mp.height(hr, 30); mp.height(hr + 1, 16);
  ['Yr. & Sec.', 'No. of Cases', 'HPS', 'HSO', 'LSO', 'MEAN', 'MPS'].forEach((t, i) => { mp.merge(hr, i + 1, hr + 1, i + 1, t, head); });
  LEVELS.forEach((lv, i) => { mp.merge(hr, 8 + i * 2, hr, 9 + i * 2, lv.n, head); mp.set(hr + 1, 8 + i * 2, 'No.', head); mp.set(hr + 1, 9 + i * 2, '%', head); });
  const line = (row, name, m, st) => {
    const base = { ...cellH, ...st }; mp.set(row, 1, name, { ...base, h: 'left', b: true, wrap: true });
    [m.cases, f, m.hso, m.lso].forEach((v, i) => mp.set(row, 2 + i, v, base)); mp.set(row, 6, m.mean, { ...base, fmt: '0.00' }); mp.set(row, 7, m.mps, { ...base, fmt: '0.00' });
    LEVELS.forEach((lv, i) => { mp.set(row, 8 + i * 2, m.bands[lv.k], base); mp.set(row, 9 + i * 2, (m.bands[lv.k] / m.cases) * 100, { ...base, fmt: '0.00' }); });
  };
  secs.forEach((s, i) => { mp.height(12 + i, 24); line(12 + i, s.name, stats[i], {}); });
  mp.height(12 + n, 24); line(12 + n, 'TOTAL', all, { b: true, fill: BLUE });
  const pr = 14 + n; const text = interpretation(o, z, secs, stats, all);
  mp.merge(pr, 1, pr, 17, text, { wrap: true, v: 'top' }); mp.height(pr, 13 * lines(text, 105) + 6);
  signatures(mp, pr + 2, [1, 7, 14], o);

  // ---- Correct Response
  const cr = book.addSheet('Correct Response', { tab: YELLOW });
  const w = n + 4; const last = 2 * w + 1; const half = Math.ceil(f / 2);
  const widths = [6.5, ...Array(n).fill(5), 6.5, 6.5, 6.5];
  widths.forEach((v, i) => { cr.width(1 + i, v); cr.width(w + 2 + i, v); }); cr.width(w + 1, 3);
  const hrows = heading(cr, last, o, z, '', true); logos(book, cr, ids, last, SEAL_B, 1, 8);
  cr.merge(9, 1, 9, last, 'C  O  R  R  E  C  T       R  E  S  P  O  N  S  E  S', { b: true, h: 'center' });
  cr.height(11, 80);
  const crHead = { ...head, rot: 90 };
  [0, 1].forEach((side) => {
    const c0 = side ? w + 2 : 1;
    cr.set(11, c0, 'Item No.', crHead); secs.forEach((s, i) => cr.set(11, c0 + 1 + i, s.name, crHead));
    cr.set(11, c0 + n + 1, 'TOTAL', crHead); cr.set(11, c0 + n + 2, '%', crHead); cr.set(11, c0 + n + 3, 'LP', crHead);
  });
  for (let i = 0; i < f; i++) {
    const side = i < half ? 0 : 1; const c0 = side ? w + 2 : 1; const row = 12 + (side ? i - half : i); const pct = (itemTot[i] / d.cases) * 100;
    cr.set(row, c0, i + 1, { ...cellH, b: true, fill: BLUE }); secs.forEach((s, k) => cr.set(row, c0 + 1 + k, secCorrect[k][i], cellH));
    cr.set(row, c0 + n + 1, itemTot[i], { ...cellH, b: true }); cr.set(row, c0 + n + 2, pct, { ...cellH, fmt: '0' }); cr.set(row, c0 + n + 3, levelOf(pct).k, { ...cellH, b: true });
  }
  signatures(cr, 12 + half + 1, [1, w + 2, last - 2], o);

  // ---- Unmastered
  const um = book.addSheet('Unmastered', { tab: YELLOW });
  [2.4, 60, 8, 14, 8, 8, 8, 18, 7].forEach((v, i) => um.width(i + 1, v));
  [o.region || '', o.division || '', (o.school || '').toUpperCase(), 'TEST  RESULTS  IN  ' + String(o.subject || z.n).toUpperCase(), z.n, 'School  Year:  ' + (o.schoolYear || '')]
    .forEach((t, i) => um.merge(i + 1, 1, i + 1, 9, t, { h: 'center', b: i === 2 || i === 3 }));
  logos(book, um, ids, 9, SEAL_A, 2, 6);
  um.merge(8, 1, 8, 9, 'LIST OF MASTERED AND UNMASTERED SKILLS', { b: true, h: 'center', sz: 11 });
  um.height(10, 30);
  ['Learning Competencies', 'Number of Items', 'Test Placement', 'HPTS', 'APTS', '%', 'LEVEL OF PROFICIENCY', 'Rank'].forEach((t, i) => um.set(10, 2 + i, t, head));
  if (!comps.length) um.merge(11, 2, 11, 9, 'No table of specification yet. Set it on the quiz to see mastered and unmastered skills.', { wrap: true });
  const ranked = comps.slice().sort((a, b) => b.pct - a.pct); const rank = (c) => 1 + ranked.filter((x) => x.pct > c.pct).length;
  let ur = 11;
  comps.forEach((c) => {
    um.height(ur, 13 * lines(c.name, 66) + 4);
    um.set(ur, 2, c.name, { border: true, wrap: true }); um.set(ur, 3, c.count, cellH); um.set(ur, 4, c.itemsText, { ...cellH, wrap: true });
    um.set(ur, 5, c.count * c.cases, cellH); um.set(ur, 6, c.correct, cellH); um.set(ur, 7, c.pct, { ...cellH, fmt: '0.00' }); um.set(ur, 8, c.level.n, cellH); um.set(ur, 9, rank(c), cellH);
    ur++;
  });
  if (comps.length) {
    ur++;
    LEVELS.slice().reverse().forEach((lv) => {
      um.merge(ur, 1, ur, 9, lv.n, { b: true, h: 'center', fill: BLUE, border: true }); ur++;
      const mine = ranked.filter((c) => c.level.k === lv.k);
      if (!mine.length) { um.merge(ur, 2, ur, 9, 'None', { i: true, color: '808080' }); ur++; }
      mine.forEach((c) => { um.merge(ur, 2, ur, 9, c.name, { wrap: true }); um.height(ur, 13 * lines(c.name, 110) + 3); ur++; });
    });
  }
  ur += 2; um.set(ur, 2, 'Prepared by', {}); um.set(ur + 2, 2, String(o.teacher || '').toUpperCase(), { b: true }); um.set(ur + 3, 2, o.teacherTitle || 'Teacher', {});

  return book.toBase64();
}
