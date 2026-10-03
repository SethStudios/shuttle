/**
 * Paystack Verify Transaction — Supabase Edge Function
 *
 * The ONLY authority for confirming payment. Flow:
 *   1. Auth the caller (JWT) -> user_id.
 *   2. Ask Paystack for the transaction truth.
 *   3. Recompute the expected amount from server FARES (never trusts the
 *      booking row, which clients can no longer write).
 *   4. Confirm in ONE atomic RPC: lock slot -> assign queue -> mark paid.
 *      Re-verifies return the STORED ticket (idempotent replay).
 *
 * ENVIRONMENT: PAYSTACK_SECRET_KEY (same mode as init: sk_test_* ↔ test).
 *
 * DEPLOYMENT:
 *   supabase functions deploy paystack-verify
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Keep in sync with paystack-init and constants/pricing.ts.
const FARES = {
  public: { fare: 500, serviceFee: 0 },
  private: { fare: 700, serviceFee: 0 },
} as const;
const CURRENCY = 'NGN';

const PAYSTACK_BASE = 'https://api.paystack.co';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set.');
      return json({ verified: false, reason: 'provider_not_configured' });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const db = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── Validate input ────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) {
      return json({ error: 'Transaction reference is required.' }, 400);
    }

    // ── Load our booking (service-role sees all rows) ─────────
    const { data: booking, error: bookingError } = await db
      .from('bookings')
      .select('*')
      .eq('paystack_reference', reference)
      .eq('user_id', user.id)
      .maybeSingle();

    if (bookingError) {
      return json({ verified: false, reason: 'database_error', reference });
    }
    if (!booking) {
      return json({ verified: false, reason: 'booking_not_found', reference });
    }

    // Already paid? Hand back the stored ticket — never invent a new one.
    if (booking.payment_status === 'paid') {
      return json({
        verified: true,
        reference,
        amount: booking.total_amount,
        currency: booking.currency,
        ticket_id: booking.ticket_id,
        travel_date: booking.travel_date,
        boarding_period: booking.boarding_period,
        queue_number: booking.queue_number,
      });
    }

    // ── Provider check ────────────────────────────────────────
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
    if (!paystackSecret) {
      return json({ verified: false, reason: 'provider_not_configured', reference });
    }

    let paystackData: Record<string, unknown> = {};
    try {
      const paystackResponse = await fetch(
        `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${paystackSecret}` } }
      );
      paystackData = await paystackResponse.json();
      if (!paystackResponse.ok || !paystackData.status) {
        return json({ verified: false, reason: 'paystack_api_error', reference });
      }
    } catch {
      return json({ verified: false, reason: 'paystack_api_error', reference });
    }

    const transaction = paystackData.data as Record<string, unknown>;

    if (transaction.status !== 'success') {
      return json({ verified: false, reason: `status_${transaction.status}`, reference });
    }

    // ── Server-side amount truth (FARES, not the booking row) ──
    const shuttleType = booking.shuttle_type as keyof typeof FARES;
    const pricing = FARES[shuttleType];
    if (!pricing) {
      return json({ verified: false, reason: 'invalid_shuttle_type', reference });
    }
    const expectedKobo = (pricing.fare + pricing.serviceFee) * 100;
    if (Number(transaction.amount) !== expectedKobo) {
      return json({ verified: false, reason: 'amount_mismatch', reference });
    }

    if (transaction.reference !== reference) {
      return json({ verified: false, reason: 'reference_mismatch', reference });
    }
    if (transaction.currency && transaction.currency !== CURRENCY) {
      return json({ verified: false, reason: 'currency_mismatch', reference });
    }
    // Bind the Paystack transaction to OUR booking (stops reference swaps).
    const meta = (transaction.metadata || {}) as Record<string, unknown>;
    if (meta.booking_id && meta.booking_id !== booking.id) {
      return json({ verified: false, reason: 'booking_mismatch', reference });
    }

    // ── Atomic confirm (lock + queue + paid in ONE transaction) ─
    const { data: confirmed, error: confirmError } = await db.rpc('confirm_booking_payment', {
      p_reference: reference,
      p_user_id: user.id,
      p_paystack_metadata: JSON.stringify(transaction),
    });

    if (confirmError || !confirmed?.ok) {
      const reason = confirmed?.reason || 'update_failed';
      return json({ verified: false, reason, reference });
    }

    return json({
      verified: true,
      reference,
      amount: confirmed.amount,
      currency: confirmed.currency,
      ticket_id: confirmed.ticket_id,
      travel_date: confirmed.travel_date,
      boarding_period: confirmed.boarding_period,
      queue_number: confirmed.queue_number,
    });
  } catch {
    return json({ verified: false, reason: 'internal_error' });
  }
});
