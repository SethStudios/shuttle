import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useBookings } from '@/hooks/useBookings';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { SUBSCRIPTION, formatSubscriptionPrice } from '@/constants/subscription';
import {
  formatPrice, formatPeriod12, getShuttlePrice, getTotalPrice, getShuttleLabel, SHUTTLE_DESCRIPTIONS,
  type ShuttleType, type RouteDirection, BOARDING_PERIODS, getNextBoardingPeriod,
} from '@/constants/pricing';
import { TAP_DEBOUNCE_MS } from '@/constants/app';
import { isBookingOpen } from '@/utils/tickets';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

export default function BookingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [type, setType] = useState<ShuttleType>('public');
  const [route, setRoute] = useState<RouteDirection>('main-to-mini');
  const [period, setPeriod] = useState(getNextBoardingPeriod());
  const total = type ? getTotalPrice(type) : 0;
  const { activeBookings, loading } = useBookings();
  const { active: subActive, loading: subLoading } = useSubscription();
  // Staff never subscribe — they scan tickets, they don't buy rides.
  const { user } = useAuth();
  const isStaff = (user as any)?.user_metadata?.role === 'staff';
  const going = useRef(false);
  const goingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionBlocked = !isStaff && !subLoading && !subActive;

  // One active pass per route + shuttle: a second pass for the same
  // direction AND bus type is blocked until the current one is used or expires.
  const routeActive = loading ? undefined : activeBookings.find((b) => b.route_direction === route && (b.shuttle_type as ShuttleType) === type);

  // Hide past boarding windows for today so users can't buy expired slots.
  const nowHour = new Date().getHours();
  const upcomingPeriods = BOARDING_PERIODS.filter((p) => p.end > nowHour);
  // Booking window: 6:00 AM – 6:00 PM daily. Outside it (evening through
  // early morning) sales are closed until 6 AM — including before dawn,
  // when today's windows technically still list as "upcoming".
  const bookingOpen = isBookingOpen(nowHour);
  const soldOut = !bookingOpen || upcomingPeriods.length === 0;

  useEffect(() => () => {
    if (goingTimer.current) clearTimeout(goingTimer.current);
  }, []);

  // Revalidate across hour boundaries: a stale period must never be payable.
  useFocusEffect(
    useCallback(() => {
      setPeriod((prev) => {
        const h = new Date().getHours();
        const stillOpen = BOARDING_PERIODS.some((p) => p.label === prev.label && p.end > h);
        if (stillOpen) return prev;
        const next = BOARDING_PERIODS.find((p) => p.end > h);
        return next || prev;
      });
    }, [])
  );

  const pick = (fn: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fn();
  };

  const swap = () => pick(() => setRoute(route === 'main-to-mini' ? 'mini-to-main' : 'main-to-mini'));

  const viewActivePass = () => {
    if (!routeActive) return;
    router.push(`/ticket?bookingId=${encodeURIComponent(routeActive.id)}&route=${encodeURIComponent(routeActive.route_direction || route)}` as any);
  };

  const go = () => {
    if (!type || going.current || loading || soldOut || subLoading) return;
    if (subscriptionBlocked) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Alert.alert(
        'Subscription required',
        `You need an active ${formatSubscriptionPrice(SUBSCRIPTION.price)} monthly subscription to book. Trip fare ${formatPrice(getShuttlePrice(type))} (${getShuttleLabel(type)}) still applies per ride.`,
        [
          { text: 'Subscribe', onPress: () => router.push('/subscription' as any) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    going.current = true;
    if (goingTimer.current) clearTimeout(goingTimer.current);
    goingTimer.current = setTimeout(() => { going.current = false; }, TAP_DEBOUNCE_MS);
    if (routeActive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Alert.alert(
        'Active pass already exists',
        `You already have an active pass for this route (${routeActive.queue_number ? `Q#${String(routeActive.queue_number).padStart(2, '0')}` : 'queue pending'}). Use it first before buying another.`,
        [
          { text: 'View my pass', onPress: viewActivePass },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Backend prices the trip; frontend figures are display-only and unused.
    router.push({
      pathname: '/payment',
      params: { shuttleType: type, route, boardingPeriod: period.label },
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 150 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={10}>
            <MaterialIcons name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'} size={24} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={styles.steps}>
            {[1, 2, 3].map((s) => {
              // route -> time -> shuttle progression
              const on = s === 1 || (s === 2 && !!period) || (s === 3 && !!type);
              return <View key={s} style={[styles.stepDot, on && styles.stepOn]} />;
            })}
          </View>
          <View style={{ width: 40 }} />
        </View>
        <Text style={styles.title}>Book shuttle</Text>
        <Text style={styles.sub}>Three quick steps — route, time, shuttle.</Text>

        {subscriptionBlocked ? (
          <TouchableOpacity style={styles.subBox} onPress={() => router.push('/subscription' as any)} activeOpacity={0.85}>
            <View style={styles.subIcon}>
              <MaterialIcons name="card-membership" size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.subTitle}>Subscription required</Text>
              <Text style={styles.subSub}>Get the {formatSubscriptionPrice(SUBSCRIPTION.price)} monthly pass to unlock booking.</Text>
            </View>
            <Text style={styles.subBtnT}>Subscribe</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sec}>1 • Route</Text>
        <View style={styles.routeCard}>
          <View style={styles.routeCol}>
            <Text style={styles.routeLab}>FROM</Text>
            <Text style={styles.routeVal}>{route === 'main-to-mini' ? 'Main Campus' : 'Mini Campus'}</Text>
          </View>
          <TouchableOpacity style={styles.swap} onPress={swap} hitSlop={8}>
            <MaterialIcons name="swap-vert" size={22} color={GREEN} />
          </TouchableOpacity>
          <View style={[styles.routeCol, { alignItems: 'flex-end' }]}>
            <Text style={styles.routeLab}>TO</Text>
            <Text style={styles.routeVal}>{route === 'main-to-mini' ? 'Mini Campus' : 'Main Campus'}</Text>
          </View>
        </View>
        <View style={styles.segRow}>
          {(['main-to-mini', 'mini-to-main'] as RouteDirection[]).map((d) => (
            <TouchableOpacity key={d} style={[styles.seg, route === d && styles.segOn]} onPress={() => pick(() => setRoute(d))}>
              <Text style={[styles.segT, route === d && styles.segTOn]}>
                {d === 'main-to-mini' ? 'Main → Mini' : 'Mini → Main'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {routeActive ? (
          <View style={styles.dupBox}>
            <View style={styles.dupIcon}>
              <MaterialIcons name="confirmation-num" size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dupTitle}>Active pass for this route</Text>
              <Text style={styles.dupSub}>
                {routeActive.queue_number ? `Q#${String(routeActive.queue_number).padStart(2, '0')}` : 'Queue pending'}
                {routeActive.boarding_period ? ` • ${formatPeriod12(routeActive.boarding_period)}` : ''} — use it first before buying another.
              </Text>
            </View>
            <TouchableOpacity style={styles.dupBtn} onPress={viewActivePass} activeOpacity={0.8}>
              <Text style={styles.dupBtnT}>View pass</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.sec}>2 • Boarding time</Text>
        <Text style={styles.note}>Passes are for today only. Queue numbers restart every hour — your window holds your place in line, so arrive 10 minutes early.</Text>
        {soldOut ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.note}>Booking is closed. Sales open daily 6:00 AM – 6:00 PM.</Text>
            <TouchableOpacity style={styles.go} onPress={routeActive ? viewActivePass : () => router.replace('/(tabs)')} activeOpacity={0.85}>
              <Text style={styles.goT}>{routeActive ? 'View my pass' : 'Back to Home'}</Text>
              <MaterialIcons name="arrow-forward" size={19} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.grid}>
          {upcomingPeriods.map((p) => {
            const on = period.label === p.label;
            return (
              <TouchableOpacity key={p.label} style={[styles.chip, on && styles.chipOn]} onPress={() => pick(() => setPeriod(p))}>
                <Text style={[styles.chipT, on && styles.chipTOn]}>{formatPeriod12(p.label)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {soldOut ? (
          <View style={styles.hint}>
            <MaterialIcons name="schedule" size={16} color={GREEN} />
            <Text style={styles.hintT}>Booking is closed right now. Passes you already own stay on Home until used or expired.</Text>
          </View>
        ) : (
          <View style={styles.hint}>
            <MaterialIcons name="schedule" size={16} color={GREEN} />
            <Text style={styles.hintT}>You are booking the {formatPeriod12(period.label)} bus. Aim to arrive 10 minutes early.</Text>
          </View>
        )}

        <Text style={styles.sec}>3 • Shuttle</Text>
        {(['public', 'petrol', 'private'] as ShuttleType[]).map((t) => {
          const on = type === t;
          return (
            <TouchableOpacity key={t} style={[styles.opt, on && styles.optOn]} onPress={() => pick(() => setType(t))} activeOpacity={0.85}>
              <View style={[styles.optIcon, on && styles.optIconOn]}>
                <MaterialIcons name="directions-bus" size={25} color={on ? '#FFFFFF' : GREEN} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optName}>{getShuttleLabel(t)}</Text>
                <Text style={styles.optD}>{SHUTTLE_DESCRIPTIONS[t]}</Text>
                <Text style={[styles.optP, on && styles.optPOn]}>{formatPrice(getShuttlePrice(t))} • no service fee</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <MaterialIcons name="check" size={15} color="#FFFFFF" /> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.barCard}>
          <View>
            <Text style={styles.barLab}>{getShuttleLabel(type)} • {formatPeriod12(period.label)}</Text>
            <Text style={styles.barTotal}>{type ? formatPrice(total) : '—'}</Text>
          </View>
          <TouchableOpacity style={[styles.go, (!type || loading || soldOut || (!isStaff && (subLoading || subscriptionBlocked))) && styles.goOff]} disabled={!type || loading || soldOut || (!isStaff && (subLoading || subscriptionBlocked))} onPress={go} activeOpacity={0.85}>
            <Text style={styles.goT}>{soldOut ? 'Closed' : loading || (!isStaff && subLoading) ? 'Loading…' : subscriptionBlocked ? 'Subscribe first' : 'Continue'}</Text>
            <MaterialIcons name="arrow-forward" size={19} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Text style={styles.fee}>No service fee • Paystack secure checkout • ₦700 monthly subscription required</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  back: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA',
  },
  steps: { flexDirection: 'row', gap: 6 },
  stepDot: { width: 22, height: 5, borderRadius: 3, backgroundColor: '#D9D9DE' },
  stepOn: { backgroundColor: GREEN },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 18 },
  sec: { fontSize: 15, fontWeight: '800', color: '#1C1C1E', marginTop: 8, marginBottom: 10, letterSpacing: 0.2 },
  note: { fontSize: 13.5, color: '#8E8E93', marginBottom: 10, marginTop: -6 },
  routeCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20,
    padding: 16, borderWidth: 1, borderColor: '#E9E9EE', gap: 10,
  },
  routeCol: { flex: 1, gap: 3 },
  routeLab: { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.8 },
  routeVal: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  swap: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#F0F9F3',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CDE8D3',
  },
  segRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  seg: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 13, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  segOn: { backgroundColor: GREEN, borderColor: GREEN },
  segT: { fontSize: 14.5, fontWeight: '700', color: '#3C3C43' },
  segTOn: { color: '#FFFFFF' },
  dupBox: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#FFFBEB',
    borderWidth: 1, borderColor: '#F5D67B', borderRadius: 16, padding: 13, marginTop: 4, marginBottom: 6,
  },
  dupIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#B45309', alignItems: 'center', justifyContent: 'center' },
  dupTitle: { fontSize: 14.5, fontWeight: '800', color: '#1C1C1E' },
  dupSub: { fontSize: 12.5, color: '#6B7280', marginTop: 2, lineHeight: 17 },
  dupBtn: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11 },
  dupBtnT: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  subBox: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#EFF6FF',
    borderWidth: 1, borderColor: '#93C5FD', borderRadius: 16, padding: 13, marginBottom: 6,
  },
  subIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  subTitle: { fontSize: 14.5, fontWeight: '800', color: '#1C1C1E' },
  subSub: { fontSize: 12.5, color: '#6B7280', marginTop: 2, lineHeight: 17 },
  subBtnT: { fontSize: 13, fontWeight: '800', color: GREEN },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 11, paddingVertical: 10, paddingHorizontal: 12, minWidth: '31%', alignItems: 'center' },
  chipOn: { backgroundColor: GREEN, borderColor: GREEN },
  chipT: { fontSize: 13, fontWeight: '700', color: '#3C3C43' },
  chipTOn: { color: '#FFFFFF' },
  hint: { flexDirection: 'row', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 13, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#E9E9EE' },
  hintT: { flex: 1, fontSize: 13, color: '#3C3C43', lineHeight: 18 },
  opt: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18,
    borderWidth: 1.5, borderColor: '#E5E5EA', padding: 15, marginBottom: 10, gap: 13,
  },
  optOn: { borderColor: GREEN, backgroundColor: '#F6FCF7' },
  optIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center' },
  optIconOn: { backgroundColor: GREEN },
  optName: { fontSize: 16.5, fontWeight: '800', color: '#1C1C1E' },
  optD: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  optP: { fontSize: 15, fontWeight: '800', color: '#3C3C43', marginTop: 6 },
  optPOn: { color: GREEN },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#C7C7CC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: GREEN, backgroundColor: GREEN },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 8, backgroundColor: 'rgba(242,242,247,0.94)', borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.1)' },
  barCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, paddingLeft: 18, borderWidth: 1, borderColor: '#E9E9EE' },
  barLab: { fontSize: 12.5, fontWeight: '600', color: '#6B7280' },
  barTotal: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.5 },
  go: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14 },
  goOff: { backgroundColor: '#C7C7CC' },
  goT: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  fee: { textAlign: 'center', fontSize: 12, color: '#8E8E93', marginTop: 8 },
});
