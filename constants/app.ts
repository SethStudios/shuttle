/**
 * App-wide shared constants — single source of truth.
 * Import from here instead of hardcoding across screens.
 */

// ── Contact / legal ─────────────────────────────────────────────
// Temporary inbox until a dedicated support address exists.
// The inbox must exist and be monitored before store release.
export const SUPPORT_EMAIL = 'hyoigroup@gmail.com';
export const LAST_UPDATED = '16 September 2026';

// ── Auth / storage keys ──────────────────────────────────────────
export const MATRIC_MAP_KEY = '@matric_email_map';

// ── Payments ────────────────────────────────────────────────────
export const CALLBACK_BASE = 'https://uniabujashuttle.app/payment-callback';

// ── Time budgets (ms) ───────────────────────────────────────────
export const SPLASH_MIN_MS = 900;
export const SESSION_TIMEOUT_MS = 2500;
export const STORAGE_TIMEOUT_MS = 1200;
export const VERIFY_RETRY_MS = 3000;
export const TAP_DEBOUNCE_MS = 1500;

// ── Onboarding ──────────────────────────────────────────────────
export const ONBOARDING_KEY = 'hasSeenOnboarding';
export const ONBOARDING_VALUE = 'v1';
