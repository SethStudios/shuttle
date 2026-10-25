/**
 * Web-only Payment Screen — redirects to Paystack instead of using WebView.
 * Only included in `expo export -p web` builds via Expo's platform resolver.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { formatPrice, getShuttlePrice, getTotalPrice, getShuttleLabel, type ShuttleType } from '@/constants/pricing';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION, formatSubscriptionPrice } from '@/constants/subscription';
import { initializePayment, verifyPayment, type PaymentStatus, type PaymentInitResult } from '@/services/payment';
import { saveDevBooking } from '@/hooks/useBookings';
import { getVerifyErrorMessage } from '@/utils/tickets';
import { scheduleBoardingReminder } from '@/services/notifications';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';

const GREEN = UniAbujaGreen[700];
const CALLBACK_BASE = 'https://uniabujashuttle.app/payment-callback';

function param(url: string, key: string): string | null {
  try {
    const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

export default function PaymentScreenWeb() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { active: subActive, loading: subLoading } = useSubscription();
  const isStaff = (user as any)?.user_metadata?.role === 'staff';
  const params = useLocalSearchParams<{ shuttleType?: string; route?: string; boardingPeriod?: string }>();

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

  const [lastReference, setLastReference] = useState('');
  const handledRef = useRef<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  // Check for callback params on mount (web redirect from Paystack)
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('reference') || urlParams.get('trxref');
      const st = urlParams.get('status');
      if (ref) {
        handleVerify(ref);
      } else if (st === 'cancelled') {
        cancelCheckout();
      }
    }
    return () => { mountedRef.current = false; };
  }, []);

  const cancelCheckout = useCallback(() => {
    processingRef.current = false;
    handledRef.current = null;
    setStatus('cancelled');
  }, []);

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
      if (!mountedRef.current) { processingRef.current = false; return; }
      setPaymentData(result);
      setLastReference(result.reference);
      setStatus('checkout');
      // On web, redirect to Paystack
      if (typeof window !== 'undefined') {
        window.location.href = result.authorizationUrl;
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setStatus('error');
        setErrorMessage(err?.message || 'Could not reach the payment service. Check your connection and try again.');
      }
    }
    processingRef.current = false;
  }, [status, shuttleType, user, routeDirection, boardingPeriod, paramsValid, subActive, subLoading, isStaff]);

  const handleVerify = useCallback(async (reference: string) => {
    if (!reference || handledRef.current === reference) return;
    handledRef.current = reference;
    setLastReference(reference);
    processingRef.current = true;
    setStatus('verifying');
    try {
      const result = await verifyPayment(reference);
      if (!mountedRef.current) { processingRef.current = false; return; }
      if (result.verified) {
        setVerifyResult(result);
        setStatus('success');
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
        const msg = getVerifyErrorMessage(result.reason);
        setStatus('failed');
        setErrorMessage(msg);
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setStatus('error');
        setErrorMessage(err?.message || "Payment verification failed. If you paid, tap 'I've paid — verify'.");
      }
    }
    processingRef.current = false;
  }, [routeDirection, shuttleType]);

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

  const startOver = useCallback(() => {
    setStatus('idle');
    setPaymentData(null);
    setErrorMessage('');
    setVerifyResult(null);
    setLastReference('');
    handledRef.current = null;
    processingRef.current = false;
  }, []);

  const retry = useCallback(() => {
    if (lastReference || paymentData?.reference) {
      setShowConfirm(true);
      return;
    }
    startOver();
  }, [lastReference, paymentData, startOver]);

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

  // Checkout state — show redirect message
  if (status === 'checkout' && paymentData) {
    return (
      <View style={styles.root}>
        <View style={[styles.webHead, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.webClose} onPress={cancelCheckout} hitSlop={10}>
            <MaterialIcons name="close" size={21} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.webTitle}>Redirecting to Paystack…</Text>
            <Text style={styles.webSub}>{formatPrice(total)} • Secure checkout</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={styles.cTitle}>Opening payment page</Text>
          <Text style={styles.mut}>If it doesn\'t open, <Text style={styles.link} onPress={() => { if (typeof window !== 'undefined') window.open(paymentData.authorizationUrl, '_blank'); }}>tap here</Text>.</Text>
        </View>
        <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.12)' }}>
          <AppleButton title="I've paid — verify" variant="plain" onPress={() => handleVerify(paymentData.reference)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
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
            <Text style={styles.note}>{isStaff ? 'Staff booking — no subscription needed.' : `Monthly subscription (${formatSubscriptionPrice(SUBSCRIPTION.price)}) required.`} You will be redirected to Paystack to pay with card, transfer or USSD. Your ticket appears instantly after payment.</Text>
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
            <Text style={styles.mut}>Please keep this page open.</Text>
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

      {showConfirm && (
        <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowConfirm(false)} activeOpacity={1}>
          <TouchableOpacity onPress={() => {}} activeOpacity={1}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Verify first?</Text>
              <Text style={styles.modalMessage}>
                If you already paid, verify that payment instead. Starting over may charge you twice.
              </Text>
              <View style={styles.modalButtons}>
                <AppleButton
                  title="Verify payment"
                  onPress={() => { setShowConfirm(false); retryVerify(); }}
                  variant="plain"
                />
                <AppleButton
                  title="Start new payment"
                  onPress={() => { setShowConfirm(false); startOver(); }}
                  variant="plain"
                  style={{ marginTop: 10 }}
                />
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7', position: 'relative' },
  body: { paddingHorizontal: 18 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  securePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF6ED', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  secureT: { fontSize: 12, fontWeight: '700', color: GREEN },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22, marginBottom: 16, borderWidth: 1, borderColor: '#E9E9EE' },
  merchant: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  mIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  mName: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  mSub: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  amt: { marginLeft: 'auto' },
  amtT: { fontSize: 26, fontWeight: '800', color: '#1C1C1E' },
  div: { height: 1, backgroundColor: '#F0F0F4', marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  k: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  v: { fontSize: 15, color: '#1C1C1E', fontWeight: '700' },
  totalK: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  totalV: { fontSize: 22, fontWeight: '800', color: GREEN },
  note: { fontSize: 13, color: '#8E8E93', marginTop: 10, textAlign: 'center', lineHeight: 20 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 14 },
  cTitle: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', textAlign: 'center' },
  mut: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
  mutCenter: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
  link: { color: GREEN, fontWeight: '700', textDecorationLine: 'underline' },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  refBox: { backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  refK: { fontSize: 11, color: '#8E8E93', fontWeight: '700', letterSpacing: 0.5 },
  refV: { fontSize: 14, fontFamily: 'monospace', fontWeight: '700', color: '#1C1C1E', marginTop: 2 },
  webHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 },
  webClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  webTitle: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  webSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  webLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    width: '88%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#E9E9EE',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14.5,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  modalButtons: {
    width: '100%',
    gap: 10,
  },
});