/**
 * Payment Service — Frontend abstraction layer (REAL PAYMENTS ONLY)
 *
 * This module is the ONLY place the frontend communicates with the
 * payment backend. It never contains Paystack secret keys.
 *
 * The backend (Supabase Edge Functions) handles:
 *   - Paystack secret key management
 *   - Amount computation and validation
 *   - Transaction initialization
 *   - Transaction verification
 *   - Booking record creation and status updates
 *
 * ARCHITECTURE:
 *
 *   Mobile App  →  Supabase Edge Function  →  Paystack API
 *                       ↑
 *                   SECRET KEY lives here only
 *
 * No mock checkout exists. Every failure throws PaymentError so the
 * UI shows a real error screen instead of a fake success.
 */

import { supabase } from '@/utils/supabase';
import { describeInitError } from '@/utils/tickets';
import type { ShuttleType } from '@/constants/pricing';

// ─── Types ───────────────────────────────────────────────────────

export type PaymentStatus =
  | 'idle'
  | 'initializing'
  | 'checkout'
  | 'verifying'
  | 'success'
  | 'cancelled'
  | 'failed'
  | 'error';

export interface PaymentInitResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  bookingId: string;
  totalAmount: number; // in Naira
  currency: string;
}

export interface PaymentVerifyResult {
  verified: boolean;
  reference?: string;
  amount?: number;
  reason?: string;
  // Fields returned by backend after successful verification
  ticketId?: string;
  travelDate?: string;       // YYYY-MM-DD
  boardingPeriod?: string;   // HH:MM-HH:MM
  queueNumber?: number;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

// ─── Payment Initialization ──────────────────────────────────────

/**
 * Initialize a Paystack payment session.
 *
 * Sends shuttle type and customer email to the backend.
 * The backend computes the amount from its own pricing config
 * (never trusts the frontend's displayed amount).
 *
 * @returns PaymentInitResult with authorization URL and reference
 * @throws PaymentError on failure — never falls back to mock
 */
export async function initializePayment(params: {
  shuttleType: ShuttleType;
  email: string;
  routeDirection?: 'main-to-mini' | 'mini-to-main';
  boardingPeriod?: string;
}): Promise<PaymentInitResult> {
  const { shuttleType, email, routeDirection = 'main-to-mini', boardingPeriod = '06:00-07:00' } = params;

  // Validate inputs
  if (!email || !email.trim()) {
    throw new PaymentError('Email is required to process payment.');
  }
  if (shuttleType !== 'public' && shuttleType !== 'private') {
    throw new PaymentError('Unknown shuttle type. Please go back and choose your trip again.');
  }

  const routeLabel = routeDirection === 'mini-to-main'
    ? 'Mini Campus → Main Campus'
    : 'Main Campus → Mini Campus';

  return initializeProdPayment(shuttleType, email, routeLabel, boardingPeriod);
}

async function ensureFreshSession(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    // If no session or expires within 60s, try refresh
    if (!session) return;
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAt && expiresAt - Date.now() < 60_000) {
      await supabase.auth.refreshSession().catch(() => {});
    }
  } catch {}
}

async function initializeProdPayment(
  shuttleType: ShuttleType,
  email: string,
  route: string,
  boardingPeriod: string
): Promise<PaymentInitResult> {
  // Ensure token is fresh before invoking Edge Function (fixes 401 "Unable to start payment" that clears on restart)
  await ensureFreshSession();

  const invoke = async (): Promise<PaymentInitResult> => {
    const { data, error } = await supabase.functions.invoke('paystack-init', {
      body: {
        shuttle_type: shuttleType,
        email: email.trim().toLowerCase(),
        route,
        boarding_period: boardingPeriod,
      },
    });

    if (error) {
      // invoke() never throws: error is a FunctionsFetchError (network),
      // FunctionsRelayError (infra), or FunctionsHttpError whose `context`
      // is the server Response — read status + backend code off it instead
      // of surfacing raw SDK text to the user.
      const ctx = (error as any)?.context;
      const status = typeof ctx?.status === 'number' ? ctx.status : 0;
      let backendCode = '';
      try {
        const body = await ctx?.json?.();
        if (body && typeof body.error === 'string') backendCode = body.error;
      } catch {
        // Body already consumed or not JSON — status mapping still applies.
      }
      const mapped = describeInitError({
        status,
        backendCode,
        name: (error as any)?.name,
        message: (error as any)?.message,
      });
      throw new PaymentError(mapped.message, mapped.code);
    }

    if (!data || !data.success) {
      // PAYSTACK_INIT_FAILED is an opaque provider code — keep it that way.
      const msg = data?.error === 'PAYSTACK_INIT_FAILED'
        ? 'Payment provider error. Please try again.'
        : data?.error || 'Payment initialization failed. Please try again.';
      throw new PaymentError(msg, 'INIT_FAILED');
    }

    return {
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      bookingId: data.data.booking_id,
      totalAmount: data.data.total_amount,
      currency: data.data.currency || 'NGN',
    };
  };

  try {
    return await invoke();
  } catch (err) {
    // One retry after refreshing session for 401 / session issues — this is what a restart does manually
    if (err instanceof PaymentError && err.code === 'SESSION_EXPIRED') {
      await supabase.auth.refreshSession().catch(() => {});
      // small delay for token propagation
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await invoke();
      } catch (retryErr) {
        if (retryErr instanceof PaymentError) throw retryErr;
        throw err;
      }
    }
    if (err instanceof PaymentError) throw err;
    throw new PaymentError(
      'Unable to connect to the payment service. Please check your internet connection and try again.',
      'NETWORK_ERROR'
    );
  }
}

// ─── Payment Verification ────────────────────────────────────────

/**
 * Verify a payment with the backend.
 *
 * The backend calls Paystack's verify API and confirms:
 *   1. Transaction status is "success"
 *   2. Amount matches the expected booking total
 *   3. Reference matches the booking record
 *
 * Only after backend confirmation is the booking marked as "paid".
 *
 * @returns PaymentVerifyResult
 * @throws PaymentError on network/infrastructure failure
 */
export async function verifyPayment(
  reference: string
): Promise<PaymentVerifyResult> {
  if (!reference) {
    throw new PaymentError('Transaction reference is required.');
  }

  // Legacy mock references from the removed mock checkout can never
  // verify — reject them instead of faking success.
  if (/^DEV/i.test(reference)) {
    return {
      verified: false,
      reference,
      reason: 'invalid_reference',
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('paystack-verify', {
      body: { reference },
    });

    if (error) {
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        throw new PaymentError(
          'Payment verification service is not available.',
          'FUNCTION_NOT_DEPLOYED'
        );
      }
      throw new PaymentError(
        'Unable to verify payment. Please check your internet connection and try again.',
        'NETWORK_ERROR'
      );
    }

    if (!data) {
      throw new PaymentError(
        'Payment verification failed. Please try again.',
        'VERIFY_FAILED'
      );
    }

    return {
      verified: data.verified === true,
      reference: data.reference,
      amount: data.amount,
      reason: data.reason,
      ticketId: data.ticket_id,
      travelDate: data.travel_date,
      boardingPeriod: data.boarding_period,
      queueNumber: data.queue_number,
    };
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    throw new PaymentError(
      'Unable to verify payment. Please check your internet connection and try again.',
      'NETWORK_ERROR'
    );
  }
}
