# Production launch runbook — UniAbuja Shuttle

Do these in order. Items 1 and 3 need the Supabase/Paystack dashboards;
item 2 needs two physical phones and live keys. Tick each box before launch.

## 1. Dashboard fixes (from the auth/password repair)

### 1a. Matric lookup permission
Dashboard → SQL Editor → New query → paste, Run:
```sql
REVOKE ALL ON FUNCTION public.get_email_by_matric(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_matric(TEXT) TO anon, authenticated;
```
Confirm it took effect (same editor, Run):
```sql
SELECT grantee FROM information_schema.routine_privileges
WHERE routine_name = 'get_email_by_matric';
```
- [x] Verified live 2026-09-29: anonymous RPC call executes (grant confirmed on the server, not just the file)

### 1b. Password-reset deep links
Dashboard → Authentication → URL Configuration → Redirect URLs → add **both**, Save:
```
uniabujashuttle://reset-password
uniabujashuttle://auth
```
- [ ] Both URLs listed and saved (otherwise reset emails land on a blank page)

### 1c. App environment values
```powershell
eas env:list --environment production
eas env:list --environment preview
eas env:list --environment development
```
- [ ] All three list `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## 3. Backend deploy

Prerequisites: Supabase CLI installed and logged in (`supabase login`).

```powershell
cd C:\Users\911se\Desktop\shuttle
supabase link --project-ref <your-project-ref>
```

### 3a. Database (Supabase Dashboard → SQL Editor)
- On a **fresh** project: run the whole `supabase-setup.sql` once.
- On the **existing** project: run ONLY the changed blocks — the section 8
  GRANT block from step 1a, plus section 9 (staff checkpoint) if scanning
  was never enabled. Never re-run the CLEANUP drops on a live database.
- [ ] `supabase-setup.sql` matches what is deployed (re-run `node scripts/smoke-check.js` locally — it validates the file's security objects)

### 3b. Function secrets (test key for investor demo — live key only at launch)
```powershell
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_... PAYSTACK_CALLBACK_URL=https://uniabujashuttle.app/payment-callback
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set them by hand.)
- [x] Test-mode `PAYSTACK_SECRET_KEY` + `PAYSTACK_CALLBACK_URL` set (verified present 2026-09-29)
- [ ] AT LAUNCH: swap to `sk_live_...` via the same command (no redeploy needed —
  functions read the secret at runtime), then re-run test row 3 of the live table

### 3c. Deploy the three functions
```powershell
supabase functions deploy paystack-init
supabase functions deploy paystack-verify
supabase functions deploy paystack-webhook --no-verify-jwt
```
- [x] Deployed from repo 2026-09-29 (all ACTIVE; webhook has `verify_jwt: false`). Redeploy after any function edit.

### 3d. Paystack webhook registration
Paystack Dashboard → Settings → Webhooks → add endpoint:
```
https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook
```
Events: `charge.success` only.
- [ ] Test event delivers HTTP 200 (Paystack shows the delivery log)

## 2. Live end-to-end test (two phones, live keys, real money)

Use a real small payment (one public ticket). Rider phone = R, staff phone = S.

| # | Step | Expected | Pass |
|---|------|----------|------|
| 1 | R: create account (student, new matric) | Account created, lands on sign-in | |
| 2 | S: sign in with the SAME matric on the staff phone | Signs in (proves server lookup, not the on-device map) | |
| 3 | R: book Main→Mini, pay with real card/transfer | Paystack checkout, verify succeeds, QR ticket appears | |
| 4 | R: open ticket from Home | Shows PAID badge, queue number, valid-today copy | |
| 5 | S: scan R's QR | Green admit, buzzes, clears itself; next QR scans without tapping | |
| 6 | S: scan the SAME QR again (after 5s) | Red "Already used", stays on screen | |
| 7 | R: ticket now shows USED badge, Home no longer lists it | Used state + History entry | |
| 8 | R: sign out → Forgot password → email → open link **on the phone** | App opens on choose-new-password, reset signs user in | |
| 9 | R: airplane mode → open app, try booking | Clear offline errors, no fake tickets, no crash | |
| 10 | S: deny camera permission → open scanner | Manual code entry + Open Settings offered, Verify works |
| 11 | R: on a dev/production build, background the app before the hour | System-tray notification appears at the bus hour (Expo Go cannot do this — in-app Alerts only) | |

- [ ] All 10 pass. Any failure: fix, redeploy, and re-run the full table —
  payment bugs hide behind partial retests.

## Go / no-go

Launch only when every box above is ticked. Known accepted risks, reviewed
and parked: the 23→0 lint triage (one documented suppression in
`app/payment.tsx`), lawyer review of `legal/`, store screenshots.
