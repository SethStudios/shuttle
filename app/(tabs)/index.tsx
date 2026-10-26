import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, RefreshControl, ActivityIndicator, Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useBookings } from '@/hooks/useBookings';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION, formatSubscriptionPrice } from '@/constants/subscription';
import { formatPrice, formatPeriod12, getShuttlePrice, getShuttleLabel } from '@/constants/pricing';
import { getUnreadCount, scheduleShuttleNotifications } from '@/services/notifications';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { activeBookings, loading, refreshing, refresh } = useBookings();
  const { active: subActive, loading: subLoading } = useSubscription();
  const isStaff = (user as any)?.user_metadata?.role === 'staff';
  const [unread, setUnread] = useState(0);

  const loadUnread = useCallback(async () => {
    try { setUnread(await getUnreadCount()); } catch {}
  }, []);

  // Reminder scheduling is fire-and-forget (no state writes); the unread
  // count loads via the focus effect below, which also runs on mount.
  useEffect(() => { scheduleShuttleNotifications(); }, []);
  useFocusEffect(useCallback(() => { loadUnread(); }, [loadUnread]));

  const first = user?.user_metadata?.full_name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const initial = (user?.user_metadata?.full_name?.[0] || 'U').toUpperCase();

  const openTicket = (id: string, dir: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // String href forces the top-level /ticket detail — never the History tab.
    router.push(`/ticket?bookingId=${encodeURIComponent(id)}&route=${encodeURIComponent(dir || 'main-to-mini')}` as any);
  };

  const fmt = (d: string) => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return d; }
  };

  // ── Staff checkpoint home ──────────────────────────────────
  if (user?.user_metadata?.role === 'staff') {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
          <ScrollView
            contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 28 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={GREEN} />}
          >
          <View style={styles.header}>
            <View style={styles.who}>
              <View style={styles.avatar}><Text style={styles.avatarT}>{initial}</Text></View>
              <View>
                <Text style={styles.hello}>{greet}, {first}</Text>
                <Text style={styles.sub}>Shuttle checkpoint duty</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={styles.bell}
                onPress={() => router.push('/(tabs)/notifications')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Alerts"
                accessibilityRole="button"
              >
                <MaterialIcons name="notifications-none" size={23} color="#1C1C1E" />
                {unread > 0 ? (
                  <View style={styles.badge}><Text style={styles.badgeT}>{unread > 9 ? '9+' : unread}</Text></View>
                ) : null}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.scanHero} activeOpacity={0.88} onPress={() => router.push('/scan')}>
            <View style={styles.scanHeroIcon}>
              <MaterialIcons name="qr-code-scanner" size={34} color="#FFFFFF" />
            </View>
            <Text style={styles.scanHeroTitle}>Scan rider ticket</Text>
            <Text style={styles.scanHeroSub}>Check the QR at boarding and confirm valid passes.</Text>
            <View style={styles.scanHeroBtn}>
              <Text style={styles.scanHeroBtnT}>Open scanner</Text>
              <MaterialIcons name="arrow-forward" size={19} color={GREEN} />
            </View>
          </TouchableOpacity>

          <View style={styles.howCard}>
            <Text style={styles.howTitle}>How boarding works</Text>
            {[
              ['1', 'Rider shows their QR boarding pass'],
              ['2', 'Green means admit and clears itself — keep scanning the line'],
              ['3', 'Red stays on screen — stop, then tap Scan Next'],
              ['4', 'Valid passes are consumed automatically — each QR works once'],
            ].map(([n, t]) => (
              <View key={n} style={styles.howRow}>
                <View style={styles.howNum}><Text style={styles.howNumT}>{n}</Text></View>
                <Text style={styles.howT}>{t}</Text>
              </View>
            ))}
          </View>

          <View style={styles.info}>
            <MaterialIcons name="info-outline" size={16} color="#6B7280" />
            <Text style={styles.infoT}>Only passes for today with confirmed payment are valid. Already-scanned passes must not board twice.</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 28 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={GREEN} />}
      >
        <View style={styles.header}>
          <View style={styles.who}>
            <View style={styles.avatar}><Text style={styles.avatarT}>{initial}</Text></View>
            <View>
              <Text style={styles.hello}>{greet}, {first}</Text>
              <Text style={styles.sub}>Where to today?</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.bell} onPress={() => router.push('/(tabs)/notifications')} hitSlop={8}>
            <MaterialIcons name="notifications-none" size={23} color="#1C1C1E" />
            {unread > 0 ? (
              <View style={styles.badge}><Text style={styles.badgeT}>{unread > 9 ? '9+' : unread}</Text></View>
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <MaterialIcons name="directions-bus" size={30} color="#FFFFFF" />
            </View>
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={styles.liveT}>Buses running 6am – 6pm</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Main Campus ⇄ Mini Campus</Text>
          <Text style={styles.heroSub}>Book ahead, skip the payment queue, and board with your QR ticket.</Text>
          <View style={styles.heroRow}>
            <TouchableOpacity style={styles.heroBtn} activeOpacity={0.88} onPress={() => router.push('/booking')}>
              <Text style={styles.heroBtnT}>Book a shuttle</Text>
              <MaterialIcons name="arrow-forward" size={19} color={GREEN} />
            </TouchableOpacity>
            <Text style={styles.heroPrice}>From {formatPrice(getShuttlePrice('public'))}</Text>
          </View>
          <Image source={require('@/assets/images/icon.png')} style={styles.heroWater} resizeMode="contain" />
        </View>

        {!subLoading && !subActive && !isStaff ? (
          <TouchableOpacity style={styles.subBanner} activeOpacity={0.88} onPress={() => router.push('/subscription' as any)}>
            <View style={styles.subBannerIcon}>
              <MaterialIcons name="card-membership" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.subBannerTitle}>Subscription required • {formatSubscriptionPrice(SUBSCRIPTION.price)}/month</Text>
              <Text style={styles.subBannerSub}>Activate your pass to unlock booking. Fares from {formatPrice(getShuttlePrice('public'))} per ride.</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.secHead}>
          <Text style={styles.secTitle}>Active ticket{activeBookings.length === 1 ? '' : 's'}</Text>
        </View>

        {loading ? (
          <View style={styles.card}>
            <ActivityIndicator size="small" color={GREEN} />
            <Text style={styles.muted}>Loading your tickets…</Text>
          </View>
        ) : activeBookings.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.emptyIcon}><MaterialIcons name="confirmation-num" size={28} color={GREEN} /></View>
            <Text style={styles.emptyT}>No active ticket</Text>
            <Text style={styles.mutedCenter}>Your next shuttle pass will appear here with its queue number.</Text>
            <TouchableOpacity style={styles.greenBtn} onPress={() => router.push('/booking')} activeOpacity={0.85}>
              <Text style={styles.greenBtnT}>Book now</Text>
            </TouchableOpacity>
          </View>
        ) : (
          activeBookings.slice(0, 2).map((t) => (
            <TouchableOpacity key={t.id} style={styles.pass} activeOpacity={0.82} onPress={() => openTicket(t.id, t.route_direction || 'main-to-mini')}>
              <View style={styles.passHead}>
                <View style={styles.passRoute}>
                  <MaterialIcons name={t.shuttle_type === 'public' ? 'directions-bus' : 'local-taxi'} size={18} color="#FFFFFF" />
                  <Text style={styles.passRouteT}>{t.route}</Text>
                </View>
                <View style={styles.queuePill}>
                  <Text style={styles.queuePillT}>Q{t.queue_number ? `#${String(t.queue_number).padStart(2, '0')}` : '—'}</Text>
                </View>
              </View>
              <View style={styles.passBody}>
                <View>
                  <Text style={styles.passType}>{getShuttleLabel(t.shuttle_type as 'public' | 'private')}</Text>
                  <Text style={styles.passMeta}>{fmt(t.travel_date)}{t.boarding_period ? ` • ${formatPeriod12(t.boarding_period)}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.passPrice}>{formatPrice(t.total_amount)}</Text>
                  <View style={styles.viewRow}>
                    <Text style={styles.viewT}>View QR</Text>
                    <MaterialIcons name="chevron-right" size={17} color={GREEN} />
                  </View>
                </View>
              </View>
              <View style={styles.perf}>
                <View style={styles.notchL} />
                <View style={styles.dash} />
                <View style={styles.notchR} />
              </View>
              <Text style={styles.tapHint}>Tap to show boarding QR • Arrive 10 min early</Text>
            </TouchableOpacity>
          ))
        )}

        <View style={styles.info}>
          <MaterialIcons name="info-outline" size={16} color="#6B7280" />
          <Text style={styles.infoT}>Queue numbers reset every hour. Tickets are valid for the date and boarding window shown.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  hello: { fontSize: 19, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.4 },
  sub: { fontSize: 13.5, color: '#6B7280', marginTop: 1 },
  bell: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E5E5EA',
  },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: '#F2F2F7',
  },
  badgeT: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  hero: {
    backgroundColor: GREEN, borderRadius: 26, padding: 20, overflow: 'hidden', marginBottom: 14,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 18,
    elevation: Platform.OS === 'android' ? 6 : 0,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  liveT: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  heroTitle: { fontSize: 23, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  heroSub: { fontSize: 14.5, color: 'rgba(255,255,255,0.85)', lineHeight: 20, marginTop: 6, maxWidth: 250 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF',
    paddingHorizontal: 18, paddingVertical: 13, borderRadius: 14,
  },
  heroBtnT: { fontSize: 16, fontWeight: '800', color: GREEN },
  heroPrice: { fontSize: 13.5, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  heroWater: { position: 'absolute', right: -28, bottom: -24, width: 150, height: 150, opacity: 0.14 },
  subBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1D4ED8',
    borderRadius: 20, padding: 16, marginBottom: 14,
  },
  subBannerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  subBannerTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  subBannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2, lineHeight: 18 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  secTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.4 },
  secLink: { fontSize: 15, fontWeight: '600', color: GREEN },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#E9E9EE',
  },
  muted: { fontSize: 14, color: '#6B7280' },
  mutedCenter: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyT: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  greenBtn: { backgroundColor: GREEN, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 12, marginTop: 10 },
  greenBtnT: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  pass: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E0EFE3', overflow: 'hidden' },
  passHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  passRoute: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GREEN, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, maxWidth: '72%' },
  passRouteT: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
  queuePill: { backgroundColor: '#F0F9F3', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  queuePillT: { fontSize: 14, fontWeight: '800', color: GREEN },
  passBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  passType: { fontSize: 16, fontWeight: '800', color: '#1C1C1E' },
  passMeta: { fontSize: 13.5, color: '#6B7280', marginTop: 3 },
  passPrice: { fontSize: 18, fontWeight: '800', color: GREEN, letterSpacing: -0.3 },
  viewRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  viewT: { fontSize: 13, fontWeight: '700', color: GREEN },
  perf: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  notchL: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#F2F2F7', marginLeft: -26 },
  notchR: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#F2F2F7', marginRight: -26 },
  dash: { flex: 1, borderTopWidth: 1.5, borderColor: '#D9EADD', borderStyle: 'dashed', marginHorizontal: 6 },
  tapHint: { fontSize: 12.5, color: '#8E8E93', textAlign: 'center' },
  info: { flexDirection: 'row', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 13, marginTop: 6, borderWidth: 1, borderColor: '#E9E9EE' },
  infoT: { flex: 1, fontSize: 13, color: '#6B7280', lineHeight: 18 },
  staffTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF6ED', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999 },
  staffTagT: { fontSize: 12.5, fontWeight: '700', color: GREEN },
  scanHero: {
    backgroundColor: GREEN, borderRadius: 26, padding: 22, marginBottom: 14,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 18,
    elevation: Platform.OS === 'android' ? 6 : 0,
  },
  scanHeroIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  scanHeroTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  scanHeroSub: { fontSize: 14.5, color: 'rgba(255,255,255,0.85)', lineHeight: 20, marginTop: 6, marginBottom: 16 },
  scanHeroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 13, borderRadius: 14, alignSelf: 'flex-start' },
  scanHeroBtnT: { fontSize: 16, fontWeight: '800', color: GREEN },
  howCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E9E9EE', gap: 12 },
  howTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  howNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center' },
  howNumT: { fontSize: 14, fontWeight: '800', color: GREEN },
  howT: { flex: 1, fontSize: 14.5, color: '#3C3C43', lineHeight: 20 },
});
