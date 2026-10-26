/**
 * Paystack Subscription Initialize — Supabase Edge Function
 *
 * Starts a ₦700 / 30-day subscription payment. Creates a pending
 * row in public.subscriptions and returns the Paystack checkout URL.
 *
 * SECURITY MODEL mirrors paystack-init:
 *   - User JWT authenticates WHO is calling.
 *   - SERVICE_ROLE performs all DB writes.
 *   - Amount is server-side (SUBSCRIPTION_PRICE), never from client.
 *
 * ENV: PAYSTACK_SUB_SECRET_KEY (subscription account), PAYSTACK_CALLBACK_URL.
 * DEPLOY: supabase functions deploy paystack-sub-init --no-verify-jwt false
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUBSCRIPTION_PRICE = 500;
const SUBSCRIPTION_KOBO = SUBSCRIPTION_PRICE * 100;
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Authorization required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) return json({ error: 'Payment service misconfigured. Contact support.' }, 500);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }

    const email = String((body as Record<string, string>).email || user.email || '').trim().toLowerCase();
    if (!email) return json({ error: 'Email is required.' }, 400);

    // Reuse an already-active subscription — no double charge.
    const { data: active } = await db
      .from('subscriptions')
      .select('id, expires_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active) {
      return json({ error: 'Subscription already active.', expires_at: (active as Record<string, string>).expires_at }, 400);
    }

    // ── Self-heal: ensure profile row exists (same as paystack-init) ──
    // subscriptions.user_id FK → profiles(id). Legacy accounts may lack it → 23503.
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const meta = (user.user_metadata || {}) as Record<string, string>;
      const role = meta.role === 'staff' ? 'staff' : 'student';
      const fullName = meta.full_name || email.split('@')[0] || 'Shuttle User';
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
        email,
        phone_number: phone,
      });
      if (profileError) {
        console.error('Subscription profile backfill failed', user.id, profileError.code, profileError.message);
        return json({ error: 'Account profile missing. Please sign out and sign up again.' }, 500);
      }
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SUB_SECRET_KEY') || '';
    if (!paystackSecret) {
      console.error('PAYSTACK_SUB_SECRET_KEY is not set.');
      return json({ error: 'Payment provider not configured. Contact support.' }, 500);
    }

    const subscriptionId = crypto.randomUUID();
    const reference = `SUB${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const { error: insertError } = await db.from('subscriptions').insert({
      id: subscriptionId,
      user_id: user.id,
      amount: SUBSCRIPTION_PRICE,
      currency: CURRENCY,
      status: 'pending',
      paystack_reference: reference,
    });
    if (insertError) {
      console.error('Subscription insert failed', insertError.code, insertError.message);
      return json({ error: 'Could not create subscription. Please try again.' }, 500);
    }

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
        email,
        amount: SUBSCRIPTION_KOBO,
        reference,
        callback_url: callbackUrl,
        currency: CURRENCY,
        metadata: {
          subscription_id: subscriptionId,
          user_id: user.id,
          kind: 'subscription',
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
      console.error('Paystack sub-init rejected', paystackResponse.status, JSON.stringify(paystackData).slice(0, 500));
      await db.from('subscriptions').update({ status: 'failed' }).eq('id', subscriptionId);
      return json({ error: 'PAYSTACK_INIT_FAILED' }, 502);
    }

    const pdata = paystackData.data as Record<string, string>;
    await db.from('subscriptions').update({
      paystack_metadata: JSON.stringify({
        authorization_url: pdata.authorization_url,
        access_code: pdata.access_code,
      }),
    }).eq('id', subscriptionId);

    return json({
      success: true,
      data: {
        authorization_url: pdata.authorization_url,
        access_code: pdata.access_code,
        reference: pdata.reference,
        subscription_id: subscriptionId,
        total_amount: SUBSCRIPTION_PRICE,
        currency: CURRENCY,
      },
    });
  } catch {
    return json({ error: 'Internal server error. Please try again.' }, 500);
  }
});
