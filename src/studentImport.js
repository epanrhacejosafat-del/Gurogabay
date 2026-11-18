// npx expo install expo-document-picker && npm i xlsx
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const isInit = (t) => /^[A-Za-z]\.?$/.test(t);

// Display name used everywhere in the app: "Last, First M."
export const fullName = (p) => {
  const mid = clean(p.mid);
  return clean(p.last) + ', ' + clean(p.first) + (mid ? ' ' + (mid.length === 1 ? mid.toUpperCase() + '.' : mid) : '');
};

// Splits a typed name into parts. Handles "Last, First M." and "First M. Last".
export function nameParts(raw) {
  const s = clean(raw); if (!s) return null;
  if (s.includes(',')) {
    const i = s.indexOf(','); const t = clean(s.slice(i + 1)).split(' ').filter(Boolean); let mid = '';
    if (t.length > 1 && isInit(t[t.length - 1])) mid = t.pop().replace('.', '');
    return { last: clean(s.slice(0, i)), first: t.join(' '), mid };
  }
  const t = s.split(' '); if (t.length < 2) return { last: s, first: '', mid: '' };
  const last = t.pop(); let mid = '';
  if (t.length > 1 && isInit(t[t.length - 1])) mid = t.pop().replace('.', '');
  return { last, first: t.join(' '), mid };
}

const HEAD = {
  id: ['id', 'student id', 'student no', 'student number', 'lrn', 'id number', 'id no'],
  first: ['first name', 'firstname', 'first', 'given name'],
  mid: ['middle name', 'middlename', 'middle', 'm.i.', 'mi'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'student name', 'learner name', "learner's name"],
};
const col = (cells, list) => cells.findIndex((c) => list.includes(clean(c).toLowerCase()));

function fromTable(rows) {
  rows = rows.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
  let h = -1, k = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c = { id: col(rows[i], HEAD.id), first: col(rows[i], HEAD.first), mid: col(rows[i], HEAD.mid), last: col(rows[i], HEAD.last), name: col(rows[i], HEAD.name) };
    if ((c.first >= 0 && c.last >= 0) || c.name >= 0) { h = i; k = c; break; }
  }
  const out = [];
  if (k) {
    for (const r of rows.slice(h + 1)) {
      const p = k.first >= 0 && k.last >= 0 ? { first: r[k.first], last: r[k.last], mid: k.mid >= 0 ? r[k.mid] : '' } : nameParts(r[k.name]);
      if (p && (p.first || p.last)) out.push({ id: k.id >= 0 ? r[k.id] : '', ...p });
    }
    return out;
  }
  for (const r of rows) { // no header row: an ID-looking cell + the name
    const cells = r.filter(Boolean); const ix = cells.findIndex((c) => /^\d{1,12}$/.test(c));
    const id = ix >= 0 ? cells.splice(ix, 1)[0] : '';
    if (!cells.length) continue;
    const p = cells.length === 1 ? nameParts(cells[0]) : { last: cells[0], first: cells[1], mid: cells[2] || '' };
    if (p && (p.first || p.last)) out.push({ id, ...p });
  }
  return out;
}

function parseCsv(text) { // small CSV parser (quotes, commas, tabs)
  const delim = text.indexOf('\t') >= 0 && text.indexOf(',') < 0 ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); rows.push(row); return rows;
}

async function readBase64(uri) {
  if (FS.File) return await new FS.File(uri).base64();
  return await FS.readAsStringAsync(uri, { encoding: 'base64' });
}

// Opens the file picker and returns [{ id, first, mid, last }], or null if cancelled.
export async function pickStudentFile() {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*', 'text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets || !res.assets[0]) return null;
  const a = res.assets[0]; const ext = (a.name || '').split('.').pop().toLowerCase();
  let rows;
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const wb = XLSX.read(await readBase64(a.uri), { type: 'base64' });
    rows = fromTable(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }));
  } else if (['csv', 'tsv', 'txt'].includes(ext)) {
    const text = FS.File ? await new FS.File(a.uri).text() : await FS.readAsStringAsync(a.uri);
    rows = fromTable(parseCsv(text));
  } else if (ext === 'pdf' || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    // PDFs and photos are read by the parse-students Edge Function (Gemini)
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const { data, error } = await supabase.functions.invoke('parse-students', { body: { base64: await readBase64(a.uri), mime } });
    if (error) throw new Error(error.message || 'Could not read the file');
    rows = (data && data.students || []).map((x) => ({ id: clean(x.id), first: clean(x.firstName), mid: clean(x.middleName), last: clean(x.lastName) }))
      .filter((x) => x.first || x.last);
  } else throw new Error('Use a PDF, Excel, CSV or a photo of the class list.');
  if (!rows.length) throw new Error('No students were found in this file.');
  return rows;
}
