import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, ScrollView, Modal, StyleSheet, Switch, Alert, Share, Image,
  ActivityIndicator, useColorScheme, Platform, StatusBar, KeyboardAvoidingView, BackHandler, Dimensions, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { readPhoto, fromBase64, rgbaToGray, ScanError } from './src/omr';
import LAYOUTS from './src/layouts';
import { TRACKS, NCOL, termCalc, finalCalc, individualScores, mpsSummary, LEVELS, csv as toCsv, quizSections, individualCsvRows, mpsCsvRows, TOS_LEVELS, MASTERY, parseItems, itemsText, tosCheck, competencyStats, tosCsvRows, competencyCsvRows } from './src/records';
import * as FS from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from './lib/supabase';
import { syncNow, markSaved } from './lib/sync';
import { checkStudent, studentConflict } from './lib/duplicates';
import { importTos } from './src/tosImport';
import SettingsPanel from './SettingsPanel';
import CreditsPanel from './CreditsPanel';
import SplashAnimation from './SplashAnimation';
import Pressable from './PressableScale';
import Animated, { FadeInRight, Easing, runOnJS, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';



// Remembers the "Stay signed in on this phone" switch.
const STAY_KEY = 'gurogabay:stay';

const jpeg = require('jpeg-js');
const KEY = 'gurogabay:v1';
const ACC_KEY = 'gurogabay:accounts';
// The picture of each scanned sheet is stored apart from the main data so the main data stays small.
const THUMB = 'gurogabay:scan:';
const OLD_THUMB = 'gurogabay:thumb:'; // name-only pictures kept by an earlier version, cleaned up on start
// The strip of the sheet shown in lists: Name, Class and the Student ID boxes (points on the printed page).
const STRIP = { x0: 8, y0: 66, x1: 587, y1: 146 };
const thumbKey = (acctId, puid) => THUMB + acctId + ':' + puid;
const thumbCache = new Map();
// Space for the phone's status bar / notch, so headers and the side menu are not cut off.
const TOP = Platform.OS === 'ios' ? (Dimensions.get('window').height >= 800 ? 56 : 24) : (StatusBar.currentHeight || 28);
const BOTTOM = Platform.OS === 'ios' ? 30 : 18;
const AMBER = '#d99a00';
const SCAN_PX = 1400; // longest side of the photo that gets read. Lower = faster, higher = more accurate
const A4 = 595 / 842;
const LET = ['A', 'B', 'C', 'D', 'E'];
// The scanner reads three printed sheet forms. A quiz of any size from 1 to 100 uses the smallest form that fits it.
const FORMS = [30, 60, 100];
const formOf = (z) => FORMS.find((n) => n >= z.f) || 100;
const CHOICE_NAMES = { AB: 'A – B', AC: 'A – C', AD: 'A – D', AE: 'A – E', TF: 'True / False' };
const CHOICE_N = { AB: 2, AC: 3, AD: 4, AE: 5, TF: 2 };
const optsOf = (z) => LET.slice(0, CHOICE_N[z.ch] || 5);
const showL = (z, l) => (z.ch === 'TF' ? (l === 'A' ? 'T' : l === 'B' ? 'F' : l) : l);
const PAL = ['#f0c24b', '#7fb59a', '#e08e79', '#8aa6d6', '#b99ad0'];
const LIGHT = { bg: '#eceee9', card: '#ffffff', ink: '#1d2b3a', mute: '#66727e', red: '#e5342d', green: '#0a9d58' };
const DARK = { bg: '#161c22', card: '#212a33', ink: '#eef1f3', mute: '#9aa7b2', red: '#ff6b64', green: '#3ecf8e' };
const TITLES = { home: 'Quizzes', classes: 'Classes', sheet: 'Spreadsheet', recent: 'Recent' };
const ICONS = { home: 'home-outline', classes: 'people-outline', sheet: 'document-text-outline', recent: 'time-outline' };
const today = () => new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMPTY = { quizzes: [], classes: [], students: [], log: [], nextId: 0, ecr: {} };
// Student IDs are 4 digits, starting at 0000 (same as the website).
const fmtId = (n) => String(n).padStart(4, '0');

// Older saved data stored students as plain names or numeric ids. Student ids are text now so teachers can edit them.
function migrate(d) {
  d = { ...EMPTY, ...d };
  d.ecr = d.ecr || {};
  // drop students that have no real ID (they made two rows share the same key) and any repeated ID
  const seenId = new Set();
  d.students = d.students.filter((st) => { const i = st && st.id !== undefined && st.id !== null ? String(st.id).trim() : ''; if (!i || i === 'undefined' || i === 'null' || seenId.has(i)) return false; seenId.add(i); return true; });
  d.students.forEach((st) => { st.id = String(st.id).trim(); });
  if (!d.students.length) d.nextId = 0; // nobody registered yet: start again from 0000
  const ids = new Set(d.students.map((st) => st.id)); const byName = {};
  d.students.forEach((st) => { byName[st.name] = st; });
  d.classes.forEach((c) => {
    c.s = (c.s || []).map((x) => {
      if (typeof x === 'number') return String(x);
      if (ids.has(x)) return x;
      if (!byName[x]) { const st = { id: fmtId(d.nextId++), name: x }; d.students.push(st); byName[x] = st; ids.add(st.id); }
      return byName[x].id;
    });
  });
  d.quizzes.forEach((q) => {
    q.res = (q.res || []).filter((r) => r.ans);
    q.res.forEach((r) => { r.id = r.id === undefined || r.id === null ? '' : String(r.id); r.uid = r.uid || uid(); });
  });
  return d;
}
// A student id nobody uses yet.
const freshId = (d) => { let id = fmtId(d.nextId++); while (d.students.some((st) => st.id === id)) id = fmtId(d.nextId++); return id; };
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
  const go = () => { if (v.trim()) { if (onAdd(v.trim()) !== false) setV(''); } };
  return (
    <View style={s.addrow}>
      <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} value={v} onChangeText={setV} placeholder={placeholder}
        placeholderTextColor={c.mute} onSubmitEditing={go} />
      <Btn s={s} label="Add" onPress={go} style={{ marginTop: 0 }} />
    </View>
  );
}

function QuizForm({ s, c, classes, quizzes, onSave, onCancel }) {
  const [name, setName] = useState(''); const [fText, setFText] = useState('30'); const [ch, setCh] = useState('AE'); const [rec, setRec] = useState(null);
  const f = Math.min(100, Math.max(1, parseInt(fText, 10) || 1));
  const [picked, setPicked] = useState([]); const [sh, setSh] = useState('');
  const tog = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => (name.trim() ? onSave({ name: name.trim(), f, ch, c: picked, sh: sh.trim() || name.trim(), rec: picked.length ? rec : null }) : Alert.alert('Enter a quiz name'));
  return (
    <View style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Bar s={s} onCancel={onCancel} onSave={save} />
        <Text style={s.lab}>Name:</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Quiz name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Number of questions (1 to 100):</Text>
        <TextInput style={s.input} value={fText} keyboardType="number-pad" maxLength={3} placeholder="30" placeholderTextColor={c.mute}
          onChangeText={(t) => { const d = t.replace(/\D/g, ''); setFText(d === '' ? '' : String(Math.min(100, parseInt(d, 10)))); }}
          onBlur={() => setFText(String(f))} />
        <Text style={s.lab}>Choices:</Text>
        <View style={s.chips}>{Object.keys(CHOICE_NAMES).map((k) => <Chip key={k} s={s} label={CHOICE_NAMES[k]} on={ch === k} onPress={() => setCh(k)} />)}</View>
        <Text style={s.sub2}>Print the {formOf({ f })}-question answer sheet for this quiz.{ch === 'TF' ? ' For true or false, students shade A for True and B for False.' : ''}</Text>
        <Text style={s.lab}>Classes:</Text>
        <View style={s.chips}>
          {classes.length ? classes.map((x) => <Chip key={x.id} s={s} label={x.n} on={picked.includes(x.id)} onPress={() => tog(x.id)} />)
            : <Text style={s.sub}>No classes yet. Create one on the Classes tab.</Text>}
        </View>
        <Text style={s.lab}>Spreadsheet name:</Text>
        <TextInput style={s.input} value={sh} onChangeText={setSh} placeholder="Spreadsheet name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Class record column (optional):</Text>
        <Text style={s.sub2}>Scores of registered students are entered here automatically after each scan.</Text>
        {!picked.length ? <Text style={s.sub2}>Pick a class above first.</Text> : (
          <View>
            <View style={s.chips}>{[1, 2, 3].map((n) => <Chip key={n} s={s} label={'Term ' + n} on={!!rec && rec.term === n} onPress={() => setRec({ term: 1, comp: 'ww', i: 0, ...(rec || {}), term: n })} />)}</View>
            <View style={s.chips}>{[['ww', 'Written Works'], ['pt', 'Performance Tasks'], ['ex', 'Examination']].map(([k, l]) => <Chip key={k} s={s} label={l} on={!!rec && rec.comp === k} onPress={() => setRec({ term: 1, ...(rec || {}), comp: k, i: 0 })} />)}</View>
            {rec ? <View style={s.chips}>{(rec.comp === 'ex' ? EXN : Array.from({ length: 10 }, (_, i) => String(i + 1))).map((l, i) => <Chip key={l} s={s} label={l} on={rec.i === i} onPress={() => setRec({ ...rec, i })} />)}</View> : null}
            {rec ? <Text style={[s.sub2, { color: c.green }]}>Scores go to {slotName(rec)}.</Text> : null}
            {rec && (quizzes || []).some((q) => q.rec && q.rec.term === rec.term && q.rec.comp === rec.comp && q.rec.i === rec.i && q.c.some((id) => picked.includes(id)))
              ? <Text style={[s.sub2, { color: c.red }]}>Another quiz already uses this column. Only one can fill it.</Text> : null}
            {rec ? <Btn s={s} label="Don't send to class record" onPress={() => setRec(null)} style={{ backgroundColor: c.mute }} /> : null}
          </View>
        )}
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
    onSave({ name: name.trim(), ids: picked.filter((k) => k[0] === 'e').map((k) => k.slice(1)), created: picked.filter((k) => k[0] === 'n').map((k) => k.slice(1)) });
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
        <AddRow s={s} c={c} placeholder="New student name" onAdd={(n) => {
          if (!checkStudent(students, '', n)) return false;
          if (added.some((a) => a.trim().toLowerCase() === n.toLowerCase())) { Alert.alert('Student already exists', 'A student named "' + n + '" is already added to this class.'); return false; }
          setAdded([...added, n]); setPicked([...picked, 'n' + n]);
        }} />
      </ScrollView>
    </View>
  );
}

function ScanModal({ s, c, quizzes, students, classes, initial, onSave, onClose }) {
  const [perm, ask] = useCameraPermissions();
  const cam = useRef(null);
  const [qid, setQid] = useState(initial || quizzes[0].id);
  const [phase, setPhase] = useState('camera'); // camera | busy | result
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [res, setRes] = useState(null); const [fix, setFix] = useState({}); const [idText, setIdText] = useState(''); const [nameText, setNameText] = useState('');
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
      if (out.n !== formOf(z)) throw new ScanError(`This is a ${out.n}-question sheet, but this quiz needs the ${formOf(z)}-question sheet.`);
      if (out.answers.length > z.f) out.answers = out.answers.slice(0, z.f);
      console.log('scan ms', Date.now() - t0);
      setRes(out); setFix({}); setNameText('');
      setIdText(out.studentId.includes('?') ? '' : out.studentId);
      setPhase('result');
    } catch (e) {
      console.log('scan error', e);
      setErr(e instanceof ScanError ? e.message : 'Could not read the photo: ' + ((e && e.message) || String(e)));
      if (e && e.debugUri) { setDbg({ uri: e.debugUri, ratio: e.debugRatio }); setPhase('fail'); } else setPhase('camera');
    }
  };

  if (phase === 'result' && res) {
    const flagged = res.answers.filter((a2) => a2.status !== 'ok' && a2.status !== 'blank');
    const unresolved = flagged.filter((a2) => !fix[a2.q]);
    const blanks = res.answers.filter((a2) => a2.status === 'blank').length;
    const letters = res.answers.map((a2) => (a2.status === 'ok' ? a2.choice[0] : fix[a2.q] ? (fix[a2.q] === 'X' ? '-' : fix[a2.q]) : a2.status === 'multiple' ? '?' : '-'));
    const score = letters.filter((l, i) => l === LET[z.key[i]]).length;
    const finalId = idText.trim(); const reg = students.find((st) => st.id === finalId) || null;
    const lay = LAYOUTS[formOf(z)]; const [PW, PH] = lay.page; const R = lay.answers.radius * 1.3;
    const pos = {}; lay.answers.bubbles.forEach((b) => { (pos[b.q] = pos[b.q] || {})[b.choice] = b; });
    const rings = [];
    res.answers.forEach((ans, i) => {
      const right = LET[z.key[i]]; const L = letters[i];
      const at = (ch, color, thin) => { const b = pos[ans.q] && pos[ans.q][ch]; if (b) rings.push({ x: b.x, y: b.y, color, thin }); };
      if (ans.status !== 'ok' && ans.status !== 'blank' && !fix[ans.q]) { (ans.status === 'multiple' ? ans.choice : [ans.suggest]).forEach((m) => m && at(m, AMBER)); return; }
      const marked = L === '?' || L === '-' ? [] : [L];
      if (marked.length === 1 && marked[0] === right) at(right, c.green);
      else if (marked.length) { marked.forEach((m) => at(m, c.red)); at(right, c.green, true); }
      else at(right, c.red);
    });
    const pool = students.filter((st) => !z.c.length || classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(st.id))).slice(0, 40);
    const save = () => {
      const name = reg ? reg.name : nameText.trim() || (finalId ? 'ID ' + finalId : 'Unnamed paper');
      const again = finalId && z.res.some((r) => r.id === finalId);
      onSave(qid, { id: finalId, name, ans: letters.join(''), d: today(), thumb: res.reviewUri });
      setNote(`Saved ${name}: ${score}/${z.f}${reg ? '' : ' (not registered, you can assign it later)'}.${again ? ' Replaced the earlier paper.' : ''} Scan the next paper.`);
      setPhase('camera'); setRes(null);
    };
    const acceptAll = () => { const f = { ...fix }; unresolved.forEach((a2) => { if (a2.suggest) f[a2.q] = a2.suggest; }); setFix(f); };
    return (
      <View style={s.sheet}>
        <Bar s={s} onCancel={() => { setPhase('camera'); setRes(null); }} cancelLabel="RETAKE" onSave={save} />
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={s.h2}>{reg ? reg.name : 'Student not registered'}</Text>
          <Text style={s.sub2}>Quiz: {z.n}. ID read from the sheet: {res.studentId || 'blank'}</Text>
          <Text style={[s.h2, { color: c.green }]}>{score} / {z.f}</Text>
          <Text style={s.lab}>Student ID</Text>
          <TextInput style={s.input} value={idText} onChangeText={(t) => setIdText(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={12}
            placeholder="Leave blank if unknown" placeholderTextColor={c.mute} />
          {!reg ? (
            <View>
              <Text style={s.lab}>Written on the paper</Text><ScanStrip uri={res.reviewUri} />
              <Text style={s.lab}>Name (optional)</Text>
              <TextInput style={s.input} value={nameText} onChangeText={setNameText} placeholder="Type a name, or pick a student below" placeholderTextColor={c.mute} maxLength={60} />
              {pool.length ? <View><Text style={s.sub2}>Pick a registered student:</Text><View style={s.chips}>
                {pool.map((st) => <Chip key={st.id} s={s} label={st.name} on={false} onPress={() => { setIdText(st.id); setNameText(''); }} />)}</View></View> : null}
              <Text style={s.sub2}>This paper is saved even if the student is not registered. Assign it later from Review Papers.</Text>
            </View>
          ) : null}
          {flagged.length ? (
            <View>
              <Text style={s.lab}>Check these answers ({unresolved.length} to confirm):</Text>
              <Text style={s.sub2}>Amber circles on the sheet below. The outlined letter is the app's best guess. "None" gives no credit.</Text>
              {unresolved.some((a2) => a2.suggest) ? <Btn s={s} label="Accept all guesses" onPress={acceptAll} style={{ marginTop: 4 }} /> : null}
              {flagged.map((a2) => (
                <View key={a2.q} style={{ marginTop: 10 }}>
                  <View style={s.kr}>
                    <Text style={s.kn}>{a2.q}</Text>
                    {optsOf(z).map((l) => <Pressable key={l} onPress={() => setFix({ ...fix, [a2.q]: l })} style={[s.kb, a2.suggest === l && !fix[a2.q] && s.kbSug, fix[a2.q] === l && s.kbOn]}><Text style={[s.txt, fix[a2.q] === l && { color: c.bg }]}>{showL(z, l)}</Text></Pressable>)}
                    <Pressable onPress={() => setFix({ ...fix, [a2.q]: 'X' })} style={[s.kbN, fix[a2.q] === 'X' && s.kbOn]}><Text style={[s.sub, fix[a2.q] === 'X' && { color: c.bg }]}>None</Text></Pressable>
                  </View>
                  <Text style={[s.sub, { textAlign: 'left', marginLeft: 36 }]}>{a2.reason}{a2.status === 'multiple' ? ': ' + a2.choice.join(', ') : ''}</Text>
                </View>
              ))}
              {unresolved.length ? <Text style={[s.sub2, { color: c.red, marginTop: 8 }]}>Unconfirmed answers count as wrong.</Text> : null}
            </View>
          ) : <Text style={s.sub2}>Every answer was read clearly.</Text>}
          {blanks ? <Text style={s.sub2}>{blanks} question{blanks > 1 ? 's' : ''} left blank.</Text> : null}
          <Text style={[s.sub2, { marginTop: 14 }]}>Green = correct. Red = wrong or missed. Amber = needs your check.</Text>
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
  const lay = LAYOUTS[formOf(z)]; const [PW, PH] = lay.page; const R = lay.answers.radius; const sc = W / PW;
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
                <Text style={s.iaL}>{k.l === '-' ? '\u2013' : showL(z, k.l)}</Text><Text style={s.iaC}>{k.n}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.iaD, s.txt]}>{r.df.toFixed(2)}</Text><Text style={[s.iaPt, s.txt]}>1</Text>
        </View>
      ))}
    </View>
  );
}

// Saves the rows as a real .csv file (opens in Excel / Sheets) and opens the share sheet.
async function shareCsv(name, rows) {
  const file = String(name || 'export').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) + '.csv';
  const text = '\ufeff' + toCsv(rows); // the first character tells Excel the file is UTF-8, so accents and ñ show correctly
  try {
    let uri;
    if (FS.File && FS.Paths) { // current Expo file API
      const f = new FS.File(FS.Paths.cache, file);
      try { if (f.exists) f.delete(); } catch (e) { /* new file */ }
      f.create(); f.write(text); uri = f.uri;
    } else { // older Expo versions
      uri = FS.cacheDirectory + file; await FS.writeAsStringAsync(uri, text);
    }
    if (!(await Sharing.isAvailableAsync())) { Alert.alert('Sharing is not available on this device'); return; }
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: file });
  } catch (e) { Alert.alert('Could not create the CSV file', String((e && e.message) || e)); }
}

function useScan(k, uri) {
  const [src, setSrc] = useState(uri || thumbCache.get(k) || null);
  useEffect(() => {
    let live = true;
    if (uri) { setSrc(uri); return undefined; }
    const hit = thumbCache.get(k);
    if (hit) setSrc(hit);
    else { setSrc(null); AsyncStorage.getItem(k).then((v) => { if (v) { thumbCache.set(k, v); if (live) setSrc(v); } }).catch(() => {}); }
    return () => { live = false; };
  }, [k, uri]);
  return src;
}
// The top of the scanned sheet: Name, Class and Student ID. For papers with no registered student.
function ScanStrip({ k, uri, style, fallback }) {
  const src = useScan(k, uri);
  if (!src) return fallback || null;
  const [PW, PH] = LAYOUTS[30].page; const bw = STRIP.x1 - STRIP.x0, bh = STRIP.y1 - STRIP.y0;
  return (
    <View style={[{ width: '100%', aspectRatio: bw / bh, overflow: 'hidden', backgroundColor: '#ffffff', borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#8a949e' }, style]}>
      <Image source={{ uri: src }} resizeMode="stretch" style={{ position: 'absolute', width: (PW / bw) * 100 + '%', height: (PH / bh) * 100 + '%', left: (-STRIP.x0 / bw) * 100 + '%', top: (-STRIP.y0 / bh) * 100 + '%' }} />
    </View>
  );
}
// Green / red rings for one graded paper, in points on the printed page.
function paperRings(c, z, paper) {
  const lay = LAYOUTS[formOf(z)]; const R = lay.answers.radius * 1.3; const pos = {}; const out = [];
  lay.answers.bubbles.forEach((b) => { (pos[b.q] = pos[b.q] || {})[b.choice] = b; });
  const at = (q, ch, color, thin) => { const b = pos[q] && pos[q][ch]; if (b) out.push({ x: b.x, y: b.y, color, thin }); };
  for (let i = 0; i < z.f; i++) {
    const m = paper.ans[i]; const right = LET[z.key[i]]; const q = i + 1;
    if (m === right) at(q, right, c.green);
    else if (LET.includes(m)) { at(q, m, c.red); at(q, right, c.green, true); }
    else at(q, right, c.red);
  }
  return { rings: out, R, page: lay.page };
}
// The whole scanned sheet, from the title to the bottom, with the rings on top.
function ScanFull({ k, z, paper, c, fallback }) {
  const src = useScan(k, null);
  if (!src) return fallback || null;
  const { rings, R, page: [PW, PH] } = paperRings(c, z, paper);
  return (
    <View style={{ width: '100%', aspectRatio: PW / PH, marginTop: 8, borderWidth: 1.5, borderColor: c.mute, backgroundColor: '#ffffff' }}>
      <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {rings.map((g, i) => (
        <View key={i} pointerEvents="none" style={{
          position: 'absolute', left: ((g.x - R) / PW) * 100 + '%', top: ((g.y - R) / PH) * 100 + '%', width: ((2 * R) / PW) * 100 + '%', height: ((2 * R) / PH) * 100 + '%',
          borderRadius: 999, borderWidth: g.thin ? 1.5 : 2.5, borderColor: g.color }} />
      ))}
    </View>
  );
}

function Field({ s, c, label, ...p }) {
  return <View><Text style={s.lab}>{label}</Text><TextInput style={s.input} placeholderTextColor={c.mute} autoCapitalize="none" autoCorrect={false} {...p} /></View>;
}

// "Rename" link that opens a small box to change a quiz, class or spreadsheet name.
function RenameBar({ s, c, value, label, onSave }) {
  const [edit, setEdit] = useState(false); const [t, setT] = useState(value);
  useEffect(() => { setT(value); }, [value]);
  const save = () => { const n = t.trim(); if (!n) return Alert.alert('Enter a name'); onSave(n); setEdit(false); };
  if (!edit) {
    return (
      <Pressable onPress={() => setEdit(true)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Ionicons name="create-outline" size={16} color={c.mute} /><Text style={[s.sub2, { marginLeft: 4 }]}>Rename</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ marginBottom: 8 }}>
      <Field s={s} c={c} label={label} value={t} onChangeText={setT} autoCapitalize="words" maxLength={60} />
      <View style={s.row}>
        <Btn s={s} label="Save" onPress={save} style={{ flex: 1 }} />
        <Btn s={s} label="Cancel" onPress={() => { setT(value); setEdit(false); }} style={{ flex: 1, backgroundColor: c.mute }} />
      </View>
    </View>
  );
}

// One learner in a class: tap to rename or change the student ID.
function StudentRow({ s, c, st, clash, onSave, onRemove }) {
  const [edit, setEdit] = useState(false); const [name, setName] = useState(st.name); const [id, setId] = useState(st.id);
  useEffect(() => { setName(st.name); setId(st.id); }, [st.name, st.id]);
  const save = () => {
    const n = name.trim(); const i = id.trim();
    if (!n) return Alert.alert('Enter a name');
    if (!/^\d{1,12}$/.test(i)) return Alert.alert('Student ID must be numbers only', 'The answer sheet can only read digits.');
    const dup = clash(i !== st.id ? i : '', n !== st.name ? n : ''); // only check what was changed
    if (dup) return Alert.alert('Student already exists', dup);
    onSave(st.id, n, i); setEdit(false);
  };
  if (!edit) {
    return (
      <Pressable style={[s.li, { alignItems: 'center' }]} onPress={() => setEdit(true)}>
        <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{st.name}</Text><Text style={s.txt}>ID {st.id}</Text><Ionicons name="create-outline" size={18} color={c.mute} />
      </Pressable>
    );
  }
  return (
    <View style={s.li2}>
      <Field s={s} c={c} label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
      <Field s={s} c={c} label="Student ID" value={id} onChangeText={(t) => setId(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={12} />
      <View style={s.row}>
        <Btn s={s} label="Save" onPress={save} style={{ flex: 1 }} />
        <Btn s={s} label="Cancel" onPress={() => { setName(st.name); setId(st.id); setEdit(false); }} style={{ flex: 1, backgroundColor: c.mute }} />
      </View>
      <Btn s={s} label="Remove from this class" style={{ backgroundColor: c.red }} onPress={() => Alert.alert('Remove ' + st.name + '?', 'Their saved papers stay in the quizzes.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => onRemove(st.id) }])} />
    </View>
  );
}

// ---------------- Individual score + MPS (from the MPS workbook) ----------------
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const pad3 = (v) => String(v).padStart(3, ' ');
function runs(marks) { // groups the 1s and 0s so a 100-item row is a few text spans instead of 100
  const out = [];
  marks.forEach((m) => { const last = out[out.length - 1]; if (last && last.m === m) last.n += 1; else out.push({ m, n: 1 }); });
  return out;
}
function IndivScores({ s, c, z, classes }) {
  const d = useMemo(() => individualScores(z), [z]);
  const m = mpsSummary(d.rows.map((r) => r.total), z.f);
  if (!m) return <Text style={s.empty}>Scan some papers first.</Text>;
  const secs = useMemo(() => quizSections(z, classes), [z, classes]);
  const shareInd = () => shareCsv(z.n + '_individual-score', individualCsvRows(z, secs));
  const shareMps = () => shareCsv(z.n + '_MPS', mpsCsvRows(z, secs));
  const R = (a2, b) => <View key={a2} style={s.li}><Text style={[s.txt, { flex: 1 }]}>{a2}</Text><Text style={s.txt}>{b}</Text></View>;
  return (
    <View>
      <View style={s.list}>{R('Cases (papers)', m.cases)}{R('HPS (items)', m.hps)}{R('HSO (highest score)', m.hso)}{R('LSO (lowest score)', m.lso)}
        {R('Mean', m.mean.toFixed(2))}{R('MPS', m.mps.toFixed(2) + '%')}</View>
      <Text style={s.sec}>Level of proficiency</Text>
      <View style={s.list}>{LEVELS.slice().reverse().map((l) => R(l.n, m.bands[l.k] + '   (' + ((m.bands[l.k] / m.cases) * 100).toFixed(1) + '%)'))}</View>
      <Text style={s.sec}>Individual score</Text>
      <Text style={s.sub2}>1 = correct, 0 = wrong or blank. Swipe sideways to see every item.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={s.ir}><Text style={[s.iN, s.sub]}>Learner</Text><Text style={[s.iT, s.sub]}>Total</Text>
            <Text style={[s.iM, { color: c.mute }]}>{z.key.map((_, i) => pad3(i + 1)).join('')}</Text></View>
          {d.rows.map((r) => (
            <View key={r.uid} style={s.ir}><Text style={s.iN} numberOfLines={1}>{r.name}</Text><Text style={s.iT}>{r.total}</Text>
              <Text style={s.iM}>{runs(r.marks).map((g, i) => <Text key={i} style={{ color: g.m ? c.ink : c.red }}>{pad3(g.m).repeat(g.n)}</Text>)}</Text></View>
          ))}
          <View style={[s.ir, { borderTopWidth: 1, borderColor: c.mute }]}><Text style={s.iN}>Correct</Text><Text style={s.iT} /><Text style={s.iM}>{d.correct.map(pad3).join('')}</Text></View>
          <View style={s.ir}><Text style={s.iN}>% correct</Text><Text style={s.iT} /><Text style={s.iM}>{d.pct.map((p) => pad3(Math.round(p))).join('')}</Text></View>
          <View style={s.ir}><Text style={s.iN}>Level</Text><Text style={s.iT} /><Text style={s.iM}>{d.lp.map((l) => l.k.padStart(3, ' ')).join('')}</Text></View>
        </View>
      </ScrollView>
      <Btn s={s} label="Share individual score (CSV file)" onPress={shareInd} />
      <Btn s={s} label="Share MPS (CSV file)" onPress={shareMps} />
      <Text style={s.sub2}>Each class that took this quiz becomes one section, laid out like your MPS workbook. Open the files in Excel or Google Sheets.</Text>
    </View>
  );
}

// ---------------- Class record (DepEd SHS e-Class Record rules) ----------------
const blankTerm = () => ({ hps: { ww: Array(10).fill(''), pt: Array(10).fill(''), ex: ['', '', ''] }, sc: {} });
const blankRec = (cls) => ({ info: { region: '', division: '', schoolId: '', school: '', teacher: '', section: cls.n, subject: '', track: 'core', terms: 3 }, t: { 1: blankTerm(), 2: blankTerm(), 3: blankTerm() } });
const COMP = [['ww', 'Written Works', 'WW'], ['pt', 'Performance Tasks', 'PT'], ['ex', 'Examinations', '']];
const EXN = ['ST 1', 'ST 2', 'TE'];
const slotName = (r) => (r.comp === 'ex' ? EXN[r.i] : (r.comp === 'ww' ? 'WW ' : 'PT ') + (r.i + 1)) + ', Term ' + r.term;
const f2 = (v) => (v === null || v === undefined ? '' : v.toFixed(2));

function Cell({ s, value, onCommit }) {
  const show = value === undefined || value === null ? '' : String(value);
  const [v, setV] = useState(show);
  useEffect(() => { setV(show); }, [show]);
  const done = () => { if (v.trim() !== show) onCommit(v.trim()); };
  return <TextInput style={s.gc} value={v} onChangeText={setV} onEndEditing={done} onBlur={done} keyboardType="decimal-pad" selectTextOnFocus />;
}

function EcrSetup({ s, c, info, onSave, onCancel }) {
  const [f, setF] = useState(info);
  const pct0 = (info.w && info.w.length === 3 ? info.w : (TRACKS.find((x) => x.k === info.track) || TRACKS[0]).w.map((x) => Math.round(x * 100)));
  const [wt, setWt] = useState(pct0.map(String));
  const wNum = wt.map((x) => (x === '' || isNaN(Number(x)) ? 0 : Number(x))); const wTotal = Math.round(wNum.reduce((a, b) => a + b, 0) * 100) / 100;
  const putW = (i) => (v) => setWt(wt.map((x, k) => (k === i ? v.replace(/[^0-9.]/g, '') : x)));
  const trySave = () => { if (wTotal !== 100) return Alert.alert('Weights must add up to 100%', 'Now they add up to ' + wTotal + '%.'); onSave({ ...f, w: wNum }); };
  const put = (k) => (v) => setF({ ...f, [k]: v });
  const fields = [['region', 'Region'], ['division', 'Division'], ['schoolId', 'School ID'], ['school', 'School name'], ['teacher', 'Teacher'], ['section', 'Section'], ['subject', 'Subject']];
  return (
    <View>
      {fields.map(([k, l]) => <Field key={k} s={s} c={c} label={l + ':'} value={f[k]} onChangeText={put(k)} placeholder={l} autoCapitalize="words" />)}
      <Text style={s.lab}>Subject track (sets the WW / PT / Exam weights):</Text>
      <View style={s.chips}>{TRACKS.map((t) => <Chip key={t.k} s={s} label={t.n} on={f.track === t.k} onPress={() => { setF({ ...f, track: t.k }); setWt(t.w.map((x) => String(Math.round(x * 100)))); }} />)}</View>
      <Text style={s.lab}>Weights (you can change them, must add up to 100%):</Text>
      {[['Written Works', 0], ['Performance Tasks', 1], ['Examination', 2]].map(([l, i]) => <Field key={i} s={s} c={c} label={l + ' %:'} value={wt[i]} onChangeText={putW(i)} keyboardType="decimal-pad" maxLength={5} placeholder="0" />)}
      <Text style={[s.sub2, { color: wTotal === 100 ? c.green : c.red }]}>Total: {wTotal}%</Text>
      <Text style={s.lab}>Number of terms the subject is taught:</Text>
      <View style={s.chips}>{[1, 2, 3].map((n) => <Chip key={n} s={s} label={String(n)} on={f.terms === n} onPress={() => setF({ ...f, terms: n })} />)}</View>
      <Btn s={s} label="Save class info" onPress={trySave} />
      <Btn s={s} label="Cancel" onPress={onCancel} style={{ backgroundColor: c.mute }} />
    </View>
  );
}

// Scores of any quiz set to "count toward" a column fill in by themselves (matched by student ID). Other columns can be typed.
function ClassRecord({ s, c, cls, students, quizzes, saved, onSave, onBack }) {
  const rec = useMemo(() => {
    const r = saved ? JSON.parse(JSON.stringify(saved)) : blankRec(cls);
    [1, 2, 3].forEach((n) => { if (!r.t[n]) r.t[n] = blankTerm(); });
    return r;
  }, [saved, cls]);
  const [view, setView] = useState('menu'); const [term, setTerm] = useState(1);
  const studs = cls.s.map((id) => students.find((x) => x.id === id)).filter(Boolean);
  const set = (fn) => { const r = JSON.parse(JSON.stringify(rec)); fn(r); onSave(r); };
  const info = rec.info; const track = TRACKS.find((t) => t.k === info.track) || TRACKS[0];
  const wts = info.w && info.w.length === 3 && Math.round(info.w.reduce((a, b) => a + b, 0) * 100) === 10000 ? info.w.map((x) => x / 100) : track.w;
  const slot = (n, k, i) => quizzes.find((q) => q.rec && q.rec.term === n && q.rec.comp === k && q.rec.i === i && q.c.includes(cls.id));

  const calc = (n) => {
    const T = rec.t[n]; const hps = { ww: [], pt: [], ex: [] }; const src = { ww: [], pt: [], ex: [] }; const linked = [];
    COMP.forEach(([k]) => T.hps[k].forEach((h, i) => { const q = slot(n, k, i); src[k][i] = q || null; hps[k][i] = q ? q.f : h; if (q) linked.push({ k, i, q }); }));
    let loose = 0; const seen = new Set();
    linked.forEach(({ q }) => { if (seen.has(q.id)) return; seen.add(q.id); q.res.forEach((r) => { if (!studs.some((st) => st.id === r.id)) loose += 1; }); });
    const rows = studs.map((st) => {
      const sc = { ww: [], pt: [], ex: [] };
      COMP.forEach(([k]) => T.hps[k].forEach((_, i) => {
        const q = src[k][i];
        if (q) { const p = q.res.find((r) => r.id === st.id); sc[k][i] = p ? scoreOf(q, p) : ''; } else sc[k][i] = ((T.sc[st.id] || {})[k] || [])[i];
      }));
      return { st, sc, r: termCalc(info.track, hps, sc, wts) };
    });
    return { hps, src, rows, loose };
  };
  const head = (title) => [
    ['Class record', cls.n], ['Region', info.region], ['Division', info.division], ['School ID', info.schoolId], ['School', info.school],
    ['Teacher', info.teacher], ['Section', info.section], ['Subject', info.subject], ['Track', track.n], ['Weights', 'WW ' + Math.round(wts[0] * 1000) / 10 + '%, PT ' + Math.round(wts[1] * 1000) / 10 + '%, Exam ' + Math.round(wts[2] * 1000) / 10 + '%'], [], [title], [],
  ];

  if (view === 'setup') {
    return <View><Pressable onPress={() => setView('menu')}><Text style={s.back}>{'\u2190'} Class record</Text></Pressable><Text style={s.h1}>Class info</Text>
      <EcrSetup s={s} c={c} info={info} onSave={(f) => { set((r) => { r.info = f; }); setView('menu'); }} onCancel={() => setView('menu')} /></View>;
  }

  if (view === 'term') {
    const T = rec.t[term]; const { hps, src, rows, loose } = calc(term);
    const shown = (k) => { if (k === 'ex') return 3; let last = -1; T.hps[k].forEach((h, i) => { if (h !== '' || src[k][i]) last = i; }); return Math.min(NCOL[k], last + 2); };
    const cols = []; COMP.forEach(([k, , ab]) => { for (let i = 0; i < shown(k); i++) cols.push({ k, i, label: k === 'ex' ? EXN[i] : ab + ' ' + (i + 1) }); });
    const setHps = (k, i, v) => set((r) => { r.t[term].hps[k][i] = v; });
    const setSc = (st, k, i, v) => set((r) => { const m2 = r.t[term].sc; if (!m2[st.id]) m2[st.id] = { ww: [], pt: [], ex: [] }; m2[st.id][k][i] = v; });
    const share = () => shareCsv((cls.n || 'class') + '_term' + term, [
      ...head('Term ' + term),
      ['', 'Learner', ...Array.from({ length: 10 }, (_, i) => 'WW' + (i + 1)), 'WW total', 'WW PS', 'WW WS', ...Array.from({ length: 10 }, (_, i) => 'PT' + (i + 1)), 'PT total', 'PT PS', 'PT WS', ...EXN, 'Exam PS', 'Exam WS', 'Initial grade', 'Term grade'],
      ['', 'HIGHEST POSSIBLE SCORE', ...hps.ww, '', 100, '', ...hps.pt, '', 100, '', ...hps.ex, 100, '', '', ''],
      ...rows.map((x, n) => [n + 1, x.st.name, ...Array.from({ length: 10 }, (_, i) => (x.sc.ww[i] === undefined ? '' : x.sc.ww[i])), x.r.ww.total, x.r.ww.ps, x.r.ww.ws,
        ...Array.from({ length: 10 }, (_, i) => (x.sc.pt[i] === undefined ? '' : x.sc.pt[i])), x.r.pt.total, x.r.pt.ps, x.r.pt.ws,
        ...[0, 1, 2].map((i) => (x.sc.ex[i] === undefined ? '' : x.sc.ex[i])), x.r.ex.ps, x.r.ex.ws, x.r.ig, x.r.tg]),
    ]);
    const links = cols.filter((x) => src[x.k][x.i]);
    return (
      <View>
        <Pressable onPress={() => setView('menu')}><Text style={s.back}>{'\u2190'} Class record</Text></Pressable>
        <Text style={s.h1}>Term {term}</Text>
        <Text style={s.sub2}>{info.subject || 'No subject yet'}. Weights: WW {Math.round(wts[0] * 1000) / 10}%, PT {Math.round(wts[1] * 1000) / 10}%, Exam {Math.round(wts[2] * 1000) / 10}%.</Text>
        <Text style={s.sub2}>Green columns fill in automatically from scanned quizzes. Type the highest possible score (HPS) and scores for any other column.</Text>
        {loose ? <Text style={[s.sub2, { color: c.red }]}>{loose} scanned paper{loose > 1 ? 's' : ''} in these quizzes could not be matched to a learner in this class. Open the quiz, Review Papers, and assign them.</Text> : null}
        {!studs.length ? <Text style={s.empty}>This class has no learners yet. Add them on the Classes tab.</Text> : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={s.gr}><Text style={s.gname} />{cols.map((x) => <Text key={x.k + x.i} style={[s.gh, src[x.k][x.i] && { color: c.green }]}>{x.label}</Text>)}</View>
              <View style={s.gr}><Text style={[s.gname, { color: c.mute, fontSize: 12 }]}>HPS</Text>{cols.map((x) => (src[x.k][x.i]
                ? <Text key={x.k + x.i} style={[s.gh, { color: c.green, fontSize: 15 }]}>{src[x.k][x.i].f}</Text>
                : <Cell key={x.k + x.i} s={s} value={T.hps[x.k][x.i]} onCommit={(v) => setHps(x.k, x.i, v)} />))}</View>
              {rows.map((x) => (
                <View key={x.st.id} style={s.gr}><Text style={s.gname} numberOfLines={1}>{x.st.name}</Text>{cols.map((col) => {
                  const val = x.sc[col.k][col.i];
                  if (src[col.k][col.i]) return <Text key={col.k + col.i} style={[s.gh, { color: c.green, fontSize: 15 }]}>{val === '' || val === undefined ? '' : val}</Text>;
                  if (T.hps[col.k][col.i] === '') return <Text key={col.k + col.i} style={[s.gh, { backgroundColor: c.bg, height: 36, lineHeight: 36 }]}>{'\u2013'}</Text>;
                  return <Cell key={col.k + col.i} s={s} value={val} onCommit={(v) => setSc(x.st, col.k, col.i, v)} />;
                })}</View>
              ))}
            </View>
          </ScrollView>
        )}
        {links.length ? <Text style={[s.sub2, { marginTop: 8 }]}>Linked: {links.map((x) => x.label + ' = ' + src[x.k][x.i].n).join('; ')}</Text> : null}
        <Text style={s.sec}>Results</Text>
        <View style={s.list}>
          <View style={s.li}><Text style={[s.sub, { flex: 1, textAlign: 'left' }]}>Weighted scores</Text>{['WW', 'PT', 'EX', 'IG', 'TG'].map((h) => <Text key={h} style={s.rc}>{h}</Text>)}</View>
          {rows.length ? rows.map((x) => (
            <View key={x.st.id} style={s.li}><Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{x.st.name}</Text>
              <Text style={s.rc}>{f2(x.r.ww.ws)}</Text><Text style={s.rc}>{f2(x.r.pt.ws)}</Text><Text style={s.rc}>{f2(x.r.ex.ws)}</Text><Text style={s.rc}>{f2(x.r.ig)}</Text>
              <Text style={[s.rc, { fontWeight: '700', color: x.r.tg !== null && x.r.tg < 75 ? c.red : c.ink }]}>{x.r.tg === null ? '' : x.r.tg}</Text></View>
          )) : <Text style={s.empty}>No learners.</Text>}
        </View>
        <Btn s={s} label="Share term as CSV" onPress={share} />
      </View>
    );
  }

  if (view === 'final') {
    const per = []; for (let n = 1; n <= 3; n++) per.push(n <= info.terms ? calc(n).rows : null);
    const rows = studs.map((st, i) => { const tgs = per.map((p) => (p ? p[i].r.tg : null)); return { st, tgs, f: finalCalc(tgs, info.terms) }; });
    const share = () => shareCsv((cls.n || 'class') + '_final-grades', [...head('Final grades'),
      ['', 'Learner', 'Term 1', 'Term 2', 'Term 3', 'Final grade', 'Descriptor', 'Remark'],
      ...rows.map((x, n) => [n + 1, x.st.name, ...x.tgs.map((g, i) => (i < info.terms ? (g === null ? '' : g) : '')), x.f.fg, x.f.desc, x.f.remark])]);
    return (
      <View>
        <Pressable onPress={() => setView('menu')}><Text style={s.back}>{'\u2190'} Class record</Text></Pressable>
        <Text style={s.h1}>Final Grades</Text>
        <Text style={s.sub2}>Final grade = average of the term grades. It appears once every term ({info.terms}) has a term grade.</Text>
        <View style={s.list}>
          <View style={s.li}><Text style={[s.sub, { flex: 1, textAlign: 'left' }]}>Learner</Text>{['T1', 'T2', 'T3', 'Final'].map((h) => <Text key={h} style={s.rc}>{h}</Text>)}</View>
          {rows.length ? rows.map((x) => (
            <View key={x.st.id} style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute }}>
              <View style={{ flexDirection: 'row' }}><Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{x.st.name}</Text>
                {x.tgs.map((g, i) => <Text key={i} style={s.rc}>{i < info.terms && g !== null ? g : '\u2013'}</Text>)}
                <Text style={[s.rc, { fontWeight: '700', color: x.f.fg !== null && x.f.fg < 75 ? c.red : c.ink }]}>{x.f.fg === null ? '' : x.f.fg}</Text></View>
              {x.f.fg !== null ? <Text style={[s.sub, { textAlign: 'left' }]}>{x.f.desc}. {x.f.remark}</Text> : null}
            </View>
          )) : <Text style={s.empty}>No learners.</Text>}
        </View>
        <Btn s={s} label="Share final grades as CSV" onPress={share} />
      </View>
    );
  }

  return (
    <View>
      <Pressable onPress={onBack}><Text style={s.back}>{'\u2190'} Back</Text></Pressable>
      <Text style={s.h1}>{cls.n}</Text>
      <Text style={s.sub2}>{studs.length} learners. {info.subject ? info.subject + '. ' + track.n + '.' : 'Set the class info first (subject and track decide the weights).'}</Text>
      <Text style={s.sub2}>To send a quiz's scores here automatically, open the quiz and tap "Class record entry".</Text>
      <MenuBtn s={s} c={c} icon="settings-outline" label="Class info" onPress={() => setView('setup')} />
      {Array.from({ length: info.terms }, (_, i) => i + 1).map((n) => <MenuBtn key={n} s={s} c={c} icon="create-outline" label={'Term ' + n} onPress={() => { setTerm(n); setView('term'); }} />)}
      <MenuBtn s={s} c={c} icon="ribbon-outline" label="Final Grades" onPress={() => setView('final')} />
    </View>
  );
}

// ---------------- Teacher accounts ----------------
const checkNew = (f) => {
  if (!f.name.trim()) return 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(f.user.trim())) return 'Enter a valid email address.';
  if (f.password.length < 6) return 'Password must be at least 6 characters.';
  if (f.password !== f.confirm) return 'The passwords do not match.';
  return '';
};
function ForgotPassword({ s, c, email: email0, onSendCode, onReset, onBack }) {
  const [email, setEmail] = useState(email0 || '');
  const [step, setStep] = useState('email');
  const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email address.');
    setBusy(true); const e = await onSendCode(email); setBusy(false);
    if (e) return setErr(e);
    setErr(''); setStep('code');
  };
  const save = async () => {
    if (busy) return;
    if (code.trim().length < 6) return setErr('Enter the code from your email.');
    if (pw.length < 6) return setErr('Password must be at least 6 characters.');
    if (pw !== pw2) return setErr('The passwords do not match.');
    setBusy(true); const e = await onReset(email, code, pw);
    if (e) { setBusy(false); setErr(e); }
  };
  return (
    <View style={[s.root, { paddingTop: TOP + 10 }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
            <Image source={require('./assets/gurogabay-logo.png')} style={{ width: 150, height: 130 }} resizeMode="contain" />
            <Text style={[s.h1, { marginLeft: 0, marginTop: 14, marginBottom: 2 }]}>Reset password</Text>
            <Text style={[s.sub2, { marginLeft: 0, textAlign: 'center' }]}>
              {step === 'email' ? "We'll email you a 6-digit code." : 'Enter the code we sent to ' + email.trim()}
            </Text>
          </View>
          {step === 'email'
            ? <Field s={s} c={c} label="Email" value={email} onChangeText={(t) => { setEmail(t); setErr(''); }} placeholder="teacher@school.com" keyboardType="email-address" autoCapitalize="none" />
            : <>
                <Field s={s} c={c} label="Code" value={code} onChangeText={(t) => { setCode(t); setErr(''); }} keyboardType="number-pad" maxLength={10} />
                <Field s={s} c={c} label="New password" value={pw} onChangeText={(t) => { setPw(t); setErr(''); }} secureTextEntry autoCapitalize="none" />
                <Field s={s} c={c} label="Confirm new password" value={pw2} onChangeText={(t) => { setPw2(t); setErr(''); }} secureTextEntry autoCapitalize="none" />
              </>}
          {err ? <Text style={[s.sub, { color: c.red, textAlign: 'left', fontSize: 14, marginTop: 6 }]}>{err}</Text> : null}
          <Btn s={s} label={busy ? 'Please wait...' : step === 'email' ? 'Send code' : 'Save new password'}
            onPress={step === 'email' ? send : save} disabled={busy} style={{ marginHorizontal: 0 }} />
          {step === 'code' ? <Pressable onPress={send} style={{ alignItems: 'center', paddingVertical: 14 }}><Text style={[s.txt, { color: c.green }]}>Resend code</Text></Pressable> : null}
          <Pressable onPress={onBack} style={{ alignItems: 'center', paddingVertical: 10 }}><Text style={[s.txt, { color: c.green }]}>Back to sign in</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
function AuthScreen({ s, c, onLogin, onRegister, onSendCode, onReset }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', school: '', user: '', password: '', confirm: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [stay, setStay] = useState(true); const [show, setShow] = useState(false);
  const put = (k) => (v) => { setF({ ...f, [k]: v }); setErr(''); };
  const reg = mode === 'register';
  const submit = () => {
    if (busy) return;
    if (reg) { const e = checkNew(f); if (e) return setErr(e); } else if (!f.user.trim() || !f.password) return setErr('Enter your email and password.');
    setBusy(true);
    setTimeout(() => { // let the spinner draw before the password work
      Promise.resolve(reg ? onRegister(f, stay) : onLogin(f, stay)).then((r) => { if (r) { setErr(r); setBusy(false); } }).catch(() => { setErr('Something went wrong. Try again.'); setBusy(false); });
    }, 40);
  };
  if (mode === 'forgot') return <ForgotPassword s={s} c={c} email={f.user} onSendCode={onSendCode} onReset={onReset} onBack={() => setMode('login')} />;
  return (
    <View style={[s.root, { paddingTop: TOP + 10 }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
            <Image source={require('./assets/gurogabay-logo.png')} style={{ width: 150, height: 130 }} resizeMode="contain" />
            <Text style={[s.h1, { marginLeft: 0, marginTop: 14, marginBottom: 2 }]}>GuroGabay</Text>
            <Text style={[s.sub2, { marginLeft: 0, textAlign: 'center' }]}>{reg ? 'Create your teacher account' : 'Sign in to your teacher account'}</Text>
          </View>
          {reg ? <Field s={s} c={c} label="Full name" value={f.name} onChangeText={put('name')} autoCapitalize="words" placeholder="e.g. Maria Santos" maxLength={60} /> : null}
          {reg ? <Field s={s} c={c} label="School (optional)" value={f.school} onChangeText={put('school')} autoCapitalize="words" placeholder="School name" maxLength={80} /> : null}
          <Field s={s} c={c} label="Email" value={f.user} onChangeText={put('user')} placeholder="teacher@school.com" keyboardType="email-address" maxLength={60} />
          <Text style={s.lab}>Password</Text>
          <View style={[s.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0 }]}>
            <TextInput style={{ flex: 1, height: 46, paddingHorizontal: 14, color: c.ink, fontSize: 16 }} value={f.password} onChangeText={put('password')} secureTextEntry={!show}
              autoCapitalize="none" autoCorrect={false} placeholder={reg ? 'At least 6 characters' : 'Password'} placeholderTextColor={c.mute} />
            <Pressable onPress={() => setShow(!show)} style={{ paddingHorizontal: 14 }} accessibilityLabel="Show or hide password"><Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={c.mute} /></Pressable>
          </View>
          {reg ? <Field s={s} c={c} label="Confirm password" value={f.confirm} onChangeText={put('confirm')} secureTextEntry={!show} placeholder="Type it again" /> : null}
          {!reg ? <Pressable onPress={() => { setMode('forgot'); setErr(''); }} style={{ alignSelf: 'flex-end', marginBottom: 12 }}>
            <Text style={[s.txt, { color: c.green }]}>Forgot password?</Text></Pressable> : null}
          <View style={s.row}><Text style={[s.txt, { flex: 1 }]}>Stay signed in on this phone</Text><Switch value={stay} onValueChange={setStay} trackColor={{ true: c.green }} /></View>
          {err ? <Text style={[s.sub, { color: c.red, textAlign: 'left', fontSize: 14, marginTop: 6 }]}>{err}</Text> : null}
          <Btn s={s} label={busy ? 'Please wait...' : reg ? 'Create account' : 'Sign in'} onPress={submit} disabled={busy} style={{ marginHorizontal: 0 }} />
          <Pressable onPress={() => { setMode(reg ? 'login' : 'register'); setErr(''); }} style={{ alignItems: 'center', paddingVertical: 18 }}>
            <Text style={[s.txt, { color: c.green }]}>{reg ? 'I already have an account' : 'Add another teacher account'}</Text>
          </Pressable>
          <Text style={[s.sub2, { textAlign: 'center', marginLeft: 0 }]}>Each teacher's quizzes, classes and scores stay separate.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function AccountPage({ s, c, acct, stats, onSave, onLogout, onDelete, onSync }) {
  const [name, setName] = useState(acct.name); const [school, setSchool] = useState(acct.school || '');
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [msg, setMsg] = useState(''); const [pmsg, setPmsg] = useState('');
  const saveProfile = () => { if (!name.trim()) return setMsg('Enter your name.'); onSave({ name: name.trim(), school: school.trim() }); setMsg('Saved.'); };
  const changePw = async () => {
    if (!cur) return setPmsg('Enter your current password.');
    if (pw.length < 6) return setPmsg('New password must be at least 6 characters.');
    if (pw !== pw2) return setPmsg('The new passwords do not match.');
    const e = await onSave({ currentPassword: cur, newPassword: pw });
    if (e) return setPmsg(e);
    setCur(''); setPw(''); setPw2(''); setPmsg('Password changed.');
  };
  const R = (a2, b) => <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>{a2}</Text><Text style={s.txt}>{b}</Text></View>;
  return (
    <View>
      <View style={{ alignItems: 'center', marginTop: 20 }}>
        <View style={[s.avatar, { width: 84, height: 84, borderRadius: 42 }]}><Text style={{ color: c.bg, fontSize: 36, fontWeight: '700' }}>{(acct.name || '?').trim().charAt(0).toUpperCase()}</Text></View>
        <Text style={[s.h2, { marginTop: 12 }]}>{acct.name}</Text>
        <Text style={s.sub2}>{acct.user}{acct.school ? '  |  ' + acct.school : ''}</Text>
        <Text style={s.sub2}>Joined {acct.created}</Text>
      </View>
      <Text style={s.sec}>Your data on this phone</Text>
      <View style={s.list}>{R('Quizzes', stats.quizzes)}{R('Classes', stats.classes)}{R('Students', stats.students)}{R('Scanned papers', stats.papers)}</View>
      <Text style={s.sec}>Profile</Text>
      <Field s={s} c={c} label="Name" value={name} onChangeText={(t) => { setName(t); setMsg(''); }} autoCapitalize="words" maxLength={60} />
      <Field s={s} c={c} label="School" value={school} onChangeText={(t) => { setSchool(t); setMsg(''); }} autoCapitalize="words" maxLength={80} />
      {msg ? <Text style={[s.sub2, { color: msg === 'Saved.' ? c.green : c.red }]}>{msg}</Text> : null}
      <Btn s={s} label="Save profile" onPress={saveProfile} style={{ marginHorizontal: 0 }} />
      <Text style={s.sec}>Change password</Text>
      <Field s={s} c={c} label="Current password" value={cur} onChangeText={(t) => { setCur(t); setPmsg(''); }} secureTextEntry />
      <Field s={s} c={c} label="New password" value={pw} onChangeText={(t) => { setPw(t); setPmsg(''); }} secureTextEntry />
      <Field s={s} c={c} label="Confirm new password" value={pw2} onChangeText={(t) => { setPw2(t); setPmsg(''); }} secureTextEntry />
      {pmsg ? <Text style={[s.sub2, { color: pmsg === 'Password changed.' ? c.green : c.red }]}>{pmsg}</Text> : null}
      <Btn s={s} label="Change password" onPress={changePw} style={{ marginHorizontal: 0 }} />
      <Btn s={s} label="Sync now" style={{ marginHorizontal: 0, backgroundColor: c.mute, marginTop: 16 }} onPress={onSync} />
      <Btn s={s} label="Log out" onPress={onLogout} style={{ marginHorizontal: 0, backgroundColor: c.mute, marginTop: 28 }} />
      <Btn s={s} label="Delete this account" style={{ marginHorizontal: 0, backgroundColor: c.red }} onPress={() => Alert.alert('Delete your account?', 'All your quizzes, classes and scores on this phone will be erased and you will be signed out. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete everything', style: 'destructive', onPress: onDelete }])} />
    </View>
  );
}

// Who a saved paper belongs to. Unregistered papers can be assigned to a student or registered as a new one.
function PaperWho({ s, c, z, r, students, classes, onEdit, onRegister, onAddToClass }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(r.name); const [id, setId] = useState(r.id);
  useEffect(() => { setName(r.name); setId(r.id); setOpen(false); }, [r.uid]);
  const reg = students.find((st) => st.id === r.id);
  const pool = students.filter((st) => !z.c.length || classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(st.id))).slice(0, 40);
  const assign = (st) => {
    const go = () => onEdit(st.name, st.id);
    if (z.res.some((x) => x.uid !== r.uid && x.id === st.id)) Alert.alert('Replace the earlier paper?', st.name + ' already has a paper in this quiz.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: go }]);
    else go();
  };
  return (
    <View>
      {!reg ? <Text style={[s.sub2, { color: AMBER }]}>Not registered. The score is saved, but the class record can only use it after you assign it to a student.</Text> : null}
      {reg && !z.rec ? <Text style={[s.sub2, { color: AMBER }]}>This quiz is not linked to a class record column yet. Open Class record entry in the quiz menu.</Text> : null}
      {reg && z.rec && !classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(r.id)) ? <Text style={[s.sub2, { color: AMBER }]}>{r.name} is not in any class of this quiz, so the score will not reach a class record.</Text> : null}
      {reg && z.rec && z.c.length && !classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(r.id))
        ? classes.filter((cl) => z.c.includes(cl.id)).map((cl) => <Btn key={cl.id} s={s} label={'Add ' + r.name + ' to ' + cl.n} onPress={() => onAddToClass(cl.id, r.id)} style={{ marginHorizontal: 0, backgroundColor: c.green }} />) : null}
      {reg && z.rec && classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(r.id)) ? <Text style={[s.sub2, { color: c.green }]}>Entered in the class record: {slotName(z.rec)}.</Text> : null}
      <Btn s={s} label={open ? 'Close' : 'Edit name or ID'} onPress={() => setOpen(!open)} style={{ marginHorizontal: 0 }} />
      {open ? (
        <View>
          <Field s={s} c={c} label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
          <Field s={s} c={c} label="Student ID" value={id} onChangeText={(t) => setId(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={12} placeholder="Leave blank if unknown" />
          <Btn s={s} label="Save changes" onPress={() => { onEdit(name.trim(), id.trim()); setOpen(false); }} style={{ marginHorizontal: 0 }} />
          {!reg ? <Btn s={s} label="Register as a new student" style={{ marginHorizontal: 0, backgroundColor: c.green }} onPress={() => {
            if (!name.trim()) return Alert.alert('Type a name first');
            onRegister(name.trim(), id.trim()); setOpen(false);
          }} /> : null}
        </View>
      ) : null}
      {!reg && pool.length ? <View><Text style={s.lab}>Assign to a registered student:</Text><View style={s.chips}>{pool.map((st) => <Chip key={st.id} s={s} label={st.name} on={false} onPress={() => assign(st)} />)}</View></View> : null}
    </View>
  );
}

// ---------------- Table of specification and competency analysis ----------------
const LV_SHORT = ['Rem', 'Und', 'App', 'Ana', 'Eva', 'Cre'];
function TosEditor({ s, c, z, quizzes, onSave }) {
  const comps = (z.tos && z.tos.comps) || [];
  const [edit, setEdit] = useState(null); // null = the list, -1 = adding, k = editing competency k
  const [name, setName] = useState(''); const [txt, setTxt] = useState(''); const [lv, setLv] = useState(['', '', '', '', '', '']); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const chk = tosCheck(z); const pct = (n) => (z.f ? ((n / z.f) * 100).toFixed(1) + '%' : '');
  const open = (k) => { const x = k >= 0 ? comps[k] : null; setName(x ? x.n : ''); setTxt(x ? itemsText(x.items) : ''); setLv(x && x.lv ? x.lv.map(String) : ['', '', '', '', '', '']); setErr(''); setEdit(k); };
  const save = () => {
    const n = name.trim(); if (!n) return setErr('Type the learning competency.');
    const { items, bad } = parseItems(txt, z.f);
    if (bad.length) return setErr('Not valid for a ' + z.f + '-item quiz: ' + bad.join(', '));
    if (!items.length) return setErr('Type the item numbers, for example 1-4, 12, 17-19.');
    const clash = items.filter((it) => comps.some((c2, k) => k !== edit && c2.items.includes(it)));
    if (clash.length) return setErr('Item ' + itemsText(clash) + ' already belongs to another competency.');
    const nums = lv.map((v) => Math.max(0, parseInt(v, 10) || 0)); const rec = { n, items, lv: nums.some((v) => v) ? nums : null };
    const next = comps.slice(); if (edit === -1) next.push(rec); else next[edit] = rec;
    onSave({ comps: next }); setEdit(null);
  };
  // Upload a ready-made TOS (PDF, photo or Excel). The competencies are filled in and stay editable below.
  const upload = async () => {
    setBusy(true);
    try {
      const r = await importTos(z); if (!r) return;
      if (!r.comps.length) { Alert.alert('Nothing found', 'No competencies could be read from this file. You can add them by hand.'); return; }
      const go = () => { onSave({ comps: r.comps }); Alert.alert('Imported ' + r.comps.length + ' competencies', (r.notes.length ? r.notes.join('\n') + '\n\n' : '') + 'Check them below and tap Edit to fix anything.'); };
      if (comps.length) Alert.alert('Replace the current table?', 'This replaces the ' + comps.length + ' competencies of this quiz.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: go }]);
      else go();
    } catch (e) { Alert.alert('Could not read the file', String((e && e.message) || e)); } finally { setBusy(false); }
  };
  const copyFrom = (q) => {
    const kept = q.tos.comps.map((x) => ({ ...x, items: x.items.filter((it) => it <= z.f) })).filter((x) => x.items.length);
    const dropped = q.tos.comps.reduce((n, x) => n + x.items.length, 0) - kept.reduce((n, x) => n + x.items.length, 0);
    const go = () => onSave({ comps: kept });
    if (comps.length || dropped) Alert.alert('Copy the table from ' + q.n + '?', (comps.length ? 'This replaces the competencies of this quiz. ' : '') + (dropped ? dropped + ' item(s) are beyond ' + z.f + ' questions and will be left out.' : ''), [{ text: 'Cancel', style: 'cancel' }, { text: 'Copy', onPress: go }]);
    else go();
  };
  if (edit !== null) {
    return (
      <View>
        <Text style={s.lab}>Learning competency</Text>
        <TextInput style={[s.input, { height: 96, textAlignVertical: 'top', paddingTop: 10 }]} value={name} onChangeText={(t) => { setName(t); setErr(''); }} multiline placeholder="e.g. Describe the nature and properties of light and sound waves" placeholderTextColor={c.mute} />
        <Text style={s.lab}>Item placement (quiz has {z.f} items)</Text>
        <TextInput style={s.input} value={txt} onChangeText={(t) => { setTxt(t); setErr(''); }} placeholder="1-4, 12, 17-19, 22" placeholderTextColor={c.mute} autoCapitalize="none" autoCorrect={false} />
        <Text style={s.lab}>Items per level of thinking (optional)</Text>
        <View style={s.row}>{TOS_LEVELS.map((l, i) => (
          <View key={l} style={{ flex: 1, alignItems: 'center' }}><Text style={s.sub}>{LV_SHORT[i]}</Text>
            <TextInput style={[s.gc, { width: 44, marginRight: 0 }]} value={lv[i]} keyboardType="number-pad" maxLength={2} onChangeText={(t) => { const n = lv.slice(); n[i] = t.replace(/\D/g, ''); setLv(n); }} /></View>))}</View>
        <Text style={s.sub2}>Rem = Remembering, Und = Understanding, App = Applying, Ana = Analyzing, Eva = Evaluating, Cre = Creating.</Text>
        {err ? <Text style={[s.sub2, { color: c.red }]}>{err}</Text> : null}
        <Btn s={s} label="Save competency" onPress={save} />
        <Btn s={s} label="Cancel" onPress={() => setEdit(null)} style={{ backgroundColor: c.mute }} />
      </View>
    );
  }
  const donors = quizzes.filter((q) => q.id !== z.id && q.tos && q.tos.comps && q.tos.comps.length);
  return (
    <View>
      <View style={{ marginBottom: 16 }}>
        <Btn s={s} label={busy ? 'Reading the file...' : 'Upload TOS (PDF, photo or Excel)'} onPress={upload} disabled={busy} />
        {busy ? <ActivityIndicator color={c.ink} style={{ marginTop: 10 }} /> : null}
      </View>
      {comps.map((x, k) => (
        <View key={k} style={[s.list, { marginBottom: 10, padding: 14 }]}>
          <Text style={s.txt}>{k + 1}. {x.n}</Text>
          <Text style={s.sub2}>{x.items.length} items ({pct(x.items.length)})   Items: {itemsText(x.items)}</Text>
          {x.lv ? <Text style={s.sub2}>{TOS_LEVELS.map((l, i) => LV_SHORT[i] + ' ' + (x.lv[i] || 0)).join('   ')}</Text> : null}
          <View style={[s.row, { marginTop: 14 }]}>
            <Btn s={s} label="Edit" onPress={() => open(k)} style={{ flex: 1 }} />
            <Btn s={s} label="Delete" style={{ flex: 1, backgroundColor: c.red }} onPress={() => Alert.alert('Delete this competency?', x.n, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => onSave({ comps: comps.filter((_, i) => i !== k) }) }])} />
          </View>
        </View>
      ))}
      {!comps.length ? <Text style={s.empty}>No competencies yet. Add the first one from your table of specification.</Text> : (
        <View style={[s.list, { marginTop: 4, marginBottom: 12 }]}>
          <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Items covered</Text><Text style={[s.txt, chk.missing.length && { color: c.red }]}>{chk.total} / {z.f}</Text></View>
          {chk.lv.some((v) => v) ? <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Easy / Average / Difficult</Text><Text style={s.txt}>{chk.easy} / {chk.average} / {chk.difficult}</Text></View> : null}
        </View>
      )}
      {chk.missing.length && comps.length ? <Text style={[s.sub2, { color: c.red }]}>No competency yet for item{chk.missing.length > 1 ? 's' : ''} {itemsText(chk.missing)}. They are left out of the analysis.</Text> : null}
      {chk.levelMismatch.length ? <Text style={[s.sub2, { color: AMBER }]}>The levels of thinking do not add up to the number of items in competency {chk.levelMismatch.map((k) => k + 1).join(', ')}.</Text> : null}
      <Btn s={s} label="Add competency" onPress={() => open(-1)} style={{ marginTop: 8 }} />
      {donors.length ? <View><Text style={s.lab}>Copy the table from another quiz:</Text><View style={s.chips}>{donors.map((q) => <Chip key={q.id} s={s} label={q.n} on={false} onPress={() => copyFrom(q)} />)}</View></View> : null}
      {comps.length ? <Btn s={s} label="Share table (CSV file)" onPress={() => shareCsv(z.n + '_TOS', tosCsvRows(z))} style={{ backgroundColor: c.mute }} /> : null}
    </View>
  );
}

// Which competencies the class has learned least, from the scanned papers and the table of specification.
function CompAnalysis({ s, c, z, classes, onTos }) {
  const stats = useMemo(() => competencyStats(z), [z]); const [open, setOpen] = useState(null);
  const comps = (z.tos && z.tos.comps) || [];
  if (!comps.length) return <View><Text style={s.empty}>Add the table of specification first. It tells the app which items test which competency.</Text><Btn s={s} label="Open Table of Specification" onPress={onTos} /></View>;
  if (!stats.length) return <Text style={s.empty}>Scan some papers first.</Text>;
  const focus = stats.filter((x) => !x.mastered).slice(0, 3);
  const tone = (x) => (x.mastered ? c.green : x.pct >= 50 ? AMBER : c.red);
  return (
    <View>
      {focus.length ? (
        <View style={[s.list, { padding: 14, marginBottom: 12 }]}>
          <Text style={s.h2}>Focus on these first</Text>
          {focus.map((x) => <Text key={x.k} style={[s.txt, { marginTop: 6 }]}>{'\u2022'} {x.name} ({x.pct.toFixed(0)}%)</Text>)}
        </View>
      ) : <Text style={[s.sub2, { color: c.green }]}>Every competency is mastered ({MASTERY}% or more correct).</Text>}
      {stats.map((x) => (
        <Pressable key={x.k} style={[s.list, { marginBottom: 10, padding: 14 }]} onPress={() => setOpen(open === x.k ? null : x.k)}>
          <Text style={s.txt}>{x.name}</Text>
          <View style={{ height: 12, borderRadius: 6, backgroundColor: c.bg, marginTop: 8, overflow: 'hidden' }}><View style={{ width: Math.max(2, x.pct) + '%', height: 12, backgroundColor: tone(x) }} /></View>
          <Text style={[s.sub, { textAlign: 'left', marginTop: 4 }]}>{x.pct.toFixed(1)}%   {x.level.n}   Items {x.itemsText}   {x.mastered ? 'Mastered' : 'Needs reteaching'}</Text>
          {open === x.k ? (
            <View style={{ marginTop: 10 }}>
              <Text style={s.lab}>Items</Text>
              {x.items.map((it) => (
                <Text key={it.item} style={s.sub2}>Item {it.item}: {Math.round(it.pct)}% correct{it.wrongTop ? '. Most chosen wrong answer: ' + (it.wrongTop.l === '-' ? 'blank' : it.wrongTop.l) + ' (' + it.wrongTop.n + ')' : ''}</Text>
              ))}
              <Text style={s.lab}>Learners below {MASTERY}% ({x.learners.length} of {x.cases})</Text>
              {x.learners.length ? x.learners.slice(0, 20).map((l) => <Text key={l.uid} style={s.sub2}>{l.name}: {Math.round(l.pct)}%</Text>) : <Text style={s.sub2}>Everyone mastered this.</Text>}
              {x.learners.length > 20 ? <Text style={s.sub2}>and {x.learners.length - 20} more (see the CSV file)</Text> : null}
            </View>
          ) : <Text style={[s.sub, { textAlign: 'left' }]}>Tap for items and learners</Text>}
        </Pressable>
      ))}
      <Btn s={s} label="Share analysis (CSV file)" onPress={() => shareCsv(z.n + '_competency-analysis', competencyCsvRows(z, quizSections(z, classes)))} />
    </View>
  );
}

const CONTACT_EMAIL = 'guro.gabay.inc@gmail.com'; // change this to the email that should receive messages

function Contact({ s, c }) {
  const [m, setM] = useState('');
  const [err, setErr] = useState('');
  const send = async () => {
    if (!m.trim()) return setErr('Enter a message first.');
    setErr('');
    const url = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('GuroGabay support') + '&body=' + encodeURIComponent(m.trim());
    try {
      await Linking.openURL(url);
      setM('');
    } catch (e) {
      Alert.alert('No email app found', 'Set up an email app on this phone, or write to us at ' + CONTACT_EMAIL + '.');
    }
  };
  return (
    <View>
      <Text style={s.lab}>Message</Text>
      <TextInput style={[s.input, { height: 140, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={m} onChangeText={(t) => { setM(t); setErr(''); }}
        placeholder="Tell us what you need" placeholderTextColor={c.mute} />
      {err ? <Text style={[s.sub2, { color: c.red }]}>{err}</Text> : null}
      <Btn s={s} label="Send message" onPress={send} />
      <Text style={[s.sub2, { marginTop: 12 }]}>Or email us at {CONTACT_EMAIL}</Text>
    </View>
  );
}

const DRAWER_W = Math.min(Dimensions.get('window').width * 0.78, 320);
// Side menu: solid drawer slides in/out over a fading dim layer (no see-through fade).
function SideMenu({ s, visible, onClose, children }) {
  const [mounted, setMounted] = useState(visible);
  const p = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      p.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      p.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => { if (done) runOnJS(setMounted)(false); });
    }
  }, [visible]);
  const drawer = useAnimatedStyle(() => ({ transform: [{ translateX: -DRAWER_W * (1 - p.value) }] }));
  const dim = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <Modal transparent animationType="none" visible={mounted} onRequestClose={onClose} statusBarTranslucent>
      <View style={s.menuWrap}>
        <Animated.View style={[s.drawer, { width: DRAWER_W }, drawer]}>{children}</Animated.View>
        <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }, dim]}>
          <Pressable style={{ flex: 1 }} pressScale={1} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>
      </View>
    </Modal>
  );
}

const NAV_KEYS = ['home', 'classes', 'add', 'sheet', 'recent'];
// Bottom bar: raised pill holding a recessed track; a white pill slides behind the selected tab.
function NavBar({ s, c, tab, det, go, plus }) {
  const [tw, setTw] = useState(0);
  const slot = tw ? (tw - 8) / 5 : 0;
  const idx = NAV_KEYS.indexOf(tab);
  const show = !det && tab !== 'add' && idx >= 0 ? 1 : 0;
  const x = useSharedValue(0); const o = useSharedValue(0);
  useEffect(() => {
    if (!slot) return;
    const target = 4 + Math.max(idx, 0) * slot + 3;
    if (o.value === 0) x.value = target; else x.value = withTiming(target, { duration: 220, easing: Easing.out(Easing.cubic) });
    o.value = withTiming(show, { duration: 150 });
  }, [slot, idx, show]);
  const pill = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: x.value }] }));
  return (
    <View style={s.nav}>
      <View style={s.navTrack} onLayout={(e) => setTw(e.nativeEvent.layout.width)}>
        <Animated.View pointerEvents="none" style={[s.navPill, { width: Math.max(slot - 6, 0) }, pill]} />
        {NAV_KEYS.map((k) => k === 'add'
          ? <View key={k} style={s.navSlot}><Pressable style={s.addBtn} onPress={plus} accessibilityLabel="Create"><Ionicons name="add" size={30} color={c.bg} /></Pressable></View>
          : <Pressable key={k} style={s.navSlot} onPress={() => go(k)} accessibilityLabel={TITLES[k]}><Ionicons name={ICONS[k]} size={28} color={tab === k && !det ? c.ink : c.mute} /></Pressable>)}
      </View>
    </View>
  );
}

function Main({ acct, onAccount, onLogout, onDelete, scheme, mode, onMode }) {
  const c = scheme === 'dark' ? DARK : LIGHT;
  const s = useMemo(() => mk(c), [scheme]);
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home'); const [det, setDet] = useState(null);
  const [q, setQ] = useState(''); const [modal, setModal] = useState(null); const [menu, setMenu] = useState(false);
  const [scanQ, setScanQ] = useState(null); const [qtab, setQtab] = useState('details'); const [stab, setStab] = useState('quiz'); const [ctab, setCtab] = useState('classes');
  const dataKey = KEY + ':' + acct.id;

  // Sync with the online account: pull newer data from another phone, push this phone's changes.
  const skipMark = useRef(1); const syncTimer = useRef(null);
  const doSync = async (manual) => {
    try {
      const r = await syncNow(acct.id);
      if (r === 'pulled') { const v = await AsyncStorage.getItem(dataKey); if (v) { skipMark.current = 1; setData(migrate(JSON.parse(v))); } }
      if (manual === true) Alert.alert('Sync', r === null ? 'Could not sync right now (not signed in online, or a sync is already running). Try again.' : r === 'pulled' ? 'Updated from your online account.' : r === 'pushed' ? 'Your changes were uploaded.' : 'Everything is already up to date.');
    } catch (e) { console.log('sync failed', e && e.message); if (manual === true) Alert.alert('Sync failed', String((e && e.message) || e)); }
  };
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') doSync(); });
    return () => { sub.remove(); clearTimeout(syncTimer.current); };
  }, []);
  // Realtime: when another device (or the website) changes this account's rows online, sync right away.
  useEffect(() => {
    let timer;
    const channel = supabase
      .channel('sync_records_' + acct.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_records', filter: 'user_id=eq.' + acct.id }, () => {
        clearTimeout(timer); timer = setTimeout(() => doSync(), 1500); // many rows can change at once: sync only once
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [acct.id]);
  useEffect(() => {
    AsyncStorage.getItem(dataKey).then((v) => { if (v) setData(migrate(JSON.parse(v))); setReady(true); doSync(); });
    AsyncStorage.getAllKeys().then((ks) => { const old = ks.filter((k) => k.startsWith(OLD_THUMB + acct.id + ':')); if (old.length) AsyncStorage.multiRemove(old); }).catch(() => {});
  }, [dataKey]);
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(dataKey, JSON.stringify(data)).then(() => {
      if (skipMark.current > 0) { skipMark.current--; return; } // loading or pulling, not a teacher edit
      return markSaved(acct.id).then(() => { clearTimeout(syncTimer.current); syncTimer.current = setTimeout(doSync, 4000); });
    }).catch(() => {});
  }, [data, ready]);
  const upd = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  const { quizzes, classes, students, log } = data;
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const go = (k) => { setMenu(false); setDet(null); setTab(k); };
  const plus = () => { setMenu(false); setModal(tab === 'classes' && !det ? 'class' : 'quiz'); };
  const openScan = (id) => { if (!quizzes.length) return Alert.alert('Create a quiz first'); setScanQ(id || (det && det.k === 'quiz' ? det.id : quizzes[0].id)); setModal('scan'); };

  const saveQuiz = (f) => {
    upd((d) => { d.quizzes.unshift({ id: uid(), n: f.name, d: today(), f: f.f, ch: f.ch || 'AE', c: f.c, sh: f.sh, key: Array(f.f).fill(-1), res: [], rec: f.rec || null }); d.log.unshift({ t: 'Created quiz ' + f.name, d: today() }); return d; });
    setModal(null); setDet(null); setTab('home');
  };
  const saveClass = (f) => {
    upd((d) => {
      const ids = f.ids.slice();
      f.created.forEach((nm) => { const id = freshId(d); d.students.push({ id, name: nm }); ids.push(id); });
      d.classes.push({ id: uid(), n: f.name, d: today(), s: ids }); d.log.unshift({ t: 'Created class ' + f.name, d: today() }); return d;
    });
    setModal(null); setDet(null); setTab('classes');
  };
  // Papers are always saved. A paper with a student ID replaces that student's earlier paper; a paper with no ID is kept as its own entry.
  const dropThumb = (puid) => { const k = thumbKey(acct.id, puid); thumbCache.delete(k); AsyncStorage.removeItem(k).catch(() => {}); };
  const savePaper = (quizId, paper) => {
    const { thumb, ...rest } = paper; const puid = uid();
    if (thumb) { const k = thumbKey(acct.id, puid); thumbCache.set(k, thumb); AsyncStorage.setItem(k, thumb).catch(() => {}); }
    const zq = byId(quizzes, quizId);
    if (zq && paper.id) zq.res.filter((r) => r.id === paper.id).forEach((r) => dropThumb(r.uid));
    upd((d) => {
      const z = byId(d.quizzes, quizId);
      if (paper.id) z.res = z.res.filter((r) => r.id !== paper.id);
      z.res.push({ ...rest, uid: puid });
      d.log.unshift({ t: 'Graded ' + paper.name + ' in ' + z.n, d: today() }); return d;
    });
  };
  const delPaper = (quizId, puid) => { dropThumb(puid); upd((d) => { const z = byId(d.quizzes, quizId); z.res = z.res.filter((r) => r.uid !== puid); return d; }); };
  // Link a saved paper to a registered student (or change its name / ID).
  const editPaper = (quizId, puid, name, id) => upd((d) => {
    const z = byId(d.quizzes, quizId); const r = z.res.find((x) => x.uid === puid); if (!r) return d;
    const st = d.students.find((x) => x.id === id);
    if (st && id === r.id && name && name.trim() && name.trim() !== st.name) { // same student, new name: rename the student everywhere
      st.name = name.trim(); d.quizzes.forEach((q) => q.res.forEach((x) => { if (x.id === id) x.name = st.name; }));
    }
    if (id) z.res = z.res.filter((x) => x.uid === puid || x.id !== id);
    r.id = id; r.name = st ? st.name : name || (id ? 'ID ' + id : 'Unnamed paper'); return d;
  });
  const registerStudent = (quizId, puid, name, id) => { if (!checkStudent(students, id, name)) return; registerStudentNow(quizId, puid, name, id); };
  const registerStudentNow = (quizId, puid, name, id) => upd((d) => {
    const z = byId(d.quizzes, quizId); const sid = id && !d.students.some((x) => x.id === id) ? id : freshId(d);
    d.students.push({ id: sid, name }); z.c.forEach((cid) => { const cl = byId(d.classes, cid); if (cl && !cl.s.includes(sid)) cl.s.push(sid); });
    const r = z.res.find((x) => x.uid === puid); if (r) { r.id = sid; r.name = name; }
    d.log.unshift({ t: 'Registered ' + name, d: today() }); return d;
  });
  // Rename a student or change the student ID everywhere it is used.
  const updStudent = (oldId, name, newId) => upd((d) => {
    const st = d.students.find((x) => x.id === oldId); if (!st) return d;
    st.name = name;
    if (newId !== oldId) {
      st.id = newId;
      d.classes.forEach((cl) => { cl.s = cl.s.map((x) => (x === oldId ? newId : x)); });
      d.quizzes.forEach((q) => q.res.forEach((r) => { if (r.id === oldId) r.id = newId; }));
      Object.keys(d.ecr || {}).forEach((cid) => { const rc = d.ecr[cid]; Object.keys(rc.t || {}).forEach((n) => { const m2 = rc.t[n].sc || {}; if (m2[oldId]) { m2[newId] = m2[oldId]; delete m2[oldId]; } }); });
    }
    d.quizzes.forEach((q) => q.res.forEach((r) => { if (r.id === newId) r.name = name; }));
    d.log.unshift({ t: 'Updated student ' + name, d: today() }); return d;
  });
  // Delete a quiz with its papers, scan pictures and table of specification.
  const deleteQuiz = (quizId) => {
    const z = byId(quizzes, quizId); if (!z) return;
    z.res.forEach((r) => dropThumb(r.uid));
    upd((d) => { d.quizzes = d.quizzes.filter((x) => x.id !== quizId); d.log.unshift({ t: 'Deleted quiz ' + z.n, d: today() }); return d; });
    setDet(null);
  };
  // Delete a class. Students who are in no other class and have no saved papers are removed too.
  const deleteStudent = (st) => upd((d) => {
    d.students = d.students.filter((x) => x.id !== st.id);
    d.classes.forEach((cl) => { cl.s = (cl.s || []).filter((x) => x !== st.id); });
    Object.keys(d.ecr || {}).forEach((cid) => { const rc = d.ecr[cid]; Object.keys((rc && rc.t) || {}).forEach((n) => { if (rc.t[n] && rc.t[n].sc) delete rc.t[n].sc[st.id]; }); });
    d.log.unshift({ t: 'Deleted student ' + st.name, d: today() }); return d;
  });
  const askDeleteStudent = (st) => Alert.alert('Delete "' + st.name + '"?', 'They are removed from every class and class record. Scanned papers stay in their quizzes. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteStudent(st) }]);
  const deleteClass = (classId) => {
    const cl = byId(classes, classId); if (!cl) return;
    upd((d) => {
      d.classes = d.classes.filter((x) => x.id !== classId);
      d.quizzes.forEach((q) => { q.c = q.c.filter((i) => i !== classId); });
      if (d.ecr) delete d.ecr[classId];
      d.students = d.students.filter((st) => d.classes.some((x) => x.s.includes(st.id)) || d.quizzes.some((q) => q.res.some((r) => r.id === st.id)) || !cl.s.includes(st.id));
      d.log.unshift({ t: 'Deleted class ' + cl.n, d: today() }); return d;
    });
    setDet(null);
  };
  const renameQuiz = (quizId, name) => upd((d) => { const q = byId(d.quizzes, quizId); if (q) { d.log.unshift({ t: 'Renamed quiz ' + q.n + ' to ' + name, d: today() }); q.n = name; } return d; });
  const renameSheet = (quizId, name) => upd((d) => { const q = byId(d.quizzes, quizId); if (q) q.sh = name; return d; });
  const renameClass = (classId, name) => upd((d) => { const cl = byId(d.classes, classId); if (cl) { d.log.unshift({ t: 'Renamed class ' + cl.n + ' to ' + name, d: today() }); cl.n = name; } return d; });
  const askDeleteQuiz = (z) => Alert.alert('Delete quiz "' + z.n + '"?', 'Its ' + z.res.length + ' scanned paper(s), answer key and table of specification will be permanently deleted. Scores it filled into a class record will be removed too. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteQuiz(z.id) }]);
  const askDeleteClass = (x) => Alert.alert('Delete class "' + x.n + '"?', 'The class, its class record and its student list will be permanently deleted. Scanned papers stay in their quizzes. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => deleteClass(x.id) }]);
  const removeFromClass = (classId, sid) => upd((d) => { const cl = byId(d.classes, classId); cl.s = cl.s.filter((x) => x !== sid); return d; });
  const saveEcr = (classId, r) => upd((d) => { d.ecr = d.ecr || {}; d.ecr[classId] = r; return d; });
  const setTos = (quizId, tos) => upd((d) => { byId(d.quizzes, quizId).tos = tos; return d; });
  const setRecSlot = (quizId, slot) => upd((d) => { byId(d.quizzes, quizId).rec = slot; return d; });
  const addToClass = (classId, sid) => upd((d) => { const cl = byId(d.classes, classId); if (cl && !cl.s.includes(sid)) cl.s.push(sid); return d; });
  const setQuizClasses = (quizId, ids) => upd((d) => { byId(d.quizzes, quizId).c = ids; return d; });
  const setKey = (qi, ci) => upd((d) => { byId(d.quizzes, det.id).key[qi] = ci; return d; });
  const addStudent = (n) => {
    if (!checkStudent(students, '', n)) return false;
    upd((d) => { const id = freshId(d); d.students.push({ id, name: n }); byId(d.classes, det.id).s.push(id); return d; });
  };
  const quizCsv = (z) => shareCsv(z.n + '_scores', [['Student', 'ID', 'Score', 'Percent'], ...z.res.map((r) => [r.name, r.id, scoreOf(z, r) + '/' + z.f, Math.round((scoreOf(z, r) / z.f) * 100) + '%'])]);

  const card = (x, i, kind, sub, name) => (
    <Pressable key={x.id} style={s.card} onPress={() => setDet({ k: kind, id: x.id })} onLongPress={kind === 'quiz' ? () => askDeleteQuiz(x) : kind === 'class' || kind === 'ecr' ? () => askDeleteClass(x) : undefined}>
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
      const named = (r) => !!r.name && r.name !== 'Unnamed paper' && !/^ID \d+$/.test(r.name);
      const prow = (r) => {
        const reg = students.some((st) => st.id === r.id); const pic = !reg && !named(r);
        return (
          <Pressable key={r.uid} style={[s.li, { alignItems: 'center' }]} onPress={() => to('paper', { pid: r.uid })}>
            {pic ? (
              <View style={{ flex: 1, marginRight: 10 }}>
                <ScanStrip k={thumbKey(acct.id, r.uid)} fallback={<Text style={s.txt}>Unnamed paper</Text>} />
                <Text style={[s.sub, { textAlign: 'left' }]}>Not registered{r.id ? '  ID ' + r.id : ''}</Text>
              </View>
            ) : <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{r.name}{reg ? '' : '  (not registered)'}</Text>}
            <Text style={s.txt}>{scoreOf(z, r)}/{z.f}   {pctOf(r)}%</Text>
          </Pressable>
        );
      };

      if (v === 'key') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Edit Key</Text>
          <Text style={s.sub2}>Tap the correct answer for each question. {keySet}/{z.f} set.</Text>
          <View style={s.list}>{z.key.map((a2, qi) => (
            <View key={qi} style={s.kr}><Text style={s.kn}>{qi + 1}</Text>
              {optsOf(z).map((l, ci) => <Pressable key={l} onPress={() => setKey(qi, ci)} style={[s.kb, a2 === ci && s.kbOn]}><Text style={[s.txt, a2 === ci && { color: c.bg }]}>{showL(z, l)}</Text></Pressable>)}
            </View>))}</View></View>;
      }
      if (v === 'review') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Review Papers</Text>
          <Text style={s.sub2}>Tap a paper to see what the student marked.</Text>
          <View style={s.list}>{sorted.length ? sorted.map(prow) : <Text style={s.empty}>No papers scanned yet.</Text>}</View></View>;
      }
      if (v === 'paper') {
        const idx = sorted.findIndex((r) => r.uid === det.pid); const r = sorted[idx];
        if (!r) return <View>{bk('Papers', () => to('review'))}<Text style={s.empty}>This paper was removed.</Text></View>;
        const go2 = (d) => to('paper', { pid: sorted[(idx + d + sorted.length) % sorted.length].uid });
        return <View>{bk('Papers', () => to('review'))}
          <Text style={s.h1}>{r.name}</Text>
          <Text style={s.sub2}>ID {r.id || 'none'}   Scanned {r.d}</Text>
          <Text style={[s.h2, { color: c.green, marginLeft: 6 }]}>{scoreOf(z, r)} / {z.f}   ({pctOf(r)}%)</Text>
          {sorted.length > 1 ? (
            <View style={s.row}>
              <Btn s={s} label={'\u2039 Previous'} onPress={() => go2(-1)} style={{ flex: 1 }} />
              <Btn s={s} label={'Next \u203A'} onPress={() => go2(1)} style={{ flex: 1 }} />
            </View>) : null}
          <PaperWho s={s} c={c} z={z} r={r} students={students} classes={classes} onEdit={(nm, id) => editPaper(z.id, r.uid, nm, id)} onRegister={(nm, id) => registerStudent(z.id, r.uid, nm, id)} onAddToClass={addToClass} />
          <Text style={[s.sub2, { marginTop: 12 }]}>The scanned sheet. Green ring = correct answer. Red ring = wrong or missed.</Text>
          <ScanFull k={thumbKey(acct.id, r.uid)} z={z} paper={r} c={c} fallback={<View><Text style={s.sub2}>No scan picture was kept for this paper. This is a redraw of the answers.</Text><PaperView c={c} z={z} paper={r} /></View>} />
          <Btn s={s} label="Delete this paper" style={{ backgroundColor: c.red }} onPress={() => Alert.alert('Delete ' + r.name + "'s paper?", 'You can scan it again later.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { delPaper(z.id, r.uid); to('review'); } }])} />
        </View>;
      }
      if (v === 'rec') {
        const cur = z.rec || null;
        const pickSlot = (patch) => setRecSlot(z.id, { term: 1, comp: 'ww', i: 0, ...(cur || {}), ...patch });
        const clash = cur ? quizzes.filter((q) => q.id !== z.id && q.rec && q.rec.term === cur.term && q.rec.comp === cur.comp && q.rec.i === cur.i && q.c.some((id) => z.c.includes(id))) : [];
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Class record entry</Text>
          <Text style={s.sub2}>Choose where this quiz's scores go in the class record. After that, every scanned paper adds its score by itself, matched by student ID. No typing.</Text>
          <Text style={s.lab}>Classes</Text>
          <View style={s.chips}>{classes.length ? classes.map((x) => <Chip key={x.id} s={s} label={x.n} on={z.c.includes(x.id)} onPress={() => setQuizClasses(z.id, z.c.includes(x.id) ? z.c.filter((i) => i !== x.id) : [...z.c, x.id])} />) : <Text style={s.sub2}>No classes yet.</Text>}</View>
          {z.res.length && z.res.some((r) => !classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(r.id)))
            ? <Text style={[s.sub2, { color: AMBER }]}>{z.res.filter((r) => !classes.some((cl) => z.c.includes(cl.id) && cl.s.includes(r.id))).length} of {z.res.length} papers belong to students who are not in the classes above. Their scores will not reach the class record.</Text>
            : null}
          <Text style={s.lab}>Term</Text>
          <View style={s.chips}>{[1, 2, 3].map((n) => <Chip key={n} s={s} label={'Term ' + n} on={!!cur && cur.term === n} onPress={() => pickSlot({ term: n })} />)}</View>
          <Text style={s.lab}>Component</Text>
          <View style={s.chips}>{[['ww', 'Written Works'], ['pt', 'Performance Tasks'], ['ex', 'Examination']].map(([k, l]) => <Chip key={k} s={s} label={l} on={!!cur && cur.comp === k} onPress={() => pickSlot({ comp: k, i: 0 })} />)}</View>
          <Text style={s.lab}>{cur && cur.comp === 'ex' ? 'Which exam' : 'Column number'}</Text>
          <View style={s.chips}>{(cur && cur.comp === 'ex' ? EXN : Array.from({ length: 10 }, (_, i) => String(i + 1))).map((l, i) => <Chip key={l} s={s} label={l} on={!!cur && cur.i === i} onPress={() => pickSlot({ i })} />)}</View>
          {cur ? <Text style={[s.sub2, { color: c.green }]}>Scores go to {slotName(cur)} for: {z.c.map((id) => byId(classes, id)).filter(Boolean).map((x) => x.n).join(', ') || 'no class yet'}.</Text> : <Text style={s.sub2}>Not sent to a class record yet. Tap options above.</Text>}
          {clash.length ? <Text style={[s.sub2, { color: c.red }]}>Another quiz ({clash.map((q) => q.n).join(', ')}) uses the same column. Only one can fill it.</Text> : null}
          {cur ? <Btn s={s} label="Stop sending to class record" onPress={() => setRecSlot(z.id, null)} style={{ backgroundColor: c.mute }} /> : null}
        </View>;
      }
      if (v === 'tos') {
        return <View>{bk('Quiz menu', () => to('menu'))}<Text style={s.h1}>Table of Specification</Text>
          <Text style={s.sub2}>List each learning competency with the item numbers that test it, like the item placement column of your table. The app then shows which competencies the class learned least.</Text>
          <TosEditor s={s} c={c} z={z} quizzes={quizzes} onSave={(t) => setTos(z.id, t)} /></View>;
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
      const focusStat = competencyStats(z).find((x) => !x.mastered) || null;
      const cls = z.c.map((id) => byId(classes, id)).filter(Boolean).map((x) => x.n).join(', ');
      return <View>{back}<Text style={s.h1}>{z.n}</Text>
        <RenameBar s={s} c={c} value={z.n} label="Quiz name" onSave={(n) => renameQuiz(z.id, n)} />
        <View style={s.sg}>{[['details', 'Details'], ['stats', 'Statistics']].map(([k, l]) => (
          <Pressable key={k} style={[s.sgB, qtab === k && s.sgOn]} onPress={() => setQtab(k)}><Text style={s.sgT}>{l}</Text></Pressable>))}</View>
        {qtab === 'details' ? (
          <View>
            <View style={s.list}>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Questions</Text><Text style={s.txt}>{z.f}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Choices</Text><Text style={s.txt}>{CHOICE_NAMES[z.ch] || 'A – E'}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Answer sheet</Text><Text style={s.txt}>{formOf(z)}-question form</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Papers</Text><Text style={s.txt}>{z.res.length}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Answer key</Text><Text style={[s.txt, keySet < z.f && { color: c.red }]}>{keySet}/{z.f} set</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Classes</Text><Text style={[s.txt, { flexShrink: 1, textAlign: 'right' }]}>{cls || 'None'}</Text></View>
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Table of specification</Text><Text style={[s.txt, !(z.tos && z.tos.comps && z.tos.comps.length) && { color: c.mute }]}>{z.tos && z.tos.comps && z.tos.comps.length ? z.tos.comps.length + ' competencies' : 'Not set'}</Text></View>
              {focusStat ? <View style={s.li}><Text style={[s.txt, { flex: 1 }]} numberOfLines={2}>Focus on: {focusStat.name}</Text><Text style={[s.txt, { color: c.red }]}>{focusStat.pct.toFixed(0)}%</Text></View> : null}
              <View style={s.li}><Text style={[s.txt, { flex: 1 }]}>Class record</Text><Text style={[s.txt, !z.rec && { color: c.mute }]}>{z.rec ? slotName(z.rec) : 'Not set'}</Text></View>
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
        <MenuBtn s={s} c={c} icon="list-outline" label="Table of Specification" onPress={() => to('tos')} />
        <MenuBtn s={s} c={c} icon="link-outline" label="Class record entry" onPress={() => to('rec')} />
        <Btn s={s} label="Delete this quiz" style={{ backgroundColor: c.red, marginTop: 16 }} onPress={() => askDeleteQuiz(z)} />
      </View>;
    }
    if (det && det.k === 'ecr') {
      const x = byId(classes, det.id); if (!x) return null;
      return <ClassRecord key={x.id} s={s} c={c} cls={x} students={students} quizzes={quizzes} saved={(data.ecr || {})[x.id]} onSave={(r) => saveEcr(x.id, r)} onBack={() => setDet(null)} />;
    }
    if (det && det.k === 'account') {
      return <View>{back}<Text style={s.h1}>Account</Text>
        <AccountPage s={s} c={c} acct={acct} stats={{ quizzes: quizzes.length, classes: classes.length, students: students.length, papers: quizzes.reduce((n, q) => n + q.res.length, 0) }}
          onSave={onAccount} onLogout={onLogout} onDelete={onDelete} onSync={() => doSync(true)} /></View>;
    }
    if (det && det.k === 'class') {
      const x = byId(classes, det.id); if (!x) return null;
      const list = x.s.map((id) => byId(students, id)).filter(Boolean);
      return <View>{back}<Text style={s.h1}>{x.n}</Text><RenameBar s={s} c={c} value={x.n} label="Class name" onSave={(n) => renameClass(x.id, n)} /><Text style={s.sub2}>Created {x.d}. Tap a student to rename them or change their ID. Each student fills in their ID number on the sheet.</Text><Text style={s.sec}>Students</Text>
        <View style={s.list}>{list.length ? list.map((st) => <StudentRow key={st.id} s={s} c={c} st={st} clash={(i, n) => studentConflict(students, i, n, st.id)} onSave={updStudent} onRemove={(sid) => removeFromClass(x.id, sid)} />) : <Text style={s.empty}>No students yet.</Text>}</View>
        <AddRow s={s} c={c} placeholder="New student name" onAdd={addStudent} />
        <Btn s={s} label="Delete this class" style={{ backgroundColor: c.red, marginTop: 16 }} onPress={() => askDeleteClass(x)} /></View>;
    }
    if (det && det.k === 'sheet') {
      const z = byId(quizzes, det.id); if (!z) return null;
      const sv = det.v || 'main';
      const toS = (nv) => setDet({ k: 'sheet', id: z.id, v: nv });
      const bkS = <Pressable onPress={() => toS('main')}><Text style={s.back}>{'\u2190'} {z.sh}</Text></Pressable>;
      if (sv === 'indiv') {
        return <View>{bkS}<Text style={s.h1}>Individual Scores</Text>
          <Text style={s.sub2}>Quiz: {z.n}. Taken from the item analysis. Every scanned paper counts as one case.</Text>
          <IndivScores s={s} c={c} z={z} classes={classes} /></View>;
      }
      if (sv === 'comp') {
        return <View>{bkS}<Text style={s.h1}>Competency Analysis</Text>
          <Text style={s.sub2}>Quiz: {z.n}. Mastered means {MASTERY}% or more correct answers on the items of that competency.</Text>
          <CompAnalysis s={s} c={c} z={z} classes={classes} onTos={() => setDet({ k: 'quiz', id: z.id, v: 'tos' })} /></View>;
      }
      return <View>{back}<Text style={s.h1}>{z.sh}</Text><RenameBar s={s} c={c} value={z.sh} label="Spreadsheet name" onSave={(n) => renameSheet(z.id, n)} /><Text style={s.sub2}>From quiz: {z.n}</Text>
        <View style={s.list}>{z.res.length ? z.res.map((r) => <Row key={r.uid} a={r.name} b={scoreOf(z, r) + '/' + z.f + '   ' + Math.round((scoreOf(z, r) / z.f) * 100) + '%'} />) : <Text style={s.empty}>No papers scanned yet.</Text>}</View>
        <Btn s={s} label="Share as CSV file" onPress={() => quizCsv(z)} />
        <MenuBtn s={s} c={c} icon="grid-outline" label="Individual Scores (MPS)" onPress={() => toS('indiv')} />
        <MenuBtn s={s} c={c} icon="analytics-outline" label="Competency Analysis" onPress={() => toS('comp')} /></View>;
    }
    if (det && det.k === 'page') {
      const p = det.p; let inner;
      if (p === 'FAQ') inner = <View style={s.list}>{[['How do I grade a paper?', 'Open Scan from the camera button, choose a quiz, and capture the filled answer sheet.'],
        ['Where do I set the answer key?', 'Open a quiz from Home and tap the correct answer for each question.'],
        ['What ID do students fill in?', 'Each student has an ID number shown in their class. They fill it in the ID grid.'],
        ['Where are scores saved?', 'Each quiz has a spreadsheet with one row per student, under Spreadsheet.']].map((x) => <View key={x[0]} style={s.li2}><Text style={s.qq}>{x[0]}</Text><Text style={s.sub2}>{x[1]}</Text></View>)}</View>;
      else if (p === 'Contact GuroGabay') inner = <Contact s={s} c={c} />;
      else if (p === 'Settings') inner = <SettingsPanel c={c} mode={mode} onMode={onMode} />;
     else if (p === 'Credits') inner = <CreditsPanel c={c} />;
      else inner = null;
      return <View>{back}<Text style={s.h1}>{p}</Text>{inner}</View>;
    }
    // Students tab: every student with only their name, ID and the class(es) they belong to
    const studentRows = students.map((st) => ({ st, cls: classes.filter((x) => x.s.includes(st.id)).map((x) => x.n) }))
      .filter(({ st, cls }) => m(st.name) || m(String(st.id)) || cls.some(m))
      .sort((a, b) => a.st.name.localeCompare(b.st.name));
    const studentList = <View style={s.list}>{studentRows.length ? studentRows.map(({ st, cls }) => (
      <View key={st.id} style={[s.li, { alignItems: 'center' }]}>
        <View style={{ flex: 1 }}><Text style={s.txt} numberOfLines={1}>{st.name}</Text><Text style={{ color: c.mute, fontSize: 14 }} numberOfLines={1}>{cls.length ? cls.join(', ') : 'No class'}</Text></View>
        <Text style={s.txt}>ID {st.id}</Text>
        <Pressable onPress={() => askDeleteStudent(st)} hitSlop={10} accessibilityLabel={'Delete ' + st.name}><Ionicons name="trash-outline" size={20} color={c.red} /></Pressable>
      </View>)) : <Text style={s.empty}>{q.trim() ? 'No matching students.' : 'No students yet. Add them inside a class.'}</Text>}</View>;
    let items = [];
    if (tab === 'home') items = quizzes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'quiz', 'Papers: ' + x.res.length + '\n' + x.d, x.n));
    if (tab === 'sheet') items = stab === 'ecr' ? classes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'ecr', x.s.length + ' learners', x.n))
      : quizzes.filter((x) => m(x.sh)).map((x, i) => card(x, i, 'sheet', 'Rows: ' + x.res.length + '\n' + x.d, x.sh));
    if (tab === 'classes') items = classes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'class', x.d, x.n)).reverse();
    return <View><Text style={s.h1}>{TITLES[tab]}</Text>
      {tab === 'sheet' ? <View style={s.sg}>{[['quiz', 'Quiz sheets'], ['ecr', 'Class records']].map(([k, l]) => (
        <Pressable key={k} style={[s.sgB, stab === k && s.sgOn]} onPress={() => setStab(k)}><Text style={s.sgT}>{l}</Text></Pressable>))}</View> : null}
      {tab === 'classes' ? <View style={s.sg}>{[['classes', 'Classes'], ['students', 'Students']].map(([k, l]) => (
        <Pressable key={k} style={[s.sgB, ctab === k && s.sgOn]} onPress={() => setCtab(k)}><Text style={s.sgT}>{l}</Text></Pressable>))}</View> : null}
      {tab === 'classes' && ctab === 'students' ? studentList : null}
      {tab === 'classes' && ctab === 'students' ? null : tab === 'recent' ? <View style={s.list}>{log.filter((e) => m(e.t)).length ? log.filter((e) => m(e.t)).map((e, i) => <Row key={i} a={e.t} b={e.d} />) : <Text style={s.empty}>No recent activity.</Text>}</View>
        : items.length ? <View style={s.grid}>{items}</View> : tab === 'sheet' && stab === 'ecr' ? <Text style={s.empty}>Create a class on the Classes tab first.</Text> : empty}</View>;
  };

  if (modal === 'scan') {
    return (
      <View style={s.root}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <ScanModal s={s} c={c} quizzes={quizzes} students={students} classes={classes} initial={scanQ} onSave={savePaper} onClose={() => setModal(null)} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={s.head}>
        <Pressable onPress={() => setMenu(true)} accessibilityLabel="Open menu"><Ionicons name="grid-outline" size={30} color={c.ink} /></Pressable>
        <Pressable style={s.user} onPress={() => { setMenu(false); setDet({ k: 'account' }); }} accessibilityLabel="Open account">
          <Text style={s.uname} numberOfLines={1}>{acct.name}</Text>
          <View style={s.avatar}><Text style={{ color: c.bg, fontSize: 20, fontWeight: '700' }}>{(acct.name || '?').trim().charAt(0).toUpperCase()}</Text></View>
        </Pressable>
      </View>
      <View style={s.srow}>
        <View style={s.search}><TextInput style={s.sin} value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={c.mute} />
          <Ionicons name="search" size={22} color={c.ink} /></View>
        <Pressable style={s.cam} onPress={() => openScan()} accessibilityLabel="Scan papers"><Ionicons name="camera" size={24} color={c.ink} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 130 + (BOTTOM - 18) }} keyboardShouldPersistTaps="handled"><Animated.View key={tab + (det ? ':' + det.k + (det.id || det.p || '') : '')} entering={FadeInRight.duration(250)}>{body()}</Animated.View></ScrollView>

      <NavBar s={s} c={c} tab={tab} det={det} go={go} plus={plus} />

      <SideMenu s={s} visible={menu} onClose={() => setMenu(false)}>
            <View style={s.brand}><Ionicons name="grid-outline" size={30} color={c.ink} /><Text style={s.brandT}>GuroGabay</Text></View>
            <Pressable style={s.acctRow} onPress={() => { setMenu(false); setDet({ k: 'account' }); }}>
              <View style={s.avatar}><Text style={{ color: c.bg, fontSize: 20, fontWeight: '700' }}>{(acct.name || '?').trim().charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={s.itemT} numberOfLines={1}>{acct.name}</Text><Text style={[s.sub, { textAlign: 'left' }]} numberOfLines={1}>{acct.user}</Text></View>
            </Pressable>
            {['home', 'classes', 'add', 'sheet', 'recent'].map((k) => (
              <Pressable key={k} style={s.item} onPress={() => { if (k === 'add') { setMenu(false); setTimeout(plus, 450); } else go(k); }}>
                {k === 'add' ? <View style={s.mini}><Ionicons name="add" size={20} color={c.bg} /></View> : <Ionicons name={ICONS[k]} size={26} color={c.mute} />}
                <Text style={s.itemT}>{k === 'add' ? 'Create' : TITLES[k]}</Text>
              </Pressable>))}
            <View style={s.hr} />
            {['Settings', 'FAQ', 'Contact GuroGabay', 'Credits'].map((x) => (
              <Pressable key={x} style={s.item} onPress={() => { setMenu(false); setDet({ k: 'page', p: x }); }}><Text style={s.itemT}>{x}</Text></Pressable>))}
            <View style={{ flex: 1 }} />
            <Pressable style={[s.item, { marginBottom: BOTTOM + 8 }]} onPress={() => { setMenu(false); onLogout(); }}><Ionicons name="log-out-outline" size={26} color={c.red} /><Text style={[s.itemT, { color: c.red }]}>Log out</Text></Pressable>
      </SideMenu>

      <Modal transparent animationType="fade" visible={modal === 'quiz' || modal === 'class'} onRequestClose={() => setModal(null)}>
        <View style={s.dim}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {modal === 'quiz' && <QuizForm s={s} c={c} classes={classes} quizzes={quizzes} onSave={saveQuiz} onCancel={() => setModal(null)} />}
          {modal === 'class' && <ClassForm s={s} c={c} students={students} classes={classes} onSave={saveClass} onCancel={() => setModal(null)} />}
        </KeyboardAvoidingView></View>
      </Modal>
    </View>
  );
}

// Decides what to show: the sign-in screen, or the app for the signed-in teacher. Accounts are kept in Supabase.
function RootInner() {

const sysScheme = useColorScheme();
const [mode, setMode] = useState('system'); // 'system' | 'light' | 'dark'
useEffect(() => {
  AsyncStorage.getItem('gg_theme_mode').then((v) => v && setMode(v)).catch(() => {});
}, []);
const changeMode = (m) => {
  setMode(m);
  AsyncStorage.setItem('gg_theme_mode', m).catch(() => {});
};
const scheme = mode === 'system' ? sysScheme : mode;
const c = scheme === 'dark' ? DARK : LIGHT;
const s = useMemo(() => mk(c), [scheme]);
const [boot, setBoot] = useState(false); const [user, setUser] = useState(null);
const resetting = useRef(false);

  // Before accounts moved online, each teacher's data was saved under a phone-only id. Copy it to the online account with the same email.
  const adoptLocalData = async (u) => {
    try {
      const raw = await AsyncStorage.getItem(ACC_KEY); if (!raw) return;
      const old = (JSON.parse(raw).accounts || []).find((a) => String(a.user || '').trim().toLowerCase() === String(u.email || '').trim().toLowerCase());
      if (!old || old.id === u.id) return;
      if (await AsyncStorage.getItem(KEY + ':' + u.id)) return;
      const data = await AsyncStorage.getItem(KEY + ':' + old.id); if (!data) return;
      await AsyncStorage.setItem(KEY + ':' + u.id, data);
      const keys = await AsyncStorage.getAllKeys();
      for (const k of keys.filter((x) => x.startsWith(THUMB + old.id + ':'))) {
        const v = await AsyncStorage.getItem(k);
        if (v) await AsyncStorage.setItem(THUMB + u.id + ':' + k.slice((THUMB + old.id + ':').length), v);
      }
    } catch (e) { /* the old data stays where it was */ }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const stay = await AsyncStorage.getItem(STAY_KEY);
        if (data.session && stay === 'false') { await supabase.auth.signOut(); if (alive) setUser(null); }
        else if (data.session) { await adoptLocalData(data.session.user); if (alive) setUser(data.session.user); }
      } catch (e) { /* show the sign-in screen */ }
      if (alive) setBoot(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => { if (!alive || resetting.current) return; setUser(sess ? sess.user : null); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const login = async (f, stay) => {
    await AsyncStorage.setItem(STAY_KEY, stay ? 'true' : 'false');
    const { data, error } = await supabase.auth.signInWithPassword({ email: f.user.trim(), password: f.password });
    if (error) return /confirm/i.test(error.message) ? 'Confirm your email first. Check your inbox.' : 'Wrong email or password.';
    await adoptLocalData(data.user); setUser(data.user); return '';
  };
  const register = async (f, stay) => {
    await AsyncStorage.setItem(STAY_KEY, stay ? 'true' : 'false');
    const { data, error } = await supabase.auth.signUp({
      email: f.user.trim(), password: f.password,
      options: { data: { full_name: f.name.trim(), school: (f.school || '').trim() } },
    });
    if (error) return error.message;
    if (!data.session) return 'Account created. Check your email to confirm it, then sign in.';
    await adoptLocalData(data.user); setUser(data.user); return '';
  };
  const sendCode = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return error ? error.message : '';
  };
  const resetPassword = async (email, code, pw) => {
    resetting.current = true;
    try {
      const v = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
      if (v.error) return 'Wrong or expired code.';
      const u = await supabase.auth.updateUser({ password: pw });
      if (u.error) { await supabase.auth.signOut(); return u.error.message; }
      await adoptLocalData(u.data.user); setUser(u.data.user); return '';
    } catch (e) { return 'Something went wrong. Try again.'; }
    finally { resetting.current = false; }
  };
  const logout = () => { supabase.auth.signOut().then(() => setUser(null)).catch(() => setUser(null)); };
  const update = async (patch) => {
    if (patch.newPassword) {
      const chk = await supabase.auth.signInWithPassword({ email: user.email, password: patch.currentPassword });
      if (chk.error) return 'Your current password is wrong.';
      const { error } = await supabase.auth.updateUser({ password: patch.newPassword });
      return error ? error.message : '';
    }
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: patch.name, school: patch.school } });
    if (error) return error.message;
    setUser(data.user); return '';
  };
  // Erases this teacher's data on this phone and signs out. The online account itself stays.
  const remove = () => {
    const id = user.id; AsyncStorage.removeItem(KEY + ':' + id);
    AsyncStorage.getAllKeys().then((ks) => AsyncStorage.multiRemove(ks.filter((k) => k.startsWith(THUMB + id + ':') || k.startsWith(OLD_THUMB + id + ':')))).catch(() => {});
    logout();
  };

  const me = user ? {
    id: user.id,
    name: (user.user_metadata && user.user_metadata.full_name) || user.email,
    school: (user.user_metadata && user.user_metadata.school) || '',
    user: user.email,
    created: new Date(user.created_at || Date.now()).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }),
  } : null;

  if (!boot) return <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={c.ink} /></View>;
  if (!me) return (<View style={{ flex: 1, backgroundColor: c.bg }}><StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
    <AuthScreen s={s} c={c} onLogin={login} onRegister={register} onSendCode={sendCode} onReset={resetPassword} /></View>);
  return <Main key={me.id} acct={me} onAccount={update} onLogout={logout} onDelete={remove} scheme={scheme} mode={mode} onMode={changeMode} />;
}

export default function Root() {
  const [showSplash, setShowSplash] = useState(true);
  return (
    <View style={{ flex: 1 }}>
      <RootInner />
      {showSplash && <SplashAnimation onDone={() => setShowSplash(false)} />}
    </View>
  );
}

const mk = (c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: TOP + 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uname: { color: c.ink, fontSize: 16, fontWeight: '500', maxWidth: 190 },
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
  nav: { position: 'absolute', left: 20, right: 20, bottom: BOTTOM, height: 76, backgroundColor: c.card, borderWidth: 1, borderColor: c.mute, borderRadius: 38, padding: 8, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  navTrack: { flex: 1, borderRadius: 30, backgroundColor: c.bg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', borderTopWidth: 2, borderTopColor: 'rgba(0,0,0,0.2)' },
  navPill: { position: 'absolute', left: 0, top: 4, bottom: 4, borderRadius: 26, backgroundColor: c.card, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  navSlot: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  navBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  menuWrap: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: { width: '78%', maxWidth: 320, backgroundColor: c.card, paddingTop: TOP + 18, paddingHorizontal: 20 },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.mute },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  brandT: { color: c.ink, fontSize: 24, fontWeight: '500' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 13 },
  itemT: { color: c.ink, fontSize: 18 },
  mini: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: c.mute, marginVertical: 10 },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flex: 1, marginTop: TOP + 56, marginHorizontal: 14, marginBottom: 40, backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 26, padding: 22 },
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
  kbSug: { borderColor: AMBER, borderWidth: 3 },
  kbN: { height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 2, borderColor: c.mute, alignItems: 'center', justifyContent: 'center' },
  gr: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  gname: { width: 120, color: c.ink, fontSize: 14, paddingRight: 6 },
  gh: { width: 44, marginRight: 4, textAlign: 'center', color: c.mute, fontSize: 12 },
  gc: { width: 44, height: 36, marginRight: 4, borderWidth: 1, borderColor: c.mute, borderRadius: 6, textAlign: 'center', color: c.ink, backgroundColor: c.bg, padding: 0, fontSize: 15 },
  rc: { width: 52, textAlign: 'right', color: c.ink, fontSize: 14 },
  ir: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  iN: { width: 120, color: c.ink, fontSize: 13, paddingRight: 6 },
  iT: { width: 44, color: c.ink, fontSize: 13, textAlign: 'center' },
  iM: { fontFamily: MONO, fontSize: 12, color: c.ink },
  logo: { width: 104, height: 104, borderRadius: 28, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  logoRing: { width: 62, height: 62, borderRadius: 31, borderWidth: 6, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
});