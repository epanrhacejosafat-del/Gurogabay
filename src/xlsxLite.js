// Tiny .xlsx writer (cells, styles, merges, column widths, images, print setup). No formulas: values only.
// Needs only `jszip`. Returns base64 so it works in Expo / React Native as well as Node.
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const EMU = 9525;

class Styles {
  constructor() { this.fonts = []; this.fills = []; this.borders = []; this.xfs = []; this.map = new Map(); this.get({}); }
  idx(list, xml) { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; }
  get(st) {
    const key = JSON.stringify(st); if (this.map.has(key)) return this.map.get(key);
    const font = '<font>' + (st.b ? '<b/>' : '') + (st.i ? '<i/>' : '') + '<sz val="' + (st.sz || 10) + '"/><color rgb="FF' + (st.color || '000000') + '"/><name val="' + (st.name || 'Arial') + '"/></font>';
    const fill = st.fill ? '<fill><patternFill patternType="solid"><fgColor rgb="FF' + st.fill + '"/><bgColor indexed="64"/></patternFill></fill>' : '<fill><patternFill patternType="none"/></fill>';
    const side = (n) => '<' + n + ' style="thin"><color rgb="FF000000"/></' + n + '>';
    const border = st.border ? '<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>' : '<border><left/><right/><top/><bottom/><diagonal/></border>';
    if (!this.fills.length) { this.fills.push('<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'); }
    const f = this.idx(this.fonts, font); const fl = this.idx(this.fills, fill); const b = this.idx(this.borders, border);
    const fmt = st.fmt === '0.00' ? 2 : st.fmt === '0' ? 1 : 0;
    const al = '<alignment' + (st.h ? ' horizontal="' + st.h + '"' : '') + ' vertical="' + (st.v || 'center') + '"' + (st.wrap ? ' wrapText="1"' : '') + (st.rot ? ' textRotation="' + st.rot + '"' : '') + '/>';
    this.xfs.push('<xf numFmtId="' + fmt + '" fontId="' + f + '" fillId="' + fl + '" borderId="' + b + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + al + '</xf>');
    const id = this.xfs.length - 1; this.map.set(key, id); return id;
  }
  xml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts><fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>'
      + '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

class Sheet {
  constructor(book, name, o = {}) {
    this.book = book; this.name = name; this.o = o; this.cells = new Map(); this.merges = []; this.widths = {}; this.heights = {}; this.images = [];
  }
  set(r, c, v, st) { this.cells.set(r * 1000 + c, { r, c, v: v === undefined ? null : v, s: this.book.styles.get(st || {}) }); return this; }
  width(c, w) { this.widths[c] = w; return this; }
  height(r, h) { this.heights[r] = h; return this; }
  // Merge a block; every cell in it gets the style so borders and fills show on the whole block.
  merge(r1, c1, r2, c2, v, st) {
    this.set(r1, c1, v, st);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) this.set(r, c, null, st);
    if (r1 !== r2 || c1 !== c2) this.merges.push(colName(c1) + r1 + ':' + colName(c2) + r2);
    return this;
  }
  image(idx, col, row, w, h, dx = 0, dy = 0) { this.images.push({ idx, col, row, w, h, dx, dy }); return this; }
  xml(hasDrawing) {
    const rows = new Map(); let maxC = 1; let maxR = 1;
    this.cells.forEach((cell) => { if (!rows.has(cell.r)) rows.set(cell.r, []); rows.get(cell.r).push(cell); maxC = Math.max(maxC, cell.c); maxR = Math.max(maxR, cell.r); });
    Object.keys(this.heights).forEach((r) => { if (!rows.has(Number(r))) rows.set(Number(r), []); });
    const rn = [...rows.keys()].sort((a, b) => a - b);
    const data = rn.map((r) => {
      const cs = rows.get(r).sort((a, b) => a.c - b.c).map((x) => {
        const ref = colName(x.c) + r;
        if (x.v === null || x.v === '') return '<c r="' + ref + '" s="' + x.s + '"/>';
        if (typeof x.v === 'number' && isFinite(x.v)) return '<c r="' + ref + '" s="' + x.s + '"><v>' + x.v + '</v></c>';
        return '<c r="' + ref + '" s="' + x.s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(x.v) + '</t></is></c>';
      }).join('');
      const h = this.heights[r];
      return '<row r="' + r + '"' + (h ? ' ht="' + h + '" customHeight="1"' : '') + '>' + cs + '</row>';
    }).join('');
    const cols = Object.keys(this.widths).map(Number).sort((a, b) => a - b).map((c) => '<col min="' + c + '" max="' + c + '" width="' + this.widths[c] + '" customWidth="1"/>').join('');
    const o = this.o;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr>' + (o.tab ? '<tabColor rgb="FF' + o.tab + '"/>' : '') + '<pageSetUpPr fitToPage="1"/></sheetPr>'
      + '<dimension ref="A1:' + colName(maxC) + maxR + '"/><sheetViews><sheetView workbookViewId="0" showGridLines="' + (o.grid ? 1 : 0) + '"' + (this.book.sheets[0] === this ? ' tabSelected="1"' : '') + '/></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>' + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + data + '</sheetData>'
      + (this.merges.length ? '<mergeCells count="' + this.merges.length + '">' + this.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' : '')
      + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
      + '<pageSetup paperSize="' + (o.paper || 9) + '" orientation="' + (o.landscape ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>'
      + (hasDrawing ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';
  }
}

export function createBook() {
  const book = { styles: new Styles(), sheets: [], media: [] };
  book.addImage = (ext, b64) => { book.media.push({ ext, b64 }); return book.media.length - 1; };
  book.addSheet = (name, o) => { const s = new Sheet(book, name, o); book.sheets.push(s); return s; };
  book.toBase64 = async () => {
    const z = new JSZip(); const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const exts = [...new Set(book.media.map((m) => m.ext))];
    const drawn = book.sheets.map((s, i) => ({ s, i, n: i + 1 })).filter((x) => x.s.images.length);
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + exts.map((e) => '<Default Extension="' + e + '" ContentType="image/' + (e === 'jpg' ? 'jpeg' : e) + '"/>').join('')
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + book.sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + drawn.map((x) => '<Override PartName="/xl/drawings/drawing' + x.n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>').join('') + '</Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + ns + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + ns + '"><bookViews><workbookView/></bookViews><sheets>'
      + book.sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + book.sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + ns + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
      + '<Relationship Id="rId' + (book.sheets.length + 1) + '" Type="' + ns + '/styles" Target="styles.xml"/></Relationships>');
    z.file('xl/styles.xml', book.styles.xml());
    book.sheets.forEach((s, i) => {
      const has = s.images.length > 0;
      z.file('xl/worksheets/sheet' + (i + 1) + '.xml', s.xml(has));
      if (!has) return;
      z.file('xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + ns + '/drawing" Target="../drawings/drawing' + (i + 1) + '.xml"/></Relationships>');
      z.file('xl/drawings/_rels/drawing' + (i + 1) + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + s.images.map((im, k) => '<Relationship Id="rId' + (k + 1) + '" Type="' + ns + '/image" Target="../media/image' + (im.idx + 1) + '.' + book.media[im.idx].ext + '"/>').join('') + '</Relationships>');
      z.file('xl/drawings/drawing' + (i + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + ns + '">'
        + s.images.map((im, k) => '<xdr:oneCellAnchor><xdr:from><xdr:col>' + (im.col - 1) + '</xdr:col><xdr:colOff>' + im.dx * EMU + '</xdr:colOff><xdr:row>' + (im.row - 1) + '</xdr:row><xdr:rowOff>' + im.dy * EMU + '</xdr:rowOff></xdr:from><xdr:ext cx="' + im.w * EMU + '" cy="' + im.h * EMU + '"/>'
          + '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="Logo ' + (k + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (k + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + im.w * EMU + '" cy="' + im.h * EMU + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>').join('') + '</xdr:wsDr>');
    });
    book.media.forEach((m, i) => z.file('xl/media/image' + (i + 1) + '.' + m.ext, m.b64, { base64: true }));
    return z.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  };
  return book;
}
