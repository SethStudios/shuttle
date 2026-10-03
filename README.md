# UniAbuja Shuttle

Expo (SDK 57) + Supabase + Paystack app for University of Abuja campus shuttle booking. Students buy a same-day boarding pass, get a QR ticket, and staff scan it at the terminal (one-time use).

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template and fill in real values (never commit `.env`):
   ```bash
   cp .env.example .env
   ```
3. Start:
   ```bash
   npx expo start
   ```

## Scripts

| Script | Purpose |
|---|---|
| `npm test` | Pure-logic unit tests (no network/device) |
| `npm run test:smoke` | Static consistency checks (fares, routes, RLS objects) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` (ESLint 9 + `eslint-config-expo/flat`) |

## Environment & secrets

- Client config comes from `EXPO_PUBLIC_` vars (`.env` locally, EAS environments in cloud builds). See `.env.example`.
- Nothing secret lives in `app.json` — the Supabase anon/publishable key is public-by-design.
- Never put `service_role` or Paystack secret keys in the app. They live in Supabase Edge Function secrets only.
- Cloud builds: `eas.json` maps each profile to its EAS environment (`development`/`preview`/`production`):
  ```bash
  eas env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://your-project.supabase.co --environment production --visibility plaintext
  eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --environment production --visibility plaintext
  ```

## Ticket validity (canonical rule)

A pass **admits** at the checkpoint iff ALL hold:

1. `payment_status = 'paid'` (confirmed via Paystack server-side)
2. `ticket_status = 'unused'` (consumed on first valid scan — one-time use)
3. Purchased within the last **24 hours**
4. `travel_date` **equals today** (backend stamps the server day at purchase)

Home "active" is the looser owned-and-live set (1–3 plus `travel_date >= today`); the scanner's same-day gate is stricter. The **boarding period** only organizes the queue (numbers restart hourly) and guides arrival — it is not a scan-time gate. One active pass per route direction.

Implementation: `isTicketActive` in `utils/tickets.ts`; enforced at scan in `app/scan.tsx` (`buildReport`), listed in `hooks/useBookings.ts`.

## Backend

- Schema + RLS in `supabase-setup.sql` (clients hold no write grants on bookings; all writes via `SECURITY DEFINER` RPCs).
- Edge Functions in `supabase/functions/`: `paystack-init` (public-only sales), `paystack-verify`, `paystack-webhook` (HMAC, legacy private tickets still verify). Server is the source of truth for fares (₦500 public flat, no fee; ₦700 private kept for legacy verification only). Monthly subscription is ₦1,000 via `paystack-sub-init` / `paystack-sub-verify` and is required to book (students only, staff exempt).
- Setup details: `supabase/README.md`.

## Project layout

- `app/` — expo-router screens (booking → payment → ticket → scan)
- `utils/tickets.ts` — pure ticket helpers (parsing, validity, verify messages)
- `services/payment.ts` — Paystack Edge Function facade (no secrets)
- `hooks/useBookings.ts` — active/history bookings (Supabase + user-scoped device cache)
- `contexts/AuthContext.tsx` — session validation, sign-out cache wipe
