/**
 * Paystack Wallet Top Up — Supabase Edge Function
 *
 * Initializes a Paystack transaction to fund the user's wallet.
 * After payment, the frontend calls wallet-verify to credit the wallet.
 *
 * ENV: PAYSTACK_SECRET_KEY (fare account), PAYSTACK_CALLBACK_URL
 * DEPLOY: supabase functions deploy wallet-top-up --no-verify-jwt false
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

    const amount = Number(body.amount);
    if (!amount || amount < 100) {
      return json({ error: 'Amount must be at least ₦100.' }, 400);
    }

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
    if (!paystackSecret) {
      return json({ error: 'Payment provider not configured.' }, 500);
    }

    const reference = `WAL${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const callbackUrl =
      Deno.env.get('PAYSTACK_CALLBACK_URL') ||
      'https://uniabujashuttle.app/wallet-callback';

    const paystackResponse = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email || '',
        amount: amount * 100, // kobo
        reference,
        callback_url: callbackUrl,
        currency: CURRENCY,
        metadata: {
          wallet_reference: reference,
          user_id: user.id,
          kind: 'wallet_top_up',
          amount,
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
      return json({ error: 'PAYSTACK_INIT_FAILED' }, 502);
    }

    const pdata = paystackData.data as Record<string, string>;
    return json({
      success: true,
      data: {
        authorization_url: pdata.authorization_url,
        access_code: pdata.access_code,
        reference: pdata.reference,
        amount,
        currency: CURRENCY,
      },
    });
  } catch {
    return json({ error: 'Internal server error.' }, 500);
  }
});
