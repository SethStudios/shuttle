# Admin dashboard (`admin/`)

Static HTML + CSS + vanilla JS. No build step. Open `admin/index.html` directly or serve the folder:

```bash
npx serve admin
# or
python -m http.server -d admin 8000
```

## Security model

- Uses the Supabase **`anon` key + staff email login** (`signInWithPassword`).
- Staff gate: after login the app reads your `profiles.role` — non-staff are signed out immediately.
- Reads bookings via `is_staff()` RLS policy + `profiles` via staff policy.
- Ticket consume goes through `mark_ticket_used` RPC only (no UPDATE grants).
- `service_role` / Paystack secrets **never** enter the browser.
- URL + anon key live in `admin/config.js` (gitignored, this PC only — copy from `config.example.js`). No passwords or secret keys are stored in the dashboard code (unlike the old gitignored `admin-dashboard.html`).

## Tabs

| Tab | Source |
|---|---|
| Overview | `bookings` for operating date: revenue, CNG/Petrol split, windows, pending/failed |
| Manifest | paid rows for date, grouped by `boarding_period + route + bus`, queue order, CSV |
| Validate | lookup by `ticket_id`, same 4-gate rule as `app/scan.tsx`, consume via RPC |
| Bookings | latest 100 with filters + search + CSV (read-only) |
| Users | `profiles` search (name/matric/email) + role filter |
| Subscriptions | `subscriptions` — requires staff read policy (see below) |
| Routes & fares | `shuttle_routes` active + fare cards (CNG ₦500 / Petrol ₦700 / sub ₦1,000) |
| Payments | `pending/failed` bookings + Paystack refs for reconciliation |
| Settings | connection + RLS checklist |

## One-time SQL (subscriptions)

`subscriptions` ships with own-rows-only RLS, so staff listing fails until you run once in the SQL Editor:

```sql
CREATE POLICY "Staff can view all subscriptions"
  ON public.subscriptions FOR SELECT USING (public.is_staff());
```

Everything else staff needs is already in `supabase-setup.sql` (bookings staff SELECT, profiles staff SELECT, `mark_ticket_used` EXECUTE).
