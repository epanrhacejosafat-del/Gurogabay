import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet, Switch, Alert, Share,
  useColorScheme, Platform, StatusBar, KeyboardAvoidingView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './src/supabase';
console.log('URL:', process.env.EXPO_PUBLIC_SUPABASE_URL);
console.log('KEY loaded:', !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const KEY = 'gurogabay:v1';
const LET = ['A', 'B', 'C', 'D', 'E'];
const PAL = ['#f0c24b', '#7fb59a', '#e08e79', '#8aa6d6', '#b99ad0'];
const LIGHT = { bg: '#eceee9', card: '#ffffff', ink: '#1d2b3a', mute: '#66727e', red: '#e5342d', green: '#0a9d58' };
const DARK = { bg: '#161c22', card: '#212a33', ink: '#eef1f3', mute: '#9aa7b2', red: '#ff6b64', green: '#3ecf8e' };
const TITLES = { home: 'Quizzes', classes: 'Classes', sheet: 'Spreadsheet', recent: 'Recent' };
const ICONS = { home: 'home-outline', classes: 'people-outline', sheet: 'document-text-outline', recent: 'time-outline' };
const today = () => new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function Btn({ s, label, onPress, style }) {
  return <Pressable onPress={onPress} style={[s.pill, style]}><Text style={s.pillT}>{label}</Text></Pressable>;
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
  const [name, setName] = useState(''); const [f, setF] = useState(20);
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
        <View style={s.chips}>{[20, 50, 100].map((n) => <Chip key={n} s={s} label={n + ' questions'} on={f === n} onPress={() => setF(n)} />)}</View>
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

function ClassForm({ s, c, classes, onSave, onCancel }) {
  const [name, setName] = useState(''); const [hide, setHide] = useState(false);
  const [picked, setPicked] = useState([]); const [added, setAdded] = useState([]);
  const pool = [...classes.flatMap((x) => x.s.map((n) => ({ n, from: x.n }))), ...added.map((n) => ({ n, from: '' }))]
    .filter((x) => !hide || !x.from);
  const tog = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const save = () => (name.trim() ? onSave({ name: name.trim(), s: picked }) : Alert.alert('Enter a class name'));
  return (
    <View style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Bar s={s} onCancel={onCancel} onSave={save} />
        <Text style={s.lab}>Name:</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Class name" placeholderTextColor={c.mute} maxLength={40} />
        <Text style={s.lab}>Students:</Text>
        <View style={s.row}><Text style={[s.txt, { flex: 1 }]}>Hide students in other classes</Text>
          <Switch value={hide} onValueChange={setHide} trackColor={{ true: c.green }} /></View>
        {pool.length ? pool.map((x, i) => (
          <Pressable key={i} style={s.stu} onPress={() => tog(x.n)}>
            <View style={[s.box, picked.includes(x.n) && s.boxOn]}>{picked.includes(x.n) && <Ionicons name="checkmark" size={16} color={c.bg} />}</View>
            <Text style={[s.txt, { flex: 1 }]}>{x.n}</Text>{x.from ? <Text style={s.sub}>{x.from}</Text> : null}
          </Pressable>
        )) : <Text style={s.sub}>No students to show. Add a new student below.</Text>}
        <AddRow s={s} c={c} placeholder="New student name" onAdd={(n) => { if (!added.includes(n)) { setAdded([...added, n]); setPicked([...picked, n]); } }} />
      </ScrollView>
    </View>
  );
}

function ScanModal({ s, c, quizzes, initial, onCapture, onClose }) {
  const [perm, ask] = useCameraPermissions();
  const [qid, setQid] = useState(initial || quizzes[0].id); const [msg, setMsg] = useState('');
  return (
    <View style={s.sheet}>
      <Bar s={s} onCancel={onClose} cancelLabel="CLOSE" />
      <Text style={s.lab}>Quiz:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}>
        <View style={s.chips}>{quizzes.map((z) => <Chip key={z.id} s={s} label={z.n} on={qid === z.id} onPress={() => { setQid(z.id); setMsg(''); }} />)}</View>
      </ScrollView>
      {perm && perm.granted ? <CameraView style={s.cv} facing="back" />
        : <View style={[s.cv, s.center]}><Text style={[s.sub, { marginBottom: 12, textAlign: 'center' }]}>Camera permission is needed to scan papers.</Text>
          <Btn s={s} label="Allow camera" onPress={ask} style={{ marginTop: 0 }} /></View>}
      <Text style={[s.sub, { marginTop: 10, textAlign: 'left' }]}>Demo mode: scores are random until bubble reading is added.</Text>
      <Btn s={s} label="Capture paper" onPress={() => setMsg(onCapture(qid))} />
      <Text style={[s.txt, { margin: 10 }]}>{msg}</Text>
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
  const [data, setData] = useState({ quizzes: [], classes: [], log: [] });
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home'); const [det, setDet] = useState(null);
  const [q, setQ] = useState(''); const [modal, setModal] = useState(null); const [menu, setMenu] = useState(false);
  const [scanQ, setScanQ] = useState(null);

  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) setData(JSON.parse(v)); setReady(true); }); }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(KEY, JSON.stringify(data)); }, [data, ready]);
  const upd = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
  const { quizzes, classes, log } = data;
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const go = (k) => { setMenu(false); setDet(null); setTab(k); };
  const plus = () => { setMenu(false); setModal(tab === 'classes' && !det ? 'class' : 'quiz'); };
  const openScan = (id) => { if (!quizzes.length) return Alert.alert('Create a quiz first'); setScanQ(id || (det && det.k === 'quiz' ? det.id : quizzes[0].id)); setModal('scan'); };

  const saveQuiz = (f) => {
    upd((d) => { d.quizzes.unshift({ id: uid(), n: f.name, d: today(), f: f.f, c: f.c, sh: f.sh, key: Array(f.f).fill(-1), res: [] }); d.log.unshift({ t: 'Created quiz ' + f.name, d: today() }); return d; });
    setModal(null); setDet(null); setTab('home');
  };
  const saveClass = (f) => {
    upd((d) => { d.classes.push({ id: uid(), n: f.name, d: today(), s: f.s }); d.log.unshift({ t: 'Created class ' + f.name, d: today() }); return d; });
    setModal(null); setDet(null); setTab('classes');
  };
  const capture = (id) => {
    const z = byId(quizzes, id);
    if (z.key.some((x) => x < 0)) return 'Set the answer key for this quiz first.';
    const cand = z.c.flatMap((cid) => (byId(classes, cid) || { s: [] }).s).filter((n) => !z.res.some((r) => r.s === n));
    if (!cand.length) return 'Every student in this quiz has a scanned paper. Assign classes to the quiz to add more.';
    const sc = z.key.filter(() => Math.random() < 0.8).length;
    upd((d) => { const t = byId(d.quizzes, id); t.res.push({ s: cand[0], sc }); d.log.unshift({ t: 'Scanned ' + cand[0] + ' in ' + z.n, d: today() }); return d; });
    return cand[0] + ' scored ' + sc + '/' + z.f + '. Capture the next paper.';
  };
  const setKey = (qi, ci) => upd((d) => { byId(d.quizzes, det.id).key[qi] = ci; return d; });
  const addStudent = (n) => upd((d) => { byId(d.classes, det.id).s.push(n); return d; });
  const csv = (z) => Share.share({ message: 'Student,Score,Percent\n' + z.res.map((r) => r.s + ',' + r.sc + '/' + z.f + ',' + Math.round((r.sc / z.f) * 100) + '%').join('\n') });

  const card = (x, i, kind, sub, name) => (
    <Pressable key={x.id} style={s.card} onPress={() => setDet({ k: kind, id: x.id })}>
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
      return <View>{back}<Text style={s.h1}>{z.n}</Text><Text style={s.sub2}>{z.f} questions, {z.res.length} papers</Text>
        <Btn s={s} label="Scan papers" onPress={() => openScan(z.id)} />
        <Text style={s.sec}>Papers</Text>
        <View style={s.list}>{z.res.length ? z.res.map((r, i) => <Row key={i} a={r.s} b={r.sc + '/' + z.f} />) : <Text style={s.empty}>No papers scanned yet.</Text>}</View>
        <Text style={s.sec}>Answer key</Text>
        <View style={s.list}>{z.key.map((a, qi) => (
          <View key={qi} style={s.kr}><Text style={s.kn}>{qi + 1}</Text>
            {LET.map((l, ci) => <Pressable key={l} onPress={() => setKey(qi, ci)} style={[s.kb, a === ci && s.kbOn]}><Text style={[s.txt, a === ci && { color: c.bg }]}>{l}</Text></Pressable>)}
          </View>))}</View></View>;
    }
    if (det && det.k === 'class') {
      const x = byId(classes, det.id); if (!x) return null;
      return <View>{back}<Text style={s.h1}>{x.n}</Text><Text style={s.sub2}>Created {x.d}</Text><Text style={s.sec}>Students</Text>
        <View style={s.list}>{x.s.length ? x.s.map((n, i) => <Row key={i} a={n} b="" />) : <Text style={s.empty}>No students yet.</Text>}</View>
        <AddRow s={s} c={c} placeholder="New student name" onAdd={addStudent} /></View>;
    }
    if (det && det.k === 'sheet') {
      const z = byId(quizzes, det.id); if (!z) return null;
      return <View>{back}<Text style={s.h1}>{z.sh}</Text><Text style={s.sub2}>From quiz: {z.n}</Text>
        <View style={s.list}>{z.res.length ? z.res.map((r, i) => <Row key={i} a={r.s} b={r.sc + '/' + z.f + '   ' + Math.round((r.sc / z.f) * 100) + '%'} />) : <Text style={s.empty}>No papers scanned yet.</Text>}</View>
        <Btn s={s} label="Share as CSV" onPress={() => csv(z)} /></View>;
    }
    if (det && det.k === 'page') {
      const p = det.p; let inner;
      if (p === 'FAQ') inner = <View style={s.list}>{[['How do I grade a paper?', 'Tap the camera button, choose a quiz, and capture the filled answer sheet.'],
        ['Where do I set the answer key?', 'Open a quiz from Home and tap the answer for each question.'],
        ['Where are scores saved?', 'Each quiz has a spreadsheet with one row per student, under Spreadsheet.']].map((x) => <View key={x[0]} style={s.li2}><Text style={s.qq}>{x[0]}</Text><Text style={s.sub2}>{x[1]}</Text></View>)}</View>;
      else if (p === 'Contact GuroGabay') inner = <Contact s={s} c={c} />;
      else if (p === 'Settings') inner = <Text style={s.sub2}>The theme follows your phone's light or dark setting.</Text>;
      else inner = <Text style={s.sub2}>GuroGabay is a quiz grading app for teachers. Add your team and the tools you used here.</Text>;
      return <View>{back}<Text style={s.h1}>{p}</Text>{inner}</View>;
    }
    let items = [];
    if (tab === 'home') items = quizzes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'quiz', 'Papers: ' + x.res.length + '\n' + x.d, x.n));
    if (tab === 'sheet') items = quizzes.filter((x) => m(x.sh)).map((x, i) => card(x, i, 'sheet', 'Rows: ' + x.res.length + '\n' + x.d, x.sh));
    if (tab === 'classes') items = classes.filter((x) => m(x.n)).map((x, i) => card(x, i, 'class', x.d, x.n)).reverse();
    return <View><Text style={s.h1}>{TITLES[tab]}</Text>
      {tab === 'recent' ? <View style={s.list}>{log.filter((e) => m(e.t)).length ? log.filter((e) => m(e.t)).map((e, i) => <Row key={i} a={e.t} b={e.d} />) : <Text style={s.empty}>No recent activity.</Text>}</View>
        : items.length ? <View style={s.grid}>{items}</View> : empty}</View>;
  };

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">{body()}</ScrollView>

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

      <Modal transparent animationType="fade" visible={!!modal} onRequestClose={() => setModal(null)}>
        <View style={s.dim}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {modal === 'quiz' && <QuizForm s={s} c={c} classes={classes} onSave={saveQuiz} onCancel={() => setModal(null)} />}
          {modal === 'class' && <ClassForm s={s} c={c} classes={classes} onSave={saveClass} onCancel={() => setModal(null)} />}
          {modal === 'scan' && <ScanModal s={s} c={c} quizzes={quizzes} initial={scanQ} onCapture={capture} onClose={() => setModal(null)} />}
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
  brandT:xx { color: c.ink, fontSize: 24, fontWeight: '500' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 13 },
  itemT: { color: c.ink, fontSize: 18 },
  mini: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: c.mute, marginVertical: 10 },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { flex: 1, marginTop: (StatusBar.currentHeight || 30) + 100, marginHorizontal: 14, marginBottom: 90, backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, borderRadius: 26, padding: 22 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  cancel: { color: c.red, fontSize: 16 },
  save: { color: c.green, fontSize: 16, textDecorationLine: 'underline' },
  lab: { color: c.ink, fontSize: 16, marginBottom: 6, marginLeft: 2 },
  input: { height: 50, borderWidth: 2, borderColor: c.mute, borderRadius: 14, backgroundColor: c.bg, color: c.ink, paddingHorizontal: 14, fontSize: 16, marginBottom: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
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
});
