import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton, ScreenHeader } from '@/components/ui/Apple';

const GREEN = UniAbujaGreen[700];

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState('');

  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const startCooldown = () => {
    setCooldown(60);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const send = async () => {
    if (cooldown > 0 || loading) return;
    setFormError('');
    // Email only: password recovery must not depend on matric routing.
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setFormError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(clean, {
        redirectTo: 'uniabujashuttle://reset-password',
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      setEmail(clean);
      setSent(true);
      startCooldown();
    } catch {
      setFormError('Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={[styles.body, { paddingTop: insets.top + 60 }]}>
          <View style={styles.done}>
            <MaterialIcons name="mark-email-read" size={44} color={GREEN} />
          </View>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.sub}>We sent a reset link to{'\n'}<Text style={styles.bold}>{email.trim().toLowerCase()}</Text></Text>
          <Text style={styles.note}>Open the link on this phone, with the app installed — not in a desktop browser. Check spam if you do not see it.</Text>
          <AppleButton title="Back to Sign In" onPress={() => router.replace('/auth')} />
          <TouchableOpacity style={styles.ghost} onPress={() => setSent(false)}>
            <Text style={styles.ghostText}>Use a different email{cooldown > 0 ? ` (resend in ${cooldown}s)` : ''}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Reset password" subtitle="Enter your account email and we will send you a secure reset link." onBack={() => router.back()} />
          <Text style={styles.label}>Email address</Text>
          <View style={styles.input}>
            <MaterialIcons name="email" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="you@uniabuja.edu.ng" placeholderTextColor="#8E8E93"
              value={email} onChangeText={(v) => { setEmail(v); setFormError(''); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Email address" autoComplete="email" returnKeyType="send" onSubmitEditing={send} />
          </View>
          {formError ? (
            <Text style={styles.err} accessibilityLiveRegion="polite">{formError}</Text>
          ) : null}
          <View style={{ height: 20 }} />
          <AppleButton
            title={loading ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send Reset Link'}
            loading={loading}
            disabled={cooldown > 0}
            icon="send"
            onPress={send}
          />
          <View style={styles.row}>
            <Text style={styles.muted}>Remember it? </Text>
            <TouchableOpacity onPress={() => router.back()}><Text style={styles.link}>Sign in</Text></TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8 },
  err: { fontSize: 13, color: '#FF3B30', marginTop: 8, lineHeight: 18 },
  input: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA', minHeight: 54, gap: 10,
  },
  text: { flex: 1, fontSize: 17, color: '#1C1C1E', height: 52 },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  muted: { fontSize: 15, color: '#6B7280' },
  link: { fontSize: 15, fontWeight: '700', color: GREEN },
  done: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#EAF6ED',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20,
    borderWidth: 1, borderColor: '#D2ECD8',
  },
  title: { fontSize: 28, fontWeight: '800', color: '#1C1C1E', textAlign: 'center', letterSpacing: -0.6 },
  sub: { fontSize: 16, color: '#6B7280', textAlign: 'center', marginTop: 10, lineHeight: 23 },
  bold: { fontWeight: '700', color: '#1C1C1E' },
  note: { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginVertical: 16, lineHeight: 20, paddingHorizontal: 12 },
  ghost: { paddingVertical: 14, alignItems: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: GREEN },
});
