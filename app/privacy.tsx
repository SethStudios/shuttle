import { Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScreenHeader } from '@/components/ui/Apple';

import { LAST_UPDATED, SUPPORT_EMAIL } from '@/constants/app';

const SECTIONS: { h: string; b: string }[] = [
  {
    h: '1. Who we are',
    b: 'UniAbuja Shuttle (“we”, “us”) provides digital shuttle-booking and boarding passes for University of Abuja Main Campus and Mini Campus routes. This policy explains what personal data the app collects, why, and the choices you have. If you do not agree with this policy, do not create an account or use the app.',
  },
  {
    h: '2. Data we collect',
    b: 'Account data: your full name, phone number, role (student or staff), and either your matric number (students) or staff email, plus your sign-in email and password credentials managed by our authentication provider. Booking data: shuttle type, route direction, travel date, boarding window, queue number, ticket ID, fares paid, and Paystack payment references. Technical data: basic device and app-diagnostic information needed to keep the app working. We do not collect card numbers, bank details, or CVVs — those are entered only on Paystack checkout pages.',
  },
  {
    h: '3. Why we collect it (purpose)',
    b: 'To create and maintain your account, confirm student or staff status, issue queue numbers and QR boarding passes, verify payments before boarding, prevent fraud and duplicate boarding, send boarding reminders, and provide support when you contact us. We collect only what is needed for these purposes (data minimisation).',
  },
  {
    h: '4. Legal basis and consent',
    b: 'By creating an account and tapping “Create Account”, you consent to the collection and use described here, as required under Nigeria’s NDPR / Data Protection Act framework. You may withdraw consent at any time by deleting your account (section 9), though bookings already used for boarding cannot be undone.',
  },
  {
    h: '5. Payments',
    b: 'Checkout and card/bank processing are handled entirely by Paystack. Payment details you enter on Paystack pages go directly to Paystack under Paystack’s own privacy policy and are never stored in this app or on our servers. We store only the payment reference, amount, and verification outcome needed to issue your ticket.',
  },
  {
    h: '6. Who sees your data',
    b: 'You see your own bookings and tickets. Shuttle staff see only what a scanned ticket reveals at boarding (name, matric number where applicable, route, boarding window, queue number, and ticket validity) and only to confirm boarding. Our backend provider (Supabase) stores the data to operate the service. We do not sell personal data and do not share it with advertisers.',
  },
  {
    h: '7. Where data is stored and how long we keep it',
    b: 'Data is stored on secured cloud servers. Records are kept as long as needed for fraud prevention, dispute resolution, and operating the service. If the law requires longer retention, we comply.',
  },
  {
    h: '8. Security',
    b: 'We use encrypted connections, authenticated access, and row-level access controls so users can only reach their own records. No method is 100% secure, so you must keep your password secret, never share QR codes or accounts, and sign out on shared devices. Tell us immediately at the support email below if you suspect misuse.',
  },
  {
    h: '9. Your rights and deleting your data',
    b: 'You may request a copy or correction of your data via the support email. To erase your data, use Profile → Delete Account, which removes your bookings and profile from the server before signing you out. Deletion is permanent and cannot be reversed. Scan records already stored on staff checkpoint phones cannot be recalled remotely — ask support if you need this addressed.',
  },
  {
    h: '10. Children',
    b: 'The app is for University of Abuja students and staff. It is not directed at children under 16, and we do not knowingly collect their data. If you believe a child’s data was provided, contact us and we will delete it.',
  },
  {
    h: '11. Changes to this policy',
    b: 'We may update this policy as the service evolves. Material changes will be reflected in the “Last updated” date above and, where appropriate, announced in the app. Continued use after changes take effect means you accept the updated policy.',
  },
  {
    h: '12. Contact us',
    b: `Questions, requests, or complaints: ${SUPPORT_EMAIL}. We aim to respond within a reasonable time. You also retain the right to complain to the Nigeria Data Protection Commission (NDPC).`,
  },
];

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Privacy Policy"
          subtitle={`Last updated ${LAST_UPDATED}.`}
          onBack={() => router.back()}
        />
        {SECTIONS.map((s) => (
          <Text key={s.h} style={styles.block}>
            <Text style={styles.h}>{s.h}{'\n'}</Text>
            <Text style={styles.b}>{s.b}</Text>
          </Text>
        ))}
        <Text style={styles.foot}>
          This policy describes how UniAbuja Shuttle handles your data.
          For the store listing, this same text is hosted at a public URL.
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
