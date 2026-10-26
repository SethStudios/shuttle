/**
 * Paystack Wallet Verify — Supabase Edge Function
 *
 * Verifies a wallet top-up payment with Paystack and credits the wallet
 * via the wallet_top_up RPC.
 *
 * ENV: PAYSTACK_SECRET_KEY
 * DEPLOY: supabase functions deploy wallet-verify --no-verify-jwt false
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authorization required' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) {
      return json({ error: 'Payment service misconfigured.' }, 500);
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

    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) {
      return json({ error: 'Transaction reference is required.' }, 400);
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
    if (!paystackSecret) {
      return json({ error: 'Payment provider not configured.' }, 500);
    }

    // Verify with Paystack
    const paystackResponse = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret}` } }
    );
    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      return json({ verified: false, reason: 'paystack_api_error', reference });
    }

    const tx = paystackData.data as Record<string, unknown>;
    if (tx.status !== 'success') {
      return json({ verified: false, reason: `status_${tx.status}`, reference });
    }

    const amount = Number(tx.amount) / 100; // kobo to naira
    if (tx.reference !== reference) {
      return json({ verified: false, reason: 'reference_mismatch', reference });
    }
    if (tx.currency && tx.currency !== CURRENCY) {
      return json({ verified: false, reason: 'currency_mismatch', reference });
    }

    // Credit the wallet via RPC
    const { data: result, error: rpcError } = await db.rpc('wallet_top_up', {
      p_reference: reference,
      p_user_id: user.id,
      p_amount: amount,
      p_paystack_metadata: JSON.stringify(tx),
    });

    if (rpcError || !result?.ok) {
      return json({ verified: false, reason: rpcError?.message || 'wallet_credit_failed', reference });
    }

    return json({
      verified: true,
      reference,
      amount,
      balance: (result as any)?.balance,
      currency: CURRENCY,
    });
  } catch {
    return json({ verified: false, reason: 'internal_error' });
  }
});
