import { Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScreenHeader } from '@/components/ui/Apple';

import { LAST_UPDATED, SUPPORT_EMAIL } from '@/constants/app';

const SECTIONS: { h: string; b: string }[] = [
  {
    h: '1. The service',
    b: 'UniAbuja Shuttle (“we”, “us”) sells digital boarding passes for scheduled buses between University of Abuja Main Campus and Mini Campus, operating 6:00am to 6:00pm daily, Monday to Saturday. By creating an account or buying a ticket, you agree to these terms. If you do not agree, do not use the app.',
  },
  {
    h: '2. Who may use the app',
    b: 'Students and staff of the University of Abuja with a valid account. You must provide true details at sign-up, keep your password secret, and never share your account, QR codes, or tickets. One account per person. We may suspend accounts used to impersonate others or evade payment.',
  },
  {
    h: '3. Fares and fees',
    b: 'The fare shown before checkout is the full price you pay — no service fee or hidden charges in the app. A ₦1,000 monthly subscription is required to book; trip fares are charged per ride on top. Fares and subscription price may change; the price at the moment you pay applies. All amounts are in Nigerian Naira (₦).',
  },
  {
    h: '4. Payment',
    b: 'Payment is processed securely by Paystack (card, transfer, or USSD where offered). Your ticket is issued only after our server confirms the payment with Paystack — a Paystack receipt alone, without in-app verification, is not a valid boarding pass. If you are charged but no ticket appears, use “I’ve paid — verify” in the app before paying again, then contact support with your payment reference.',
  },
  {
    h: '5. Tickets, queue numbers, and validity',
    b: 'Each paid booking issues exactly one ticket with one queue number for the travel date and boarding window shown on the pass. Queue numbers restart every boarding window. A ticket is valid only for its stated travel date, only until scanned (single use), and only within 24 hours of purchase — the boarding window holds your place in the queue, it is not a separate expiry. Expired, used, cancelled, or unverified passes admit no one.',
  },
  {
    h: '6. Boarding rules',
    b: 'Arrive at least 10 minutes early and listen for your queue number. Show the in-app QR to the conductor for scanning; screenshots or forwarded links may be rejected where they cannot be verified live. Boarding order follows queue numbers at the conductor’s direction. For everyone’s safety, the conductor may refuse boarding for overloading, misconduct, unsafe items, or any safety concern — that decision is final on the day.',
  },
  {
    h: '7. Cancellations, delays, and refunds',
    b: 'If a scheduled bus cannot run, we will advise rebooking or a refund through support. Refunds, where due, go back through the original Paystack payment method and follow Paystack timelines — we cannot refund in cash at the terminal. Missed buses for any reason attributable to the passenger (late arrival, wrong window, invalid pass) are not refundable. Duplicate charges for the same trip, once confirmed, are refunded after investigation.',
  },
  {
    h: '8. Prohibited conduct',
    b: 'One ticket admits one passenger. Forging, sharing, or reselling QR codes or tickets, using another person’s account, tampering with the app, or abusing staff or drivers may lead to immediate denial of boarding, ticket cancellation without refund, and account suspension or permanent ban. We may preserve records needed for investigation.',
  },
  {
    h: '9. Service availability and changes',
    b: 'We aim for reliable daily operation but do not guarantee every departure time; traffic, weather, vehicle faults, fuel, security directives, or university schedules may disrupt service. We may change routes, timetables, fares, or app features with reasonable notice in the app. Buses do not operate on Sundays unless expressly announced.',
  },
  {
    h: '10. Liability',
    b: 'To the maximum extent permitted by law: the app is provided “as is”; we are not liable for indirect or consequential losses (missed lectures, appointments, or onward travel). Our total liability for any trip is limited to the fare paid for that trip. Nothing here limits liability that cannot be limited under Nigerian law, including for personal injury caused by our negligence. Keep valuables with you — we are not liable for lost belongings.',
  },
  {
    h: '11. Account suspension and termination',
    b: 'We may warn, suspend, or terminate accounts that breach these terms, abuse payments, or misuse tickets. You may delete your account anytime in Profile → Delete Account (permanent; bookings and profile are erased from the server). Termination does not affect tickets already used or amounts already due.',
  },
  {
    h: '12. Governing law and disputes',
    b: 'These terms are governed by the laws of the Federal Republic of Nigeria. Disputes should first be raised with us at the support email below so we can resolve them; unresolved disputes are subject to the jurisdiction of the courts of the Federal Capital Territory, Abuja.',
  },
  {
    h: '13. Changes to these terms',
    b: 'We may update these terms as the service evolves, with the “Last updated” date revised above. Continued use after changes take effect means you accept them. Material changes may additionally be announced in the app.',
  },
  {
    h: '14. Contact',
    b: `Support, refunds, and complaints: ${SUPPORT_EMAIL}. Include your ticket ID and payment reference so we can help quickly.`,
  },
];

export default function TermsScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Terms of Service"
          subtitle={`The rules for riding with us. Last updated ${LAST_UPDATED}.`}
          onBack={() => router.back()}
        />
        {SECTIONS.map((s) => (
          <Text key={s.h} style={styles.block}>
            <Text style={styles.h}>{s.h}{'\n'}</Text>
            <Text style={styles.b}>{s.b}</Text>
          </Text>
        ))}
        <Text style={styles.foot}>
          By using UniAbuja Shuttle you agree to these terms. For questions,
          contact support with your ticket ID and payment reference.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Full-bleed: no card, no container box — text flows edge to edge with
  // SafeAreaView keeping it clear of notches, status bar, and gesture bar.
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  block: { marginTop: 18, fontSize: 15, lineHeight: 23 },
  h: { fontSize: 16.5, fontWeight: '800', color: '#1C1C1E' },
  b: { fontSize: 15, color: '#3C3C43' },
  foot: { marginTop: 22, fontSize: 13, color: '#8E8E93', lineHeight: 19 },
});
