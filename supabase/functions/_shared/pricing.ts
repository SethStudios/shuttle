/**
 * Shared pricing configuration for Supabase Edge Functions.
 *
 * This is the SOURCE OF TRUTH for shuttle fares.
 * The frontend displays amounts, but the backend computes
 * and validates them independently.
 *
 * To change pricing:
 *   Update the values here and redeploy the Edge Functions.
 * Display names: public = CNG Bus, private = Petrol Bus (see constants/pricing.ts).
 */

export const FARES = {
  public: { fare: 500, serviceFee: 0 },
  private: { fare: 700, serviceFee: 0 },
} as const;

export const ROUTE = 'Main Campus → Mini Campus';
export const CURRENCY = 'NGN';

export type ShuttleType = keyof typeof FARES;

export function getTotalKobo(type: ShuttleType): number {
  const pricing = FARES[type];
  return (pricing.fare + pricing.serviceFee) * 100;
}

export function getTotalNaira(type: ShuttleType): number {
  const pricing = FARES[type];
  return pricing.fare + pricing.serviceFee;
}
