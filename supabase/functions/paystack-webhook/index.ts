/**
 * Paystack Webhook — Supabase Edge Function
 *
 * Safety net for payments completed AFTER the app closed (WebView killed
 * before verify). Paystack retries events, so this handler is idempotent.
 *
 * TWO ACCOUNTS:
 *   - Transport fares (CNG Bus ₦500 / Petrol Bus ₦700) sign with PAYSTACK_SECRET_KEY.
 *   - Subscriptions (₦1,000) sign with PAYSTACK_SUB_SECRET_KEY.
 * Both Paystack dashboards point at this SAME URL. The signature is
 * accepted when it matches EITHER secret (signature IS the auth, no JWT).
 *
 * SETUP in each Paystack Dashboard → Settings → Webhooks:
 *   URL: https://<project-ref>.supabase.co/functions/v1/paystack-webhook
 *   Events: charge.success
 *
 * DEPLOYMENT:
 *   supabase functions deploy paystack-webhook --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FARES = {
  public: { fare: 500, serviceFee: 0 },
  petrol: { fare: 600, serviceFee: 0 },
  private: { fare: 700, serviceFee: 0 },
} as const;

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const fareSecret = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
    const subSecret = Deno.env.get('PAYSTACK_SUB_SECRET_KEY') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    if (!fareSecret || !subSecret || !serviceRoleKey) {
      console.error('Webhook misconfigured: missing fare/sub secret or service key.');
      return new Response('Misconfigured', { status: 500 });
    }

    // ── Verify signature over the RAW body (either account) ────
    const raw = await req.text();
    const signature = (req.headers.get('x-paystack-signature') || '').toLowerCase();
    const expectedFare = (await hmacHex(fareSecret, raw)).toLowerCase();
    const expectedSub = (await hmacHex(subSecret, raw)).toLowerCase();
    if (!signature || (signature !== expectedFare && signature !== expectedSub)) {
      return new Response('Invalid signature', { status: 401 });
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response('Bad payload', { status: 400 });
    }

    // Only charge.success mints tickets. Acknowledge everything else.
    if (event.event !== 'charge.success') {
      return new Response('ok');
    }

    const data = event.data as Record<string, unknown>;
    const reference = typeof data.reference === 'string' ? data.reference : '';
    if (!reference || data.status !== 'success') {
      return new Response('ok');
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    // Subscriptions first (SUB-prefixed refs, ₦1,000 fixed).
    const { data: sub } = await db
      .from('subscriptions')
      .select('id, user_id')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (sub) {
      if (Number(data.amount) !== 500 * 100) {
        console.error('Webhook subscription amount mismatch for', reference);
        return new Response('ok');
      }
      await db.rpc('confirm_subscription_payment', {
        p_reference: reference,
        p_user_id: (sub as Record<string, string>).user_id,
        p_paystack_metadata: JSON.stringify(data),
      });
      return new Response('ok');
    }

    const { data: booking } = await db
      .from('bookings')
      .select('id, user_id, shuttle_type')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (!booking) return new Response('ok'); // unknown reference: nothing to do

    const pricing = FARES[booking.shuttle_type as keyof typeof FARES];
    if (!pricing || Number(data.amount) !== (pricing.fare + pricing.serviceFee) * 100) {
      console.error('Webhook amount mismatch for', reference);
      return new Response('ok');
    }

    // Atomic + idempotent (paid rows replay their stored ticket).
    await db.rpc('confirm_booking_payment', {
      p_reference: reference,
      p_user_id: booking.user_id,
      p_paystack_metadata: JSON.stringify(data),
    });

    return new Response('ok');
  } catch {
    return new Response('Error', { status: 500 });
  }
});
