import * as FS from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Timing log for the scanner. It must never break the app: every file operation is wrapped, and nothing here throws.
const rows = [];
let paper = 0;
const NAME = 'gurogabay_perf.csv';

export const now = () => global.performance?.now?.() ?? Date.now();
export const nextPaper = () => ++paper;

const add = (metric, ms, note) => rows.push({ paper, metric, ms: +Number(ms).toFixed(2), epoch: Date.now(), note: note || '' });

// Writes the CSV and returns its uri (current Expo file API first, older API as a fallback, same as App.js).
async function save() {
  const csv = 'paper,metric,ms,epoch_ms,note\n' +
    rows.map((r) => `${r.paper},${r.metric},${r.ms},${r.epoch},${String(r.note).replace(/,/g, ';')}`).join('\n');
  if (FS.File && FS.Paths) {
    const f = new FS.File(FS.Paths.cache, NAME);
    try { if (f.exists) f.delete(); } catch (e) { /* new file */ }
    f.create(); f.write(csv);
    return f.uri;
  }
  const uri = FS.documentDirectory + NAME;
  await FS.writeAsStringAsync(uri, csv);
  return uri;
}
const autosave = () => { try { Promise.resolve(save()).catch(() => {}); } catch (e) { /* logging only */ } };

// Records a duration that was measured elsewhere.
export function logMs(metric, ms, note) {
  add(metric, ms, note);
  if (rows.length % 5 === 0) autosave();
}

// Times an async function. Result and errors pass straight through.
export async function timed(metric, fn, note) {
  const t0 = now();
  try { return await fn(); }
  finally { logMs(metric, now() - t0, note); }
}

// Same for a normal (non-async) function.
export function timedSync(metric, fn, note) {
  const t0 = now();
  try { return fn(); }
  finally { logMs(metric, now() - t0, note); }
}

export async function exportPerf() {
  try {
    const uri = await save();
    await Sharing.shareAsync(uri);
  } catch (e) { /* nothing to share */ }
}