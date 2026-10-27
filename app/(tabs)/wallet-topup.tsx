import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { CustomAlert } from '@/components/ui/CustomAlert';
import { CALLBACK_BASE } from '@/constants/app';

const GREEN = UniAbujaGreen[700];

const TOP_UP_AMOUNTS = [500, 1000, 2000, 5000, 10000];

export default function WalletTopUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [reference, setReference] = useState('');
  const [webError, setWebError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  // Custom alert states
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [alertOnConfirm, setAlertOnConfirm] = useState(() => () => {});

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');

  const amountToUse = selectedAmount || (customAmount ? parseFloat(customAmount) : 0);

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', onConfirm: () => void = () => {}) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertType(type);
    setAlertOnConfirm(onConfirm);
    setAlertVisible(true);
  };

  const handleTopUp = async () => {
    if (!amountToUse || amountToUse < 100) {
      showAlert('Invalid amount', 'Please enter an amount of ₦100 or more.', 'error');
      return;
    }
    if (!user) return;

    setLoading(true);
    setWebError(null);
    try {
      const { data, error } = await supabase.functions.invoke('wallet-top-up', {
        body: { amount: amountToUse },
      });
      if (error) throw new Error(error.message || 'Top up initialization failed');
      if (!data?.success) throw new Error(data?.error || 'Could not start top up.');

      setCheckoutUrl(data.data.authorization_url);
      setReference(data.data.reference);
    } catch (err: any) {
      showAlert('Top up failed', err?.message || 'Could not start top up. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const verifyPayment = async (ref: string) => {
    if (verified) return; // Prevent double verification
    setVerified(true);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wallet-verify', {
        body: { reference: ref },
      });
      if (error) throw new Error(error.message || 'Verification failed');
      if (!data?.verified) {
        showAlert('Payment not confirmed', data?.reason || 'Paystack did not confirm this payment.', 'error', () => {
          setCheckoutUrl('');
          setVerified(false);
        });
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      showAlert('Wallet Topped Up', `₦${amountToUse.toLocaleString()} has been added to your wallet.`, 'success', () => {
        setCheckoutUrl('');
        setReference('');
        setVerified(false);
        router.replace('/(tabs)/wallet');
      });
    } catch (err: any) {
      showAlert('Verification failed', err?.message || 'Could not verify payment.', 'error', () => {
        setVerified(false);
      });
    } finally {
      setLoading(false);
    }
  };

  const onNav = useCallback(
    (nav: WebViewNavigation) => {
      if (nav.url.startsWith(CALLBACK_BASE)) {
        const m = nav.url.match(/[?&](reference|trxref)=([^&#]+)/);
        if (m) {
          const ref = decodeURIComponent(m[2]);
          verifyPayment(ref);
        }
      }
    },
    [verifyPayment]
  );

  const onWebError = useCallback(
    (e: { nativeEvent: { url?: string; message?: string } }) => {
      const url = (e.nativeEvent as { url?: string; message?: string }).url || '';
      const msg = (e.nativeEvent as { url?: string; message?: string }).message || '';
      setWebError(msg || `Failed to load: ${url}`);
    },
    []
  );

  if (loading && !checkoutUrl) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Preparing checkout…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* WebView overlay for Paystack checkout */}
      {checkoutUrl && (
        <View style={styles.webviewOverlay}>
          <View style={styles.webviewHeader}>
            <TouchableOpacity style={styles.webClose} onPress={() => { setCheckoutUrl(''); setReference(''); setWebError(null); setVerified(false); }}>
              <MaterialIcons name="close" size={24} color="#1C1C1E" />
            </TouchableOpacity>
            <Text style={styles.webTitle}>Secure Checkout</Text>
          </View>
          {webError ? (
            <View style={styles.webErrorView}>
              <MaterialIcons name="wifi-off" size={48} color="#FF3B30" />
              <Text style={styles.webErrorText}>{webError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setWebError(null); setVerified(false); }}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <WebView
              source={{ uri: checkoutUrl }}
              style={styles.webview}
              javaScriptEnabled
              originWhitelist={['https://*']}
              onNavigationStateChange={onNav}
              onError={onWebError}
              onHttpError={onWebError}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webLoading}>
                  <ActivityIndicator size="large" color={GREEN} />
                  <Text style={styles.webLoadingText}>Loading Paystack…</Text>
                </View>
              )}
            />
          )}
        </View>
      )}

      {!checkoutUrl && (
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.nav}>
            <TouchableOpacity style={styles.back} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={24} color="#1C1C1E" />
            </TouchableOpacity>
            <Text style={styles.title}>Add Funds</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Amount to Deposit</Text>
            <View style={styles.amountRow}>
              {TOP_UP_AMOUNTS.map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={[styles.amountBtn, selectedAmount === amt && styles.amountBtnSelected]}
                  onPress={() => {
                    setSelectedAmount(selectedAmount === amt ? null : amt);
                    if (selectedAmount === amt) setCustomAmount('');
                    else setCustomAmount('');
                  }}
                >
                  <Text style={[styles.amountText, selectedAmount === amt && styles.amountTextSelected]}>
                    ₦{amt.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.customInputRow}>
              <Text style={styles.customInputLabel}>Or enter custom amount</Text>
              <View style={styles.customInputWrap}>
                <Text style={styles.currencyPrefix}>₦</Text>
                <TextInput
                  style={styles.customInput}
                  value={customAmount}
                  onChangeText={setCustomAmount}
                  placeholder="0"
                  keyboardType="numeric"
                />
              </View>
            </View>
            {amountToUse > 0 && (
              <Text style={styles.depositSummary}>
                You are depositing: <Text style={styles.depositAmount}>₦{amountToUse.toLocaleString()}</Text>
              </Text>
            )}
            <AppleButton
              title={loading ? 'Processing…' : 'Continue to Paystack'}
              loading={loading}
              disabled={amountToUse < 100 || loading}
              onPress={handleTopUp}
              variant="primary"
            />
            <Text style={styles.bankTransferNote}>
              You can pay with card or bank transfer on Paystack
            </Text>
          </View>
        </ScrollView>
      )}

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
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: '#E9E9EE', marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#6B7280', marginBottom: 16 },
  amountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  amountBtn: {
    flex: 1,
    minWidth: 72,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  amountBtnSelected: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  amountText: { fontSize: 14, fontWeight: '700', color: '#1C1C1E' },
  amountTextSelected: { color: '#FFFFFF' },
  customInputRow: { marginTop: 16, marginBottom: 16 },
  customInputLabel: { fontSize: 13, color: '#6B7280', marginBottom: 8 },
  customInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, height: 52, borderWidth: 1, borderColor: '#E5E5EA' },
  currencyPrefix: { fontSize: 17, fontWeight: '800', color: '#1C1C1E', marginLeft: 12 },
  customInput: { flex: 1, color: '#1C1C1E', fontSize: 17, marginRight: 12 },
  depositSummary: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 12 },
  depositAmount: { fontWeight: '800', color: GREEN },
  bankTransferNote: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
  // WebView overlay
  webviewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 100,
  },
  webviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  webClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  webTitle: { fontSize: 18, fontWeight: '800', color: '#1C1C1E' },
  webview: { flex: 1 },
  webLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 101,
  },
  webLoadingText: { marginTop: 12, color: '#6B7280' },
  webErrorView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  webErrorText: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 16, marginBottom: 20 },
  retryBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700' },
});
