/**
 * Monthly subscription configuration — single source of truth.
 * ₦500 for 30 days. Required to book (hard gate).
 */
export const SUBSCRIPTION = {
  price: 500,
  currency: 'NGN',
  durationDays: 30,
} as const;

export type SubscriptionStatus = 'pending' | 'active' | 'expired' | 'failed';

export interface Subscription {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: SubscriptionStatus;
  paystack_reference: string | null;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
}

/** True when subscription is active and not expired. */
export function isSubscriptionActive(
  sub: Pick<Subscription, 'status' | 'expires_at'> | null | undefined,
  now = Date.now()
): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  if (!sub.expires_at) return false;
  const exp = new Date(sub.expires_at).getTime();
  if (Number.isNaN(exp)) return false;
  return exp > now;
}

/** Whole days left on a subscription (0 when inactive/expired/unknown). */
export function daysLeftInSubscription(
  sub: Pick<Subscription, 'status' | 'expires_at'> | null | undefined,
  now = Date.now()
): number {
  if (!isSubscriptionActive(sub, now)) return 0;
  const exp = new Date((sub as Subscription).expires_at as string).getTime();
  const left = exp - now;
  if (Number.isNaN(left) || left <= 0) return 0;
  return Math.ceil(left / (24 * 3600000));
}

export const formatSubscriptionPrice = (amount: number): string =>
  `₦${amount.toLocaleString('en-NG')}`;
