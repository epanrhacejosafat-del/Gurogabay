// theme.js  — put in your src/ folder
// Needs: npx expo install @react-native-async-storage/async-storage
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gg_theme_mode'; // 'system' | 'light' | 'dark'

export const lightColors = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#000000',
  subtext: '#6D6D72',
  border: '#D1D1D6',
  primary: '#007AFF',
  switchOn: '#34C759',
  headerBg: '#F9F9F9',
};

export const darkColors = {
  background: '#000000',
  card: '#1C1C1E',
  text: '#FFFFFF',
  subtext: '#98989F',
  border: '#38383A',
  primary: '#0A84FF',
  switchOn: '#30D158',
  headerBg: '#121212',
};

const ThemeContext = createContext({
  mode: 'system',
  isDark: false,
  colors: lightColors,
  setMode: () => {},
});

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setModeState(v))
      .catch(() => {});
  }, []);

  const setMode = (m) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  };

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';

  return (
    <ThemeContext.Provider
      value={{ mode, isDark, colors: isDark ? darkColors : lightColors, setMode }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

// ---- Settings row: add this inside your Settings screen ----
export function AppearanceSetting() {
  const { mode, setMode, colors } = useTheme();
  const options = [
    { key: 'system', label: 'System' },
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Night' },
  ];
  return (
    <View style={{ backgroundColor: colors.card, padding: 16 }}>
      <Text style={{ color: colors.text, fontSize: 17, marginBottom: 10 }}>Appearance</Text>
      <View style={[s.seg, { borderColor: colors.border }]}>
        {options.map((o) => {
          const active = mode === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => setMode(o.key)}
              style={[s.segBtn, active && { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
});

/*
HOW TO USE
1) Wrap your app root (App.js):
     <ThemeProvider> ...existing app... </ThemeProvider>

2) In Settings screen, add under a new "APPEARANCE" section header:
     <AppearanceSetting />

3) In every screen, replace hard-coded colors:
     const { colors } = useTheme();
     <View style={{ backgroundColor: colors.background }}>
       <Text style={{ color: colors.text }}>...</Text>
     Use colors.card for rows/cards, colors.border for dividers,
     and pass trackColor={{ true: colors.switchOn }} to <Switch />.

4) For the status bar:  <StatusBar style={isDark ? 'light' : 'dark'} />
   and in app.json set  "userInterfaceStyle": "automatic".
*/
