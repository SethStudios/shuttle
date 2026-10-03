/**
 * Paystack Subscription Verify — Supabase Edge Function
 *
 * The ONLY authority for activating a subscription. Flow:
 *   1. Auth caller (JWT) -> user_id.
 *   2. Ask Paystack for transaction truth.
 *   3. Recompute expected amount server-side (₦1,000, never client).
 *   4. Activate via atomic RPC confirm_subscription_payment.
 *
 * ENV: PAYSTACK_SUB_SECRET_KEY (subscription account)
 * DEPLOY: supabase functions deploy paystack-sub-verify
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUBSCRIPTION_PRICE = 1000;
const EXPECTED_KOBO = SUBSCRIPTION_PRICE * 100;
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
    if (!serviceRoleKey) return json({ verified: false, reason: 'provider_not_configured' });

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
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) return json({ error: 'Transaction reference is required.' }, 400);

    const { data: sub, error: subError } = await db
      .from('subscriptions')
      .select('*')
      .eq('paystack_reference', reference)
      .eq('user_id', user.id)
      .maybeSingle();

    if (subError) return json({ verified: false, reason: 'database_error', reference });
    if (!sub) return json({ verified: false, reason: 'subscription_not_found', reference });

    if (sub.status === 'active') {
      return json({ verified: true, reference, expires_at: sub.expires_at });
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SUB_SECRET_KEY') || '';
    if (!paystackSecret) return json({ verified: false, reason: 'provider_not_configured', reference });

    let paystackData: Record<string, unknown> = {};
    try {
      const r = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      });
      paystackData = await r.json();
      if (!r.ok || !paystackData.status) return json({ verified: false, reason: 'paystack_api_error', reference });
    } catch {
      return json({ verified: false, reason: 'paystack_api_error', reference });
    }

    const tx = paystackData.data as Record<string, unknown>;
    if (tx.status !== 'success') return json({ verified: false, reason: `status_${tx.status}`, reference });
    if (Number(tx.amount) !== EXPECTED_KOBO) return json({ verified: false, reason: 'amount_mismatch', reference });
    if (tx.reference !== reference) return json({ verified: false, reason: 'reference_mismatch', reference });
    if (tx.currency && tx.currency !== CURRENCY) return json({ verified: false, reason: 'currency_mismatch', reference });

    const meta = (tx.metadata || {}) as Record<string, unknown>;
    if (meta.subscription_id && meta.subscription_id !== sub.id) {
      return json({ verified: false, reason: 'booking_mismatch', reference });
    }

    const { data: confirmed, error: confirmError } = await db.rpc('confirm_subscription_payment', {
      p_reference: reference,
      p_user_id: user.id,
      p_paystack_metadata: JSON.stringify(tx),
    });

    if (confirmError || !confirmed?.ok) {
      return json({ verified: false, reason: confirmed?.reason || 'update_failed', reference });
    }

    return json({ verified: true, reference, expires_at: confirmed.expires_at });
  } catch {
    return json({ verified: false, reason: 'internal_error' });
  }
});
