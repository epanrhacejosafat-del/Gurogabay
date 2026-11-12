// SettingsPanel.js — save next to App.js (same folder). Replaces the old file.
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, Pressable, Linking, Modal, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETTINGS_KEY = 'gg_settings';
export const DEFAULTS = {
  showPaperOnScan: false, betweenGrading: 'Wait Indefinitely', oneQuizPerStudent: true,
  warnBeforeOverwriting: true, hideScoreOnSummary: false, showCorrectedAnswers: false,
  inactivityPause: true, brightLightDetection: true, playSoundOnScan: true,
  vibrateOnScan: true, crashReporting: true, syncDebugImages: false, sharpness: 0.5,
};
const BETWEEN = ['Wait Indefinitely', '1 second', '2 seconds', '3 seconds', '5 seconds'];

// Other screens can call this to read the saved settings.
export async function loadSettings() {
  try {
    const x = await AsyncStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULTS, ...(x ? JSON.parse(x) : {}) };
  } catch (e) {
    return DEFAULTS;
  }
}

// These are defined OUTSIDE SettingsPanel on purpose. When they were inside, every change
// rebuilt them, which restarted the switches mid-animation and made them flicker.
const Head = ({ t, col }) => <Text style={[st.head, { color: col.sub }]}>{t}</Text>;

const Row = ({ label, col, last, onPress, children }) => {
  const line = !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: col.line };
  const inner = (
    <>
      <Text style={{ color: col.text, fontSize: 16, flex: 1 }}>{label}</Text>
      {children}
    </>
  );
  // Toggle rows are plain Views, so scrolling over them can never trigger a tap.
  if (!onPress) return <View style={[st.row, line]}>{inner}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, line, pressed && { opacity: 0.6 }]}>
      {inner}
    </Pressable>
  );
};

const Tog = ({ label, value, onChange, col, last }) => (
  <Row label={label} col={col} last={last}>
    <Switch
      value={!!value}
      onValueChange={onChange}
      trackColor={{ false: col.line, true: col.on }}
      ios_backgroundColor={col.line}
    />
  </Row>
);

// App.js passes: c (the colours), mode ('system' | 'light' | 'dark'), onMode (changes it).
export default function SettingsPanel({ c, mode, onMode }) {
  const col = {
    card: c.card, text: c.ink, sub: c.mute, line: c.mute + '55', accent: c.ink, onAccent: c.card, on: c.green,
  };

  const [v, setV] = useState(DEFAULTS);
  const [sharp, setSharp] = useState(DEFAULTS.sharpness);
  const [pick, setPick] = useState(false);

  useEffect(() => {
    loadSettings().then((x) => { setV(x); setSharp(x.sharpness); });
  }, []);

  const upd = (p) => {
    setV((prev) => {
      const n = { ...prev, ...p };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(n)).catch(() => {});
      return n;
    });
  };
  const t = (label, f, last) => <Tog label={label} value={v[f]} onChange={(x) => upd({ [f]: x })} col={col} last={last} />;

  return (
    <View>
      <Head t="APPEARANCE" col={col} />
      <View style={[st.card, { backgroundColor: col.card, flexDirection: 'row', padding: 6 }]}>
        {[['system', 'System'], ['light', 'Light'], ['dark', 'Night']].map(([k, l]) => {
          const on = mode === k;
          return (
            <Pressable
              key={k}
              onPress={() => onMode(k)}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: on ? col.accent : 'transparent' }}
            >
              <Text style={{ color: on ? col.onAccent : col.text, fontWeight: '600' }}>{l}</Text>
            </Pressable>
          );
        })}
      </View>

      <Head t="GRADING" col={col} />
      <View style={[st.card, { backgroundColor: col.card }]}>
        {t('Show Paper On Scan', 'showPaperOnScan')}
        <Row label="Between Grading" col={col} onPress={() => setPick(true)}>
          <Text style={{ color: col.sub, fontSize: 16 }}>{v.betweenGrading}  ›</Text>
        </Row>
        {t('One Quiz Per Student', 'oneQuizPerStudent')}
        {t('Warn Before Overwriting', 'warnBeforeOverwriting')}
        {t('Hide Score on Summary', 'hideScoreOnSummary')}
        {t('Show Corrected Answers', 'showCorrectedAnswers')}
        {t('Inactivity Pause', 'inactivityPause')}
        {t('Bright Light Detection', 'brightLightDetection')}
        {t('Play Sound On Scan', 'playSoundOnScan')}
        {t('Vibrate On Scan (iPhone)', 'vibrateOnScan', true)}
      </View>

      <Head t="CRASH/USAGE LOGGING" col={col} />
      <View style={[st.card, { backgroundColor: col.card }]}>
        {t('Enable Crash/Usage Reporting', 'crashReporting')}
        {t('Sync Debug Images', 'syncDebugImages', true)}
      </View>

      <Head t="REQUIRED IMAGE SHARPNESS" col={col} />
      <View style={[st.card, { backgroundColor: col.card, padding: 14 }]}>
        <Slider
          value={sharp}
          minimumValue={0}
          maximumValue={1}
          onValueChange={setSharp}
          onSlidingComplete={(x) => upd({ sharpness: x })}
          minimumTrackTintColor={col.on}
          maximumTrackTintColor={col.line}
        />
        <Text style={{ color: col.sub, fontSize: 13, marginTop: 6 }}>
          Move left to allow less sharp images if the app is not scanning well.
        </Text>
      </View>

      <Pressable onPress={() => Linking.openSettings()} style={{ marginTop: 20, paddingVertical: 8 }}>
        <Text style={{ color: col.on, fontSize: 15, fontWeight: '600' }}>Privacy — open in Settings app</Text>
      </Pressable>
      <View style={{ height: 120 }} />

      {/* Picker for "Between Grading" (Alert only allows 3 buttons on Android) */}
      <Modal visible={pick} transparent animationType="fade" onRequestClose={() => setPick(false)}>
        <Pressable style={st.shade} onPress={() => setPick(false)}>
          <View style={[st.sheet, { backgroundColor: col.card }]}>
            <Text style={{ color: col.text, fontSize: 17, fontWeight: '700', padding: 16 }}>Between Grading</Text>
            {BETWEEN.map((o) => (
              <Pressable
                key={o}
                onPress={() => { upd({ betweenGrading: o }); setPick(false); }}
                style={[st.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: col.line }]}
              >
                <Text style={{ color: col.text, fontSize: 16, flex: 1 }}>{o}</Text>
                {v.betweenGrading === o ? <Text style={{ color: col.on, fontSize: 18, fontWeight: '700' }}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  head: { fontSize: 13, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  card: { borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 50 },
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 16, overflow: 'hidden' },
});