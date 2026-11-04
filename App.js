import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet, Switch, Alert, Share, Image,
  ActivityIndicator, useColorScheme, Platform, StatusBar, KeyboardAvoidingView, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { readPhoto, fromBase64, rgbaToGray, ScanError } from './src/omr';
import LAYOUTS from './src/layouts';
import { TRACKS, termCalc, finalCalc, individualScores, mpsSummary, levelOf, LEVELS, r2, csv as toCsv } from './src/records';

const jpeg = require('jpeg-js');
const KEY = 'gurogabay:v1';
const SCAN_PX = 1400; // longest side of the photo that gets read. Lower = faster, higher = more accurate
const A4 = 595 / 842;
const LET = ['A', 'B', 'C', 'D', 'E'];
const PAL = ['#f0c24b', '#7fb59a', '#e08e79', '#8aa6d6', '#b99ad0'];
const LIGHT = { bg: '#eceee9', card: '#ffffff', ink: '#1d2b3a', mute: '#66727e', red: '#e5342d', green: '#0a9d58' };
const DARK = { bg: '#161c22', card: '#212a33', ink: '#eef1f3', mute: '#9aa7b2', red: '#ff6b64', green: '#3ecf8e' };
const TITLES = { home: 'Quizzes', classes: 'Classes', sheet: 'Spreadsheet', recent: 'Recent' };
const ICONS = { home: 'home-outline', classes: 'people-outline', sheet: 'document-text-outline', recent: 'time-outline' };
const today = () => new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMPTY = { quizzes: [], classes: [], students: [], records: [], log: [], nextId: 1001 };

// Older saved data stored students as plain names and had demo scores. Convert it.
function migrate(d) {
  d = { ...EMPTY, ...d };
  const byName = {};
  d.students.forEach((s) => { byName[s.name] = s; });
  d.classes.forEach((c) => {
    c.s = (c.s || []).map((x) => {
      if (typeof x !== 'string') return x;
      if (!byName[x]) { const st = { id: d.nextId++, name: x }; d.students.push(st); byName[x] = st; }
      return byName[x].id;
    });
  });
  d.quizzes.forEach((q) => { q.res = (q.res || []).filter((r) => r.ans); });
  return d;
}
const scoreOf = (z, r) => z.key.reduce((n, k, i) => n + (r.ans[i] === LET[k] ? 1 : 0), 0);

function Btn({ s, label, onPress, style, disabled }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[s.pill, style, disabled && { opacity: 0.4 }]}><Text style={s.pillT}>{label}</Text></Pressable>;
}
function Chip({ s, label, on, onPress }) {
  return <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipT, on && s.chipTOn]}>{label}</Text></Pressable>;
}
function Bar({ s, onCancel, onSave, cancelLabel = 'CANCEL' }) {
  return (
    <View style={s.bar}>
      <Pressable onPress={onCancel}><Text style={s.cancel}>{cancelLabel}</Text></Pressable>
      {onSave ? <Pressable onPress={onSave}><Text style={s.save}>SAVE</Text></Pressable> : null}
    </View>
  );
}
function AddRow({ s, c, placeholder, onAdd }) {
  const [v, setV] = useState('');
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(''); } };
  return (
    <View style={s.addrow}>
      <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={v} onChangeText={setV} placeholder={placeholder}
        placeholderTextColor={c.mute} onSubmitEditing={go} />
      <Btn s={s} label="Add" onPress={go} style={{ marginTop: 0 }} />
    </View>
  );
}

function QuizForm({ s, c, classes, onSave, onCancel }) {
  const [name, setName] = useState(''); const [f, setF] = useState(30);
  const [picked, setPicked] = useState([]); const [sh, setSh] = useState('');
  const tog = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => (name.trim() ? onSave({ name: name.trim(), f, c: picked, sh: sh.trim() || name.trim() }) : Alert.alert('Enter a quiz name'));
  return (
    <View style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Bar s={s} onCancel={onCancel} onSave={save} />
        <Text style={s.lab}>Name:</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Quiz name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Answer sheet form:</Text>
        <View style={s.chips}>{[30, 60, 100].map((n) => <Chip key={n} s={s} label={n + ' questions'} on={f === n} onPress={() => setF(n)} />)}</View>
        <Text style={s.lab}>Classes:</Text>
        <View style={s.chips}>
          {classes.length ? classes.map((x) => <Chip key={x.id} s={s} label={x.n} on={picked.includes(x.id)} onPress={() => tog(x.id)} />)
            : <Text style={s.sub}>No classes yet. Create one on the Classes tab.</Text>}
        </View>
        <Text style={s.lab}>Spreadsheet name:</Text>
        <TextInput style={s.input} value={sh} onChangeText={setSh} placeholder="Spreadsheet name" placeholderTextColor={c.mute} maxLength={40} />
      </ScrollView>
    </View>
  );
}

function ClassForm({ s, c, students, classes, onSave, onCancel }) {
  const [name, setName] = useState(''); const [hide, setHide] = useState(false);
  const [picked, setPicked] = useState([]); const [added, setAdded] = useState([]);
  const pool = [
    ...students.map((st) => ({ key: 'e' + st.id, name: st.name, from: classes.filter((x) => x.s.includes(st.id)).map((x) => x.n).join(', ') })),
    ...added.map((n) => ({ key: 'n' + n, name: n, from: '' })),
  ].filter((x) => !hide || !x.from);
  const tog = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const save = () => {
    if (!name.trim()) return Alert.alert('Enter a class name');
    onSave({ name: name.trim(), ids: picked.filter((k) => k[0] === 'e').map((k) => +k.slice(1)), created: picked.filter((k) => k[0] === 'n').map((k) => k.slice(1)) });
  };
  return (
    <View style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Bar s={s} onCancel={onCancel} onSave={save} />
        <Text style={s.lab}>Name:</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Class name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Students:</Text>
        <View style={s.row}><Text style={[s.txt, { flex: 1 }]}>Hide students in other classes</Text>
          <Switch value={hide} onValueChange={setHide} trackColor={{ true: c.green }} /></View>
        {pool.length ? pool.map((x) => (
          <Pressable key={x.key} style={s.stu} onPress={() => tog(x.key)}>
            <View style={[s.box, picked.includes(x.key) && s.boxOn]}>{picked.includes(x.key) && <Ionicons name="checkmark" size={16} color={c.bg} />}</View>
            <Text style={[s.txt, { flex: 1 }]}>{x.name}</Text>{x.from ? <Text style={s.sub}>{x.from}</Text> : null}
          </Pressable>
        )) : <Text style={s.sub}>No students to show. Add a new student below.</Text>}
        <AddRow s={s} c={c} placeholder="New student name" onAdd={(n) => { if (!added.includes(n)) { setAdded([...added, n]); setPicked([...picked, 'n' + n]); } }} />
      </ScrollView>
    </View>
  );
}

function ScanModal({ s, c, quizzes, students, initial, onSave, onClose }) {
  const [perm, ask] = useCameraPermissions();
  const cam = useRef(null);
  const [qid, setQid] = useState(initial || quizzes[0].id);
  const [phase, setPhase] = useState('camera'); // camera | busy | result
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [res, setRes] = useState(null); const [fix, setFix] = useState({}); const [who, setWho] = useState(null);
  const [box, setBox] = useState(null); const [dbg, setDbg] = useState(null);
  const fit = (e) => {
    const { width: W, height: H } = e.nativeEvent.layout;
    let h = H * 0.96; let w = h * A4;
    if (w > W * 0.96) { w = W * 0.96; h = w / A4; }
    setBox({ x: (W - w) / 2, y: (H - h) / 2, w, h });
  };
  const z = quizzes.find((x) => x.id === qid);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const snap = async () => {
    if (z.key.some((k) => k < 0)) { setErr('Set the answer key for this quiz first. Open the quiz and tap the correct answers.'); return; }
    setErr(''); setNote(''); setPhase('busy');
    try {
      const t0 = Date.now();
      const pic = await cam.current.takePictureAsync({ quality: 0.8, skipProcessing: true, shutterSound: false });
      const k = SCAN_PX / Math.max(pic.width, pic.height);
      const small = await manipulateAsync(pic.uri, [{ resize: { width: Math.round(pic.width * k) } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
      await new Promise((r) => setTimeout(r, 150)); // let the "Reading" message show before the heavy work
      const raw = jpeg.decode(fromBase64(small.base64), { useTArray: true });
      const out = readPhoto(rgbaToGray(raw.data, raw.width, raw.height), raw.width, raw.height, LAYOUTS);
      if (out.n !== z.f) throw new ScanError(`This is a ${out.n}-question sheet, but this quiz uses ${z.f} questions.`);
      console.log('scan ms', Date.now() - t0);
      setRes(out); setFix({});
      setWho(out.studentId.includes('?') ? null : students.find((st) => String(st.id) === out.studentId) || null);
      setPhase('result');
    } catch (e) {
      console.log('scan error', e);
      setErr(e instanceof ScanError ? e.message : 'Could not read the photo: ' + ((e && e.message) || String(e)));
      if (e && e.debugUri) { setDbg({ uri: e.debugUri, ratio: e.debugRatio }); setPhase('fail'); } else setPhase('camera');
    }
  };

  if (phase === 'result' && res) {
    const letters = res.answers.map((a) => (a.status === 'ok' ? a.choice[0] : fix[a.q] || (a.status === 'multiple' ? '?' : '-')));
    const score = letters.filter((l, i) => l === LET[z.key[i]]).length;
    const flagged = res.answers.filter((a) => a.status !== 'ok');
    const lay = LAYOUTS[z.f]; const [PW, PH] = lay.page; const R = lay.answers.radius * 1.3;
    const pos = {}; lay.answers.bubbles.forEach((b) => { (pos[b.q] = pos[b.q] || {})[b.choice] = b; });
    const rings = [];
    res.answers.forEach((ans, i) => {
      const right = LET[z.key[i]]; const L = letters[i];
      const marked = L === '?' || L === '-' ? (ans.status === 'multiple' ? ans.choice : []) : [L];
      const at = (ch, color, thin) => { const b = pos[ans.q] && pos[ans.q][ch]; if (b) rings.push({ x: b.x, y: b.y, color, thin }); };
      if (marked.length === 1 && marked[0] === right) at(right, c.green);
      else if (marked.length) { marked.forEach((m) => at(m, c.red)); at(right, c.green, true); }
      else at(right, c.red); // left blank: circle the answer that was missed
    });
    const unmatched = res.studentId.includes('?') || !students.find((st) => String(st.id) === res.studentId);
    return (
      <View style={s.sheet}>
        <Bar s={s} onCancel={() => { setPhase('camera'); setRes(null); }} cancelLabel="RETAKE" onSave={who ? () => {
          onSave(qid, { id: who.id, name: who.name, ans: letters.join(''), d: today() });
          setNote(`Saved ${who.name}: ${score}/${z.f}. Scan the next paper.`); setPhase('camera'); setRes(null);
        } : null} />
        <ScrollView>
          <Text style={s.h2}>{who ? who.name : 'Student not found'}</Text>
          <Text style={s.sub2}>Student ID read: {res.studentId || 'none'}. Quiz: {z.n}</Text>
          <Text style={[s.h2, { color: c.green }]}>{score} / {z.f}</Text>
          {unmatched && !who ? (
            <View>
              <Text style={s.lab}>Pick the student:</Text>
              <View style={s.chips}>{students.length ? students.map((st) => <Chip key={st.id} s={s} label={st.name} on={false} onPress={() => setWho(st)} />)
                : <Text style={s.sub}>Add students in a class first.</Text>}</View>
            </View>
          ) : null}
          {flagged.length ? (
            <View>
              <Text style={s.lab}>Check these questions:</Text>
              {flagged.map((a) => (
                <View key={a.q} style={s.kr}>
                  <Text style={s.kn}>{a.q}</Text>
                  {LET.map((l) => <Pressable key={l} onPress={() => setFix({ ...fix, [a.q]: l })} style={[s.kb, fix[a.q] === l && s.kbOn]}><Text style={[s.txt, fix[a.q] === l && { color: c.bg }]}>{l}</Text></Pressable>)}
                  <Text style={[s.sub, { marginLeft: 6 }]}>{a.status === 'multiple' ? 'two marks' : 'blank'}</Text>
                </View>
              ))}
            </View>
          ) : <Text style={s.sub2}>Every answer was read clearly.</Text>}
          <Text style={[s.sub2, { marginTop: 14 }]}>Green circle = correct answer. Red circle = wrong or missed.</Text>
          <View style={{ width: '100%', aspectRatio: PW / PH, marginTop: 6 }}>
            <Image source={{ uri: res.reviewUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
            {rings.map((g, i) => (
              <View key={i} pointerEvents="none" style={{
                position: 'absolute', left: ((g.x - R) / PW) * 100 + '%', top: ((g.y - R) / PH) * 100 + '%',
                width: ((2 * R) / PW) * 100 + '%', height: ((2 * R) / PH) * 100 + '%',
                borderRadius: 999, borderWidth: g.thin ? 1.5 : 2.5, borderColor: g.color,
              }} />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'fail' && dbg) {
    return (
      <View style={s.sheet}>
        <Bar s={s} onCancel={() => { setPhase('camera'); setDbg(null); }} cancelLabel="BACK" onSave={null} />
        <ScrollView>
          <Text style={s.h2}>Could not read the sheet</Text>
          <Text style={s.sub2}>{err}</Text>
          <Text style={s.sub2}>Green boxes are the side stripes the app found. Red boxes are other dark marks it ignored. A good scan has a full column of green boxes on both sides.</Text>
          <Image source={{ uri: dbg.uri }} style={{ width: '100%', aspectRatio: dbg.ratio, marginTop: 12 }} resizeMode="contain" />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.sheet}>
      <Bar s={s} onCancel={onClose} cancelLabel="CLOSE" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 12 }}>
        <View style={s.chips}>{quizzes.map((q) => <Chip key={q.id} s={s} label={q.n} on={qid === q.id} onPress={() => { setQid(q.id); setErr(''); }} />)}</View>
      </ScrollView>
      {perm && perm.granted ? (
        <View style={{ flex: 1 }} onLayout={fit}>
          <CameraView ref={cam} style={{ flex: 1 }} facing="back" onMountError={(e) => setErr('Camera could not start: ' + ((e && e.message) || 'unknown error'))} />
          {box ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }}>
              {[{ top: -2, left: -2, borderTopWidth: 5, borderLeftWidth: 5 }, { top: -2, right: -2, borderTopWidth: 5, borderRightWidth: 5 },
                { bottom: -2, left: -2, borderBottomWidth: 5, borderLeftWidth: 5 }, { bottom: -2, right: -2, borderBottomWidth: 5, borderRightWidth: 5 }]
                .map((p, i) => <View key={i} style={[{ position: 'absolute', width: 34, height: 34, borderColor: '#22c55e' }, p]} />)}
            </View>
          ) : null}
          {phase === 'busy' ? <View style={s.busy}><ActivityIndicator size="large" color="#fff" /><Text style={s.busyT}>Reading the sheet...</Text></View> : null}
        </View>
      ) : (
        <View style={[s.cv, s.center, { flex: 1 }]}><Text style={[s.sub, { marginBottom: 12, textAlign: 'center' }]}>Camera permission is needed to scan papers.</Text>
          <Btn s={s} label="Allow camera" onPress={ask} style={{ marginTop: 0 }} /></View>
      )}
      <Text style={[s.sub, { marginTop: 8, textAlign: 'left' }]}>Line up the paper's four corners with the green corners. Keep it flat and well lit.</Text>
      {err ? <Text style={[s.sub, { color: c.red, textAlign: 'left', marginTop: 4 }]}>{err}</Text> : null}
      {note ? <Text style={[s.sub, { color: c.green, textAlign: 'left', marginTop: 4 }]}>{note}</Text> : null}
      <Btn s={s} label="Capture and grade" onPress={snap} disabled={phase === 'busy' || !(perm && perm.granted)} />
    </View>
  );
}

const fmt1 = (n) => n.toFixed(1);
function quizStats(z) {
  const sc = z.res.map((r) => scoreOf(z, r)).sort((x, y) => x - y); const n = sc.length;
  if (!n) return null;
  const avg = sc.reduce((x, y) => x + y, 0) / n;
  const med = n % 2 ? sc[(n - 1) / 2] : (sc[n / 2 - 1] + sc[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(sc.reduce((x, v) => x + (v - avg) * (v - avg), 0) / (n - 1)) : 0;
  return { min: sc[0], max: sc[n - 1], avg, med, sd };
}
// Per question: % correct, how many chose each option (most chosen first), and DF = how well the question separates
// strong students from weak ones (correlation between getting it right and the total score, from -1 to 1).
function itemStats(z) {
  const n = z.res.length; if (!n) return [];
  const tot = z.res.map((r) => scoreOf(z, r)); const mt = tot.reduce((x, y) => x + y, 0) / n;
  return z.key.map((k, qi) => {
    const right = LET[k]; const counts = {}; const hit = [];
    z.res.forEach((r) => { const m = r.ans[qi] || '-'; counts[m] = (counts[m] || 0) + 1; hit.push(m === right ? 1 : 0); });
    const ok = hit.reduce((x, y) => x + y, 0); const mx = ok / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    hit.forEach((x, i) => { const dx = x - mx; const dy = tot[i] - mt; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; });
    const df = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    if (right && counts[right] === undefined) counts[right] = 0;
    const cols = Object.keys(counts).map((l) => ({ l, n: counts[l], right: l === right })).sort((x, y) => y.n - x.n || (x.l < y.l ? -1 : 1));
    return { q: qi + 1, pct: Math.round((ok / n) * 100), cols, df };
  });
}

function MenuBtn({ s, c, icon, label, onPress }) {
  return <Pressable style={s.mb} onPress={onPress}><Ionicons name={icon} size={26} color={c.bg} /><Text style={s.mbT}>{label}</Text></Pressable>;
}

// Redraws a graded paper from the saved answers: dark bubble = what the student marked,
// green ring = correct answer, red ring = wrong or missed.
function PaperView({ c, z, paper }) {
  const [W, setW] = useState(0);
  const lay = LAYOUTS[z.f]; const [PW, PH] = lay.page; const R = lay.answers.radius; const sc = W / PW;
  const pos = {}; lay.answers.bubbles.forEach((b) => { (pos[b.q] = pos[b.q] || {})[b.choice] = b; });
  const els = [];
  lay.answers.bubbles.forEach((b) => {
    els.push(<View key={'b' + b.q + b.choice} style={{ position: 'absolute', left: (b.x - R) * sc, top: (b.y - R) * sc, width: 2 * R * sc, height: 2 * R * sc,
      borderRadius: 999, borderWidth: 1, borderColor: '#8a949e', backgroundColor: paper.ans[b.q - 1] === b.choice ? '#1d2b3a' : 'transparent' }} />);
    if (b.choice === 'A') {
      els.push(<Text key={'n' + b.q} style={{ position: 'absolute', left: (b.x - R - 17) * sc, top: (b.y - R) * sc, width: 14 * sc, height: 2 * R * sc,
        lineHeight: 2 * R * sc, textAlign: 'right', fontSize: Math.max(6, 6.5 * sc), color: '#55606b' }}>{b.q}</Text>);
    }
  });
  const ring = (key, q, ch, color, thin) => {
    const b = pos[q] && pos[q][ch]; if (!b) return;
    const r = R * 1.35;
    els.push(<View key={key} pointerEvents="none" style={{ position: 'absolute', left: (b.x - r) * sc, top: (b.y - r) * sc, width: 2 * r * sc, height: 2 * r * sc,
      borderRadius: 999, borderWidth: thin ? 1.5 : 2.5, borderColor: color }} />);
  };
  for (let i = 0; i < z.f; i++) {
    const m = paper.ans[i]; const right = LET[z.key[i]]; const q = i + 1;
    if (m === right) ring('r' + q, q, right, c.green);
    else if (LET.includes(m)) { ring('x' + q, q, m, c.red); ring('r' + q, q, right, c.green, true); }
    else ring('x' + q, q, right, c.red);
  }
  return (
    <View style={{ borderWidth: 1.5, borderColor: c.mute, marginTop: 8 }}>
      <View style={{ width: '100%', aspectRatio: PW / PH, backgroundColor: '#ffffff' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>{W ? els : null}</View>
    </View>
  );
}

function ItemAnalysis({ s, c, z }) {
  const rows = useMemo(() => itemStats(z), [z]); const n = z.res.length; const BARH = 64;
  return (
    <View>
      <View style={s.iaH}>
        <Text style={[s.iaQ, s.iaHT]}>Q#</Text><Text style={[s.iaP, s.iaHT]}>%</Text>
        <Text style={[s.iaB, s.iaHT]}>Response Freq.</Text><Text style={[s.iaD, s.iaHT]}>DF</Text><Text style={[s.iaPt, s.iaHT]}>Pts</Text>
      </View>
      {rows.map((r) => (
        <View key={r.q} style={s.ia}>
          <Text style={[s.iaQ, s.txt]}>{r.q}</Text><Text style={[s.iaP, s.txt]}>{r.pct}</Text>
          <View style={[s.iaB, { flexDirection: 'row' }]}>
            {r.cols.slice(0, 6).map((k) => (
              <View key={k.l} style={{ width: 32, alignItems: 'center' }}>
                <View style={{ height: BARH, justifyContent: 'flex-end' }}>
                  <View style={{ width: 24, height: Math.max(2, (k.n / n) * BARH), backgroundColor: k.right ? c.green : c.red }} />
                </View>
                <Text style={s.iaL}>{k.l === '-' ? '\u2013' : k.l}</Text><Text style={s.iaC}>{k.n}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.iaD, s.txt]}>{r.df.toFixed(2)}</Text><Text style={[s.iaPt, s.txt]}>1</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------- Spreadsheet: class records (DepEd e-Class Record) and MPS ----------------
const f2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(v));
const blankSc = () => ({ ww: Array(10).fill(''), pt: Array(10).fill(''), ex: Array(3).fill('') });
const emptyTerm = () => ({ hps: blankSc(), sc: {} });
const byName = (a, b) => a.name.localeCompare(b.name);
const EXN = ['ST1', 'ST2', 'Exam'];
const hpsSum = (arr) => arr.reduce((x, y) => x + (Number(y) > 0 ? Number(y) : 0), 0);
const CW = 42; const TW = 54; const NW = 132;
const COLS = [];
[['ww', 10], ['pt', 10], ['ex', 3]].forEach(([g, n]) => {
  for (let i = 0; i < n; i++) COLS.push({ g, i, inp: true, w: CW, h: g === 'ex' ? EXN[i] : g.toUpperCase() + (i + 1) });
  (g === 'ex' ? ['PS', 'WS'] : ['Total', 'PS', 'WS']).forEach((h) => COLS.push({ g, w: TW, h }));
});
COLS.push({ g: 'out', w: TW, h: 'IG' }, { g: 'out', w: TW, h: 'Grade' });
const GROUP_LABEL = { ww: 'Written Works', pt: 'Performance Tasks', ex: 'Examinations', out: 'Result' };
// One learner's term as a flat list of values, in the same order as COLS (used by the grid and the CSV).
function termRow(track, hps, sc) {
  const r = termCalc(track, hps, sc);
  return [...sc.ww, r.ww.total, r.ww.ps, r.ww.ws, ...sc.pt, r.pt.total, r.pt.ps, r.pt.ws, ...sc.ex, r.ex.ps, r.ex.ws, r.ig, r.tg];
}

function RecordForm({ s, c, classes, onSave, onCancel }) {
  const [name, setName] = useState(''); const [cid, setCid] = useState(classes[0] ? classes[0].id : null);
  const [track, setTrack] = useState('core'); const [nT, setNT] = useState(2);
  const save = () => {
    if (!name.trim()) return Alert.alert('Enter a subject name');
    if (!cid) return Alert.alert('Create a class first');
    onSave({ name: name.trim(), classId: cid, track, nTerms: nT });
  };
  return (
    <View style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Bar s={s} onCancel={onCancel} onSave={save} />
        <Text style={s.lab}>Subject:</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Subject name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Class:</Text>
        <View style={s.chips}>
          {classes.length ? classes.map((x) => <Chip key={x.id} s={s} label={x.n} on={cid === x.id} onPress={() => setCid(x.id)} />)
            : <Text style={s.sub}>No classes yet. Create one on the Classes tab.</Text>}
        </View>
        <Text style={s.lab}>Subject type (sets the weights):</Text>
        <View style={s.chips}>{TRACKS.map((t) => <Chip key={t.k} s={s} label={t.n} on={track === t.k} onPress={() => setTrack(t.k)} />)}</View>
        <Text style={s.lab}>Number of terms:</Text>
        <View style={s.chips}>{[1, 2, 3, 4].map((n) => <Chip key={n} s={s} label={String(n)} on={nT === n} onPress={() => setNT(n)} />)}</View>
      </ScrollView>
    </View>
  );
}

function RecordView({ s, c, rec, list, cls, ti, setTi, cell, setCell, onBack, onShare }) {
  const tr = TRACKS.find((x) => x.k === rec.track) || TRACKS[0];
  const final = ti >= rec.terms.length;
  const cellEl = (key, w, txt, o = {}) => (
    <Pressable key={key} disabled={!o.onPress} onPress={o.onPress} style={[s.gc, { width: w }, o.head && s.gcH, o.on && s.gcOn]}>
      <Text style={[s.gcT, o.head && s.gcHT, o.bold && { fontWeight: '700' }, o.dim && { color: c.mute }]} numberOfLines={1}>{txt}</Text>
    </Pressable>
  );
  let content;
  if (final) {
    content = (
      <ScrollView horizontal>
        <View>
          <View style={s.grow}>{cellEl('n', NW, 'Learner', { head: true })}{rec.terms.map((_, i) => cellEl('t' + i, TW, 'Term ' + (i + 1), { head: true }))}
            {cellEl('f', TW, 'Final', { head: true })}{cellEl('d', 100, 'Descriptor', { head: true })}{cellEl('r', 76, 'Remarks', { head: true })}</View>
          {list.map((st) => {
            const tgs = rec.terms.map((t) => termCalc(rec.track, t.hps, t.sc[st.id] || blankSc()).tg);
            const f = finalCalc(tgs, rec.nTerms);
            return (
              <View key={st.id} style={s.grow}>{cellEl('n', NW, st.name)}{tgs.map((g, i) => cellEl('t' + i, TW, f2(g)))}
                {cellEl('f', TW, f2(f.fg), { bold: true })}{cellEl('d', 100, f.desc)}{cellEl('r', 76, f.remark, { bold: true })}</View>
            );
          })}
        </View>
      </ScrollView>
    );
  } else {
    const t = rec.terms[ti];
    const groups = [];
    COLS.forEach((col) => { const last = groups[groups.length - 1]; if (last && last.g === col.g) last.w += col.w; else groups.push({ g: col.g, w: col.w }); });
    const hv = [...t.hps.ww, hpsSum(t.hps.ww), '', '', ...t.hps.pt, hpsSum(t.hps.pt), '', '', ...t.hps.ex, '', '', '', ''];
    const sel = (sid, col) => !!cell && cell.ti === ti && cell.sid === sid && cell.g === col.g && cell.i === col.i;
    content = (
      <ScrollView horizontal>
        <View>
          <View style={s.grow}>{cellEl('n0', NW, '', { head: true })}{groups.map((g, i) => cellEl('g' + i, g.w, GROUP_LABEL[g.g], { head: true }))}</View>
          <View style={s.grow}>{cellEl('n1', NW, 'Learner', { head: true })}{COLS.map((col, i) => cellEl('h' + i, col.w, col.h, { head: true }))}</View>
          <View style={s.grow}>{cellEl('n2', NW, 'Highest possible', { bold: true })}
            {COLS.map((col, i) => cellEl('p' + i, col.w, f2(hv[i]), { bold: true, on: sel(null, col), onPress: col.inp ? () => setCell({ ti, g: col.g, i: col.i, sid: null }) : null }))}</View>
          {list.map((st) => {
            const vals = termRow(rec.track, t.hps, t.sc[st.id] || blankSc());
            return (
              <View key={st.id} style={s.grow}>{cellEl('n', NW, st.name)}
                {COLS.map((col, i) => cellEl('c' + i, col.w, f2(vals[i]), { dim: !col.inp, bold: col.h === 'Grade', on: sel(st.id, col), onPress: col.inp ? () => setCell({ ti, g: col.g, i: col.i, sid: st.id }) : null }))}</View>
            );
          })}
        </View>
      </ScrollView>
    );
  }
  return (
    <View>
      <Pressable onPress={onBack}><Text style={s.back}>{'\u2190'} Back</Text></Pressable>
      <Text style={s.h1}>{rec.n}</Text>
      <Text style={s.sub2}>{cls ? cls.n : 'Class removed'}. {tr.n}: written works {Math.round(tr.w[0] * 100)}%, performance tasks {Math.round(tr.w[1] * 100)}%, exam {Math.round(tr.w[2] * 100)}%.</Text>
      <View style={s.sg}>
        {rec.terms.map((_, i) => ({ i, l: 'T' + (i + 1) })).concat([{ i: rec.terms.length, l: 'Final' }]).map((t) => (
          <Pressable key={t.l} style={[s.sgB, ti === t.i && s.sgOn]} onPress={() => { setTi(t.i); setCell(null); }}><Text style={s.sgT}>{t.l}</Text></Pressable>))}
      </View>
      {list.length ? content : <Text style={s.empty}>This class has no students yet. Add students on the Classes tab.</Text>}
      <Text style={[s.sub2, { marginTop: 10 }]}>{final ? 'Final grade is the average of the term grades, shown once every term has a grade.' : 'Tap a white cell to type a score. Tap a "Highest possible" cell to set the highest score, or fill that column from a scanned quiz.'}</Text>
      <Btn s={s} label="Share as CSV" onPress={onShare} />
    </View>
  );
}

function CellPanel({ s, c, rec, list, quizzes, cell, setCell, edit }) {
  const term = rec.terms[cell.ti]; if (!term) return null;
  const isH = cell.sid === null;
  const st = isH ? null : list.find((x) => x.id === cell.sid);
  const sc = isH ? term.hps : term.sc[cell.sid] || blankSc();
  const val = sc[cell.g][cell.i];
  const top = Number(term.hps[cell.g][cell.i]);
  const colName = cell.g === 'ex' ? EXN[cell.i] : cell.g.toUpperCase() + (cell.i + 1);
  const set = (txt) => {
    const v = txt.replace(/[^0-9.]/g, '');
    edit((r) => {
      const T = r.terms[cell.ti];
      if (isH) T.hps[cell.g][cell.i] = v;
      else { T.sc[cell.sid] = T.sc[cell.sid] || blankSc(); T.sc[cell.sid][cell.g][cell.i] = v; }
    });
  };
  const nextStu = () => { const k = list.findIndex((x) => x.id === cell.sid); if (k >= 0 && k < list.length - 1) setCell({ ...cell, sid: list[k + 1].id }); else setCell(null); };
  const nextCol = () => {
    const n = cell.g === 'ex' ? 3 : 10;
    if (cell.i < n - 1) setCell({ ...cell, i: cell.i + 1 });
    else { const g = cell.g === 'ww' ? 'pt' : cell.g === 'pt' ? 'ex' : null; if (g) setCell({ ...cell, g, i: 0 }); else setCell(null); }
  };
  const fill = (qid) => edit((r, d) => {
    const z = d.quizzes.find((x) => x.id === qid); if (!z) return;
    const T = r.terms[cell.ti]; T.hps[cell.g][cell.i] = String(z.f);
    list.forEach((stu) => {
      const p = z.res.find((x) => x.id === stu.id);
      if (p) { T.sc[stu.id] = T.sc[stu.id] || blankSc(); T.sc[stu.id][cell.g][cell.i] = String(scoreOf(z, p)); }
    });
  });
  const over = !isH && val !== '' && top > 0 && Number(val) > top;
  return (
    <View style={s.cp}>
      <Text style={s.txt}>{isH ? 'Highest possible score' : st ? st.name : ''}, {colName}</Text>
      <TextInput key={cell.ti + cell.g + cell.i + String(cell.sid)} autoFocus keyboardType="decimal-pad" style={[s.input, { marginTop: 8, marginBottom: 6 }]}
        value={String(val)} onChangeText={set} placeholder={isH ? 'Highest score' : 'Score'} placeholderTextColor={c.mute} />
      {over ? <Text style={[s.sub, { color: c.red, textAlign: 'left' }]}>This is higher than the highest possible score ({top}).</Text> : null}
      <View style={s.row}>
        {!isH ? <Btn s={s} label="Next learner" onPress={nextStu} style={{ flex: 1, marginHorizontal: 3 }} /> : null}
        <Btn s={s} label="Next column" onPress={nextCol} style={{ flex: 1, marginHorizontal: 3 }} />
        <Btn s={s} label="Done" onPress={() => setCell(null)} style={{ flex: 1, marginHorizontal: 3 }} />
      </View>
      {isH && quizzes.length ? (
        <View>
          <Text style={[s.sub, { textAlign: 'left', marginTop: 8 }]}>Fill this whole column from a scanned quiz:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }}>
            <View style={s.chips}>{quizzes.map((z) => <Chip key={z.id} s={s} label={z.n + ' (' + z.f + ')'} on={false} onPress={() => fill(z.id)} />)}</View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function MpsView({ s, c, z, onBack }) {
  const ia = useMemo(() => individualScores(z), [z]);
  const sum = ia.cases ? mpsSummary(ia.rows.map((r) => r.total), z.f) : null;
  const share = () => {
    const rows = [['Learner', 'ID', ...z.key.map((_, i) => i + 1), 'Total'], ...ia.rows.map((r) => [r.name, r.id, ...r.marks, r.total]),
      ['Correct', '', ...ia.correct, ''], ['Percent', '', ...ia.pct.map(r2), ''], ['Level', '', ...ia.lp.map((l) => l.k), '']];
    if (sum) rows.push([], ['Cases', sum.cases], ['HPS', sum.hps], ['HSO', sum.hso], ['LSO', sum.lso], ['Mean', r2(sum.mean)], ['MPS', r2(sum.mps)],
      ...LEVELS.map((l) => [l.n, sum.bands[l.k]]));
    Share.share({ message: toCsv(rows) });
  };
  const cell = (key, w, txt, o = {}) => (
    <View key={key} style={[s.gc, { width: w }, o.head && s.gcH]}><Text style={[s.gcT, o.head && s.gcHT, o.red && { color: c.red }, o.bold && { fontWeight: '700' }]} numberOfLines={1}>{txt}</Text></View>
  );
  return (
    <View>
      <Pressable onPress={onBack}><Text style={s.back}>{'\u2190'} Back</Text></Pressable>
      <Text style={s.h1}>{z.sh}</Text>
      <Text style={s.sub2}>MPS workbook for quiz: {z.n}. The table below is the individual score sheet taken from the scanned papers.</Text>
      {sum ? (
        <View>
          <View style={s.list}>
            {[['Cases (learners)', sum.cases], ['Highest possible score', sum.hps], ['Highest score obtained', sum.hso], ['Lowest score obtained', sum.lso],
              ['Mean', r2(sum.mean)], ['MPS (%)', r2(sum.mps)], ['Level', levelOf(sum.mps).n]].map(([l, v]) => (
              <View key={l} style={s.li}><Text style={[s.txt, { flex: 1 }]}>{l}</Text><Text style={s.txt}>{String(v)}</Text></View>))}
          </View>
          <Text style={s.sec}>Learners by level</Text>
          <View style={s.list}>{LEVELS.map((l) => (
            <View key={l.k} style={s.li}><Text style={[s.txt, { flex: 1 }]}>{l.n}</Text><Text style={s.txt}>{sum.bands[l.k]}   ({r2((sum.bands[l.k] / sum.cases) * 100)}%)</Text></View>))}</View>
          <Text style={s.sec}>Individual scores</Text>
          <ScrollView horizontal>
            <View>
              <View style={s.grow}>{cell('n', NW, 'Learner', { head: true })}{z.key.map((_, i) => cell('h' + i, 28, String(i + 1), { head: true }))}{cell('t', 48, 'Total', { head: true })}</View>
              {ia.rows.map((r) => (
                <View key={r.id} style={s.grow}>{cell('n', NW, r.name)}{r.marks.map((mk2, i) => cell('m' + i, 28, String(mk2), { red: mk2 === 0 }))}{cell('t', 48, String(r.total), { bold: true })}</View>))}
              <View style={s.grow}>{cell('n', NW, 'Correct', { head: true })}{ia.correct.map((v, i) => cell('c' + i, 28, String(v), { head: true }))}{cell('t', 48, '', { head: true })}</View>
              <View style={s.grow}>{cell('n', NW, 'Percent', { head: true })}{ia.pct.map((v, i) => cell('p' + i, 28, String(Math.round(v)), { head: true }))}{cell('t', 48, '', { head: true })}</View>
              <View style={s.grow}>{cell('n', NW, 'Level', { head: true })}{ia.lp.map((l, i) => cell('l' + i, 28, l.k, { head: true }))}{cell('t', 48, '', { head: true })}</View>
            </View>
          </ScrollView>
          <Btn s={s} label="Share as CSV" onPress={share} />
        </View>
      ) : <Text style={s.empty}>No papers scanned yet. The MPS appears after you scan this quiz.</Text>}
    </View>
  );
}

function Contact({ s, c }) {
  const [m, setM] = useState('');
  return (
    <View>
      <Text style={s.lab}>Message</Text>
      <TextInput style={[s.input, { height: 140, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={m} onChangeText={setM}
        placeholder="Tell us what you need" placeholderTextColor={c.mute} />
      <Btn s={s} label="Send message" onPress={() => { if (m.trim()) { setM(''); Alert.alert('Message ready to send in the full app'); } }} />
    </View>
  );
}

export default function App() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const s = useMemo(() => mk(c), [scheme]);
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home'); const [det, setDet] = useState(null);
  const [q, setQ] = useState(''); const [modal, setModal] = useState(null); const [menu, setMenu] = useState(false);
  const [scanQ, setScanQ] = useState(null); const [qtab, setQtab] = useState('details');
  const [stab, setStab] = useState('records'); const [cell, setCell] = useState(null); const [ti, setTi] = useState(0);

  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) setData(migrate(JSON.parse(v))); setReady(true); }); }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(KEY, JSON.stringify(data)); }, [data, ready]);
  const upd = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  const { quizzes, classes, students, log } = data; const records = data.records || [];
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const go = (k) => { setMenu(false); setDet(null); setTab(k); };
  const plus = () => { setMenu(false); setModal(!det && tab === 'classes' ? 'class' : !det && tab === 'sheet' && stab === 'records' ? 'record' : 'quiz'); };
  const openScan = (id) => { if (!quizzes.length) return Alert.alert('Create a quiz first'); setScanQ(id || (det && det.k === 'quiz' ? det.id : quizzes[0].id)); setModal('scan'); };

  const saveQuiz = (f) => {
    upd((d) => { d.quizzes.unshift({ id: uid(), n: f.name, d: today(), f: f.f, c: f.c, sh: f.sh, key: Array(f.f).fill(-1), res: [] }); d.log.unshift({ t: 'Created quiz ' + f.name, d: today() }); return d; });
    setModal(null); setDet(null); setTab('home');
  };
  const saveClass = (f) => {
    upd((d) => {
      const ids = f.ids.slice();
      f.created.forEach((nm) => { const id = d.nextId++; d.students.push({ id, name: nm }); ids.push(id); });
      d.classes.push({ id: uid(), n: f.name, d: today(), s: ids }); d.log.unshift({ t: 'Created class ' + f.name, d: today() }); return d;
    });
    setModal(null); setDet(null); setTab('classes');
  };
  const saveRecord = (f) => {
    upd((d) => {
      d.records = d.records || [];
      d.records.unshift({ id: uid(), n: f.name, classId: f.classId, track: f.track, nTerms: f.nTerms, d: today(), terms: Array.from({ length: f.nTerms }, emptyTerm) });
      d.log.unshift({ t: 'Created class record ' + f.name, d: today() }); return d;
    });
    setModal(null); setDet(null); setTab('sheet'); setStab('records');
  };
  const editRec = (id) => (fn) => upd((d) => { const r = (d.records || []).find((x) => x.id === id); if (r) fn(r, d); return d; });
  const recList = (r) => { const cl = byId(classes, r.classId); return cl ? cl.s.map((id) => byId(students, id)).filter(Boolean).sort(byName) : []; };
  const shareRecord = (r, list) => {
    const clean = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
    let rows;
    if (ti >= r.terms.length) {
      rows = [['Learner', 'ID', ...r.terms.map((_, i) => 'Term ' + (i + 1)), 'Final grade', 'Descriptor', 'Remarks']];
      list.forEach((st) => {
        const tgs = r.terms.map((t) => termCalc(r.track, t.hps, t.sc[st.id] || blankSc()).tg); const f = finalCalc(tgs, r.nTerms);
        rows.push([st.name, st.id, ...tgs.map(clean), clean(f.fg), f.desc, f.remark]);
      });
    } else {
      const t = r.terms[ti];
      rows = [['Learner', 'ID', ...COLS.map((x) => x.h)], ['Highest possible', '', ...t.hps.ww, hpsSum(t.hps.ww), '', '', ...t.hps.pt, hpsSum(t.hps.pt), '', '', ...t.hps.ex, '', '', '', '']];
      list.forEach((st) => rows.push([st.name, st.id, ...termRow(r.track, t.hps, t.sc[st.id] || blankSc()).map(clean)]));
    }
    Share.share({ message: toCsv(rows) });
  };
  const savePaper = (quizId, paper) => upd((d) => {
    const z = byId(d.quizzes, quizId);
    z.res = z.res.filter((r) => r.id !== paper.id); z.res.push(paper);
    d.log.unshift({ t: 'Graded ' + paper.name + ' in ' + z.n, d: today() }); return d;
  });
  const delPaper = (quizId, pid) => upd((d) => { const z = byId(d.quizzes, quizId); z.res = z.res.filter((r) => r.id !== pid); return d; });
  const setKey = (qi, ci) => upd((d) => { byId(d.quizzes, det.id).key[qi] = ci; return d; });
  const addStudent = (n) => upd((d) => { const id = d.nextId++; d.students.push({ id, name: n }); byId(d.classes, det.id).s.push(id); return d; });
  const csv = (z) => Share.share({ message: 'Student,ID,Score,Percent\n' + z.res.map((r) => r.name + ',' + r.id + ',' + scoreOf(z, r) + '/' + z.f + ',' + Math.round((scoreOf(z, r) / z.f) * 100) + '%').join('\n') });

  const card = (x, i, kind, sub, name) => (
    <Pressable key={x.id} style={s.card} onPress={() => { setCell(null); setTi(0); setDet({ k: kind, id: x.id }); }}>
      <View style={[s.stripe, { backgroundColor: PAL[i % 5] }]} />
      <Text style={s.sub}>{sub}</Text><Text style={s.cname} numberOfLines={2}>{name}</Text>
    </Pressable>
  );
  const m = (t) => t.toLowerCase().includes(q.trim().toLowerCase());
  const empty = <Text style={s.empty}>Nothing here yet. Tap + to create one.</Text>;
  const back = <Pressable onPress={() => setDet(null)}><Text style={s.back}>{'\u2190'} Back</Text></Pressable>;
  const Row = ({ a, b }) => <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>{a}</Text><Text style={s.txt}>{b}</Text></View>;

  const body = () => {
    if (det && det.k === 'quiz') {
      const z = byId(quizzes, det.id); if (!z) return null;
      const v = det.v || 'menu';
      const to = (nv, extra) => setDet({ k: 'quiz', id: z.id, v: nv, ...extra });
      const bk = (label, fn) => <Pressable onPress={fn}><Text style={s.back}>{'\u2190'} {label}</Text></Pressable>;
      const sorted = z.res.slice().sort((x, y) => x.name.localeCompare(y.name));
      const keySet = z.key.filter((k) => k >= 0).length;
      const pctOf = (r) => Math.round((scoreOf(z, r) / z.f) * 100);
      const prow = (r) => (
        <Pressable key={r.id} style={s.li} onPress={() => to('paper', { pid: r.id })}>
          <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{r.name}</Text>
          <Text style={s.txt}>{scoreOf(z, r)}/{z.f}   {pctOf(r)}%</Text>
        </Pressable>
      );

      if (v === 'key') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Edit Key</Text>
          <Text style={s.sub2}>Tap the correct answer for each question. {keySet}/{z.f} set.</Text>
          <View style={s.list}>{z.key.map((a2, qi) => (
            <View key={qi} style={s.kr}><Text style={s.kn}>{qi + 1}</Text>
              {LET.map((l, ci) => <Pressable key={l} onPress={() => setKey(qi, ci)} style={[s.kb, a2 === ci && s.kbOn]}><Text style={[s.txt, a2 === ci && { color: c.bg }]}>{l}</Text></Pressable>)}
            </View>))}</View></View>;
      }
      if (v === 'review') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Review Papers</Text>
          <Text style={s.sub2}>Tap a paper to see what the student marked.</Text>
          <View style={s.list}>{sorted.length ? sorted.map(prow) : <Text style={s.empty}>No papers scanned yet.</Text>}</View></View>;
      }
      if (v === 'paper') {
        const idx = sorted.findIndex((r) => r.id === det.pid); const r = sorted[idx];
        if (!r) return <View>{bk('Papers', () => to('review'))}<Text style={s.empty}>This paper was removed.</Text></View>;
        const go2 = (d) => to('paper', { pid: sorted[(idx + d + sorted.length) % sorted.length].id });
        return <View>{bk('Papers', () => to('review'))}
          <Text style={s.h1}>{r.name}</Text>
          <Text style={s.sub2}>ID {r.id}   Scanned {r.d}</Text>
          <Text style={[s.h2, { color: c.green, marginLeft: 6 }]}>{scoreOf(z, r)} / {z.f}   ({pctOf(r)}%)</Text>
          {sorted.length > 1 ? (
            <View style={s.row}>
              <Btn s={s} label={'\u2039 Previous'} onPress={() => go2(-1)} style={{ flex: 1 }} />
              <Btn s={s} label={'Next \u203A'} onPress={() => go2(1)} style={{ flex: 1 }} />
            </View>) : null}
          <Text style={[s.sub2, { marginTop: 12 }]}>Dark bubble = student's mark. Green ring = correct answer. Red ring = wrong or missed.</Text>
          <PaperView c={c} z={z} paper={r} />
          <Btn s={s} label="Delete this paper" style={{ backgroundColor: c.red }} onPress={() => Alert.alert('Delete ' + r.name + "'s paper?", 'You can scan it again later.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { delPaper(z.id, r.id); to('review'); } }])} />
        </View>;
      }
      if (v === 'item') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Item Analysis</Text>
          <Text style={s.sub2}>Quiz: {z.n}</Text>
          <Text style={[s.sub2, { color: c.green }]}>Key: Primary key, {z.res.length} papers</Text>
          <Text style={s.sub2}>% = students who got it right. Bars = how many chose each answer (green = correct). DF = how well the question separates strong from weak students.</Text>
          {z.res.length ? <ItemAnalysis s={s} c={c} z={z} /> : <Text style={s.empty}>Scan some papers first.</Text>}
        </View>;
      }

      const st = quizStats(z);
      const cls = z.c.map((id) => byId(classes, id)).filter(Boolean).map((x) => x.n).join(', ');
      return <View>{back}<Text style={s.h1}>{z.n}</Text>
        <View style={s.sg}>{[['details', 'Details'], ['stats', 'Statistics']].map(([k, l]) => (
          <Pressable key={k} style={[s.sgB, qtab === k && s.sgOn]} onPress={() => setQtab(k)}><Text style={s.sgT}>{l}</Text></Pressable>))}</View>
        {qtab === 'details' ? (
          <View>
            <View style={s.list}>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Questions</Text><Text style={s.txt}>{z.f}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Papers</Text><Text style={s.txt}>{z.res.length}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Answer key</Text><Text style={[s.txt, keySet < z.f && { color: c.red }]}>{keySet}/{z.f} set</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Classes</Text><Text style={[s.txt, { flexShrink: 1, textAlign: 'right' }]}>{cls || 'None'}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Created</Text><Text style={s.txt}>{z.d}</Text></View>
            </View>
            <Text style={s.sec}>Scanned papers</Text>
            <View style={s.list}>{sorted.length ? sorted.map(prow) : <Text style={s.empty}>No papers scanned yet.</Text>}</View>
          </View>
        ) : st ? (
          <View style={s.list}>
            <View style={s.stR}><Text style={s.stL} /><Text style={s.stC}>Score</Text><Text style={s.stC}>Percent</Text></View>
            {[['Min. Score', st.min], ['Max. Score', st.max], ['Average', st.avg], ['Median', st.med], ['Std. Dev.', st.sd]].map(([l, val]) => (
              <View key={l} style={s.stR}><Text style={s.stL}>{l}:</Text><Text style={s.stV}>{fmt1(val)}</Text><Text style={s.stV}>{fmt1((val / z.f) * 100)}</Text></View>))}
          </View>
        ) : <Text style={s.empty}>No papers scanned yet. Statistics appear after you scan.</Text>}
        {keySet < z.f ? <Text style={[s.sub2, { color: c.red, marginTop: 12 }]}>The answer key is not complete. Tap Edit Key first.</Text> : null}
        <MenuBtn s={s} c={c} icon="key-outline" label="Edit Key" onPress={() => to('key')} />
        <MenuBtn s={s} c={c} icon="camera-outline" label="Scan Papers" onPress={() => openScan(z.id)} />
        <MenuBtn s={s} c={c} icon="document-text-outline" label="Review Papers" onPress={() => to('review')} />
        <MenuBtn s={s} c={c} icon="bar-chart-outline" label="Item Analysis" onPress={() => to('item')} />
      </View>;
    }
    if (det && det.k === 'class') {
      const x = byId(classes, det.id); if (!x) return null;
      const list = x.s.map((id) => byId(students, id)).filter(Boolean);
      return <View>{back}<Text style={s.h1}>{x.n}</Text><Text style={s.sub2}>Created {x.d}. Each student fills in their ID number on the sheet.</Text><Text style={s.sec}>Students</Text>
        <View style={s.list}>{list.length ? list.map((st) => <Row key={st.id} a={st.name} b={'ID ' + st.id} />) : <Text style={s.empty}>No students yet.</Text>}</View>
        <AddRow s={s} c={c} placeholder="New student name" onAdd={addStudent} /></View>;
    }
    if (det && det.k === 'record') {
      const r = byId(records, det.id); if (!r) return null;
      return <RecordView s={s} c={c} rec={r} list={recList(r)} cls={byId(classes, r.classId)} ti={ti} setTi={setTi} cell={cell} setCell={setCell}
        onBack={() => { setCell(null); setDet(null); }} onShare={() => shareRecord(r, recList(r))} />;
    }
    if (det && det.k === 'mps') {
      const z = byId(quizzes, det.id); if (!z) return null;
      return <MpsView s={s} c={c} z={z} onBack={() => setDet(null)} />;
    }
    if (det && det.k === 'page') {
      const p = det.p; let inner;
      if (p === 'FAQ') inner = <View style={s.list}>{[['How do I grade a paper?', 'Open Scan from the camera button, choose a quiz, and capture the filled answer sheet.'],
        ['Where do I set the answer key?', 'Open a quiz from Home and tap the correct answer for each question.'],
        ['What ID do students fill in?', 'Each student has an ID number shown in their class. They fill it in the ID grid.'],
        ['Where are scores saved?', 'Each quiz has a spreadsheet with one row per student, under Spreadsheet.']].map((x) => <View key={x[0]} style={s.li2}><Text style={s.qq}>{x[0]}</Text><Text style={s.sub2}>{x[1]}</Text></View>)}</View>;
      else if (p === 'Contact GuroGabay') inner = <Contact s={s} c={c} />;
      else if (p === 'Settings') inner = <Text style={s.sub2}>The theme follows your phone's light or dark setting.</Text>;
      else inner = <Text style={s.sub2}>GuroGabay is a quiz grading app for teachers. Add your team and the tools you used here.</Text>;
      return <View>{back}<Text style={s.h1}>{p}</Text>{inner}</View>;
    }
    let items = [];
    if (tab === 'home') items = quizzes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'quiz', 'Papers: ' + x.res.length + '\n' + x.d, x.n));
    if (tab === 'sheet') items = stab === 'records'
      ? records.filter((x) => m(x.n)).map((x, i) => card(x, i, 'record', ((byId(classes, x.classId) || {}).n || '') + '\n' + x.d, x.n))
      : quizzes.filter((x) => m(x.sh)).map((x, i) => card(x, i, 'mps', 'MPS\nPapers: ' + x.res.length, x.sh));
    if (tab === 'classes') items = classes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'class', x.d, x.n)).reverse();
    return <View><Text style={s.h1}>{TITLES[tab]}</Text>
      {tab === 'sheet' ? (
        <View style={s.sg}>{[['records', 'Class records'], ['mps', 'MPS']].map(([k, l]) => (
          <Pressable key={k} style={[s.sgB, stab === k && s.sgOn]} onPress={() => setStab(k)}><Text style={s.sgT}>{l}</Text></Pressable>))}</View>
      ) : null}
      {tab === 'recent' ? <View style={s.list}>{log.filter((e) => m(e.t)).length ? log.filter((e) => m(e.t)).map((e, i) => <Row key={i} a={e.t} b={e.d} />) : <Text style={s.empty}>No recent activity.</Text>}</View>
        : items.length ? <View style={s.grid}>{items}</View> : empty}</View>;
  };

  if (modal === 'scan') {
    return (
      <View style={s.root}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <ScanModal s={s} c={c} quizzes={quizzes} students={students} initial={scanQ} onSave={savePaper} onClose={() => setModal(null)} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={s.head}>
        <Pressable onPress={() => setMenu(true)} accessibilityLabel="Open menu"><Ionicons name="grid-outline" size={30} color={c.ink} /></Pressable>
        <View style={s.user}><Text style={s.uname}>Username</Text><View style={s.avatar}><Ionicons name="person" size={24} color={c.bg} /></View></View>
      </View>
      <View style={s.srow}>
        <View style={s.search}><TextInput style={s.sin} value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={c.mute} />
          <Ionicons name="search" size={22} color={c.ink} /></View>
        <Pressable style={s.cam} onPress={() => openScan()} accessibilityLabel="Scan papers"><Ionicons name="camera" size={24} color={c.ink} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: cell && det && det.k === 'record' ? 300 : 130 }} keyboardShouldPersistTaps="handled">{body()}</ScrollView>

      {cell && det && det.k === 'record' && byId(records, det.id) ? (
        <CellPanel s={s} c={c} rec={byId(records, det.id)} list={recList(byId(records, det.id))} quizzes={quizzes} cell={cell} setCell={setCell} edit={editRec(det.id)} />
      ) : null}

      <View style={s.nav}>
        {['home', 'classes', 'add', 'sheet', 'recent'].map((k) => k === 'add'
          ? <Pressable key={k} style={s.addBtn} onPress={plus} accessibilityLabel="Create"><Ionicons name="add" size={30} color={c.bg} /></Pressable>
          : <Pressable key={k} style={s.navBtn} onPress={() => go(k)} accessibilityLabel={TITLES[k]}><Ionicons name={ICONS[k]} size={28} color={tab === k && !det ? c.ink : c.mute} /></Pressable>)}
      </View>

      {menu && (
        <View style={s.overlay}>
          <Pressable style={s.scrim} onPress={() => setMenu(false)} />
          <View style={s.drawer}>
            <View style={s.brand}><Ionicons name="grid-outline" size={30} color={c.ink} /><Text style={s.brandT}>GuroGabay</Text></View>
            {['home', 'classes', 'add', 'sheet', 'recent'].map((k) => (
              <Pressable key={k} style={s.item} onPress={() => (k === 'add' ? plus() : go(k))}>
                {k === 'add' ? <View style={s.mini}><Ionicons name="add" size={20} color={c.bg} /></View> : <Ionicons name={ICONS[k]} size={26} color={c.mute} />}
                <Text style={s.itemT}>{k === 'add' ? 'Create' : TITLES[k]}</Text>
              </Pressable>))}
            <View style={s.hr} />
            {['Settings', 'FAQ', 'Contact GuroGabay', 'Credits'].map((x) => (
              <Pressable key={x} style={s.item} onPress={() => { setMenu(false); setDet({ k: 'page', p: x }); }}><Text style={s.itemT}>{x}</Text></Pressable>))}
          </View>
        </View>
      )}

      <Modal transparent animationType="fade" visible={modal === 'quiz' || modal === 'class' || modal === 'record'} onRequestClose={() => setModal(null)}>
        <View style={s.dim}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {modal === 'quiz' && <QuizForm s={s} c={c} classes={classes} onSave={saveQuiz} onCancel={() => setModal(null)} />}
          {modal === 'record' && <RecordForm s={s} c={c} classes={classes} onSave={saveRecord} onCancel={() => setModal(null)} />}
          {modal === 'class' && <ClassForm s={s} c={c} students={students} classes={classes} onSave={saveClass} onCancel={() => setModal(null)} />}
        </KeyboardAvoidingView></View>
      </Modal>
    </View>
  );
}

const mk = (c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: (StatusBar.currentHeight || 30) + 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uname: { color: c.ink, fontSize: 16, fontWeight: '500' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  srow: { flexDirection: 'row', gap: 10, marginTop: 16, paddingHorizontal: 20 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: c.mute, borderRadius: 14, backgroundColor: c.card, paddingHorizontal: 12 },
  sin: { flex: 1, height: 44, color: c.ink, fontSize: 16 },
  cam: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: c.mute, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 36, fontWeight: '700', color: c.ink, marginTop: 18, marginBottom: 12, marginLeft: 6 },
  h2: { fontSize: 24, fontWeight: '700', color: c.ink, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  card: { width: '48%', aspectRatio: 1.7, backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 18, padding: 12, justifyContent: 'flex-end', alignItems: 'flex-end', overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8 },
  sub: { color: c.mute, fontSize: 13, textAlign: 'right' },
  sub2: { color: c.mute, fontSize: 15, marginLeft: 6, marginBottom: 6 },
  cname: { color: c.ink, fontSize: 18, textAlign: 'right' },
  empty: { color: c.mute, padding: 16, fontSize: 15 },
  txt: { color: c.ink, fontSize: 16 },
  back: { color: c.mute, fontSize: 16, marginTop: 16, marginLeft: 4 },
  sec: { color: c.ink, fontSize: 19, fontWeight: '500', marginTop: 22, marginBottom: 8, marginLeft: 6 },
  list: { backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 18, paddingHorizontal: 16 },
  li: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute },
  li2: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute },
  qq: { color: c.ink, fontSize: 16, fontWeight: '500', marginBottom: 4 },
  kr: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  kn: { width: 30, textAlign: 'right', color: c.mute, marginRight: 6 },
  kb: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: c.mute, alignItems: 'center', justifyContent: 'center' },
  kbOn: { backgroundColor: c.ink, borderColor: c.ink },
  pill: { marginTop: 14, marginHorizontal: 6, height: 48, paddingHorizontal: 22, borderRadius: 24, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  pillT: { color: c.bg, fontSize: 16, fontWeight: '700' },
  addrow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  nav: { position: 'absolute', left: 20, right: 20, bottom: 18, height: 64, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.mute, borderRadius: 32, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', elevation: 8 },
  navBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: { width: '78%', maxWidth: 320, backgroundColor: c.card, paddingTop: (StatusBar.currentHeight || 30) + 18, paddingHorizontal: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  brandT: { color: c.ink, fontSize: 24, fontWeight: '500' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 13 },
  itemT: { color: c.ink, fontSize: 18 },
  mini: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: c.mute, marginVertical: 10 },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flex: 1, marginTop: (StatusBar.currentHeight || 30) + 60, marginHorizontal: 14, marginBottom: 40, backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 26, padding: 22 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  cancel: { color: c.red, fontSize: 16 },
  save: { color: c.green, fontSize: 16, textDecorationLine: 'underline' },
  lab: { color: c.ink, fontSize: 16, marginBottom: 6, marginLeft: 2, marginTop: 8 },
  input: { height: 50, borderWidth: 2, borderColor: c.mute, borderRadius: 14, backgroundColor: c.bg, color: c.ink, paddingHorizontal: 14, fontSize: 16, marginBottom: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 2, borderColor: c.mute, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { backgroundColor: c.ink, borderColor: c.ink },
  chipT: { color: c.ink, fontSize: 15 },
  chipTOn: { color: c.bg },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  stu: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  box: { width: 22, height: 22, borderWidth: 2, borderColor: c.mute, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: c.ink, borderColor: c.ink },
  cv: { height: 260, borderRadius: 16, overflow: 'hidden', backgroundColor: c.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: c.mute },
  guide: { position: 'absolute', top: 10, bottom: 10, left: '12%', right: '12%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', borderRadius: 6 },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyT: { color: '#fff', fontSize: 16 },
  sg: { flexDirection: 'row', backgroundColor: c.bg, borderRadius: 14, padding: 3, marginBottom: 16, borderWidth: 1.5, borderColor: c.mute },
  sgB: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  sgOn: { backgroundColor: c.card },
  sgT: { color: c.ink, fontSize: 16, fontWeight: '500' },
  mb: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.ink, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, marginTop: 14 },
  mbT: { color: c.bg, fontSize: 19 },
  stR: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  stL: { flex: 1.3, color: c.mute, fontSize: 15 },
  stV: { flex: 1, textAlign: 'right', color: c.ink, fontSize: 22 },
  stC: { flex: 1, textAlign: 'right', color: c.mute, fontSize: 14 },
  iaH: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: c.mute, marginTop: 8 },
  iaHT: { color: c.green, fontSize: 13 },
  ia: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute },
  iaQ: { width: 30 }, iaP: { width: 34, textAlign: 'right', marginRight: 6 }, iaB: { flex: 1 }, iaD: { width: 48, textAlign: 'right' }, iaPt: { width: 26, textAlign: 'right' },
  iaL: { color: c.ink, fontSize: 14, fontWeight: '700', marginTop: 2 }, iaC: { color: c.ink, fontSize: 13 },
  grow: { flexDirection: 'row' },
  gc: { height: 38, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute, backgroundColor: c.card },
  gcH: { backgroundColor: c.bg },
  gcOn: { backgroundColor: '#f0c24b' },
  gcT: { color: c.ink, fontSize: 13 },
  gcHT: { color: c.mute, fontSize: 12, fontWeight: '700' },
  cp: { position: 'absolute', left: 12, right: 12, bottom: 92, backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 18, padding: 14, elevation: 12 },
});
