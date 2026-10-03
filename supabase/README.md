# UniAbuja Shuttle — Supabase Backend Setup

## Architecture

```
Mobile App (React Native)
    ↓  supabase.functions.invoke()
Supabase Edge Functions (Deno)
    ↓  PAYSTACK_SECRET_KEY (server-only)
Paystack API
    ↓  authorization_url, verification
Back to Mobile App
```

The Paystack **secret key** lives only on the server (Supabase Edge Functions).
The mobile app never has access to it.

## Setup Steps

### 1. Database Schema

Run `supabase-setup.sql` (in the project root) in the Supabase SQL Editor.

This creates everything the app needs:
- `profiles` — Student/Staff user profiles, auto-created on sign-up
- `bookings` — booking records with payment status and Paystack reference
- `shuttle_routes` — future route management
- RLS policies (users can only access their own data)

### 2. Edge Functions

Install the Supabase CLI if you haven't:

```bash
npm install -g supabase
```

Login and link your project:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

Deploy the functions:

```bash
supabase functions deploy paystack-init
supabase functions deploy paystack-verify
supabase functions deploy paystack-sub-init
supabase functions deploy paystack-sub-verify
supabase functions deploy paystack-webhook --no-verify-jwt
```

### 3. Environment Variables (TWO Paystack accounts)

- Transport fares (₦500 public-only) → fare account key:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx
```
- Monthly subscriptions (₦1,000) → subscription account key:
```bash
supabase secrets set PAYSTACK_SUB_SECRET_KEY=sk_test_yyyyyyyy
```
- Webhook needs BOTH set (same URL in both Paystack dashboards):

Optionally set the callback URL (defaults to `https://uniabujashuttle.app/payment-callback`):

```bash
supabase secrets set PAYSTACK_CALLBACK_URL=https://your-callback-url.com/payment-callback
```

### 4. Connect Frontend

`services/payment.ts` is real-payments only — no mock checkout.
It calls the Edge Functions directly and throws on failure.

## Paystack Test Mode

During development, use Paystack **test** keys:

- Secret Key: `sk_test_xxxxxxxx`
- Public Key: `pk_test_xxxxxxxx`

Test card:
- Number: `4187 4274 1556 4246`
- Expiry: Any future date
- CVV: Any 3 digits

## Security Rules

1. The Paystack secret key is NEVER in the mobile app code
2. The backend computes amounts from its own pricing config — never trusts the frontend
3. Payment verification happens server-side only
4. Transactions are verified against Paystack's API before marking bookings as paid
5. All database access is protected by Row Level Security
6. Double-tap protection is handled on both frontend and backend
