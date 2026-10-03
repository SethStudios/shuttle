import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { AppleButton, ScreenHeader } from '@/components/ui/Apple';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Recovery links expire and screens can be deep-linked directly.
  // Without a session, updateUser cannot succeed — say so up front.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    }).catch(() => setHasSession(false));
  }, []);

  const valid = next.length >= 6 && next === next2;

  const save = async () => {
    if (!valid) {
      Alert.alert('Check passwords', 'Password must be 6+ characters and match confirmation.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        Alert.alert('Reset failed', error.message);
        return;
      }
      if (data.user) {
        Alert.alert('Done', 'Your password was reset. You are signed in.', [
          { text: 'Continue', onPress: () => router.replace('/(tabs)') },
        ]);
      }
    } catch {
      Alert.alert('Error', 'This link may have expired. Request a new one.');
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
          <ScreenHeader title="Choose new password" subtitle="Enter the new password for your account." onBack={() => router.replace('/forgot-password')} />
          {hasSession === false ? (
            <View style={{ marginTop: 18 }}>
              <Text style={styles.err}>This reset link is invalid or expired.</Text>
              <Text style={styles.hint}>
                Tip: open the email link on the phone with the app installed — not in a desktop
                browser. Links work once and expire quickly, so request a fresh one below.
              </Text>
              <View style={{ height: 12 }} />
              <AppleButton title="Request a new link" icon="send" onPress={() => router.replace('/forgot-password')} />
            </View>
          ) : (
            <>
              <Text style={styles.label}>New password</Text>
              <View style={styles.input}>
                <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
                <TextInput style={styles.text} placeholder="Minimum 6 characters" placeholderTextColor="#8E8E93"
                  value={next} onChangeText={setNext} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                  textContentType="newPassword" returnKeyType="next" />
                <TouchableOpacity onPress={() => setShow(!show)} hitSlop={8} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                  <MaterialIcons name={show ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>Confirm new password</Text>
              <View style={styles.input}>
                <MaterialIcons name="lock-outline" size={20} color="#8E8E93" />
                <TextInput style={styles.text} placeholder="Repeat new password" placeholderTextColor="#8E8E93"
                  value={next2} onChangeText={setNext2} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                  textContentType="newPassword" returnKeyType="done" onSubmitEditing={save} />
                <TouchableOpacity onPress={() => setShow(!show)} hitSlop={8} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                  <MaterialIcons name={show ? 'visibility' : 'visibility-off'} size={20} color="#8E8E93" />
                </TouchableOpacity>
              </View>
              {next2.length > 0 && next !== next2 ? <Text style={styles.err}>Passwords do not match.</Text> : null}
              <View style={{ height: 18 }} />
              <AppleButton title={loading ? 'Saving…' : 'Reset Password'} loading={loading} disabled={!valid || hasSession !== true} icon="lock" onPress={save} />
            </>
          )}
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
  err: { fontSize: 13, color: '#FF3B30', marginTop: 6 },
  hint: { fontSize: 13.5, color: '#6B7280', lineHeight: 19, marginTop: 8 },
});
