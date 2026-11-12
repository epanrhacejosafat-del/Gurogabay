// lib/sync.ts — syncs this account's data with Supabase, item by item (see syncCore.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { COLLECTIONS, EMPTY_DATA, flatten, unflatten, merge, hash, Remote } from './syncCore';

export async function markSaved(_acctId: string) { /* kept so App.js stays the same; changes are detected automatically */ }

let running = false;
// Returns 'pulled' (this phone got changes: reload the data), 'pushed', 'same', or null (not signed in / busy).
export async function syncNow(acctId: string): Promise<'pulled' | 'pushed' | 'same' | null> {
  if (running) return null;
  running = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const uid = session.user.id;
    const dataKey = 'gurogabay:v1:' + acctId, snapKey = 'gurogabay:snap2:' + uid, rowsKey = 'gurogabay:rows:' + uid;

    const raw = await AsyncStorage.getItem(dataKey);
    const base = raw ? JSON.parse(raw) : EMPTY_DATA;
    const S = JSON.parse((await AsyncStorage.getItem(snapKey)) ?? '{}');
    const R0 = JSON.parse((await AsyncStorage.getItem(rowsKey)) ?? '{}');

    // 1. read EVERYTHING online (no updated_at filter), so nothing depends on timestamps
    const rows: Remote[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from('sync_records')
        .select('collection,id,data,deleted,updated_at').eq('user_id', uid)
        .order('updated_at').order('collection').order('id').range(from, from + 499);
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach((r: any) => { if (COLLECTIONS.includes(r.collection)) rows.push(r); });
      if (data.length < 500) break;
    }

    // 2. merge, then upload this phone's changes
    const { L2, upserts, deletes, S2, changedLocal, R } = merge(flatten(base), S, rows, R0);
    const out = upserts.map((r) => ({ user_id: uid, collection: r.collection, id: r.id, data: r.data, deleted: false }));
    for (let i = 0; i < out.length; i += 200) {
      const { error } = await supabase.from('sync_records').upsert(out.slice(i, i + 200), { onConflict: 'user_id,collection,id' });
      if (error) throw error;
    }
    // deletions: only set deleted = true, never touch the row's data.
    // Found by the row's id column, and (students/classes/quizzes) also by the id inside data, so both kinds of rows are caught.
    const byCol: Record<string, { rows: string[]; items: string[] }> = {};
    deletes.forEach((d) => { const g = (byCol[d.collection] = byCol[d.collection] || { rows: [], items: [] }); g.rows.push(d.id); g.items.push(String(d.data)); });
    for (const col of Object.keys(byCol)) {
      const { rows: rids, items } = byCol[col];
      for (let i = 0; i < rids.length; i += 100) {
        const { error } = await supabase.from('sync_records').update({ deleted: true })
          .eq('user_id', uid).eq('collection', col).in('id', rids.slice(i, i + 100));
        if (error) throw error;
      }
      if (['students', 'classes', 'quizzes'].includes(col)) {
        for (let i = 0; i < items.length; i += 100) {
          const { error } = await supabase.from('sync_records').update({ deleted: true })
            .eq('user_id', uid).eq('collection', col).in('data->>id', items.slice(i, i + 100));
          if (error) throw error;
        }
      }
    }

    // 3. save the merged data (skip if the teacher edited meanwhile; the next sync will pick it up)
    if (changedLocal) {
      const now = await AsyncStorage.getItem(dataKey);
      const nowData = now ? JSON.parse(now) : EMPTY_DATA;
      if (hash(flatten(nowData)) !== hash(flatten(base))) { console.log('[sync] skipped: data changed during sync'); return null; }
      await AsyncStorage.setItem(dataKey, JSON.stringify(unflatten(L2, base)));
    }
    await AsyncStorage.setItem(snapKey, JSON.stringify(S2));
    await AsyncStorage.setItem(rowsKey, JSON.stringify(R));
    const sent = out.length + deletes.length;
    console.log('[sync] read', rows.length, 'rows, uploaded', out.length, 'deleted', deletes.length, changedLocal ? ', phone updated' : '');
    return changedLocal ? 'pulled' : sent ? 'pushed' : 'same';
  } finally {
    running = false;
  }
}