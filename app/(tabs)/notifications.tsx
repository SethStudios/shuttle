import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, AppState } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import { loadNotifications, markNotificationRead, markAllNotificationsRead } from '@/services/notifications';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Clock pinned in state (refreshed on focus): Date.now() during render
  // breaks render purity, so the timestamp lives here instead.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      setItems(await loadNotifications());
      setLoadError(false);
    } catch {
      // Storage can fail (e.g. cleared app data) — surface it instead of
      // masquerading as "caught up".
      setLoadError(true);
    }
  }, []);
  
  // No mount useEffect: the focus effect below already loads on first
  // mount, and a second loader would double-fetch and flash.

  // Reload when the tab gains focus (e.g. after tapping the bell) and
  // when the app returns to the foreground — the React Native equivalents
  // of web `storage` / custom DOM events, which don't exist on native.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      load().finally(() => setLoading(false));
    }, [load])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const open = async (n: any) => {
    // Optimistic UI, reverted if storage fails so the badge never desyncs.
    setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
      } catch {
        setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: false } : x)));
      }
    }
    // Boarding reminders point at a live pass — take the rider to Home
    // where active tickets live. Other items are read-only notices.
    if (typeof n.id === 'string' && n.id.startsWith('reminder-')) {
      router.replace('/(tabs)');
    }
  };
  const allRead = async () => {
    const prev = items;
    setItems((p) => p.map((x) => ({ ...x, read: true })));
    try {
      await markAllNotificationsRead();
    } catch {
      setItems(prev);
    }
  };

  // `now` is declared with the other state above; `ago` only reads it.
  const ago = (ts: number) => {
    const d = (now || ts) - ts;
    const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), days = Math.floor(d / 86400000);
    if (m < 1) return 'Now';
    if (m < 60) return `${m}m`;
    if (h < 24) return `${h}h`;
    if (days < 7) return `${days}d`;
    return new Date(ts).toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 28 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        <View style={styles.head}>
          <View>
            <Text style={styles.title}>Alerts</Text>
            <Text style={styles.sub}>Shuttle windows & ticket updates.</Text>
          </View>
          {items.some((n) => !n.read) ? (
            <TouchableOpacity
              onPress={allRead}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Mark all alerts as read"
              accessibilityRole="button"
            >
              <Text style={styles.link}>Mark all read</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {loadError ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="wifi-off" size={30} color={GREEN} /></View>
            <Text style={styles.emptyT}>Could not load alerts</Text>
            <Text style={styles.mut}>Check your connection and try again.</Text>
            <View style={{ height: 14 }} />
            <TouchableOpacity
              style={styles.retry}
              onPress={() => { setLoading(true); setLoadError(false); load().finally(() => setLoading(false)); }}
              accessibilityLabel="Retry loading alerts"
              accessibilityRole="button"
            >
              <Text style={styles.retryT}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="notifications-none" size={30} color={GREEN} /></View>
            <Text style={styles.emptyT}>You are all caught up</Text>
            <Text style={styles.mut}>Boarding reminders and service news will appear here.</Text>
          </View>
        ) : (
          <View style={styles.group}>
            {items.map((n, i) => (
              <View key={n.id}>
                <TouchableOpacity
                  style={[styles.row, !n.read && styles.unread]}
                  activeOpacity={0.75}
                  onPress={() => open(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.title}. ${n.read ? 'Read' : 'Unread'}`}
                >
                  <View style={[styles.icon, !n.read && styles.iconOn]}>
                    <MaterialIcons name="directions-bus" size={20} color={!n.read ? '#FFFFFF' : GREEN} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.t, !n.read && styles.tBold]} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.time}>{ago(n.timestamp)}</Text>
                    </View>
                    <Text style={styles.b} numberOfLines={2}>{n.body}</Text>
                  </View>
                  {!n.read ? <View style={styles.dot} /> : null}
                </TouchableOpacity>
                {i < items.length - 1 ? <View style={styles.sep} /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4 },
  link: { fontSize: 14.5, fontWeight: '700', color: GREEN, padding: 6 },
  retry: { backgroundColor: GREEN, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 13 },
  retryT: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 34, alignItems: 'center', borderWidth: 1, borderColor: '#E9E9EE' },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyT: { fontSize: 18, fontWeight: '800', color: '#1C1C1E', marginBottom: 6 },
  mut: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  group: { backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#E9E9EE' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  unread: { backgroundColor: '#F3FAF4' },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: GREEN },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  t: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1C1C1E' },
  tBold: { fontWeight: '800' },
  time: { fontSize: 12.5, color: '#8E8E93', fontWeight: '500' },
  b: { fontSize: 13.5, color: '#6B7280', lineHeight: 18 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: GREEN },
  sep: { height: 1, backgroundColor: '#F0F0F4', marginLeft: 68 },
});
