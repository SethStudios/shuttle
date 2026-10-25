import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, BackHandler, Alert } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { formatPrice, getShuttlePrice, getTotalPrice, getShuttleLabel, type ShuttleType } from '@/constants/pricing';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION, formatSubscriptionPrice } from '@/constants/subscription';
import { initializePayment, verifyPayment, type PaymentStatus, type PaymentInitResult } from '@/services/payment';
import { saveDevBooking } from '@/hooks/useBookings';
import { getVerifyErrorMessage, shouldAutoRetryVerify } from '@/utils/tickets';
import { scheduleBoardingReminder } from '@/services/notifications';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { CALLBACK_BASE, VERIFY_RETRY_MS } from '@/constants/app';

const GREEN = UniAbujaGreen[700];
const PAYSTACK_HOSTS = ['paystack.com', 'paystack.co'];

function param(url: string, key: string): string | null {
  try {
    const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

export default function PaymentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { active: subActive, loading: subLoading } = useSubscription();
  const isStaff = (user as any)?.user_metadata?.role === 'staff';
  const params = useLocalSearchParams<{ shuttleType?: string; route?: string; boardingPeriod?: string }>();

  // CNG Bus (public ₦500) and Petrol Bus (private ₦700) — both bookable.
  const paramsValid =
    (params.shuttleType === 'public' || params.shuttleType === 'private') &&
    (params.route === 'main-to-mini' || params.route === 'mini-to-main') &&
    !!params.boardingPeriod &&
    /^\d{2}:00-\d{2}:00$/.test(params.boardingPeriod);
  const shuttleType = (params.shuttleType as ShuttleType) || 'public';
  const routeDirection = (params.route as 'main-to-mini' | 'mini-to-main') || 'main-to-mini';
  const boardingPeriod = params.boardingPeriod || '06:00-07:00';
  const routeLabel = routeDirection === 'main-to-mini' ? 'Main Campus → Mini Campus' : 'Mini Campus → Main Campus';
  const fare = getShuttlePrice(shuttleType);
  const total = getTotalPrice(shuttleType);

  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [paymentData, setPaymentData] = useState<PaymentInitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const webViewRef = useRef<WebView>(null);
  const processingRef = useRef(false);

  const [lastReference, setLastReference] = useState('');
  const handledRef = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  const cancelCheckout = useCallback(() => {
    processingRef.current = false;
    handledRef.current = null;
    setStatus('cancelled');
  }, []);


  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      // Never auto-cancel while verification is running.
      if (status === 'initializing' || status === 'checkout') {
        cancelCheckout();
        return true;
      }
      return false;
    });
    return () => h.remove();
  }, [status, cancelCheckout]);

  const checkoutHostOk = (uri: string) => {
    try {
      const host = new URL(uri).hostname.toLowerCase();
      return PAYSTACK_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  };

  const handlePay = useCallback(async () => {
    if (processingRef.current || status !== 'idle') return;
    if (!paramsValid) {
      setStatus('error');
      setErrorMessage('Booking details are missing. Please go back and choose your trip again.');
      return;
    }
    if (!subLoading && !subActive && !isStaff) {
      setStatus('error');
      setErrorMessage(`Active ${formatSubscriptionPrice(SUBSCRIPTION.price)} monthly subscription required. Subscribe first, then pay the trip fare.`);
      return;
    }
    processingRef.current = true;
    const email = user?.email || '';
    if (!email) {
      setStatus('error'); setErrorMessage('Please sign in to make a payment.');
      processingRef.current = false; return;
    }
    setStatus('initializing');
    try {
      const result = await initializePayment({ shuttleType, email, routeDirection, boardingPeriod });
      if (!checkoutHostOk(result.authorizationUrl)) {
        throw new Error('Payment service returned an unsafe checkout link. Please try again.');
      }
      setPaymentData(result);
      // Persist immediately so a WebView crash never loses the reference.
      setLastReference(result.reference);
      setStatus('checkout');
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Could not reach the payment service. Check your connection and try again.');
    }
    processingRef.current = false;
  }, [status, shuttleType, user, routeDirection, boardingPeriod, paramsValid, subActive, subLoading, isStaff]);

  // Function declaration (hoisted): handlePay's auto-retry timer and the
  // WebView callbacks reference this before its textual position, which
  // reads as use-before-declare under memoization. Identity churn is
  // harmless — only `source` navigates the WebView.
  const handleVerify = useCallback(async (reference: string) => {
    if (!reference || handledRef.current === reference) return;
    handledRef.current = reference;
    setLastReference(reference);
    processingRef.current = true;
    setStatus('verifying');
    try {
      const result = await verifyPayment(reference);
      if (result.verified) {
        setVerifyResult(result);
        setStatus('success');
        // Schedule 10-minute boarding reminder
        if (result.ticketId && result.travelDate && result.boardingPeriod) {
          const routeLabel = routeDirection === 'mini-to-main'
            ? 'Mini Campus → Main Campus'
            : 'Main Campus → Mini Campus';
          scheduleBoardingReminder({
            ticketId: result.ticketId,
            boardingPeriod: result.boardingPeriod,
            travelDate: result.travelDate,
            routeLabel,
            shuttleType,
          }).catch(() => {});
        }
      } else {
        // Keep the guard set: the second WebView callback for this same
        // reference must not double-verify. Manual retry resets it first.
        const msg = getVerifyErrorMessage(result.reason);
        setStatus('failed');
        setErrorMessage(msg);
        // One auto-retry for Paystack-side lag (transfer/USSD confirms late).
        if (shouldAutoRetryVerify(result.reason)) {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            handledRef.current = null;
            // Deferred self-call: this runs after commit, long after the
            // const above is initialized — safe despite the lexical order.
            // eslint-disable-next-line react-hooks/immutability
            handleVerify(reference);
          }, VERIFY_RETRY_MS);
        }
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || "Payment verification failed. If you paid, tap 'I've paid — verify'.");
    }
    processingRef.current = false;
  }, [routeDirection, shuttleType]);

  const onNav = useCallback((nav: WebViewNavigation) => {
    const url = nav.url;
    if (url.startsWith(CALLBACK_BASE)) {
      const ref = param(url, 'reference') || param(url, 'trxref');
      const st = param(url, 'status');
      if (ref) handleVerify(ref);
      else if (st === 'cancelled') cancelCheckout();
    }
  }, [handleVerify, cancelCheckout]);

  const shouldStart = useCallback((req: WebViewNavigation): boolean => {
    const url = req.url;
    if (url.startsWith(CALLBACK_BASE)) {
      const ref = param(url, 'reference') || param(url, 'trxref');
      const st = param(url, 'status');
      if (ref) { handleVerify(ref); return false; }
      if (st === 'cancelled') { cancelCheckout(); return false; }
    }
    return true;
  }, [handleVerify, cancelCheckout]);

  const retryVerify = useCallback(() => {
    const ref = lastReference || paymentData?.reference || '';
    if (!ref) {
      handledRef.current = null;
      setStatus('idle');
      return;
    }
    handledRef.current = null;
    handleVerify(ref);
  }, [lastReference, paymentData, handleVerify]);

  const retry = useCallback(() => {
    const startOver = () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      setStatus('idle'); setPaymentData(null); setErrorMessage('');
      setVerifyResult(null); setLastReference('');
      handledRef.current = null; processingRef.current = false;
    };
    // Starting over opens a NEW Paystack session. If the user already
    // paid, that is a double charge — force verify-first when a
    // reference exists.
    if (lastReference || paymentData?.reference) {
      Alert.alert(
        'Verify first?',
        'If you already paid, verify that payment instead. Starting over may charge you twice.',
        [
          { text: 'Verify payment', onPress: () => retryVerify() },
          { text: 'Start new payment', style: 'destructive', onPress: startOver },
        ]
      );
      return;
    }
    startOver();
  }, [lastReference, paymentData, retryVerify]);

  const viewTicket = useCallback(async () => {
    if (paymentData?.bookingId && verifyResult?.ticketId && user?.id) {
      try {
        await saveDevBooking({
          shuttleType, bookingId: paymentData.bookingId, reference: paymentData.reference || '',
          ticketId: verifyResult.ticketId, travelDate: verifyResult.travelDate || new Date().toISOString().slice(0, 10),
          boardingPeriod: verifyResult.boardingPeriod || boardingPeriod, queueNumber: verifyResult.queueNumber || 0, routeDirection,
          userId: user.id,
        });
      } catch {}
    }
    router.replace({
      pathname: '/ticket',
      params: {
        bookingId: paymentData?.bookingId || '', reference: paymentData?.reference || '', shuttleType,
        totalAmount: String(paymentData?.totalAmount || total), ticketId: verifyResult?.ticketId,
        travelDate: verifyResult?.travelDate, boardingPeriod: verifyResult?.boardingPeriod || boardingPeriod,
        queueNumber: String(verifyResult?.queueNumber || ''), route: routeDirection,
      },
    });
  }, [router, paymentData, shuttleType, total, verifyResult, routeDirection, boardingPeriod, user]);

  if (status === 'checkout' && paymentData) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={[styles.webHead, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.webClose} onPress={cancelCheckout} hitSlop={10}>
            <MaterialIcons name="close" size={21} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.webTitle}>Secure checkout</Text>
            <Text style={styles.webSub}>{formatPrice(total)} • Paystack</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <WebView
          ref={webViewRef}
          source={{ uri: paymentData.authorizationUrl }}
          style={{ flex: 1 }}
          onNavigationStateChange={onNav}
          onShouldStartLoadWithRequest={shouldStart}
          javaScriptEnabled
          originWhitelist={['https://*']}
          startInLoadingState
          onError={(e) => {
            const url = (e.nativeEvent as { url?: string }).url || '';
            // Callback host never resolves — capture ref, don't error.
            if (url.startsWith(CALLBACK_BASE)) {
              const ref = param(url, 'reference') || param(url, 'trxref');
              if (ref) handleVerify(ref);
              return;
            }
            setStatus('error');
            setErrorMessage("Checkout failed to load. Check your connection, then tap Try Again. If you already paid, use 'I've paid — verify'.");
          }}
          renderLoading={() => (
            <View style={styles.webLoading}><ActivityIndicator size="large" color={GREEN} /><Text style={styles.mut}>Loading Paystack…</Text></View>
          )}
        />
        <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.12)' }}>
          <AppleButton title="I've paid — verify" variant="plain" onPress={() => handleVerify(paymentData.reference)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.nav}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={10}>
            <MaterialIcons name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'} size={24} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={styles.securePill}>
            <MaterialIcons name="lock" size={13} color={GREEN} />
            <Text style={styles.secureT}>Paystack secured</Text>
          </View>
        </View>
        <Text style={styles.title}>Review & pay</Text>
        <Text style={styles.sub}>Confirm the details below, then complete payment.</Text>

        {status === 'idle' && (
          <>
            <View style={styles.card}>
              <View style={styles.merchant}>
                <View style={styles.mIcon}><MaterialIcons name="directions-bus" size={19} color="#FFFFFF" /></View>
                <View>
                  <Text style={styles.mName}>UniAbuja Shuttle</Text>
                  <Text style={styles.mSub}>{routeLabel}</Text>
                </View>
                <View style={styles.amt}><Text style={styles.amtT}>{formatPrice(total)}</Text></View>
              </View>
              <View style={styles.div} />
              {[
                ['Shuttle', getShuttleLabel(shuttleType)],
                ['Boarding window', boardingPeriod],
                ['Shuttle fare', formatPrice(fare)],
              ].map(([k, v]) => (
                <View key={k} style={styles.row}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v}</Text></View>
              ))}
              <View style={styles.div} />
              <View style={styles.row}><Text style={styles.totalK}>Total due</Text><Text style={styles.totalV}>{formatPrice(total)}</Text></View>
            </View>
            <AppleButton title={`Pay ${formatPrice(total)}`} icon="lock" onPress={handlePay} />
            {!subLoading && !subActive && !isStaff ? (
              <AppleButton title={`Subscribe (${formatSubscriptionPrice(SUBSCRIPTION.price)}/month) first`} variant="plain" onPress={() => router.push('/subscription' as any)} />
            ) : null}
            <Text style={styles.note}>{isStaff ? 'Staff booking — no subscription needed.' : `Monthly subscription (${formatSubscriptionPrice(SUBSCRIPTION.price)}) required.`} You will be taken to Paystack to pay with card, transfer or USSD. Your ticket appears instantly after payment.</Text>
          </>
        )}

        {status === 'initializing' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.cTitle}>Preparing checkout...</Text>
            <Text style={styles.mut}>Creating your secure Paystack session.</Text>
          </View>
        )}

        {status === 'verifying' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.cTitle}>Confirming payment…</Text>
            <Text style={styles.mut}>Please keep the app open.</Text>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.center}>
            <View style={[styles.badge, { backgroundColor: GREEN }]}>
              <MaterialIcons name="check" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.cTitle}>Payment successful</Text>
            <Text style={styles.mutCenter}>Your shuttle is booked. Show the QR ticket when boarding.</Text>
            {paymentData?.reference ? (
              <View style={styles.refBox}>
                <Text style={styles.refK}>REFERENCE</Text>
                <Text style={styles.refV}>{paymentData.reference}</Text>
              </View>
            ) : null}
            <View style={{ width: '100%', marginTop: 8 }}>
              <AppleButton title="View Ticket" icon="qr-code-2" onPress={viewTicket} />
            </View>
          </View>
        )}

        {status === 'cancelled' && (
          <View style={styles.center}>
            <View style={[styles.badge, { backgroundColor: '#FF9F0A' }]}>
              <MaterialIcons name="close" size={34} color="#FFFFFF" />
            </View>
            <Text style={styles.cTitle}>Payment cancelled</Text>
            <Text style={styles.mutCenter}>If you closed checkout before confirming, you were not charged. If you already paid, verify that payment below instead of starting a new one.</Text>
            <View style={{ width: '100%', gap: 4, marginTop: 8 }}>
              {(lastReference || paymentData?.reference) ? (
                <AppleButton title="I've paid — verify" onPress={retryVerify} />
              ) : null}
              <AppleButton title="Try Again" variant="plain" onPress={retry} />
              <AppleButton title="Back to Booking" variant="plain" onPress={() => router.back()} />
            </View>
          </View>
        )}

        {status === 'failed' && (
          <View style={styles.center}>
            <View style={[styles.badge, { backgroundColor: '#FF3B30' }]}>
              <MaterialIcons name="error-outline" size={34} color="#FFFFFF" />
            </View>
            <Text style={styles.cTitle}>Payment not confirmed</Text>
            <Text style={styles.mutCenter}>{errorMessage || 'Paystack did not confirm this transaction. If you paid, verify before paying again.'}</Text>
            <View style={{ width: '100%', gap: 4, marginTop: 8 }}>
              <AppleButton title="I've paid — verify" onPress={retryVerify} />
              <AppleButton title="Try Again" variant="plain" onPress={retry} />
              <Text style={styles.note}>Only start a new payment if verification finds no booking for your account.</Text>
            </View>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.center}>
            <View style={[styles.badge, { backgroundColor: '#636366' }]}>
              <MaterialIcons name="wifi-off" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.cTitle}>Something went wrong</Text>
            <Text style={styles.mutCenter}>{errorMessage}</Text>
            <View style={{ width: '100%', gap: 4, marginTop: 8 }}>
              {(lastReference || paymentData?.reference) ? (
                <AppleButton title="I've paid — verify" onPress={retryVerify} />
              ) : null}
              {/subscription/i.test(errorMessage) ? (
                <AppleButton title="Subscribe now" onPress={() => router.push('/subscription' as any)} />
              ) : null}
              <AppleButton title="Try Again" variant="plain" onPress={retry} />
              <AppleButton title="Back to Booking" variant="plain" onPress={() => router.back()} />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  securePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF6ED', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  secureT: { fontSize: 12.5, fontWeight: '700', color: GREEN },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#E9E9EE', marginBottom: 16 },
  merchant: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  mIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  mName: { fontSize: 16, fontWeight: '800', color: '#1C1C1E' },
  mSub: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  amt: { marginLeft: 'auto', backgroundColor: '#F0F9F3', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  amtT: { fontSize: 16, fontWeight: '800', color: GREEN },
  div: { height: 1, backgroundColor: '#F0F0F4', marginVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  k: { fontSize: 14.5, color: '#6B7280' },
  v: { fontSize: 14.5, fontWeight: '700', color: '#1C1C1E' },
  totalK: { fontSize: 16, fontWeight: '800', color: '#1C1C1E' },
  totalV: { fontSize: 22, fontWeight: '800', color: GREEN, letterSpacing: -0.5 },
  note: { fontSize: 13, color: '#8E8E93', lineHeight: 18, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
  center: { alignItems: 'center', paddingVertical: 30, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 22, borderWidth: 1, borderColor: '#E9E9EE' },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  cTitle: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.4, marginBottom: 6, textAlign: 'center' },
  mut: { fontSize: 14.5, color: '#6B7280', textAlign: 'center' },
  mutCenter: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  refBox: { backgroundColor: '#F2F2F7', borderRadius: 13, padding: 14, marginTop: 18, width: '100%', borderWidth: 1, borderColor: '#E5E5EA' },
  refK: { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.8, marginBottom: 4 },
  refV: { fontSize: 13, fontWeight: '700', color: '#1C1C1E' },
  webHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.12)' },
  webClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  webTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  webSub: { fontSize: 12.5, color: '#6B7280', fontWeight: '500' },
  webLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 10 },
});
