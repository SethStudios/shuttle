import { useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { deriveDirection, isTicketActive } from '@/utils/tickets';
import { PRICING, getShuttlePrice, getTotalPrice, type ShuttleType } from '@/constants/pricing';

const DEV_BOOKINGS_KEY = '@dev_bookings';

// ── Types ────────────────────────────────────────────────────────

export interface Booking {
  id: string;
  user_id: string;
  shuttle_type: ShuttleType;
  route: string;
  fare: number;
  service_fee: number;
  total_amount: number;
  currency: string;
  payment_status: string;
  paystack_reference: string | null;
  travel_date: string;
  boarding_period: string | null;
  queue_number: number | null;
  ticket_id: string | null;
  ticket_status: string;
  route_direction: string | null;
  created_at: string;
  updated_at: string;
  profiles?: {
    full_name: string;
    role: string;
  };
}

// ── Dev mode helpers ─────────────────────────────────────────────

export async function loadDevBookings(): Promise<Booking[]> {
  try {
    const raw = await AsyncStorage.getItem(DEV_BOOKINGS_KEY);
    const bookings: Booking[] = raw ? JSON.parse(raw) : [];
    // Deduplicate by ID in case of stale data
    const seen = new Set<string>();
    return bookings.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  } catch {
    return [];
  }
}

async function saveDevBookings(bookings: Booking[]): Promise<void> {
  await AsyncStorage.setItem(DEV_BOOKINGS_KEY, JSON.stringify(bookings));
}

async function addDevBooking(booking: Booking): Promise<void> {
  const existing = await loadDevBookings();
  // Prevent duplicate entries by ID
  const filtered = existing.filter((b) => b.id !== booking.id);
  filtered.unshift(booking);
  await saveDevBookings(filtered);
}

/**
 * Standalone dev booking saver — callable from outside React
 * (e.g. the Payment screen after successful verification).
 */
/** Remove all on-device dev bookings (called on sign-out / account delete). */
export async function clearDevBookings(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEV_BOOKINGS_KEY);
  } catch {}
}

/** Flip an on-device dev booking to used (staff confirming boarding). */
export async function markDevBookingUsed(bookingId: string): Promise<void> {
  try {
    const all = await loadDevBookings();
    const updated = all.map((b) =>
      b.id === bookingId ? { ...b, ticket_status: 'used', updated_at: new Date().toISOString() } : b
    );
    await saveDevBookings(updated);
  } catch {}
}

export async function saveDevBooking(params: {
  shuttleType: ShuttleType;
  bookingId: string;
  reference: string;
  ticketId: string;
  travelDate: string;
  boardingPeriod: string;
  queueNumber: number;
  routeDirection?: string;
  userId?: string;
}): Promise<void> {
  const fare = getShuttlePrice(params.shuttleType);
  const total = getTotalPrice(params.shuttleType);

  const routeLabel = params.routeDirection === 'mini-to-main'
    ? 'Mini Campus → Main Campus'
    : 'Main Campus → Mini Campus';

  const booking: Booking = {
    id: params.bookingId,
    user_id: params.userId || 'dev-user',
    shuttle_type: params.shuttleType,
    route: routeLabel,
    fare,
    service_fee: PRICING.serviceFee,
    total_amount: total,
    currency: 'NGN',
    payment_status: 'paid',
    paystack_reference: params.reference,
    travel_date: params.travelDate,
    boarding_period: params.boardingPeriod,
    queue_number: params.queueNumber,
    ticket_id: params.ticketId,
    ticket_status: 'unused',
    route_direction: params.routeDirection || 'main-to-mini',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await addDevBooking(booking);
}

// ── Active ticket check ──────────────────────────────────────────
//
// Canonical validity rule lives in utils/tickets (isTicketActive):
// owned-and-live = paid + unused + within 24h of purchase +
// travel_date today or later. The scanner (app/scan.tsx) is stricter —
// it additionally requires travel_date == today — so a future-dated row
// can list in Home yet be denied at the checkpoint. The backend only
// issues same-day tickets, making that gap unreachable in practice.
//
// Once a pass is used or lapses, it drops from Home into History,
// freeing that route for a new purchase. Re-exported for consumers.
export { isTicketActive };

// DB rows carry `route` label, not `route_direction` code — see utils/tickets.
// Re-exported here so existing imports keep working.
export { deriveDirection } from '@/utils/tickets';

function withDirection<T extends { route?: string | null; route_direction?: string | null }>(b: T): T {
  if (!b.route_direction) {
    return { ...b, route_direction: deriveDirection(b.route as any) };
  }
  return b;
}

// Today string for DB filtering
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Hook ─────────────────────────────────────────────────────────

export function useBookings() {
  const { user } = useAuth();
  const [activeBookings, setActiveBookings] = useState<Booking[]>([]);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const fetchBookings = useCallback(async () => {
    let supabasePaid: Booking[] = [];
    let supabaseHistory: Booking[] = [];
    let fetchError: string | null = null;

    // 1. Fetch active candidates + full history (all statuses) separately
    // so History shows failed/cancelled/used — not just paid.
    if (user) {
      try {
        const today = todayStr();
        const { data: paid, error: paidErr } = await supabase
          .from('bookings')
          .select('*, profiles(full_name, role)')
          .eq('user_id', user.id)
          .eq('payment_status', 'paid')
          .eq('ticket_status', 'unused')
          .gte('travel_date', today)
          .order('created_at', { ascending: false })
          .limit(50);

        if (paidErr) {
          fetchError = paidErr.message;
        } else if (paid) {
          supabasePaid = (paid as Booking[]).map(withDirection).filter(isTicketActive);
        }

        const { data: hist, error: histErr } = await supabase
          .from('bookings')
          .select('*, profiles(full_name, role)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (histErr) {
          fetchError = fetchError || histErr.message;
        } else if (hist) {
          const paidIds = new Set(supabasePaid.map((b) => b.id));
          supabaseHistory = (hist as Booking[]).map(withDirection).filter((b) => !paidIds.has(b.id));
        }
      } catch (err: any) {
        fetchError = err?.message || 'Could not load bookings.';
      }
    }

    // 2. Fetch cached bookings from AsyncStorage — strictly scoped to the
    // signed-in user so one phone never shows another account's tickets.
    const allDev = await loadDevBookings();
    const ownDev = user
      ? allDev.filter((b) => b.user_id === user.id)
      : [];

    // 3. Merge — Supabase wins. Drop cached copies once the server has
    // the row (used/expired server state must not be masked by cache).
    const serverIds = new Set([...supabasePaid, ...supabaseHistory].map((b) => b.id));
    const mergedDev = ownDev.filter(
      (b) => !serverIds.has(b.id) && b.payment_status === 'paid' && isTicketActive(b)
    );

    const active = [...supabasePaid, ...mergedDev.filter(isTicketActive)]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const all = [...active, ...supabaseHistory]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setActiveBookings(active);
    setAllBookings(all);
    setError(fetchError);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        // Full skeleton only on first load; refocus uses silent refresh
        // so tabs never flash "Loading your tickets…".
        if (!loadedOnce.current) {
          setLoading(true);
          await fetchBookings();
          loadedOnce.current = true;
          setLoading(false);
        } else {
          await fetchBookings();
        }
      })();
    }, [fetchBookings])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBookings();
    setRefreshing(false);
  }, [fetchBookings]);

  const saveDevBookingToHook = useCallback(
    async (params: {
      shuttleType: ShuttleType;
      bookingId: string;
      reference: string;
      ticketId: string;
      travelDate: string;
      boardingPeriod: string;
      queueNumber: number;
      routeDirection?: string;
    }) => {
      if (!user) return;

      const fare = getShuttlePrice(params.shuttleType);
      const total = getTotalPrice(params.shuttleType);

      const routeLabel = params.routeDirection === 'mini-to-main'
        ? 'Mini Campus → Main Campus'
        : 'Main Campus → Mini Campus';

      const booking: Booking = {
        id: params.bookingId,
        user_id: user.id,
        shuttle_type: params.shuttleType,
        route: routeLabel,
        fare,
        service_fee: PRICING.serviceFee,
        total_amount: total,
        currency: 'NGN',
        payment_status: 'paid',
        paystack_reference: params.reference,
        travel_date: params.travelDate,
        boarding_period: params.boardingPeriod,
        queue_number: params.queueNumber,
        ticket_id: params.ticketId,
        ticket_status: 'unused',
        route_direction: params.routeDirection || 'main-to-mini',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Persist to AsyncStorage for dev mode
      await addDevBooking(booking);

      // Update local state immediately
      setActiveBookings((prev) => [booking, ...prev]);
      setAllBookings((prev) => [booking, ...prev]);
    },
    [user]
  );

  return {
    activeBookings,
    allBookings,
    loading,
    refreshing,
    refresh,
    error,
    saveDevBooking: saveDevBookingToHook,
  };
}
