/**
 * Pay with Wallet — Supabase Edge Function
 *
 * Deducts from the user's wallet and creates a paid booking.
 * Used when a customer pays for a shuttle ticket from their wallet balance
 * instead of Paystack.
 *
 * ENV: none (uses service_role for DB writes)
 * DEPLOY: supabase functions deploy wallet-pay --no-verify-jwt false
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) {
      return json({ error: 'Service misconfigured.' }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }

    const shuttle_type = typeof body.shuttle_type === 'string' ? body.shuttle_type : 'public';
    const route = typeof body.route === 'string' ? body.route : 'Main Campus → Mini Campus';
    const boarding_period = typeof body.boarding_period === 'string' ? body.boarding_period : '06:00-07:00';
    const travel_date = typeof body.travel_date === 'string' ? body.travel_date : new Date().toISOString().slice(0, 10);
    const amount = Number(body.amount);
    if (!amount || amount < 1) {
      return json({ error: 'Invalid amount.' }, 400);
    }

    // ── Deduct from wallet ──
    const { data: deductResult, error: deductError } = await db.rpc('wallet_deduct', {
      p_user_id: user.id,
      p_amount: amount,
    });
    if (deductError || !deductResult?.ok) {
      return json({ ok: false, reason: deductResult?.reason || 'insufficient_balance' }, 402);
    }

    // ── Check for existing active pass for same route + shuttle ──
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await db
      .from('bookings')
      .select('id')
      .eq('user_id', user.id)
      .eq('shuttle_type', shuttle_type)
      .eq('route', route)
      .eq('travel_date', travel_date)
      .eq('boarding_period', boarding_period)
      .eq('payment_status', 'paid')
      .eq('ticket_status', 'unused')
      .maybeSingle();
    if (existing) {
      // Refund the wallet deduction
      await db.rpc('wallet_top_up', {
        p_reference: 'REFUND-' + crypto.randomUUID(),
        p_user_id: user.id,
        p_amount: amount,
      });
      return json({ ok: false, reason: 'active_pass_exists' }, 409);
    }

    // ── Assign queue number ──
    const { data: queueResult, error: queueError } = await db.rpc('get_next_queue_number', {
      p_travel_date: travel_date,
      p_boarding_period: boarding_period,
      p_shuttle_type: shuttle_type,
      p_route: route,
    });
    if (queueError) {
      // Refund
      await db.rpc('wallet_top_up', {
        p_reference: 'REFUND-' + crypto.randomUUID(),
        p_user_id: user.id,
        p_amount: amount,
      });
      return json({ ok: false, reason: 'queue_error' }, 500);
    }
    const queue_number = Number(queueResult);

    // ── Create booking as paid ──
    const bookingId = crypto.randomUUID();
    const reference = `WAL${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const ticketId = 'TKT-' + travel_date.replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();

    const { error: insertError } = await db.from('bookings').insert({
      id: bookingId,
      user_id: user.id,
      shuttle_type,
      route,
      fare: amount,
      service_fee: 0,
      total_amount: amount,
      currency: 'NGN',
      payment_status: 'paid',
      paystack_reference: reference,
      travel_date,
      boarding_period,
      queue_number,
      ticket_id: ticketId,
      ticket_status: 'unused',
    });

    if (insertError) {
      // Refund wallet deduction
      await db.rpc('wallet_top_up', {
        p_reference: 'REFUND-' + crypto.randomUUID(),
        p_user_id: user.id,
        p_amount: amount,
      });
      return json({ ok: false, reason: 'booking_create_failed' }, 500);
    }

    return json({
      ok: true,
      booking_id: bookingId,
      reference,
      ticket_id: ticketId,
      travel_date,
      boarding_period,
      queue_number,
      amount,
      currency: 'NGN',
      balance: (deductResult as any)?.balance,
    });
  } catch {
    return json({ error: 'Internal server error.' }, 500);
  }
});
