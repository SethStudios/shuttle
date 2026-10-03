/**
 * Ticket helpers — pure functions with no React Native imports.
 * Single source of truth so app code and `scripts/unit-tests.js`
 * (plain Node) can share the same logic without drift.
 */

/** Extract ticket_id from QR — supports legacy JSON payloads and plain ticket strings. */
export function parseTicketId(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t);
      if (typeof o.ticketId === 'string' && o.ticketId.trim()) return o.ticketId.trim();
      if (typeof o.ticket_id === 'string' && o.ticket_id.trim()) return o.ticket_id.trim();
    } catch {
      // fall through — return raw trimmed string
    }
  }
  return t;
}

// DB rows carry `route` label, not `route_direction` code — derive it so
// Home/History navigation and per-route blocking always have a value.
export function deriveDirection(route: string | null | undefined): string {
  if (route && route.includes('Mini Campus → Main Campus')) return 'mini-to-main';
  return 'main-to-mini';
}

/** User-facing message for a backend verify `reason` code. Must stay in sync with app/payment.tsx. */
export function getVerifyErrorMessage(reason: string | undefined | null): string {
  const reasonMsg: Record<string, string> = {
    invalid_reference: 'This payment reference is not valid.',
    booking_not_found: 'No booking found for this account. Verify on the same account you paid with.',
    amount_mismatch: 'Amount paid does not match this booking. Contact support — do not pay again yet.',
    booking_mismatch: 'This payment belongs to a different booking. Contact support.',
    currency_mismatch: 'Currency mismatch on this payment. Contact support.',
    paystack_api_error: "Paystack is still confirming. Wait a few seconds, then tap 'I've paid — verify'.",
    provider_not_configured: 'Payment service misconfigured. Contact support.',
    update_failed: "Payment confirmed but ticket save failed. Tap 'I've paid — verify' once.",
    not_pending: 'This payment was already processed. Check your tickets.',
  };
  if (reason && reasonMsg[reason]) return reasonMsg[reason];
  return `Paystack did not confirm this transaction (${reason || 'unknown'}). If you paid, tap 'I've paid — verify'.`;
}

/** Reasons that warrant one automatic re-verify (Paystack-side lag). */
export function shouldAutoRetryVerify(reason: string | undefined | null): boolean {
  if (!reason) return false;
  return reason === 'paystack_api_error' || reason.startsWith('status_');
}

// ── Payment-init failure mapping (services/payment.ts) ─────────────
// supabase-js never throws on invoke: it returns { data: null, error },
// where a FunctionsHttpError carries the server Response as
// `error.context` (status + JSON body). Raw SDK text
// ("Edge Function returned a non-2xx status code") must never reach
// users — map it here. Pure + unit-tested.

export type InitErrorCode =
  | 'SESSION_EXPIRED'
  | 'FUNCTION_NOT_DEPLOYED'
  | 'NETWORK_ERROR'
  | 'SUBSCRIPTION_REQUIRED'
  | 'INIT_FAILED';

export function describeInitError(input: {
  status?: number;
  backendCode?: string;
  name?: string;
  message?: string;
}): { message: string; code: InitErrorCode } {
  const status = input.status || 0;
  const backendCode = input.backendCode || '';
  const name = input.name || '';
  const message = input.message || '';
  const networkLike =
    name === 'FunctionsFetchError' ||
    name === 'FunctionsRelayError' ||
    /failed to fetch|networkerror|network request failed|load failed|fetch/i.test(message);
  if (networkLike) {
    return {
      message: 'Unable to connect to the payment service. Please check your internet connection and try again.',
      code: 'NETWORK_ERROR',
    };
  }
  if (status === 401 || /401|unauthorized/i.test(message)) {
    return { message: 'Session expired. Please try again.', code: 'SESSION_EXPIRED' };
  }
  if (status === 404 || /not found/i.test(message)) {
    return {
      message: 'Payment service is not configured. Please contact support.',
      code: 'FUNCTION_NOT_DEPLOYED',
    };
  }
  if (backendCode === 'SUBSCRIPTION_REQUIRED' || status === 403) {
    return {
      message: 'Active ₦1,000 monthly subscription required. Subscribe first, then pay the ₦500 trip fare.',
      code: 'SUBSCRIPTION_REQUIRED',
    };
  }
  // Provider/secret problems stay opaque: never leak Paystack internals.
  if (backendCode === 'PAYSTACK_INIT_FAILED' || status === 502) {
    return { message: 'Payment provider error. Please try again.', code: 'INIT_FAILED' };
  }
  if (status === 400) {
    return {
      message: 'Booking details were rejected. Please go back and choose your trip again.',
      code: 'INIT_FAILED',
    };
  }
  if (status >= 500) {
    return {
      message: 'The payment service had a hiccup. Please try again in a moment.',
      code: 'INIT_FAILED',
    };
  }
  return {
    message: 'Unable to start payment. Please try again.',
    code: 'INIT_FAILED',
  };
}

// ── Booking window ───────────────────────────────────────────────
// Sales run 6:00 AM – 6:00 PM daily. Outside it the booking screen
// closes until 6 AM (app/booking.tsx).

export const BOOKING_OPEN_HOUR = 6;
export const BOOKING_CLOSE_HOUR = 18;

/** True when bookings can be sold at the given hour (0–23). */
export function isBookingOpen(hour: number): boolean {
  return hour >= BOOKING_OPEN_HOUR && hour < BOOKING_CLOSE_HOUR;
}

// ── Ticket validity (canonical rule — keep all screens in sync) ────
// A pass ADMITS at the checkpoint iff ALL hold:
//   1. payment_status is 'paid' (backend-confirmed via Paystack)
//   2. ticket_status is 'unused' (one-time; consumed on first valid scan)
//   3. created_at is within the last 24h (TICKET_LIFE_MS)
//   4. travel_date equals today (backend stamps server-day at purchase;
//      the scanner compares YYYY-MM-DD slices — see app/scan.tsx)
//
// Home "active" is the looser owned-and-live set: 1–3 plus
// travel_date >= today (the Supabase query prefilters the same way).
// The scanner's same-day gate is stricter: a future-dated row can appear
// in Home but is denied at scan ("Not valid today"). The backend only
// ever issues same-day tickets, so this gap is unreachable in practice.
//
// Boarding period is NOT a validity gate: it organizes the queue
// (numbers restart each hour) and guides arrival. A morning pass scanned
// in the afternoon of the same day still admits while 1–4 hold.

export type TicketLiveness = {
  payment_status: string;
  ticket_status: string;
  created_at: string;
  travel_date: string;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Owned-and-live: paid + unused + within 24h + travel_date today or later. */
export function isTicketActive(booking: TicketLiveness, now = Date.now()): boolean {
  if (booking.payment_status !== 'paid') return false;
  if (booking.ticket_status !== 'unused') return false;
  // Fail-closed on unknown/invalid dates (same semantics as pricing helper).
  if (!booking.created_at) return false;
  const age = now - new Date(booking.created_at).getTime();
  if (Number.isNaN(age)) return false;
  const TICKET_LIFE_MS = 24 * 60 * 60 * 1000;
  if (!(age < TICKET_LIFE_MS)) return false;
  const day = (booking.travel_date || '').slice(0, 10);
  if (!day) return false;
  return day >= todayStr();
}
