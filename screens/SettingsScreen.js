// SettingsScreen.js
// Needs: npx expo install @react-native-async-storage/async-storage @react-native-community/slider
// Uses theme.js from the previous step (ThemeProvider must wrap the app).
import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, Switch, TouchableOpacity, Linking, Alert, StyleSheet,
} from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, AppearanceSetting } from './theme';

const KEY = 'gg_settings';

const DEFAULTS = {
  showPaperOnScan: false,
  betweenGrading: 'Wait Indefinitely',
  oneQuizPerStudent: true,
  warnBeforeOverwriting: true,
  hideScoreOnSummary: false,
  showCorrectedAnswers: false,
  inactivityPause: true,
  brightLightDetection: true,
  playSoundOnScan: true,
  vibrateOnScan: true,
  crashReporting: true,
  syncDebugImages: false,
  sharpness: 0.5,
};

const BETWEEN_OPTIONS = ['Wait Indefinitely', '1 second', '2 seconds', '3 seconds', '5 seconds'];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const [s, setS] = useState(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setS({ ...DEFAULTS, ...JSON.parse(v) }))
      .catch(() => {});
  }, []);

  const update = (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };

  const Section = ({ title, children }) => (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.subtext }]}>{title}</Text>
      <View style={{ backgroundColor: colors.card }}>{children}</View>
    </View>
  );

  const Row = ({ label, children, onPress, last }) => (
    <TouchableOpacity
      activeOpacity={onPress ? 0.6 : 1}
      onPress={onPress}
      style={[styles.row, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
    >
      <Text style={{ color: colors.text, fontSize: 17, flex: 1 }}>{label}</Text>
      {children}
    </TouchableOpacity>
  );

  const Toggle = ({ label, field, last }) => (
    <Row label={label} last={last}>
      <Switch
        value={s[field]}
        onValueChange={(v) => update({ [field]: v })}
        trackColor={{ true: colors.switchOn, false: colors.border }}
      />
    </Row>
  );

  const pickBetween = () =>
    Alert.alert('Between Grading', undefined, [
      ...BETWEEN_OPTIONS.map((o) => ({ text: o, onPress: () => update({ betweenGrading: o }) })),
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ height: 16 }} />
      <View style={{ backgroundColor: colors.card }}>
        <Row label="Privacy — open in Settings app" onPress={() => Linking.openSettings()} last />
      </View>

      <Section title="APPEARANCE">
        <AppearanceSetting />
      </Section>

      <Section title="GRADING">
        <Toggle label="Show Paper On Scan" field="showPaperOnScan" />
        <Row label="Between Grading" onPress={pickBetween}>
          <Text style={{ color: colors.subtext, fontSize: 17 }}>{s.betweenGrading}  ›</Text>
        </Row>
        <Toggle label="One Quiz Per Student" field="oneQuizPerStudent" />
        <Toggle label="Warn Before Overwriting" field="warnBeforeOverwriting" />
        <Toggle label="Hide Score on Summary" field="hideScoreOnSummary" />
        <Toggle label="Show Corrected Answers" field="showCorrectedAnswers" />
        <Toggle label="Inactivity Pause" field="inactivityPause" />
        <Toggle label="Bright Light Detection" field="brightLightDetection" />
        <Toggle label="Play Sound On Scan" field="playSoundOnScan" />
        <Toggle label="Vibrate On Scan (iPhone)" field="vibrateOnScan" last />
      </Section>

      <Section title="CRASH/USAGE LOGGING">
        <Toggle label="Enable Crash/Usage Reporting" field="crashReporting" />
        <Toggle label="Sync Debug Images" field="syncDebugImages" last />
      </Section>

      <Section title="REQUIRED IMAGE SHARPNESS">
        <View style={{ padding: 16 }}>
          <Slider
            value={s.sharpness}
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            onSlidingComplete={(v) => update({ sharpness: v })}
          />
        </View>
      </Section>
      <Text style={[styles.footer, { color: colors.subtext }]}>
        Move left to allow less sharp images if the app is not scanning well.
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 14, marginTop: 28, marginBottom: 8, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 50 },
  footer: { fontSize: 13, marginTop: 8, marginHorizontal: 16 },
});
