import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { AppleButton, ScreenHeader } from '@/components/ui/Apple';

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.full_name || '');
  const [phone, setPhone] = useState(user?.user_metadata?.phone_number || '');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const digits = phone.replace(/\D/g, '');
  const nameBad = name.length > 0 && name.trim().length <= 1;
  const phoneBad = phone.length > 0 && (digits.length < 7 || digits.length > 15);
  const valid = name.trim().length > 1 && digits.length >= 7 && digits.length <= 15;

  const save = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setFormError('');
    try {
      const { data, error } = await supabase.rpc('update_own_profile', {
        p_full_name: name.trim(),
        p_phone_number: phone.trim(),
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data?.ok) {
        const why: Record<string, string> = {
          bad_name: 'Please enter your full name.',
          bad_phone: 'Please enter a valid phone number (7-15 digits).',
          no_profile: 'Profile not found. Contact support.',
          not_authenticated: 'Please sign in again.',
        };
        setFormError(why[data?.reason] || 'Please try again.');
        return;
      }
      // Keep sign-in metadata in sync so the new name shows immediately.
      await supabase.auth.updateUser({
        data: { full_name: name.trim(), phone_number: phone.trim() },
      }).catch(() => {});
      Alert.alert('Saved', 'Your profile was updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      setFormError('Check your connection and try again.');
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
          <ScreenHeader title="Edit profile" subtitle="Only your name and phone number can be changed here." onBack={() => router.back()} />
          <Text style={styles.label}>Full name</Text>
          <View style={styles.input}>
            <MaterialIcons name="person-outline" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="e.g. Amina Yusuf" placeholderTextColor="#8E8E93"
              value={name} onChangeText={(v) => { setName(v); setFormError(''); }} autoCapitalize="words"
              autoComplete="name" textContentType="name" returnKeyType="next"
              accessibilityLabel="Full name" />
          </View>
          {nameBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Enter your full name.</Text> : null}
          <Text style={styles.label}>Phone number</Text>
          <View style={styles.input}>
            <MaterialIcons name="phone" size={20} color="#8E8E93" />
            <TextInput style={styles.text} placeholder="080…" placeholderTextColor="#8E8E93"
              value={phone} onChangeText={(v) => { setPhone(v); setFormError(''); }} keyboardType="phone-pad"
              autoComplete="tel" textContentType="telephoneNumber" returnKeyType="done" onSubmitEditing={save}
              accessibilityLabel="Phone number" />
          </View>
          {phoneBad ? <Text style={styles.err} accessibilityLiveRegion="polite">Enter a valid phone number (7-15 digits).</Text> : null}
          <Text style={styles.hint}>Matric number, email, and role cannot be changed here. Contact support if they are wrong.</Text>
          {formError ? (
            <Text style={styles.errCenter} accessibilityLiveRegion="polite">{formError}</Text>
          ) : null}
          {!valid && !loading ? (
            <Text style={styles.hintCenter}>Enter your full name and a valid phone number to enable saving.</Text>
          ) : null}
          <View style={{ height: 18 }} />
          <AppleButton title={loading ? 'Saving…' : 'Save Changes'} loading={loading} disabled={!valid} icon="check" onPress={save} />
          <AppleButton title="Cancel" variant="plain" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8, marginTop: 12 },
  input: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA', minHeight: 54, gap: 10,
  },
  text: { flex: 1, fontSize: 17, color: '#1C1C1E', height: 52 },
  err: { fontSize: 13, color: '#FF3B30', marginTop: 6, lineHeight: 18 },
  errCenter: { fontSize: 13.5, color: '#FF3B30', textAlign: 'center', lineHeight: 18, marginTop: 12 },
  hintCenter: { fontSize: 13, color: '#8E8E93', textAlign: 'center', marginTop: 10, lineHeight: 18 },
  hint: { fontSize: 13, color: '#8E8E93', marginTop: 10, lineHeight: 18 },
});
