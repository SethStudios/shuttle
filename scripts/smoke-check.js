/**
 * Static consistency smoke test — no network, no device needed.
 * Run:  node scripts/smoke-check.js
 * Fails (exit 1) on any drift between the pricing/route copies or on
 * missing security objects in supabase-setup.sql.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) failures++;
};
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const appPricing = read('constants/pricing.ts');
const sharedPricing = read('supabase/functions/_shared/pricing.ts');
const initFn = read('supabase/functions/paystack-init/index.ts');
const verifyFn = read('supabase/functions/paystack-verify/index.ts');
const webhookFn = read('supabase/functions/paystack-webhook/index.ts');
const sql = read('supabase-setup.sql');
const paymentSvc = read('services/payment.ts');
const subInitFn = read('supabase/functions/paystack-sub-init/index.ts');
const subVerifyFn = read('supabase/functions/paystack-sub-verify/index.ts');
const subConstants = read('constants/subscription.ts');
const appJson = read('app.json');
const supabaseClient = read('utils/supabase.ts');

// ── Fares: 500 public / 700 private / 0 fee everywhere ──────────
const fareSets = [
  ['constants/pricing.ts', /publicShuttle:\s*500/.test(appPricing) && /privateShuttle:\s*700/.test(appPricing) && /serviceFee:\s*0/.test(appPricing)],
  ['_shared/pricing.ts', /fare:\s*500/.test(sharedPricing) && /fare:\s*700/.test(sharedPricing)],
  ['paystack-init', /fare:\s*500/.test(initFn) && /fare:\s*700/.test(initFn)],
  ['paystack-verify', /fare:\s*500/.test(verifyFn) && /fare:\s*700/.test(verifyFn)],
  ['paystack-webhook', /fare:\s*500/.test(webhookFn) && /fare:\s*700/.test(webhookFn)],
];
fareSets.forEach(([name, cond]) => ok(cond, `fares 500/700 + fee 0 in ${name}`));

// ── Routes: both directions whitelisted ──────────────────────────
const RT1 = 'Main Campus → Mini Campus';
const RT2 = 'Mini Campus → Main Campus';
[appPricing, initFn, sql].forEach((src, i) => {
  ok(src.includes(RT1) && src.includes(RT2), `both route labels in ${['constants/pricing.ts', 'paystack-init', 'supabase-setup.sql'][i]}`);
});

// ── Secrets hygiene ─────────────────────────────────────────────
ok(!/sk_(test|live)_[A-Za-z0-9]{10,}/.test(initFn + verifyFn + webhookFn + subInitFn + subVerifyFn + paymentSvc), 'no real Paystack secret in code (doc placeholders ok)');
ok(!/service_role/i.test(paymentSvc), 'frontend never touches service_role');
// Supabase URL/key must come from .env / EAS env, never baked into app.json
ok(!/supabaseUrl|supabaseAnonKey|kxidexfvkshevblguxjq|sb_publishable_/i.test(appJson), 'no Supabase URL/key in committed app.json (use .env + EAS env)');
ok(/process\.env\.EXPO_PUBLIC_SUPABASE_URL/.test(supabaseClient), 'supabase client reads EXPO_PUBLIC_SUPABASE_URL');
ok(!/expoConfig\?\.extra\?\.supabase/i.test(supabaseClient), 'supabase client does not prefer committed app.json extra');

// ── Security objects present in SQL ─────────────────────────────
[
  'confirm_booking_payment',
  'mark_ticket_used',
  'update_own_profile',
  'confirm_subscription_payment',
  'REVOKE ALL ON public.bookings FROM anon, authenticated',
  'REVOKE ALL ON public.subscriptions FROM anon, authenticated',
  'bookings_money_sane',
  'bookings_status_coherent',
  'ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings',
  'idx_bookings_queue_slot',
  'idx_bookings_user_list',
  'idx_profiles_matric_upper',
  'idx_subscriptions_user_active',
].forEach((token) => ok(sql.includes(token), `supabase-setup.sql contains: ${token}`));

// ── Dangerous leftovers gone ─────────────────────────────────────
ok(!sql.includes('CREATE POLICY "Staff can mark tickets used"'), 'broad staff UPDATE policy removed');
ok(!sql.includes('CREATE POLICY "Users can update own bookings"'), 'user UPDATE policy removed');
ok(!sql.includes('CREATE POLICY "Users can create own bookings"'), 'user INSERT policy removed');
ok(!sql.includes('CREATE POLICY "Users can delete own bookings"'), 'user DELETE policy removed');
ok(!sql.includes('CREATE POLICY "Users can update own profile"'), 'profile UPDATE policy removed');

// ── Required files ──────────────────────────────────────────────
['app/edit-profile.tsx', 'app/reset-password.tsx', 'app/subscription.tsx', 'constants/subscription.ts', 'hooks/useSubscription.ts', 'services/subscription.ts', 'supabase/functions/paystack-webhook/index.ts', 'supabase/functions/paystack-sub-init/index.ts', 'supabase/functions/paystack-sub-verify/index.ts', 'constants/app.ts', 'eas.json'].forEach((f) =>
  ok(fs.existsSync(path.join(root, f)), `file exists: ${f}`)
);

// ── Subscription: ₦1,000 / 30 days everywhere ────────────────────
ok(/price:\s*1000/.test(subConstants) && /durationDays:\s*30/.test(subConstants), 'subscription constants 1000/30 days');
ok(/SUBSCRIPTION_PRICE\s*=\s*1000/.test(subInitFn) && /SUBSCRIPTION_KOBO/.test(subInitFn), 'sub-init charges 1000 NGN');
ok(/SUBSCRIPTION_PRICE\s*=\s*1000/.test(subVerifyFn) && /EXPECTED_KOBO/.test(subVerifyFn), 'sub-verify expects 1000 NGN');
ok(/confirm_subscription_payment/.test(subVerifyFn) && /confirm_subscription_payment/.test(webhookFn), 'sub verify + webhook activate via RPC');
ok(!/service_role/i.test(read('services/subscription.ts')), 'subscription frontend never touches service_role');

// ── Two Paystack accounts: fares vs subscriptions ────────────────
ok(/PAYSTACK_SECRET_KEY/.test(initFn) && /PAYSTACK_SECRET_KEY/.test(verifyFn), 'fare functions use PAYSTACK_SECRET_KEY');
ok(/PAYSTACK_SUB_SECRET_KEY/.test(subInitFn) && /PAYSTACK_SUB_SECRET_KEY/.test(subVerifyFn), 'sub functions use PAYSTACK_SUB_SECRET_KEY');
ok(!/PAYSTACK_SECRET_KEY/.test(subInitFn) && !/PAYSTACK_SECRET_KEY/.test(subVerifyFn), 'sub functions do not use fare key');
ok(/PAYSTACK_SECRET_KEY/.test(webhookFn) && /PAYSTACK_SUB_SECRET_KEY/.test(webhookFn), 'webhook accepts both keys');

// ── Server-side subscription gate (students only, staff exempt) ──
ok(/SUBSCRIPTION_REQUIRED/.test(initFn) && /from\('subscriptions'\)/.test(initFn), 'paystack-init gates on active subscription');
ok(/userRole !== 'staff'/.test(initFn) || /role.*staff/i.test(initFn), 'paystack-init exempts staff');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
