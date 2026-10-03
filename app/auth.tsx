import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton, Segmented } from '@/components/ui/Apple';

const GREEN = UniAbujaGreen[700];
export const MATRIC_MAP_KEY = '@matric_email_map';
type Role = 'student' | 'staff';

/** Resolve what a student typed (matric number or email) to an auth email.
 * Returns null when a matric matches nothing — callers must show
 * "not found" instead of attempting sign-in with a guessed address. */
export async function findStudentEmail(id: string): Promise<string | null> {
  const clean = id.trim();
  if (clean.includes('@')) return clean.toLowerCase();
  const matric = clean.toUpperCase();
  // 1. On-device map saved at signup on this phone.
  try {
    const raw = await AsyncStorage.getItem(MATRIC_MAP_KEY);
    if (raw) {
      const map = JSON.parse(raw) as Record<string, string>;
      if (map[matric]) return String(map[matric]).toLowerCase();
    }
  } catch {}
  // 2. Server lookup (works before sign-in — anon may call it).
  try {
    const { data } = await supabase.rpc('get_email_by_matric', { p_matric: matric });
    if (typeof data === 'string' && data.includes('@')) return data.toLowerCase();
  } catch {}
  return null;
}

/** Legacy wrapper: falls back to a derived address for accounts
 * created before emails. Prefer findStudentEmail for new code. */
export async function resolveStudentEmail(id: string): Promise<string> {
  const found = await findStudentEmail(id);
  if (found) return found;
  return `${id.trim().toLowerCase()}@uniabuja.edu.ng`;
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [role, setRole] = useState<Role>('student');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const passwordRef = useRef<any>(null);

  const signIn = async () => {
    setErr('');
    const id = role === 'staff' ? email.trim() : identifier.trim();
    if (!id || !password) {
      setErr(role === 'staff' ? 'Enter your email and password.' : 'Enter your matric number or email, plus password.');
      return;
    }
    setLoading(true);
    try {
      // Matric with no match anywhere is "not found" — never attempt
      // sign-in with a guessed address (that only yields a misleading
      // "invalid credentials" error).
      const loginEmail = role === 'staff'
        ? id.toLowerCase()
        : await findStudentEmail(id);
      if (!loginEmail) {
        setErr('That matric number was not found. Check it, or sign in with your email instead.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
        setErr('That account was not found. Check the matric/email and try again.');
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) {
        setErr(error.message);
        return;
      }
      // Email-confirmation accounts have user but no session — don't enter tabs.
      if (data.session && data.user) router.replace('/(tabs)');
      else if (data.user && !data.session) setErr('Check your email to confirm your account, then sign in.');
      else setErr('Could not sign in. Try again.');
    } catch {
      setErr('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/onboarding'))} hitSlop={10}>
            <MaterialIcons name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'} size={24} color="#1C1C1E" />
          </TouchableOpacity>

          <View style={styles.hero}>
            <View style={styles.logo}>
              <MaterialIcons name="directions-bus" size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.sub}>
              {role === 'staff' ? 'Sign in with your staff email to book shuttles.' : 'Sign in with your matric number or email to book shuttles.'}
            </Text>
          </View>

          <Segmented<Role>
            value={role}
            onChange={(v) => { setRole(v); setErr(''); setEmail(''); setIdentifier(''); setPassword(''); }}
            options={[
              { value: 'student', label: 'Student', icon: 'school' },
              { value: 'staff', label: 'Staff', icon: 'work' },
            ]}
          />

          <View style={{ height: 20 }} />

          {role === 'staff' ? (
            <View>
              <Text style={styles.label}>Email address</Text>
              <View style={styles.input}>
                <MaterialIcons name="email" size={20} color="#8E8E93" />
                <TextInput
                  style={styles.text}
                  placeholder="you@uniabuja.edu.ng"
                  placeholderTextColor="#8E8E93"
                  value={email}
                  onChangeText={(t) => { setEmail(t); setErr(''); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>Matric number or email</Text>
              <View style={styles.input}>
                <MaterialIcons name="badge" size={20} color="#8E8E93" />
                <TextInput
                  style={styles.text}
                  placeholder="e.g. UAB/2024/001"
                  placeholderTextColor="#8E8E93"
                  value={identifier}
                  onChangeText={(t) => { setIdentifier(t); setErr(''); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
              <Text style={styles.help}>Use the matric number from signup, or the email you signed up with.</Text>
            </View>
          )}

          <View style={{ height: 14 }} />
          <Text style={styles.label}>Password</Text>
          <View style={styles.input}>
            <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
            <TextInput
              ref={passwordRef}
              style={styles.text}
              placeholder="Enter your password"
              placeholderTextColor="#8E8E93"
              value={password}
              onChangeText={(t) => { setPassword(t); setErr(''); }}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={signIn}
            />
            <TouchableOpacity onPress={() => setShow(!show)} hitSlop={8}>
              <MaterialIcons name={show ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
            </TouchableOpacity>
          </View>

          {err ? (
            <View style={styles.errBox}>
              <MaterialIcons name="error-outline" size={17} color="#FF3B30" />
              <Text style={styles.errText}>{err}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.forgot} onPress={() => router.push('/forgot-password')}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <AppleButton title={loading ? 'Signing in…' : 'Sign In'} loading={loading} onPress={signIn} />

          <View style={styles.signup}>
            <Text style={styles.signupText}>New here? </Text>
            <TouchableOpacity onPress={() => router.push({ pathname: '/signup', params: { role } })}>
              <Text style={styles.signupLink}>Create account</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.secure}>
            <MaterialIcons name="verified-user" size={15} color="#8E8E93" />
            <Text style={styles.secureText}>Secured by Supabase Auth • Paystack checkout</Text>
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
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    borderWidth: 1, borderColor: '#E5E5EA',
  },
  hero: { alignItems: 'center', marginBottom: 20 },
  logo: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5,
  },
  title: { fontSize: 30, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.7 },
  sub: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginTop: 6, lineHeight: 21, paddingHorizontal: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8 },
  input: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA',
    minHeight: 54, gap: 10,
  },
  text: { flex: 1, fontSize: 17, color: '#1C1C1E', height: 52 },
  help: { fontSize: 13, color: '#8E8E93', marginTop: 7, marginLeft: 2 },
  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF1F0',
    borderWidth: 1, borderColor: '#FFD7D4', borderRadius: 12, padding: 12, marginTop: 14,
  },
  errText: { flex: 1, fontSize: 14, color: '#B3261E', lineHeight: 19 },
  forgot: { alignSelf: 'flex-end', paddingVertical: 12 },
  forgotText: { fontSize: 15, fontWeight: '600', color: GREEN },
  signup: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  signupText: { fontSize: 15, color: '#6B7280' },
  signupLink: { fontSize: 15, fontWeight: '700', color: GREEN },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22 },
  secureText: { fontSize: 12.5, color: '#8E8E93', fontWeight: '500' },
});
