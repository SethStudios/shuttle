import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, ActivityIndicator, Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import QRCodeSVG from 'react-native-qrcode-svg';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/utils/supabase';
import { loadDevBookings } from '@/hooks/useBookings';
import { useState, useCallback } from 'react';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { formatPrice, formatPeriod12, getTotalPrice, isWithinTicketLife, hoursLeftInTicketLife, getShuttleLabel } from '@/constants/pricing';

const GREEN = UniAbujaGreen[700];
const W = Dimensions.get('window').width;

export default function TicketScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    bookingId?: string; reference?: string; shuttleType?: string; totalAmount?: string;
    ticketId?: string; travelDate?: string; boardingPeriod?: string; queueNumber?: string; route?: string;
  }>();

  const bookingId = params.bookingId || '';
  const shuttleType = (params.shuttleType as 'public' | 'private') || 'public';
  const routeDirection = (params.route as 'main-to-mini' | 'mini-to-main') || 'main-to-mini';

  const [data, setData] = useState({
    ticketId: params.ticketId || '', travelDate: params.travelDate || '',
    boardingPeriod: params.boardingPeriod || '', queueNumber: params.queueNumber ? parseInt(params.queueNumber, 10) : 0,
    total: params.totalAmount ? parseInt(params.totalAmount, 10) : 0,
    shuttleType, reference: params.reference || '', fullName: 'Student',
    createdAt: '', ticketStatus: '', paymentStatus: '',
  });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Refetch on focus (not just mount): returning from payment or from a
  // staff scan shows the fresh paid/used state instead of a stale pass.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!bookingId || !user) {
        setLoading(false);
        if (!params.ticketId) setNotFound(true);
        return;
      }
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const { data: b, error } = await supabase.from('bookings')
          .select('*, profiles(full_name, role)')
          .eq('id', bookingId).eq('user_id', user.id).single();
        if (cancelled) return;
        if (!error && b && b.ticket_id) {
          setData({
            ticketId: b.ticket_id,
            travelDate: b.travel_date || params.travelDate || new Date().toISOString().slice(0, 10),
            boardingPeriod: b.boarding_period || params.boardingPeriod || '06:00-07:00',
            queueNumber: b.queue_number || 0,
            total: b.total_amount || 0,
            shuttleType: b.shuttle_type || shuttleType,
            reference: b.paystack_reference || params.reference || '',
            fullName: (b.profiles as any)?.full_name || user.user_metadata?.full_name || 'Student',
            createdAt: b.created_at || '',
            ticketStatus: b.ticket_status || '',
            paymentStatus: b.payment_status || '',
          });
          return;
        }
        // Dev cache is a display cache for verified tickets only — never
        // invent a ticket_id. If nothing has a real ticket_id, not-found.
        try {
          const devs = await loadDevBookings();
          const d = devs.find((x) => x.id === bookingId);
          if (d && d.ticket_id) {
            setData({
              ticketId: d.ticket_id,
              travelDate: d.travel_date || '',
              boardingPeriod: d.boarding_period || '',
              queueNumber: d.queue_number || 0,
              total: d.total_amount || 0,
              shuttleType: (d.shuttle_type as 'public' | 'private') || shuttleType,
              reference: d.paystack_reference || '',
              fullName: user.user_metadata?.full_name || 'Student',
              createdAt: d.created_at || '',
              ticketStatus: d.ticket_status || '',
              paymentStatus: d.payment_status || '',
            });
            return;
          }
        } catch {}
        // Last resort: params from a just-verified payment carry a real
        // backend ticket_id. Anything else is not a valid ticket.
        if (params.ticketId) {
          setData((prev) => ({ ...prev, ticketId: params.ticketId || '' }));
        } else {
          setNotFound(true);
        }
      } catch {
        if (!cancelled && !params.ticketId) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
      })();
      return () => { cancelled = true; };
    }, [bookingId, user, params.ticketId, params.travelDate, params.boardingPeriod, params.reference, shuttleType])
  );

  const routeLabel = routeDirection === 'mini-to-main' ? 'Mini Campus → Main Campus' : 'Main Campus → Mini Campus';
  const shortRoute = routeDirection === 'mini-to-main' ? 'Mini → Main' : 'Main → Mini';
  const queue = data.queueNumber > 0 ? `#${String(data.queueNumber).padStart(2, '0')}` : '—';
  // Online-only ticket: QR holds ONLY the ticket_id. Verification always
  // hits Supabase (scan.tsx) — no embedded pass data, no offline bypass.
  // Legacy JSON tickets are still accepted by the scanner via parseTicketId.
  // Unknown age must never claim "expired" — show neutral validity copy.
  const ageKnown = !!data.createdAt;
  const expired = ageKnown ? !isWithinTicketLife(data.createdAt) : false;
  const hoursLeft = ageKnown ? hoursLeftInTicketLife(data.createdAt) : 0;
  const qr = data.ticketId || '';
  const used = data.ticketStatus === 'used';
  const cancelled = data.paymentStatus === 'cancelled' || data.ticketStatus === 'cancelled';
  const dead = used || cancelled || expired;
  const dateFmt = (() => {
    try {
      const d = data.travelDate || new Date().toISOString().slice(0, 10);
      return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return 'Today'; }
  })();

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Loading ticket…</Text>
      </View>
    );
  }

  if (notFound || !qr) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }]}>
        <StatusBar style="dark" />
        <MaterialIcons name="error-outline" size={48} color="#8E8E93" />
        <Text style={{ marginTop: 12, fontSize: 18, fontWeight: '800', color: '#1C1C1E', textAlign: 'center' }}>Ticket not found</Text>
        <Text style={{ marginTop: 6, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 }}>This pass could not be verified. If you just paid, return and retry verification — never use a forwarded link as a ticket.</Text>
        <View style={{ marginTop: 18, width: '100%' }}>
          <AppleButton title="Back to Home" onPress={() => router.replace('/(tabs)')} />
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
          {cancelled ? (
            <View style={[styles.paid, { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }]}>
              <View style={[styles.paidDot, { backgroundColor: '#B91C1C' }]} />
              <Text style={[styles.paidT, { color: '#B91C1C' }]}>CANCELLED</Text>
            </View>
          ) : used ? (
            <View style={[styles.paid, { backgroundColor: '#F2F2F7', borderColor: '#E5E5EA' }]}>
              <View style={[styles.paidDot, { backgroundColor: '#8E8E93' }]} />
              <Text style={[styles.paidT, { color: '#8E8E93' }]}>USED</Text>
            </View>
          ) : expired ? (
            <View style={[styles.paid, { backgroundColor: '#FFFBEB', borderColor: '#F5D67B' }]}>
              <View style={[styles.paidDot, { backgroundColor: '#B45309' }]} />
              <Text style={[styles.paidT, { color: '#B45309' }]}>EXPIRED</Text>
            </View>
          ) : (
            <View style={styles.paid}>
              <View style={styles.paidDot} />
              <Text style={styles.paidT}>PAID</Text>
            </View>
          )}
        </View>
        <Text style={styles.title}>Boarding pass</Text>
        <Text style={styles.sub}>{data.fullName} • {shortRoute}</Text>

        <View style={styles.pass}>
          <View style={styles.passTop}>
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}><MaterialIcons name="directions-bus" size={20} color="#FFFFFF" /></View>
              <View>
                <Text style={styles.brandName}>UniAbuja Shuttle</Text>
                <Text style={styles.brandSub}>{getShuttleLabel(shuttleType as 'public' | 'private')}</Text>
              </View>
            </View>
            <Text style={styles.route}>{routeLabel}</Text>
            <View style={styles.metaRow}>
              <View style={styles.meta}>
                <Text style={styles.metaK}>DATE</Text>
                <Text style={styles.metaV}>{dateFmt}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.metaK}>BOARDING</Text>
                <Text style={styles.metaV}>{formatPeriod12(data.boardingPeriod || '06:00-07:00')}</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.metaK}>QUEUE</Text>
                <Text style={[styles.metaV, { color: '#FFFFFF', fontSize: 20 }]}>{queue}</Text>
              </View>
            </View>
          </View>

          <View style={styles.perf}>
            <View style={styles.notch} />
            <View style={styles.dash} />
            <View style={styles.notch} />
          </View>

          <View style={styles.passBottom}>
            <View style={[styles.qrWrap, dead && { opacity: 0.35 }]}>
              <QRCodeSVG value={qr} size={W * 0.52} color="#11181C" backgroundColor="#FFFFFF" />
            </View>
            <Text style={styles.scan}>Show this code to the conductor</Text>
            <View style={styles.grid}>
              <View style={styles.cell}>
                <Text style={styles.cellK}>Paid</Text>
                <Text style={styles.cellV}>{data.total > 0 ? formatPrice(data.total) : formatPrice(getTotalPrice(shuttleType))}</Text>
              </View>
              <View style={styles.cell}>
                <Text style={styles.cellK}>Ticket</Text>
                <Text style={styles.cellVSm} numberOfLines={1}>{data.ticketId}</Text>
              </View>
            </View>
            {data.reference ? <Text style={styles.ref}>Ref {data.reference}</Text> : null}
            {cancelled ? (
              <Text style={[styles.valid, { color: '#B91C1C', fontWeight: '700' }]}>This booking was cancelled. This pass cannot be used.</Text>
            ) : used ? (
              <Text style={[styles.valid, { color: '#6B7280', fontWeight: '700' }]}>Already scanned. Each pass admits once. Buy a new pass for your next trip.</Text>
            ) : expired ? (
              <Text style={[styles.valid, { color: '#B45309', fontWeight: '700' }]}>This pass expired — passes are valid for the travel day only, up to 24 hours after purchase.</Text>
            ) : ageKnown ? (
              <Text style={styles.valid}>
                Valid today only{hoursLeft > 0 ? ` • about ${hoursLeft}h left of the 24h window` : ''} • Arrive 10 min early and listen for your queue number.
              </Text>
            ) : (
              <Text style={styles.valid}>
                Valid for the travel day and boarding window shown • Arrive 10 min early and listen for your queue number.
              </Text>
            )}
          </View>
        </View>

        <AppleButton title="Done — Back to Home" onPress={() => router.replace('/(tabs)')} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  paid: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EAF6ED', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  paidDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  paidT: { fontSize: 12, fontWeight: '800', color: GREEN, letterSpacing: 0.6 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 18 },
  pass: { borderRadius: 26, overflow: 'hidden', marginBottom: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0EFE3' },
  passTop: { backgroundColor: GREEN, padding: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 16 },
  brandIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  brandSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  route: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 16 },
  metaRow: { flexDirection: 'row', gap: 10 },
  meta: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 11 },
  metaK: { fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.72)', letterSpacing: 0.8, marginBottom: 4 },
  metaV: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  perf: { flexDirection: 'row', alignItems: 'center', backgroundColor: GREEN, paddingBottom: 0 },
  notch: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F2F2F7', marginHorizontal: -13 },
  dash: { flex: 1, borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.45)', borderStyle: 'dashed' },
  passBottom: { padding: 22, alignItems: 'center' },
  qrWrap: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#E5E5EA' },
  scan: { fontSize: 14, fontWeight: '700', color: GREEN, marginTop: 12 },
  grid: { flexDirection: 'row', gap: 10, marginTop: 18, width: '100%' },
  cell: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 14, padding: 12 },
  cellK: { fontSize: 11, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.6, marginBottom: 4 },
  cellV: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  cellVSm: { fontSize: 12.5, fontWeight: '700', color: '#1C1C1E' },
  ref: { fontSize: 12, color: '#8E8E93', marginTop: 12 },
  valid: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 19, marginTop: 10, paddingHorizontal: 6 },
});
