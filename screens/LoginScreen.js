import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, Switch, Image,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const C = {
  bg: '#EDEFEB',
  ink: '#1E293B',
  muted: '#64748B',
  border: '#64748B',
  green: '#16A34A',
  error: '#B3261E',
};

export const STAY_KEY = 'gg_stay_signed_in';

function Field({ label, right, ...props }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputWrap}>
        <TextInput style={s.input} placeholderTextColor={C.muted} {...props} />
        {right}
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [stay, setStay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const eye = (
    <TouchableOpacity onPress={() => setShowPw(!showPw)} hitSlop={10}>
      <Ionicons name={showPw ? 'eye-outline' : 'eye-off-outline'} size={24} color={C.muted} />
    </TouchableOpacity>
  );

  const switchMode = () => { setSignup(!signup); setError(''); setInfo(''); };

  const submit = async () => {
    setError(''); setInfo('');
    if (signup && !name.trim()) return setError('Enter your full name.');
    if (!email.trim()) return setError('Enter your email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (signup && password !== confirm) return setError('Passwords do not match.');

    setLoading(true);
    try {
      await AsyncStorage.setItem(STAY_KEY, stay ? 'true' : 'false');
      if (signup) {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim(), school: school.trim() } },
        });
        if (e) throw e;
        if (!data.session) {
          setInfo('Account created. Check your email to confirm it, then sign in.');
          setSignup(false);
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (e) throw e;
      }
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Image source={require('../assets/gurogabay-logo.png')} style={s.logo} resizeMode="contain" />
        <Text style={s.title}>GuroGabay</Text>
        <Text style={s.subtitle}>
          {signup ? 'Create your teacher account' : 'Sign in to your teacher account'}
        </Text>

        {signup && (
          <>
            <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Maria Santos" />
            <Field label="School (optional)" value={school} onChangeText={setSchool} placeholder="School name" />
          </>
        )}

        <Field label="Email" value={email} onChangeText={setEmail}
          placeholder="teacher@school.com" autoCapitalize="none"
          keyboardType="email-address" autoCorrect={false} />

        <Field label="Password" value={password} onChangeText={setPassword}
          placeholder="Password" secureTextEntry={!showPw} autoCapitalize="none" right={eye} />

        {signup && (
          <Field label="Confirm password" value={confirm} onChangeText={setConfirm}
            placeholder="Type it again" secureTextEntry={!showPw} autoCapitalize="none" />
        )}

        <View style={s.stayRow}>
          <Text style={s.stayText}>Stay signed in on this phone</Text>
          <Switch value={stay} onValueChange={setStay}
            trackColor={{ true: C.green, false: '#CBD5E1' }} thumbColor="#fff" />
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}
        {!!info && <Text style={s.info}>{info}</Text>}

        <TouchableOpacity style={[s.button, loading && { opacity: 0.7 }]} onPress={submit} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.buttonText}>{signup ? 'Create account' : 'Sign in'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={switchMode} style={{ marginTop: 20 }}>
          <Text style={s.link}>
            {signup ? 'Already have an account? Sign in' : 'Add another teacher account'}
          </Text>
        </TouchableOpacity>

        <Text style={s.note}>Each teacher's quizzes, classes and scores stay separate.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 36, paddingTop: 70, paddingBottom: 40 },
  logo: { width: 150, height: 130, alignSelf: 'center' },
  title: { fontSize: 38, fontWeight: '800', color: C.ink, textAlign: 'center', marginTop: 12 },
  subtitle: { fontSize: 18, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 36 },
  label: { fontSize: 17, color: C.ink, marginBottom: 8, marginLeft: 2 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: C.border,
    borderRadius: 18, paddingHorizontal: 18, height: 56,
  },
  input: { flex: 1, fontSize: 18, color: C.ink },
  stayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 2, marginBottom: 24,
  },
  stayText: { fontSize: 18, color: C.ink },
  button: {
    backgroundColor: C.ink, borderRadius: 40, height: 60,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  link: { color: C.green, fontSize: 19, textAlign: 'center' },
  note: { color: C.muted, fontSize: 16, textAlign: 'center', marginTop: 24, lineHeight: 23 },
  error: { color: C.error, fontSize: 15, marginBottom: 12 },
  info: { color: C.green, fontSize: 15, marginBottom: 12 },
});
