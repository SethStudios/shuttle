import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { AppleButton, Segmented } from '@/components/ui/Apple';
import { UniAbujaGreen } from '@/constants/theme';
import { MATRIC_MAP_KEY } from '@/constants/app';

const GREEN = UniAbujaGreen[700];

type Role = 'student' | 'staff';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { role: initial } = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<Role>(initial === 'staff' ? 'staff' : 'student');
  const [name, setName] = useState('');
  const [matric, setMatric] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const pwShort = pw.length > 0 && pw.length < 6;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailBad = email.length > 0 && !emailOk;
  const nameBad = name.length > 0 && name.trim().length <= 1;
  const matricBad = role === 'student' && matric.length > 0 && matric.trim().length < 4;
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 7 && phoneDigits.length <= 15;
  const phoneBad = phone.length > 0 && !phoneOk;
  const valid =
    name.trim().length > 1 &&
    emailOk &&
    (role === 'staff' ? true : matric.trim().length >= 4) &&
    phoneOk &&
    pw.length >= 6 && pw === pw2 && agreed;

  const submit = async () => {
    if (!valid) return;
    setLoading(true);
    setSubmitError('');
    try {
      const signEmail = email.trim().toLowerCase();
      const matricUp = matric.trim().toUpperCase();
      const { data, error } = await supabase.auth.signUp({
        email: signEmail,
        password: pw,
        options: {
          emailRedirectTo: 'uniabujashuttle://auth',
          data: {
            full_name: name.trim(),
            role,
            phone_number: phone.trim(),
            ...(role === 'student' ? { matric_number: matricUp } : {}),
          },
        },
      });
      if (error) {
        setSubmitError(error.message);
        return;
      }
      if (data.user) {
        // Remember matric → email on this phone so matric sign-in
        // works instantly, even before the server lookup is set up.
        if (role === 'student') {
          try {
            const raw = await AsyncStorage.getItem(MATRIC_MAP_KEY);
            const map = raw ? JSON.parse(raw) : {};
            map[matricUp] = signEmail;
            await AsyncStorage.setItem(MATRIC_MAP_KEY, JSON.stringify(map));
          } catch {}
        }
        Alert.alert('Account created', 'You can now sign in with your details.', [
          { text: 'Sign In', onPress: () => router.replace('/auth') },
        ]);
      }
    } catch {
      setSubmitError('Could not create your account. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
          bounces={true}
        >
          <TouchableOpacity
            style={styles.back}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'} size={24} color="#1C1C1E" />
          </TouchableOpacity>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.sub}>One account for booking, tickets and boarding.</Text>

          <View style={{ height: 18 }} />
          <Segmented<Role>
            value={role}
            onChange={(v) => { setRole(v); setMatric(''); }}
            options={[
              { value: 'student', label: 'Student', icon: 'school' },
              { value: 'staff', label: 'Staff', icon: 'work' },
            ]}
          />
          <View style={{ height: 20 }} />

          <Text style={styles.label}>Full name</Text>
          <View style={styles.input}>
            <MaterialIcons name="person-outline" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="e.g. Amina Yusuf" placeholderTextColor="#8E8E93"
              value={name} onChangeText={(v) => { setName(v); setSubmitError(''); }} autoCapitalize="words"
              accessibilityLabel="Full name" autoComplete="name" />
          </View>
          {nameBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Enter your full name.</Text> : null}

          {role === 'student' ? (
            <>
              <Text style={styles.label}>Matric number</Text>
              <View style={styles.input}>
                <MaterialIcons name="badge" size={20} color="#8E8E93" />
                <TextInput style={styles.text} placeholder="e.g. UAB/2024/001" placeholderTextColor="#8E8E93"
                  value={matric} onChangeText={(v) => { setMatric(v); setSubmitError(''); }} autoCapitalize="characters"
                  accessibilityLabel="Matric number" />
              </View>
              {matricBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Matric number looks too short.</Text> : null}
            </>
          ) : null}

          <Text style={styles.label}>{role === 'staff' ? 'Staff email' : 'Email address'}</Text>
          <View style={styles.input}>
            <MaterialIcons name="email" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="you@example.com" placeholderTextColor="#8E8E93"
              value={email} onChangeText={(v) => { setEmail(v); setSubmitError(''); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Email address" autoComplete="email" textContentType="emailAddress" />
          </View>
          {emailBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Enter a valid email address.</Text> : null}
          {role === 'student' ? (
            <Text style={styles.hint}>Used for sign-in and password reset. Your matric number still works for sign-in too.</Text>
          ) : null}

          <Text style={styles.label}>Phone number</Text>
          <View style={styles.input}>
            <MaterialIcons name="phone" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="080…" placeholderTextColor="#8E8E93"
              value={phone} onChangeText={(v) => { setPhone(v); setSubmitError(''); }} keyboardType="phone-pad" maxLength={16}
              accessibilityLabel="Phone number" autoComplete="tel" textContentType="telephoneNumber" />
          </View>
          {phoneBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Enter a valid phone number (7-15 digits).</Text> : null}

          <Text style={styles.label}>Password</Text>
          <View style={styles.input}>
            <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="Minimum 6 characters" placeholderTextColor="#8E8E93"
              value={pw} onChangeText={setPw} secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Password" textContentType="newPassword" />
            <TouchableOpacity
              onPress={() => setShowPw(!showPw)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
              accessibilityRole="button"
            >
              <MaterialIcons name={showPw ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
            </TouchableOpacity>
          </View>
          {pwShort ? <Text style={styles.err}>Password must be at least 6 characters.</Text> : null}

          <Text style={styles.label}>Confirm password</Text>
          <View style={styles.input}>
            <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="Repeat password" placeholderTextColor="#8E8E93"
              value={pw2} onChangeText={setPw2} secureTextEntry={!showPw2} autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Confirm password" textContentType="newPassword" />
            <TouchableOpacity
              onPress={() => setShowPw2(!showPw2)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={showPw2 ? 'Hide password' : 'Show password'}
              accessibilityRole="button"
            >
              <MaterialIcons name={showPw2 ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
            </TouchableOpacity>
          </View>
          {mismatch ? <Text style={styles.err}>Passwords do not match.</Text> : null}

          <View style={styles.termsRow}>
            <TouchableOpacity
              style={styles.termsBox}
              onPress={() => setAgreed(!agreed)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Agree to terms"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
            >
              <View style={[styles.box, agreed && styles.boxOn]}>
                {agreed ? <MaterialIcons name="check" size={15} color="#FFFFFF" /> : null}
              </View>
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>
              {' '}and{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/terms')}>Terms of Service</Text>.
            </Text>
          </View>

          {submitError ? (
            <Text style={styles.errCenter} accessibilityLiveRegion="polite">{submitError}</Text>
          ) : null}
          {!valid && !loading ? (
            <Text style={styles.hintCenter}>Fill every field correctly and accept the terms to enable sign-up.</Text>
          ) : null}
          <AppleButton title={loading ? 'Creating…' : 'Create Account'} loading={loading} disabled={!valid} onPress={submit} />

          <View style={styles.row}>
            <Text style={styles.muted}>Have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth')}>
              <Text style={styles.link}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  back: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1, borderColor: '#E5E5EA',
  },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 16, color: '#6B7280', marginTop: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8, marginTop: 14 },
  input: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA', minHeight: 54, gap: 10,
  },
  text: { flex: 1, fontSize: 17, color: '#1C1C1E', height: 52 },
  err: { fontSize: 13, color: '#FF3B30', marginTop: 6 },
  errCenter: { fontSize: 13.5, color: '#FF3B30', textAlign: 'center', lineHeight: 18, marginTop: 12 },
  hintCenter: { fontSize: 13, color: '#8E8E93', textAlign: 'center', marginTop: 10, lineHeight: 18 },
  hint: { fontSize: 13, color: '#8E8E93', marginTop: 7, marginLeft: 2, lineHeight: 18 },
  box: {
    width: 23, height: 23, borderRadius: 7, borderWidth: 1.5, borderColor: '#C7C7CC',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginTop: 1,
  },
  boxOn: { backgroundColor: GREEN, borderColor: GREEN },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
  muted: { fontSize: 15, color: '#6B7280' },
  link: { fontSize: 15, fontWeight: '700', color: GREEN },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 18, gap: 8 },
  termsBox: { marginTop: 1 },
  termsText: { flex: 1, fontSize: 14, color: '#3C3C43', lineHeight: 20 },
  termsLink: { fontSize: 14, fontWeight: '700', color: GREEN, textDecorationLine: 'underline' },
});
