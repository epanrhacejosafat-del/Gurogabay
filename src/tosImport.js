// Upload a ready-made table of specification (PDF, photo or Excel) and turn it into competencies.
// The file is read by the "parse-tos" Supabase Edge Function, so no API key is stored in the app.
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { parseItems } from './records';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// BEGIN normalizeTos
// Cleans what the reader returned: strips "1." numbering, drops item numbers outside the quiz, keeps each item in one competency only.
export function normalizeTos(data, max) {
  const raw = Array.isArray(data && data.comps) ? data.comps : [];
  const comps = []; const notes = []; const owner = {};
  raw.forEach((x, k) => {
    const label = 'Competency ' + (k + 1);
    const n = String((x && x.n) || '').replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\s+/g, ' ').trim();
    if (!n) return;
    const { items, bad } = parseItems(Array.isArray(x.items) ? x.items.join(',') : x.items, max);
    if (bad.length) notes.push(label + ': ignored ' + bad.join(', ') + ' (not an item from 1 to ' + max + ').');
    const clash = [];
    const mine = items.filter((it) => { if (owner[it] !== undefined) { clash.push(it); return false; } owner[it] = k; return true; });
    if (clash.length) notes.push(label + ': item ' + clash.join(', ') + ' is already in an earlier competency.');
    if (!mine.length) { notes.push(label + ' has no valid item numbers and was skipped.'); return; }
    let lv = Array.isArray(x.lv) ? x.lv.slice(0, 6).map((v) => Math.max(0, parseInt(v, 10) || 0)) : null;
    if (lv) { while (lv.length < 6) lv.push(0); if (!lv.some((v) => v)) lv = null; }
    comps.push({ n, items: mine, lv });
  });
  return { comps, notes };
}
// END normalizeTos

async function readBase64(uri) {
  if (FS.File) return new FS.File(uri).base64(); // current Expo file API
  return FS.readAsStringAsync(uri, { encoding: 'base64' }); // older Expo versions
}

function mimeOf(a) {
  const m = String(a.mimeType || '').toLowerCase(); const name = String(a.name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/.test(name)) return 'image/*';
  if (m === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (m === XLSX || name.endsWith('.xlsx')) return XLSX;
  return '';
}

// Lets the teacher pick the file, sends it to the Edge Function and returns { comps, notes }, or null if the picker was cancelled.
export async function importTos(z) {
  const pick = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*', XLSX], copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets || !pick.assets.length) return null;
  const a = pick.assets[0]; const kind = mimeOf(a);
  if (!kind) throw new Error('Choose a PDF, a photo or an Excel (.xlsx) file.');
  let file; let mediaType = kind;
  if (kind === 'image/*') {
    const im = await manipulateAsync(a.uri, [{ resize: { width: 1600 } }], { compress: 0.85, format: SaveFormat.JPEG, base64: true });
    file = im.base64; mediaType = 'image/jpeg';
  } else file = await readBase64(a.uri);
  if (!file || file.length > 9000000) throw new Error('The file is too large. Use a file under about 6 MB.');
  const { data, error } = await supabase.functions.invoke('parse-tos', { body: { file, mediaType, items: z.f } });
  if (error) {
    let msg = error.message || 'Could not reach the server.';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep the generic message */ }
    throw new Error(msg);
  }
  return normalizeTos(data, z.f);
}
