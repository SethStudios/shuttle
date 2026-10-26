/**
 * Shuttle pricing and route configuration
 * All prices in Nigerian Naira (NGN)
 * Update these values to change pricing across the app
 */
export const PRICING = {
  public: 500,
  petrol: 600,
  private: 700,
  serviceFee: 0,
} as const;

export type ShuttleType = 'public' | 'petrol' | 'private';

// User-facing names: DB keeps 'public' | 'petrol' | 'private' (no migration),
// but students see CNG Bus (₦500), Petrol Bus (₦600) and Private Shuttle (₦700).
export const SHUTTLE_LABELS: Record<ShuttleType, string> = {
  public: 'CNG Bus',
  petrol: 'Petrol Bus',
  private: 'Private Shuttle',
};

export const SHUTTLE_DESCRIPTIONS: Record<ShuttleType, string> = {
  public: 'CNG-powered • Main ⇄ Mini',
  petrol: 'Petrol-powered • Main ⇄ Mini',
  private: 'Private shuttle • Main ⇄ Mini',
};

export const getShuttleLabel = (type: ShuttleType): string =>
  SHUTTLE_LABELS[type] ?? type;

export const getShuttleShortLabel = (type: string | null | undefined): string =>
  type === 'private' ? SHUTTLE_LABELS.private : type === 'petrol' ? SHUTTLE_LABELS.petrol : SHUTTLE_LABELS.public;

export type RouteDirection = 'main-to-mini' | 'mini-to-main';

export const ROUTE_LABELS: Record<RouteDirection, string> = {
  'main-to-mini': 'Main Campus → Mini Campus',
  'mini-to-main': 'Mini Campus → Main Campus',
};

export const getRouteLabel = (direction: RouteDirection): string =>
  ROUTE_LABELS[direction];

export const getShuttlePrice = (type: ShuttleType): number => {
  return PRICING[type];
};

export const formatPrice = (amount: number): string => {
  return `₦${amount.toLocaleString('en-NG')}`;
};

export const getTotalPrice = (shuttleType: ShuttleType): number => {
  return getShuttlePrice(shuttleType) + PRICING.serviceFee;
};

// ─── Boarding Periods ─────────────────────────────────────────────
// Each period is a 1-hour window from 6 AM to 6 PM.
// Queue numbers are scoped per date + boarding period (+ shuttle type).
// They reset to 1 at the start of each new period.

export type BoardingPeriod = {
  start: number; // hour, e.g. 6
  end: number;   // hour, e.g. 7
  label: string;  // e.g. "06:00-07:00"
};

export const BOARDING_PERIODS: BoardingPeriod[] = Array.from(
  { length: 12 }, // 6 AM → 5 PM (last period 17:00-18:00)
  (_, i) => {
    const start = i + 6;
    const end = start + 1;
    return {
      start,
      end,
      label: `${String(start).padStart(2, '0')}:00-${String(end).padStart(2, '0')}:00`,
    };
  }
);

/** Ticket lifespan: every pass expires 24 hours after purchase (one half of
 * the validity rule — the other half is same-day travel_date; see the
 * canonical rule on isTicketActive in utils/tickets.ts). */
export const TICKET_LIFE_MS = 24 * 60 * 60 * 1000;

/** True when a booking was created less than 24h ago (fail-closed). */
export function isWithinTicketLife(createdAt: string | undefined | null, now = Date.now()): boolean {
  if (!createdAt) return false;
  const age = now - new Date(createdAt).getTime();
  if (Number.isNaN(age)) return false;
  return age < TICKET_LIFE_MS;
}

/** Whole hours left in the 24h ticket life (0 when expired/unknown). */
export function hoursLeftInTicketLife(createdAt: string | undefined | null, now = Date.now()): number {
  if (!createdAt) return 0;
  const left = TICKET_LIFE_MS - (now - new Date(createdAt).getTime());
  if (Number.isNaN(left) || left <= 0) return 0;
  return Math.floor(left / 3600000);
}

/**
 * Display a boarding window in 12-hour form.
 * "13:00-14:00" → "1:00 – 2:00 PM", "06:00-07:00" → "6:00 – 7:00 AM".
 * Stored labels stay 24h — this is display-only.
 */
export function formatPeriod12(label: string): string {
  const m = label.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (!m) return label;
  const part = (hStr: string, min: string, withSuffix: boolean) => {
    const h = parseInt(hStr, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return withSuffix ? `${h12}:${min} ${suffix}` : `${h12}:${min}`;
  };
  const startH = parseInt(m[1], 10);
  const endH = parseInt(m[3], 10);
  const sameSuffix = (startH >= 12) === (endH >= 12);
  const start = part(m[1], m[2], !sameSuffix);
  const end = part(m[3], m[4], true);
  return `${start} – ${end}`;
}

/** Return the boarding period that contains the given hour, or the first one if outside hours. */
export function getBoardingPeriodForHour(hour: number): BoardingPeriod {
  if (hour < 6 || hour >= 18) return BOARDING_PERIODS[0];
  return BOARDING_PERIODS.find((p) => hour >= p.start && hour < p.end) ?? BOARDING_PERIODS[0];
}

/** Return the next boarding period (for pre-selecting the upcoming slot). */
export function getNextBoardingPeriod(): BoardingPeriod {
  const hour = new Date().getHours();
  if (hour < 6) return BOARDING_PERIODS[0];
  if (hour >= 18) return BOARDING_PERIODS[0]; // after hours → next day's first slot
  const currentIdx = BOARDING_PERIODS.findIndex((p) => hour >= p.start && hour < p.end);
  // If currently inside a period, suggest the *next* one (user likely booking ahead)
  return BOARDING_PERIODS[Math.min(currentIdx + 1, BOARDING_PERIODS.length - 1)];
}
