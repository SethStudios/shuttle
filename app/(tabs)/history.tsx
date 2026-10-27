import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatPrice, formatPeriod12, isWithinTicketLife, getShuttleLabel } from '@/constants/pricing';
import { useBookings, type Booking } from '@/hooks/useBookings';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen } from '@/constants/theme';
import { supabase } from '@/utils/supabase';
import { AppleButton } from '@/components/ui/Apple';
import { CustomAlert } from '@/components/ui/CustomAlert';

const GREEN = UniAbujaGreen[700];
const SCAN_HISTORY_KEY = '@scan_history';

type ScanEntry = { code: string; time: string; result: 'ADMIT' | 'DENY' | 'USED' };

export default function TicketsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { activeBookings, allBookings, loading, refreshing, refresh, error: bookingsError } = useBookings();
  const isStaff = user?.user_metadata?.role === 'staff';

  // History shows ALL bookings (past and completed trips)
  // Active passes also live on Home, but appear here too for reference
  const history = isStaff ? [] : allBookings;

  // Custom alert states
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [alertOnConfirm, setAlertOnConfirm] = useState(() => () => {});

  // Delete booking state
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bookingToDelete, setBookingToDelete] = useState<string | null>(null);

  // Scans state (staff only)
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [scansLoading, setScansLoading] = useState(isStaff);
  const [scansRefreshing, setScansRefreshing] = useState(false);
  const [scansError, setScansError] = useState(false);

  const loadScans = useCallback(async () => {
    try {
      setScansLoading(true);
      const raw = await AsyncStorage.getItem(SCAN_HISTORY_KEY);
      setScans(raw ? JSON.parse(raw) : []);
      setScansError(false);
    } catch {
      setScansError(true);
    } finally {
      setScansLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => { if (isStaff) { setScansLoading(true); loadScans(); } }, [isStaff, loadScans])
  );

  const refreshScans = useCallback(async () => {
    setScansRefreshing(true);
    await loadScans();
    setScansRefreshing(false);
  }, [loadScans]);

  const fmt = (d: string) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const statusOf = (b: Booking) => {
    if (b.ticket_status === 'cancelled' || b.payment_status === 'cancelled') return { l: 'Cancelled', c: '#FF3B30', bg: '#FFE9E8' };
    if (b.payment_status === 'failed') return { l: 'Failed', c: '#FF3B30', bg: '#FFE9E8' };
    if (b.ticket_status === 'used') return { l: 'Used', c: '#6B7280', bg: '#EDEDED' };
    // A booking is only "Active" if payment is confirmed. Pending/unpaid
    // bookings must never show as Active — they have no valid ticket.
    if (b.payment_status !== 'paid') return { l: 'Pending', c: '#B45309', bg: '#FEF3C7' };
    if (!isWithinTicketLife(b.created_at)) return { l: 'Expired', c: '#B45309', bg: '#FEF3C7' };
    const today = new Date().toISOString().slice(0, 10);
    if (b.travel_date < today) return { l: 'Expired', c: '#B45309', bg: '#FEF3C7' };
    return { l: 'Active', c: GREEN, bg: '#EAF6ED' };
  };

  const open = (b: Booking) => router.push(`/ticket?bookingId=${encodeURIComponent(b.id)}&route=${encodeURIComponent(b.route_direction || 'main-to-mini')}` as any);

  // ── Show alert ──
  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', onConfirm: () => void = () => {}) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertType(type);
    setAlertOnConfirm(onConfirm);
    setAlertVisible(true);
  };

  // ── Delete single booking ──
  const deleteBooking = async (bookingId: string) => {
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.rpc('delete_own_booking', {
        p_booking_id: bookingId,
      });
      if (error) throw error;
      if (!data?.ok) {
        showAlert('Delete failed', (data as any)?.reason || 'Could not delete booking.', 'error');
        return;
      }
      await refresh();
      showAlert('Deleted', 'Booking removed from history.', 'success');
    } catch (err: any) {
      showAlert('Delete failed', err?.message || 'Could not delete booking.', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Clear all history ──
  const clearAllHistory = async () => {
    if (history.length === 0) return;
    setDeleteLoading(true);
    try {
      const { error } = await supabase.rpc('delete_own_history', {
        p_user_id: user!.id,
      });
      if (error) throw error;
      await refresh();
      showAlert('Cleared', 'All past trips removed from history.', 'success');
    } catch (err: any) {
      showAlert('Clear failed', err?.message || 'Could not clear history.', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const Card = ({ b }: { b: Booking }) => {
    const s = statusOf(b);
    const canDelete = b.payment_status !== 'paid' || b.ticket_status !== 'unused';
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => open(b)}>
        <View style={styles.top}>
          <View style={styles.left}>
            <View style={styles.icon}>
              <MaterialIcons name={b.shuttle_type === 'public' ? 'directions-bus' : 'local-taxi'} size={20} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.type}>{getShuttleLabel(b.shuttle_type as 'public' | 'private')}</Text>
              <Text style={styles.route} numberOfLines={1}>{b.route}</Text>
            </View>
          </View>
          <View style={[styles.pill, { backgroundColor: s.bg }]}>
            <Text style={[styles.pillT, { color: s.c }]}>{s.l}</Text>
          </View>
          {!canDelete ? null : (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={(e: any) => {
                e.stopPropagation();
                setBookingToDelete(b.id);
                showAlert(
                  'Delete booking?',
                  'Remove this booking from your history?',
                  'warning',
                  () => deleteBooking(b.id),
                );
              }}
            >
              <MaterialIcons name="delete" size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaT}>{fmt(b.travel_date)}</Text>
          {b.boarding_period ? <Text style={styles.metaT}>• {formatPeriod12(b.boarding_period)}</Text> : null}
          {b.queue_number ? <Text style={[styles.metaT, { fontWeight: '800', color: GREEN }]}>• Q#{String(b.queue_number).padStart(2, '0')}</Text> : null}
        </View>
        <View style={styles.bottom}>
          <Text style={styles.price}>{formatPrice(b.total_amount)}</Text>
          <View style={styles.view}>
            <Text style={styles.viewT}>View pass</Text>
            <MaterialIcons name="chevron-right" size={18} color="#8E8E93" />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isStaff) {
    return (
      <View style={styles.root}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 28 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={scansRefreshing} onRefresh={refreshScans} tintColor={GREEN} />}
        >
          <View style={styles.titleWrap}>
            <Text style={styles.title}>Scanned</Text>
          </View>
          <Text style={styles.sub}>Tickets you have scanned at boarding.</Text>
          {scansLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={GREEN} />
              <Text style={styles.mut}>Loading scans…</Text>
            </View>
          ) : scansError && scans.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name="wifi-off" size={30} color={GREEN} />
              </View>
              <Text style={styles.emptyT}>Could not load scans</Text>
              <Text style={styles.mutCenter}>Check your connection and try again.</Text>
              <TouchableOpacity
                style={styles.book}
                onPress={() => { setScansLoading(true); loadScans(); }}
                accessibilityLabel="Retry loading scans"
                accessibilityRole="button"
              >
                <Text style={styles.bookT}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : scans.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name="qr-code-scanner" size={30} color={GREEN} />
              </View>
              <Text style={styles.emptyT}>No scans yet</Text>
              <Text style={styles.mutCenter}>Tickets you scan at boarding will appear here.</Text>
              <TouchableOpacity style={styles.book} onPress={() => router.push('/scan')}>
                <Text style={styles.bookT}>Open Scanner</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.scanGroup}>
              {scans.map((s, i) => (
                <View key={`${s.code}-${i}`}>
                  <View style={styles.scanRow}>
                    <View style={[styles.scanDot, { backgroundColor: s.result === 'ADMIT' ? '#22C55E' : s.result === 'USED' ? '#FF9F0A' : '#FF3B30' }]} />
                    <Text style={styles.scanCode} numberOfLines={1}>{s.code.length > 10 ? `${s.code.slice(0, 7)}…${s.code.slice(-4)}` : s.code}</Text>
                    <Text style={styles.scanMeta}>{s.result} • {s.time}</Text>
                  </View>
                  {i < scans.length - 1 ? <View style={styles.scanSep} /> : null}
                </View>
              ))}
            </View>
          )
        }
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
        <View style={styles.titleWrap}>
          <Text style={styles.title}>History</Text>
        </View>
        <Text style={styles.sub}>
          Your past and completed trips. Active passes live on Home.
        </Text>

        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={styles.mut}>Loading tickets…</Text>
          </View>
        ) : bookingsError && history.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name="wifi-off" size={30} color={GREEN} />
            </View>
            <Text style={styles.emptyT}>Could not load tickets</Text>
            <Text style={styles.mutCenter}>Check your connection and try again.</Text>
            <TouchableOpacity
              style={styles.book}
              onPress={() => refresh()}
              accessibilityLabel="Retry loading tickets"
              accessibilityRole="button"
            >
              <Text style={styles.bookT}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : history.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name="confirmation-num" size={30} color={GREEN} />
            </View>
            <Text style={styles.emptyT}>No trips yet</Text>
            <Text style={styles.mutCenter}>
              Your booked trips will appear here.
            </Text>
            <TouchableOpacity style={styles.book} onPress={() => router.push('/booking')}>
              <Text style={styles.bookT}>Book Shuttle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Clear all button */}
            <View style={{ marginBottom: 16 }}>
              <TouchableOpacity
                style={styles.clearAllBtn}
                onPress={() => {
                  const deletable = history.filter(b => b.payment_status !== 'paid' || b.ticket_status !== 'unused');
                  if (deletable.length === 0) {
                    showAlert('Nothing to clear', 'No past trips to remove.', 'info');
                    return;
                  }
                  showAlert(
                    'Clear all history?',
                    `Remove all ${deletable.length} past trip(s) from your history?`,
                    'warning',
                    () => clearAllHistory(),
                  );
                }}
              >
                <MaterialIcons name="delete-forever" size={20} color="#FF3B30" />
                <Text style={styles.clearAllText}>Clear all history</Text>
              </TouchableOpacity>
            </View>

            <View style={{ gap: 10 }}>
              {history.map((b) => <Card key={b.id} b={b} />)}
            </View>
          </>
        )}
      </ScrollView>

      {/* Custom Alert */}
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        type={alertType}
        onConfirm={alertOnConfirm}
        loading={deleteLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  titleWrap: { textAlign: 'center', marginBottom: 4 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8, textAlign: 'center' },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, borderWidth: 1, borderColor: '#E9E9EE', marginBottom: 10 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center' },
  type: { fontSize: 15.5, fontWeight: '800', color: '#1C1C1E' },
  route: { fontSize: 12.5, color: '#6B7280', marginTop: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillT: { fontSize: 11.5, fontWeight: '800' },
  meta: { flexDirection: 'row', gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F4', marginBottom: 10 },
  metaT: { fontSize: 13, color: '#3C3C43', fontWeight: '500' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: 18, fontWeight: '800', color: GREEN, letterSpacing: -0.3 },
  view: { flexDirection: 'row', alignItems: 'center' },
  viewT: { fontSize: 13.5, fontWeight: '600', color: '#6B7280' },
  deleteBtn: { padding: 6 },
  empty: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: '#E9E9EE' },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyT: { fontSize: 18, fontWeight: '800', color: '#1C1C1E', marginBottom: 6 },
  mut: { fontSize: 14, color: '#6B7280', marginTop: 8 },
  mutCenter: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  book: { backgroundColor: GREEN, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 13 },
  bookT: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  scanGroup: { backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#E9E9EE', paddingHorizontal: 14 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  scanDot: { width: 9, height: 9, borderRadius: 5 },
  scanCode: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#1C1C1E' },
  scanMeta: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  scanSep: { height: 1, backgroundColor: '#F0F0F4' },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFE9E8',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#FFE9E8',
  },
  clearAllText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF3B30',
  },
});
