# Store listing — UniAbuja Shuttle (draft for copy/paste)

## App name
UniAbuja Shuttle

## Short description (max 80 chars, Google Play)
Book UniAbuja campus shuttles, pay, and board with a QR pass.

## Full description (draft)
UniAbuja Shuttle is the official way to ride between the University of Abuja Main Campus and Mini Campus.

- Book in seconds: pick your route, boarding window, and shuttle type, and get your queue number instantly.
- Pay securely: card, bank transfer, or USSD through Paystack. Your ticket appears the moment payment confirms.
- Board with QR: each pass is a same-day, one-time QR boarding pass. Show it at the terminal, listen for your queue number, and go.
- Track everything: active passes on Home, past trips under Tickets, boarding reminders via alerts.

Buses run 6:00am–6:00pm, Monday to Saturday. One active pass per route. Support: hyoigroup@gmail.com.

## Keywords / tags
uniabuja, abuja shuttle, campus bus, shuttle booking, university transport, QR ticket

## Category
Maps & Navigation (alt: Travel & Transportation / Events secondary)

## Content rating guidance
Likely Everyone / 3+ (no user-generated content, no ads, no location tracking in-app). Confirm in the Play Console / App Store Connect questionnaires — answer for payments (Paystack external checkout) honestly.

## Privacy policy URL (required)
Host `legal/privacy.html` from this repo at a public URL and paste it here:
`https://YOUR-DOMAIN/privacy.html`
Regenerate after any legal edit: `npm run legal`

## Pre-submission checklist
- [ ] Screenshots: Home, booking, QR ticket, staff scanner (phone frames, no real personal data)
- [ ] Feature graphic (Play, 1024×500) if required
- [ ] Icon renders on-device (adaptive icon foreground/background present in app.json)
- [ ] Live Paystack keys in Supabase Edge Function secrets (not test keys)
- [ ] Production Supabase URL + anon key in EAS `production` environment
- [ ] Support inbox monitored (currently hyoigroup@gmail.com)
- [ ] Data safety form (Play): contacts collected = name, phone, email, matric; payments via Paystack; no ads/trackers
- [ ] Apple App Privacy labels: contact info + purchases, linked to user, no tracking
