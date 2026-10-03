import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { AppleButton, ScreenHeader } from '@/components/ui/Apple';

// Hoisted: defining rows inside render remounts TextInputs every keystroke.
function Row({ label, value, set, ph, show, onToggle }: {
  label: string; value: string; set: (v: string) => void; ph: string;
  show: boolean; onToggle: () => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.input}>
        <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
        <TextInput style={styles.text} placeholder={ph} placeholderTextColor="#8E8E93"
          value={value} onChangeText={set} secureTextEntry={!show}
          autoCapitalize="none" autoCorrect={false} textContentType="password" />
        <TouchableOpacity onPress={onToggle} hitSlop={8} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
          <MaterialIcons name={show ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showNext2, setShowNext2] = useState(false);
  const [loading, setLoading] = useState(false);

  const valid = cur.length >= 6 && next.length >= 6 && next === next2 && cur !== next;

  const save = async () => {
    if (!valid) {
      Alert.alert('Check passwords', 'New password must be 6+ characters, match confirmation, and differ from current.');
      return;
    }
    setLoading(true);
    try {
      const { data, error: uErr } = await supabase.auth.getUser();
      if (uErr || !data.user?.email) {
        Alert.alert('Not signed in', 'Please sign in again to change your password.');
        return;
      }
      // Re-authenticate with current password before allowing the change.
      const { error: reErr } = await supabase.auth.signInWithPassword({
        email: data.user.email,
        password: cur,
      });
      if (reErr) {
        Alert.alert('Wrong password', 'Your current password is incorrect.');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        Alert.alert('Could not update', error.message);
        return;
      }
      Alert.alert('Done', 'Your password was changed.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch {
      Alert.alert('Error', 'Try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Change password" subtitle="Choose a strong password you don't use elsewhere." onBack={() => router.back()} />
          <Row label="Current password" value={cur} set={setCur} ph="Enter current password" show={showCur} onToggle={() => setShowCur(!showCur)} />
          <Row label="New password" value={next} set={setNext} ph="Minimum 6 characters" show={showNext} onToggle={() => setShowNext(!showNext)} />
          <Row label="Confirm new password" value={next2} set={setNext2} ph="Repeat new password" show={showNext2} onToggle={() => setShowNext2(!showNext2)} />
          {next.length > 0 && next.length < 6 ? <Text style={styles.err}>Use at least 6 characters.</Text> : null}
          {next2.length > 0 && next !== next2 ? <Text style={styles.err}>Passwords do not match.</Text> : null}
          {next.length >= 6 && cur === next ? <Text style={styles.err}>New password must differ from current.</Text> : null}
          <View style={{ height: 18 }} />
          <AppleButton title={loading ? 'Saving…' : 'Update Password'} loading={loading} disabled={!valid} icon="lock" onPress={save} />
          <AppleButton title="Cancel" variant="plain" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8 },
  input: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA', minHeight: 54, gap: 10,
  },
  text: { flex: 1, fontSize: 17, color: '#1C1C1E', height: 52 },
  err: { fontSize: 13, color: '#FF3B30', marginBottom: 6 },
});
