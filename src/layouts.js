// Builds the scan layout for any quiz from its number of items and choices.
// This copies the math of the website's Sheet Editor (sheetutils.js: gridFor + buildBlankSheet, sheet v1),
// so the positions the scanner looks at are exactly the ones that were printed.
// Units: pt, origin top-left, A4 sheet space (the sheet is scaled when printed on Letter/Folio, which the scanner handles).

export const SHEET_W = 595.28;
export const SHEET_H = 841.89;
export const PAGE = [SHEET_W, SHEET_H];

const BAND_TOP = 328, BAND_BOTTOM = 800, BAND_AREA_W = 495;
const PITCH_MAX = 48, D_MAX = 26, CP_MAX = 44, MIN_CHOICE_GAP = 3, NUM_PAD = 5, BAND_RIGHT_PAD = 4;
const RULES = [
  { cols: 1, maxRows: 10, gap: 0 },
  { cols: 2, maxRows: 15, gap: 19 },
  { cols: 3, maxRows: 20, gap: 9 },
  { cols: 4, maxRows: 25, gap: 5 },
];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Helvetica digits are 556/1000 em wide
const sizesFor = (d, items) => {
  const numSize = Math.min(11.7, Math.max(8, d * 0.45));
  const numGap = Math.max(8, d * 0.5);
  return { numGap, bandDx: numGap + (String(items).length * 556 * numSize) / 1000 + NUM_PAD };
};

export function buildLayout(items, choiceCount) {
  items = Math.max(1, Math.min(100, Math.floor(items) || 1));
  const nC = Math.max(2, Math.min(5, choiceCount || 5));
  const choices = LETTERS.slice(0, nC); // True/False sheets are read as A (True) and B (False)

  const rule = RULES.find((r) => r.cols * r.maxRows >= items) || RULES[RULES.length - 1];
  const { cols, gap } = rule;
  const rows = Math.ceil(items / cols);
  const pitch = Math.min(PITCH_MAX, (BAND_BOTTOM - BAND_TOP) / rows);
  const fullBandW = (BAND_AREA_W - (cols - 1) * gap) / cols;

  let d = Math.min(D_MAX, pitch * 0.76);
  const first = sizesFor(d, items);
  d = Math.min(d, (fullBandW - first.bandDx - BAND_RIGHT_PAD - (nC - 1) * MIN_CHOICE_GAP) / nC);
  const sz = sizesFor(d, items);
  const cp = Math.min(CP_MAX, (fullBandW - sz.bandDx - BAND_RIGHT_PAD - d) / (nC - 1));
  const bandW = Math.min(fullBandW, sz.bandDx + (nC - 1) * cp + d + BAND_RIGHT_PAD);
  const x0 = (SHEET_W - (cols * bandW + (cols - 1) * gap)) / 2;

  const rowY = (r) => BAND_TOP + pitch / 2 + r * pitch; // centre of row r (same as top + d/2 + r*pitch on the sheet)

  // side bars: 10 beside the header, then one per answer row (first and last are longer)
  const left = [], right = [];
  for (let k = 0; k < 10; k++) {
    const y = 110 + 18 * k;
    left.push({ y, x: 22, len: 14 });
    right.push({ y, x: SHEET_W - 22 - 14, len: 14 });
  }
  for (let r = 0; r < rows; r++) {
    const len = r === 0 || r === rows - 1 ? 24 : 14;
    left.push({ y: rowY(r), x: 22, len });
    right.push({ y: rowY(r), x: SHEET_W - 22 - len, len });
  }

  const bubbles = [];
  for (let g = 0; g < cols; g++) {
    const count = Math.min(rows, items - g * rows);
    if (count <= 0) continue;
    const gx = x0 + g * (bandW + gap) + sz.bandDx;
    for (let r = 0; r < count; r++) {
      const q = g * rows + r + 1;
      choices.forEach((choice, i) => bubbles.push({ q, choice, x: gx + d / 2 + i * cp, y: rowY(r) }));
    }
  }

  return {
    unit: 'pt, origin top-left',
    page: PAGE,
    marks: { left, right },
    id: { cols: 8, rows: 10, x0: 390, pitchX: 20, y0: 110, pitchY: 18, radius: 6.5 },
    answers: { n: items, choices, bubbles, rows, cols, y0: rowY(0), pitchY: pitch, pitchX: cp, radius: d / 2 },
  };
}

export default {};