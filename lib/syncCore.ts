// lib/syncCore.ts — pure logic (no Supabase, no storage). Splits the app's data into items and merges them.
export type Remote = { collection: string; id: string; data: any; deleted: boolean };
export const COLLECTIONS = ['quizzes', 'papers', 'classes', 'students', 'ecr', 'meta'];
// collections whose item id lives in data.id (the website's row id can be a different random id)
const ID_COLS = ['quizzes', 'classes', 'students'];

// 12-character random id (same shape as nanoid(12)) used for the database `id` column of new rows
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
const newRowId = (used: Set<string>) => {
  let id = '';
  do { id = ''; for (let i = 0; i < 12; i++) id += ALPHABET[Math.floor(Math.random() * 64)]; } while (used.has(id));
  used.add(id);
  return id;
};

function stable(o: any): string {
  if (o === null || typeof o !== 'object') return JSON.stringify(o) ?? 'null';
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
export function hash(o: any): string {
  const s = stable(JSON.parse(JSON.stringify(o ?? null)));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + s.length.toString(36);
}

// an item without a real id can't be synced (it would collide with every other id-less item)
export const good = (id: any) => id !== undefined && id !== null && String(id).trim() !== '' && String(id) !== 'undefined' && String(id) !== 'null';

export const EMPTY_DATA = { quizzes: [], classes: [], students: [], log: [], nextId: 0, ecr: {} };

// One quiz, one class, one student, one scanned paper, one class record = one item each.
export function flatten(b: any): Record<string, any> {
  const L: Record<string, any> = {};
  (b.quizzes || []).forEach((q: any) => {
    if (!good(q.id)) return;
    const { res, ...rest } = q; L['quizzes/' + q.id] = rest;
    (res || []).forEach((r: any) => { L['papers/' + q.id + '~' + (r.uid || 'i' + hash(r))] = { ...r, quizId: q.id }; });
  });
  (b.classes || []).forEach((c: any) => { if (good(c.id)) L['classes/' + c.id] = c; });
  (b.students || []).forEach((s: any) => { if (good(s.id)) L['students/' + s.id] = s; });
  Object.keys(b.ecr || {}).forEach((cid) => { if (good(cid)) L['ecr/' + cid] = b.ecr[cid]; });
  L['meta/main'] = { log: b.log || [], nextId: b.nextId ?? 0 };
  return L;
}

// Rebuilds the app's data from items, keeping this phone's order and putting new items in sensible places.
export function unflatten(L: Record<string, any>, base: any): any {
  const keys = Object.keys(L);
  const pick = (col: string, arr: any[], idOf: (x: any) => string, front: boolean) => {
    const seen = new Set<string>(); const kept: any[] = [];
    arr.forEach((x) => { const k = col + '/' + idOf(x); if (L[k] !== undefined) { kept.push(L[k]); seen.add(k); } });
    const added = keys.filter((k) => k.startsWith(col + '/') && !seen.has(k)).sort().map((k) => L[k]);
    return front ? [...added.reverse(), ...kept] : [...kept, ...added];
  };
  const quizzes = pick('quizzes', base.quizzes || [], (x) => x.id, true);
  const oldRes: Record<string, any[]> = {}; (base.quizzes || []).forEach((q: any) => { oldRes[q.id] = q.res || []; });
  quizzes.forEach((q: any, i: number) => {
    const mine = keys.filter((k) => k.startsWith('papers/' + q.id + '~'));
    const seen = new Set<string>(); const res: any[] = [];
    (oldRes[q.id] || []).forEach((r) => { const k = 'papers/' + q.id + '~' + (r.uid || 'i' + hash(r)); if (L[k] !== undefined) { const { quizId, ...p } = L[k]; res.push(p); seen.add(k); } });
    mine.filter((k) => !seen.has(k)).sort().forEach((k) => { const { quizId, ...p } = L[k]; res.push(p); });
    quizzes[i] = { ...q, res };
  });
  const ecr: Record<string, any> = {}; keys.filter((k) => k.startsWith('ecr/')).forEach((k) => { ecr[k.slice(4)] = L[k]; });
  const meta = L['meta/main'] || { log: [], nextId: 0 };
  return {
    ...base, quizzes,
    classes: pick('classes', base.classes || [], (x) => x.id, false),
    students: pick('students', base.students || [], (x) => String(x.id), false),
    ecr, log: meta.log || [], nextId: Number(meta.nextId) || 0,
  };
}

// L = this phone's items, S = fingerprints at the last sync, remote = ALL online rows,
// rowIds = item key -> database row id (they differ for items the website created).
// An item changed on only one side is taken from that side. If the same item changed on both, the online copy wins.
export function merge(L: Record<string, any>, S: Record<string, string>, remote: Remote[], rowIds: Record<string, string> = {}) {
  const L2 = { ...L }; const R: Record<string, string> = { ...rowIds };
  const applied: Record<string, string | null> = {}; const forceUp = new Set<string>();

  // the item's identity is data.id when the writer (e.g. the website) set one; r.id is just the database row id
  const keyOf = (r: Remote) => {
    let itemId = r.id;
    if (ID_COLS.includes(r.collection)) {
      if (r.data && typeof r.data === 'object' && good(r.data.id)) itemId = String(r.data.id);
      else { const hit = Object.keys(R).find((x) => x.startsWith(r.collection + '/') && R[x] === r.id); if (hit) itemId = hit.slice(r.collection.length + 1); }
    }
    return r.collection + '/' + itemId;
  };
  // an id can be reused after a delete: if a live row exists for an item, older deleted rows of that id are ignored
  const live = new Set(remote.filter((r) => good(r.id) && !r.deleted).map(keyOf));
  const tomb = new Set<string>();   // database rows that are deleted online (collection/row id)

  for (const r of remote) {
    if (!good(r.id)) continue;
    const k = keyOf(r);
    if (r.deleted) tomb.add(r.collection + '/' + r.id);
    if (r.deleted && live.has(k)) continue;
    const itemId = k.slice(r.collection.length + 1);
    R[k] = r.id;
    let data = r.data;
    if (!r.deleted && data && typeof data === 'object') {
      if (ID_COLS.includes(r.collection) && !good(data.id)) data = { ...data, id: itemId };
      if (r.collection === 'papers') { const [qid, puid] = r.id.split('~'); data = { ...data, quizId: data.quizId ?? qid, uid: data.uid ?? puid }; }
      if (hash(data) !== hash(r.data)) forceUp.add(k);      // write the repaired item back online
    }
    const rh = r.deleted ? null : hash(data);
    if (rh === (S[k] ?? null) && !forceUp.has(k)) continue;     // our own echo, nothing new
    const lh = L[k] === undefined ? null : hash(L[k]);
    if (lh === rh && !forceUp.has(k)) { applied[k] = rh; continue; } // same on both sides
    if (r.deleted) delete L2[k]; else L2[k] = data;
    applied[k] = rh;
  }
  // rows removed for good online (e.g. deleted in the Supabase table editor): drop the items this phone has not changed since the last sync
  if (remote.length) {
    const seen = new Set(remote.filter((r) => good(r.id)).map(keyOf));
    Object.keys(S).forEach((k) => {
      if (k === 'meta/main' || seen.has(k) || L2[k] === undefined || hash(L2[k]) !== S[k]) return;
      delete L2[k]; applied[k] = null;
    });
  }
  // a paper whose quiz is gone is dropped
  Object.keys(L2).forEach((k) => { if (k.startsWith('papers/') && !L2['quizzes/' + L2[k].quizId]) delete L2[k]; });
  // what must be uploaded: new/changed items, and deletions (using each item's real database row id)
  const base = (k: string) => (k in applied ? applied[k] : (S[k] ?? null));
  const itemOf = (k: string) => k.split('/').slice(1).join('/');
  const used = new Set<string>(Object.values(R));
  // new students/classes/quizzes get their own random row id; the item's real id stays inside data.id
  const rid = (k: string) => {
    const col = k.split('/')[0];
    // an id that is used again after a delete gets a brand-new row; the old deleted row is left alone
    if (!R[k] || tomb.has(col + '/' + R[k])) R[k] = ID_COLS.includes(col) ? newRowId(used) : itemOf(k);
    return R[k];
  };
  const ridOld = (k: string) => R[k] ?? itemOf(k);   // deletions never create ids
  const upserts: Remote[] = []; const deletes: Remote[] = [];
  Object.keys(L2).forEach((k) => { if (hash(L2[k]) !== base(k) || forceUp.has(k)) { upserts.push({ collection: k.split('/')[0], id: rid(k), data: L2[k], deleted: false }); } });
  // deletions only flag the row (deleted = true); the row's data is left untouched online
  new Set([...Object.keys(S), ...Object.keys(applied)]).forEach((k) => {
    if (L2[k] === undefined && base(k) !== null && good(k.split('/').slice(1).join('/'))) { deletes.push({ collection: k.split('/')[0], id: ridOld(k), data: k.split('/').slice(1).join('/'), deleted: true }); } // data = the item's own id (data.id)
  });
  const S2: Record<string, string> = {}; Object.keys(L2).forEach((k) => { S2[k] = hash(L2[k]); });
  const changedLocal = Object.keys(L2).some((k) => L[k] === undefined || hash(L[k]) !== hash(L2[k])) || Object.keys(L).some((k) => L2[k] === undefined);
  return { L2, upserts, deletes, S2, changedLocal, R };
}