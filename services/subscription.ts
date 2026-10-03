/**
 * Subscription Service — frontend facade for the ₦1,000 monthly plan.
 * Mirrors services/payment.ts: no secrets here, all Paystack work
 * happens in Supabase Edge Functions (paystack-sub-init / verify).
 */
import { supabase } from '@/utils/supabase';

export interface SubscriptionInitResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  subscriptionId: string;
  totalAmount: number;
  currency: string;
}

export interface SubscriptionVerifyResult {
  verified: boolean;
  reference?: string;
  reason?: string;
  expiresAt?: string;
}

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

export async function initializeSubscription(email: string): Promise<SubscriptionInitResult> {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) throw new SubscriptionError('Email is required to process payment.');

  const { data, error } = await supabase.functions.invoke('paystack-sub-init', {
    body: { email: clean },
  });

  if (error) {
    const ctx = (error as any)?.context;
    const status = typeof ctx?.status === 'number' ? ctx.status : 0;
    let backendCode = '';
    try {
      const body = await ctx?.json?.();
      if (body && typeof body.error === 'string') backendCode = body.error;
    } catch {}
    console.error('[subscription init] invoke failed', { status, backendCode, name: (error as any)?.name, message: (error as any)?.message });
    if (status === 401) throw new SubscriptionError('Session expired. Please sign out and sign in again, then try.', 'SESSION_EXPIRED');
    if (status === 404) throw new SubscriptionError('Subscription service is not deployed. Run: supabase functions deploy paystack-sub-init', 'FUNCTION_NOT_DEPLOYED');
    if (backendCode === 'PAYSTACK_INIT_FAILED' || status === 502) {
      throw new SubscriptionError('Payment provider rejected subscription init. Check PAYSTACK_SUB_SECRET_KEY (test vs live) in Supabase secrets.', 'INIT_FAILED');
    }
    if (backendCode) throw new SubscriptionError(backendCode, 'INIT_FAILED');
    throw new SubscriptionError('Unable to start subscription payment. Check your connection and try again.', 'INIT_FAILED');
  }
  if (!data?.success) {
    console.error('[subscription init] backend error', data?.error);
    throw new SubscriptionError(data?.error || 'Subscription initialization failed.', 'INIT_FAILED');
  }

  return {
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference: data.data.reference,
    subscriptionId: data.data.subscription_id,
    totalAmount: data.data.total_amount,
    currency: data.data.currency || 'NGN',
  };
}

export async function verifySubscription(reference: string): Promise<SubscriptionVerifyResult> {
  const ref = (reference || '').trim();
  if (!ref) throw new SubscriptionError('Transaction reference is required.');

  const { data, error } = await supabase.functions.invoke('paystack-sub-verify', {
    body: { reference: ref },
  });

  if (error) throw new SubscriptionError('Unable to verify subscription. Check your connection and try again.', 'NETWORK_ERROR');
  if (!data) throw new SubscriptionError('Subscription verification failed.', 'VERIFY_FAILED');

  return {
    verified: data.verified === true,
    reference: data.reference,
    reason: data.reason,
    expiresAt: data.expires_at,
  };
}
