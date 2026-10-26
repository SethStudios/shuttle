/**
 * Paystack Initialize Transaction — Supabase Edge Function
 *
 * Called by the mobile app to start a Paystack payment. Creates a pending
 * booking and returns the authorization URL for the hosted checkout.
 *
 * SECURITY MODEL:
 *   - User JWT authenticates WHO is calling (verify_jwt + getUser).
 *   - SUPABASE_SERVICE_ROLE_KEY performs all DB writes (clients hold no
 *     INSERT/UPDATE/DELETE grants, so paid tickets cannot be forged).
 *   - Amounts come from server FARES only; frontend figures are ignored.
 *   - An idempotency guard reuses a pending booking for the same
 *     user+trip started within 10 minutes (no orphan-pending spam).
 *
 * ENVIRONMENT VARIABLES REQUIRED:
 *   PAYSTACK_SECRET_KEY    — Paystack test/live secret key
 *   PAYSTACK_CALLBACK_URL — Callback URL (defaults below)
 *
 * DEPLOYMENT:
 *   supabase functions deploy paystack-init --no-verify-jwt false
 *   supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Pricing (inlined — self-contained) ──────────────────────────
// Deploys as-is from the Dashboard editor (single file only).
// Keep in sync with _shared/pricing.ts and constants/pricing.ts:
//   public = CNG Bus ₦500 fare. petrol = Petrol Bus ₦600 fare. private = Private Shuttle ₦700 fare. No service fee.
const FARES = {
  public: { fare: 500, serviceFee: 0 },
  petrol: { fare: 600, serviceFee: 0 },
  private: { fare: 700, serviceFee: 0 },
} as const;
// All directions are valid — frontend sends the label, we whitelist it.
const ROUTES = ['Main Campus → Mini Campus', 'Mini Campus → Main Campus'] as const;
const DEFAULT_ROUTE = ROUTES[0];
const CURRENCY = 'NGN';
// Re-inits for the same trip within this window reuse the pending booking.
const IDEMPOTENCY_MINUTES = 10;

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
    // ── Auth (who is calling) ───────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set.');
      return json({ error: 'Payment service misconfigured. Contact support.' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // All DB reads/writes bypass RLS (clients hold no write grants).
    const db = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── Validate input ──────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }
    const { shuttle_type, email, boarding_period, route } = body as Record<string, string>;

    if (shuttle_type !== 'public' && shuttle_type !== 'petrol' && shuttle_type !== 'private') {
      return json({ error: 'Unknown shuttle type. Please choose your trip again.' }, 400);
    }

    const validPeriodRegex = /^\d{2}:00-\d{2}:00$/;
    const sanitizedBoardingPeriod =
      boarding_period && validPeriodRegex.test(boarding_period)
        ? boarding_period
        : '06:00-07:00';

    // Whitelist route — never trust arbitrary strings for DB storage.
    const sanitizedRoute: string = (ROUTES as readonly string[]).includes(route)
      ? (route as string)
      : DEFAULT_ROUTE;

    const customerEmail = (email || user.email || '').trim().toLowerCase();
    if (!customerEmail) {
      return json({ error: 'Email is required.' }, 400);
    }

    // ── Compute pricing (SERVER IS SOURCE OF TRUTH) ───────────
    const pricing = FARES[shuttle_type as keyof typeof FARES];
    const totalKobo = (pricing.fare + pricing.serviceFee) * 100;

    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ── Idempotency: reuse a fresh pending for the same trip ────
    const cutoff = new Date(Date.now() - IDEMPOTENCY_MINUTES * 60_000).toISOString();
    const { data: existingPending } = await db
      .from('bookings')
      .select('id, paystack_reference, paystack_metadata')
      .eq('user_id', user.id)
      .eq('shuttle_type', shuttle_type)
      .eq('route', sanitizedRoute)
      .eq('travel_date', todayStr)
      .eq('boarding_period', sanitizedBoardingPeriod)
      .eq('payment_status', 'pending')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPending?.paystack_reference) {
      // Re-enter the same hosted checkout (stored at first init).
      let storedUrl = '', storedCode = '';
      try {
        const meta = typeof existingPending.paystack_metadata === 'string'
          ? JSON.parse(existingPending.paystack_metadata)
          : existingPending.paystack_metadata;
        storedUrl = meta?.authorization_url || '';
        storedCode = meta?.access_code || '';
      } catch { /* ignore */ }
      if (storedUrl) {
        return json({
          success: true,
          reused: true,
          data: {
            authorization_url: storedUrl,
            access_code: storedCode,
            reference: existingPending.paystack_reference,
            booking_id: existingPending.id,
            total_amount: pricing.fare + pricing.serviceFee,
            currency: CURRENCY,
          },
        });
      }
      // URL lost (old rows): fall through and start a fresh reference.
    }

    // ── Self-heal: ensure profile row exists ──────────────────
    // bookings.user_id FK → profiles(id). Legacy/Dashboard accounts may
    // lack a profile row → 23503. Backfill from auth metadata.
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    let userRole = (existingProfile as Record<string, string> | null)?.role || '';

    if (!existingProfile) {
      const meta = (user.user_metadata || {}) as Record<string, string>;
      const role = meta.role === 'staff' ? 'staff' : 'student';
      const fullName =
        meta.full_name || customerEmail.split('@')[0] || 'Shuttle User';
      const phone = meta.phone_number || '08000000000';
      const matric =
        role === 'student'
          ? meta.matric_number || ('PENDING-' + user.id.slice(0, 8).toUpperCase())
          : null;

      const { error: profileError } = await db.from('profiles').insert({
        id: user.id,
        full_name: fullName,
        role,
        matric_number: matric,
        email: customerEmail,
        phone_number: phone,
      });

      if (profileError) {
        console.error('Profile backfill failed for user', user.id, profileError.code);
        return json({ error: 'Account profile missing. Please sign out and sign up again.' }, 500);
      }
      userRole = role;
    }

    // ── Subscription gate (students only; staff scan, never subscribe) ──
    if (userRole !== 'staff') {
      const { data: activeSub } = await db
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();
      if (!activeSub) {
        return json({ error: 'SUBSCRIPTION_REQUIRED' }, 403);
      }
    }

    // ── Fail fast when secret is missing (test vs live mix-ups) ──
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
    if (!paystackSecret) {
      console.error('PAYSTACK_SECRET_KEY is not set.');
      return json({ error: 'Payment provider not configured. Contact support.' }, 500);
    }

    // ── Create pending booking ────────────────────────────────
    const bookingId = crypto.randomUUID();
    const reference = `UAS${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const { error: insertError } = await db.from('bookings').insert({
      id: bookingId,
      user_id: user.id,
      shuttle_type: shuttle_type,
      route: sanitizedRoute,
      fare: pricing.fare,
      service_fee: pricing.serviceFee,
      total_amount: pricing.fare + pricing.serviceFee,
      currency: CURRENCY,
      payment_status: 'pending',
      paystack_reference: reference,
      travel_date: todayStr,
      boarding_period: sanitizedBoardingPeriod,
    });

    if (insertError) {
      console.error('Booking insert failed', insertError.code);
      return json({ error: 'Could not create booking. Please try again.' }, 500);
    }

    // ── Initialize Paystack transaction ───────────────────────
    const callbackUrl =
      Deno.env.get('PAYSTACK_CALLBACK_URL') ||
      'https://uniabujashuttle.app/payment-callback';

    const paystackResponse = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: totalKobo,
        reference,
        callback_url: callbackUrl,
        currency: CURRENCY,
        metadata: {
          booking_id: bookingId,
          user_id: user.id,
          shuttle_type,
          route: sanitizedRoute,
          fare: pricing.fare,
          service_fee: pricing.serviceFee,
          platform: 'uniabuja-shuttle-mobile',
        },
      }),
    });

    let paystackData: Record<string, unknown> = {};
    try {
      paystackData = await paystackResponse.json();
    } catch {
      paystackData = {};
    }

    if (!paystackResponse.ok || !paystackData.status) {
      await db
        .from('bookings')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', bookingId);

      // Generic to clients; details stay in server logs.
      return json({ error: 'PAYSTACK_INIT_FAILED' }, 502);
    }

    const pdata = paystackData.data as Record<string, string>;
    // Persist checkout details so idempotent re-inits can re-enter it.
    await db
      .from('bookings')
      .update({
        paystack_metadata: JSON.stringify({
          authorization_url: pdata.authorization_url,
          access_code: pdata.access_code,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);
    return json({
      success: true,
      data: {
        authorization_url: pdata.authorization_url,
        access_code: pdata.access_code,
        reference: pdata.reference,
        booking_id: bookingId,
        total_amount: pricing.fare + pricing.serviceFee,
        currency: CURRENCY,
      },
    });
  } catch {
    return json({ error: 'Internal server error. Please try again.' }, 500);
  }
});
