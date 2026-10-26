import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { initializeSubscription, verifySubscription } from '@/services/subscription';
import { SUBSCRIPTION, formatSubscriptionPrice, daysLeftInSubscription } from '@/constants/subscription';
import { CALLBACK_BASE } from '@/constants/app';
import { AppleButton } from '@/components/ui/Apple';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { subscription, active, loading: subLoading, refresh } = useSubscription();

  const [status, setStatus] = useState<'idle' | 'initializing' | 'checkout' | 'verifying' | 'success' | 'error'>('idle');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [reference, setReference] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const handledRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    const email = user?.email || '';
    if (!email) {
      setStatus('error');
      setErrorMessage('Please sign in to subscribe.');
      return;
    }
    handledRef.current = null;
    setStatus('initializing');
    setErrorMessage('');
    try {
      const result = await initializeSubscription(email);
      setCheckoutUrl(result.authorizationUrl);
      setReference(result.reference);
      setStatus('checkout');
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Could not start subscription payment.');
    }
  }, [user]);

  const verify = useCallback(
    async (ref: string) => {
      if (!ref || handledRef.current === ref) return;
      handledRef.current = ref;
      setStatus('verifying');
      try {
        const result = await verifySubscription(ref);
        if (result.verified) {
          setStatus('success');
          await refresh();
        } else {
          setStatus('error');
          setErrorMessage(`Paystack did not confirm this payment (${result.reason || 'unknown'}). If you paid, try Verify again.`);
        }
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err?.message || 'Verification failed.');
      }
    },
    [refresh]
  );

  const onNav = useCallback(
    (nav: WebViewNavigation) => {
      if (nav.url.startsWith(CALLBACK_BASE)) {
        const m = nav.url.match(/[?&](reference|trxref)=([^&#]+)/);
        if (m) verify(decodeURIComponent(m[2]));
      }
    },
    [verify]
  );

  const onShouldStart = useCallback(
    (req: WebViewNavigation): boolean => {
      if (req.url.startsWith(CALLBACK_BASE)) {
        const m = req.url.match(/[?&](reference|trxref)=([^&#]+)/);
        if (m) verify(decodeURIComponent(m[2]));
        return false;
      }
      return true;
    },
    [verify]
  );

  const onWebError = useCallback(
    (e: { nativeEvent: { url?: string } }) => {
      const url = (e.nativeEvent as { url?: string }).url || '';
      // Callback host never resolves (no real site) — capture ref, don't error.
      if (url.startsWith(CALLBACK_BASE)) {
        const m = url.match(/[?&](reference|trxref)=([^&#]+)/);
        if (m) verify(decodeURIComponent(m[2]));
      }
    },
    [verify]
  );

  if (status === 'checkout') {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <View style={[styles.webHead, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.webClose} onPress={() => setStatus('idle')} hitSlop={10}>
            <MaterialIcons name="close" size={21} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.webTitle}>Subscription checkout</Text>
            <Text style={styles.webSub}>{formatSubscriptionPrice(SUBSCRIPTION.price)} • Paystack</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          style={{ flex: 1 }}
          onNavigationStateChange={onNav}
          onShouldStartLoadWithRequest={onShouldStart}
          onError={onWebError}
          onHttpError={onWebError}
          javaScriptEnabled
          originWhitelist={['https://*']}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color={GREEN} />
              <Text style={styles.mut}>Loading Paystack…</Text>
            </View>
          )}
        />
        <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) }}>
          <AppleButton title="I've paid — verify" variant="plain" onPress={() => verify(reference)} />
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
        <Text style={styles.title}>Monthly subscription</Text>
        <Text style={styles.sub}>₦1,000 for 30 days. Required to book any shuttle.</Text>

        <View style={styles.card}>
          <View style={styles.merchant}>
            <View style={styles.mIcon}>
              <MaterialIcons name="card-membership" size={19} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.mName}>UniAbuja Shuttle Pass</Text>
              <Text style={styles.mSub}>30 days • all routes</Text>
            </View>
            <View style={styles.amt}>
              <Text style={styles.amtT}>{formatSubscriptionPrice(SUBSCRIPTION.price)}</Text>
            </View>
          </View>
          <View style={styles.div} />
          <View style={styles.row}>
            <Text style={styles.k}>Status</Text>
            <Text style={styles.v}>{subLoading ? 'Checking…' : active ? `Active (${daysLeftInSubscription(subscription)} days left)` : 'Not active'}</Text>
          </View>
          {subscription?.expires_at ? (
            <View style={styles.row}>
              <Text style={styles.k}>Expires</Text>
              <Text style={styles.v}>{new Date(subscription.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </View>
          ) : null}
          <View style={styles.div} />
          <View style={styles.row}>
            <Text style={styles.totalK}>Total due</Text>
            <Text style={styles.totalV}>{formatSubscriptionPrice(SUBSCRIPTION.price)}</Text>
          </View>
        </View>

        {status === 'initializing' || status === 'verifying' ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.cTitle}>{status === 'initializing' ? 'Preparing checkout...' : 'Confirming payment…'}</Text>
            <Text style={styles.mut}>Please keep the app open.</Text>
          </View>
        ) : status === 'success' ? (
          <View style={styles.center}>
            <View style={[styles.badge, { backgroundColor: GREEN }]}>
              <MaterialIcons name="check" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.cTitle}>Subscription active</Text>
            <Text style={styles.mutCenter}>You can now book shuttles. Trip fare ₦500 still applies per ride.</Text>
            <View style={{ width: '100%', marginTop: 8 }}>
              <AppleButton title="Book a shuttle" icon="directions-bus" onPress={() => router.replace('/booking')} />
            </View>
          </View>
        ) : subLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.cTitle}>Checking subscription…</Text>
          </View>
        ) : (
          <>
            {status === 'error' ? <Text style={styles.err}>{errorMessage}</Text> : null}
            <AppleButton title={active ? `Cancel Subscription` : `Subscribe (${formatSubscriptionPrice(SUBSCRIPTION.price)})`} icon="lock" onPress={() => { if (!active) start(); }} />
            {reference ? <AppleButton title="I've paid — verify" variant="plain" onPress={() => verify(reference)} /> : null}
            <Text style={styles.note}>You will be taken to Paystack to pay with card, transfer or USSD. Your subscription activates instantly after payment.</Text>
          </>
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
  totalV: { fontSize: 22, fontWeight: '800', color: GREEN },
  note: { fontSize: 13, color: '#8E8E93', lineHeight: 18, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
  err: { fontSize: 14, color: '#FF3B30', textAlign: 'center', marginBottom: 12, lineHeight: 20 },
  center: { alignItems: 'center', paddingVertical: 30, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 22, borderWidth: 1, borderColor: '#E9E9EE' },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  cTitle: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', marginBottom: 6, textAlign: 'center' },
  mut: { fontSize: 14.5, color: '#6B7280', textAlign: 'center' },
  mutCenter: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  webHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingBottom: 10 },
  webClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  webTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  webSub: { fontSize: 12.5, color: '#6B7280', fontWeight: '500' },
  webLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 10 },
});
