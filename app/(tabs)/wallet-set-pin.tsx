import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { CustomAlert } from '@/components/ui/CustomAlert';

const GREEN = UniAbujaGreen[700];
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function WalletSetPinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  // Custom alert states
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [alertOnConfirm, setAlertOnConfirm] = useState(() => () => {});

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', onConfirm: () => void = () => {}) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertType(type);
    setAlertOnConfirm(onConfirm);
    setAlertVisible(true);
  };

  const savePin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('wallet_set_pin', {
        p_user_id: user!.id,
        p_pin: pin,
      });
      if (error) throw error;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      showAlert('PIN set', 'Your wallet PIN has been created. You can now transfer funds.', 'success', () => {
        router.replace('/(tabs)/wallet');
      });
    } catch (err: any) {
      showAlert('PIN setup failed', err?.message || 'Could not set PIN.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addDigit = (digit: string) => {
    if (isConfirming) {
      if (confirmPin.length < 4) {
        setConfirmPin(confirmPin + digit);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    } else {
      if (pin.length < 4) {
        setPin(pin + digit);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    }
  };

  const removeDigit = () => {
    if (isConfirming) {
      if (confirmPin.length > 0) {
        setConfirmPin(confirmPin.slice(0, -1));
      }
    } else {
      if (pin.length > 0) {
        setPin(pin.slice(0, -1));
      }
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Setting up PIN…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color="#1C1C1E" />
          </TouchableOpacity>
          <Text style={styles.title}>Set Wallet PIN</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.card}>
          <View style={styles.headerText}>
            <Text style={styles.modalTitle}>
              {isConfirming ? 'Confirm your PIN' : 'Create your wallet PIN'}
            </Text>
            <Text style={styles.subtitle}>
              {isConfirming ? 'Enter your PIN again to confirm' : 'This PIN will be used to authorize wallet transfers'}
            </Text>
          </View>

          {/* PIN Circles */}
          <View style={styles.pinRow}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.pinBox, (isConfirming ? confirmPin : pin).length > i && styles.pinBoxFilled]}>
                {(isConfirming ? confirmPin : pin).length > i && <Text style={styles.pinText}>•</Text>}
              </View>
            ))}
          </View>

          {/* Numeric Keypad */}
          <View style={styles.keypad}>
            {['1', '2', '3'].map((d) => (
              <TouchableOpacity
                key={d}
                style={styles.keyBtn}
                onPress={() => addDigit(d)}
                activeOpacity={0.8}
              >
                <Text style={styles.keyText}>{d}</Text>
              </TouchableOpacity>
            ))}
            {['4', '5', '6'].map((d) => (
              <TouchableOpacity
                key={d}
                style={styles.keyBtn}
                onPress={() => addDigit(d)}
                activeOpacity={0.8}
              >
                <Text style={styles.keyText}>{d}</Text>
              </TouchableOpacity>
            ))}
            {['7', '8', '9'].map((d) => (
              <TouchableOpacity
                key={d}
                style={styles.keyBtn}
                onPress={() => addDigit(d)}
                activeOpacity={0.8}
              >
                <Text style={styles.keyText}>{d}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.keyBtn} />
            <TouchableOpacity
              key="0"
              style={styles.keyBtn}
              onPress={() => addDigit('0')}
              activeOpacity={0.8}
            >
              <Text style={styles.keyText}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.keyBtn, styles.keyDelete]}
              onPress={removeDigit}
              activeOpacity={0.8}
            >
              <MaterialIcons name="backspace" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>

          {/* Auto-advance: when 4 digits entered, switch to confirm */}
          {pin.length === 4 && !isConfirming && (
            <View style={styles.autoAdvanceBox}>
              <Text style={styles.autoAdvanceText}>PIN entered. Confirm below.</Text>
            </View>
          )}

          {/* Continue / Confirm Button */}
          <View style={{ marginTop: 32 }}>
            <AppleButton
              title={isConfirming ? 'Confirm PIN' : 'Continue'}
              loading={loading}
              disabled={loading || (isConfirming ? confirmPin.length !== 4 : pin.length !== 4)}
              onPress={() => {
                if (isConfirming) {
                  savePin();
                } else {
                  setIsConfirming(true);
                }
              }}
              variant="primary"
            />
            <Text style={styles.hintText}>
              {isConfirming ? 'Enter your PIN again to confirm' : 'Create a 4-digit PIN'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Custom Alert */}
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        type={alertType}
        onConfirm={alertOnConfirm}
        loading={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, marginBottom: 24, width: '100%' },
  headerText: { marginBottom: 32 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  pinRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 40,
  },
  pinBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E5E5EA',
  },
  pinBoxFilled: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  pinText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  keypad: {
    marginTop: 16,
  },
  keyBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDelete: {
    backgroundColor: '#FFF5F5',
  },
  keyText: { fontSize: 26, fontWeight: '700', color: '#1C1C1E' },
  autoAdvanceBox: {
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F0F9F3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CDE8D3',
  },
  autoAdvanceText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  hintText: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 12 },
});
