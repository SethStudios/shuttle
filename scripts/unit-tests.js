/**
 * Minimal unit tests — pure logic only, no network, no device.
 * Run:  npm test  (node --experimental-strip-types --test scripts/unit-tests.js)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

async function main() {
  // Type-stripping lets plain Node import the real TS sources.
  const tickets = await import('../utils/tickets.ts');
  const pricing = await import('../constants/pricing.ts');
  const subscription = await import('../constants/subscription.ts');

  const { parseTicketId, deriveDirection, getVerifyErrorMessage, shouldAutoRetryVerify, isTicketActive, describeInitError, isBookingOpen } = tickets;
  const {
    isWithinTicketLife,
    hoursLeftInTicketLife,
    getTotalPrice,
    getShuttlePrice,
    formatPeriod12,
    getBoardingPeriodForHour,
    BOARDING_PERIODS,
    TICKET_LIFE_MS,
  } = pricing;

  describe('parseTicketId (scan.tsx QR parsing)', () => {
    it('returns plain codes trimmed', () => {
      assert.equal(parseTicketId('TKT-2026-ABC123'), 'TKT-2026-ABC123');
      assert.equal(parseTicketId('  TKT-2026-ABC123  '), 'TKT-2026-ABC123');
    });
    it('extracts ticketId from legacy JSON', () => {
      assert.equal(parseTicketId('{"ticketId":"TKT-1"}'), 'TKT-1');
      assert.equal(parseTicketId('{"ticket_id":"TKT-2"}'), 'TKT-2');
      assert.equal(parseTicketId(' { "ticketId" : "  TKT-3 " } '), 'TKT-3');
    });
    it('falls back to raw string on malformed JSON', () => {
      assert.equal(parseTicketId('{not-json'), '{not-json');
      assert.equal(parseTicketId('{}'), '{}');
      assert.equal(parseTicketId('{"other":"x"}'), '{"other":"x"}');
    });
    it('returns empty for blank input', () => {
      assert.equal(parseTicketId(''), '');
      assert.equal(parseTicketId('   '), '');
    });
  });

  describe('deriveDirection (useBookings route mapping)', () => {
    it('maps Mini→Main label', () => {
      assert.equal(deriveDirection('Mini Campus → Main Campus'), 'mini-to-main');
    });
    it('defaults everything else to main-to-mini', () => {
      assert.equal(deriveDirection('Main Campus → Mini Campus'), 'main-to-mini');
      assert.equal(deriveDirection(null), 'main-to-mini');
      assert.equal(deriveDirection(undefined), 'main-to-mini');
      assert.equal(deriveDirection(''), 'main-to-mini');
    });
  });

  describe('isWithinTicketLife / hoursLeftInTicketLife (24h ticket life)', () => {
    it('fresh ticket is valid', () => {
      const now = Date.now();
      assert.equal(isWithinTicketLife(new Date(now - 1000).toISOString(), now), true);
    });
    it('expired ticket (>24h) is invalid', () => {
      const now = Date.now();
      assert.equal(isWithinTicketLife(new Date(now - TICKET_LIFE_MS - 1000).toISOString(), now), false);
    });
    it('fail-closed on unknown/invalid dates', () => {
      assert.equal(isWithinTicketLife(null), false);
      assert.equal(isWithinTicketLife(undefined), false);
      assert.equal(isWithinTicketLife('not-a-date'), false);
      assert.equal(hoursLeftInTicketLife(null), 0);
    });
    it('hours left decreases over life', () => {
      const now = Date.now();
      const fresh = hoursLeftInTicketLife(new Date(now - 1000).toISOString(), now);
      const old = hoursLeftInTicketLife(new Date(now - 23 * 3600000).toISOString(), now);
      assert.ok(fresh >= 23 && fresh <= 24, `fresh=${fresh}`);
      assert.ok(old >= 0 && old <= 1, `old=${old}`);
    });
  });

  describe('pricing (constants/pricing.ts)', () => {
    it('totals equal fare (no service fee)', () => {
      assert.equal(getShuttlePrice('public'), 500);
      assert.equal(getShuttlePrice('private'), 700);
      assert.equal(getTotalPrice('public'), 500);
      assert.equal(getTotalPrice('private'), 700);
    });
    it('formats boarding windows in 12h', () => {
      assert.equal(formatPeriod12('06:00-07:00'), '6:00 – 7:00 AM');
      assert.equal(formatPeriod12('13:00-14:00'), '1:00 – 2:00 PM');
      assert.equal(formatPeriod12('garbage'), 'garbage');
    });
    it('has 12 one-hour periods 06–18', () => {
      assert.equal(BOARDING_PERIODS.length, 12);
      assert.equal(BOARDING_PERIODS[0].label, '06:00-07:00');
      assert.equal(BOARDING_PERIODS[11].label, '17:00-18:00');
      assert.equal(getBoardingPeriodForHour(6).label, '06:00-07:00');
      assert.equal(getBoardingPeriodForHour(25).label, '06:00-07:00');
    });
  });

  describe('isTicketActive (canonical validity rule)', () => {
    const live = (over = {}) => ({
      payment_status: 'paid',
      ticket_status: 'unused',
      created_at: new Date(Date.now() - 1000).toISOString(),
      travel_date: new Date().toISOString().slice(0, 10),
      ...over,
    });
    it('live same-day ticket is active', () => {
      assert.equal(isTicketActive(live()), true);
    });
    it('rejects unpaid / used / 24h-lapsed passes', () => {
      assert.equal(isTicketActive(live({ payment_status: 'pending' })), false);
      assert.equal(isTicketActive(live({ ticket_status: 'used' })), false);
      assert.equal(
        isTicketActive(live({ created_at: new Date(Date.now() - TICKET_LIFE_MS - 1000).toISOString() })),
        false
      );
    });
    it('rejects past travel dates, keeps today-or-later', () => {
      assert.equal(isTicketActive(live({ travel_date: '2000-01-01' })), false);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      assert.equal(isTicketActive(live({ travel_date: tomorrow })), true);
    });
    it('fail-closed on missing/invalid dates', () => {
      assert.equal(isTicketActive(live({ created_at: '' })), false);
      assert.equal(isTicketActive(live({ travel_date: '' })), false);
    });
  });

  describe('describeInitError (payment init mapping)', () => {
    it('never surfaces raw SDK text', () => {
      const r = describeInitError({ status: 500, name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' });
      assert.ok(!r.message.includes('non-2xx'), r.message);
      assert.equal(r.code, 'INIT_FAILED');
    });
    it('maps session, missing function, and network', () => {
      assert.equal(describeInitError({ status: 401 }).code, 'SESSION_EXPIRED');
      assert.equal(describeInitError({ status: 404 }).code, 'FUNCTION_NOT_DEPLOYED');
      assert.equal(describeInitError({ status: 403, backendCode: 'SUBSCRIPTION_REQUIRED' }).code, 'SUBSCRIPTION_REQUIRED');
      const net = describeInitError({ name: 'FunctionsFetchError', message: 'Failed to fetch' });
      assert.equal(net.code, 'NETWORK_ERROR');
      assert.equal(describeInitError({ name: 'FunctionsRelayError' }).code, 'NETWORK_ERROR');
    });
    it('keeps provider failures opaque', () => {
      const r = describeInitError({ status: 502, backendCode: 'PAYSTACK_INIT_FAILED' });
      assert.equal(r.code, 'INIT_FAILED');
      assert.ok(!r.message.includes('PAYSTACK'), r.message);
      assert.equal(describeInitError({ status: 400 }).message.includes('Booking details'), true);
    });
  });

  describe('isBookingOpen (6 AM – 6 PM sales window)', () => {
    it('open during service hours', () => {
      assert.equal(isBookingOpen(6), true);
      assert.equal(isBookingOpen(12), true);
      assert.equal(isBookingOpen(17), true);
    });
    it('closed evening through dawn', () => {
      assert.equal(isBookingOpen(18), false);
      assert.equal(isBookingOpen(23), false);
      assert.equal(isBookingOpen(0), false);
      assert.equal(isBookingOpen(5), false);
    });
  });

  describe('payment verify messages (payment.tsx)', () => {    it('maps known reasons', () => {
      assert.match(getVerifyErrorMessage('invalid_reference'), /not valid/);
      assert.match(getVerifyErrorMessage('amount_mismatch'), /do not pay again/);
      assert.match(getVerifyErrorMessage('not_pending'), /already processed/);
    });
    it('falls back for unknown reasons', () => {
      assert.match(getVerifyErrorMessage('weird_code'), /weird_code/);
      assert.match(getVerifyErrorMessage(null), /unknown/);
    });
    it('auto-retries only on provider lag', () => {
      assert.equal(shouldAutoRetryVerify('paystack_api_error'), true);
      assert.equal(shouldAutoRetryVerify('status_pending'), true);
      assert.equal(shouldAutoRetryVerify('amount_mismatch'), false);
      assert.equal(shouldAutoRetryVerify(null), false);
    });
  });

  describe('subscription (₦1,000 monthly gate)', () => {
    const { SUBSCRIPTION, isSubscriptionActive, daysLeftInSubscription } = subscription;
    it('is priced at 1000 NGN for 30 days', () => {
      assert.equal(SUBSCRIPTION.price, 1000);
      assert.equal(SUBSCRIPTION.durationDays, 30);
    });
    it('active only when status active and unexpired', () => {
      const now = Date.now();
      const live = { status: 'active', expires_at: new Date(now + 86400000).toISOString() };
      assert.equal(isSubscriptionActive(live, now), true);
      assert.equal(isSubscriptionActive({ status: 'pending', expires_at: live.expires_at }, now), false);
      assert.equal(isSubscriptionActive({ status: 'active', expires_at: new Date(now - 1000).toISOString() }, now), false);
      assert.equal(isSubscriptionActive(null, now), false);
    });
    it('reports days left, 0 when inactive', () => {
      const now = Date.now();
      const live = { status: 'active', expires_at: new Date(now + 5 * 86400000).toISOString() };
      assert.equal(daysLeftInSubscription(live, now), 5);
      assert.equal(daysLeftInSubscription(null, now), 0);
      assert.equal(daysLeftInSubscription({ status: 'active', expires_at: null }, now), 0);
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
