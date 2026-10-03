import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { ONBOARDING_KEY, ONBOARDING_VALUE } from '@/constants/app';

const GREEN = UniAbujaGreen[700];

const PAGES = [
  {
    icon: 'directions-bus' as const,
    chip: 'Main ⇄ Mini Campus',
    title: 'Book your shuttle\nin seconds.',
    desc: 'Pick your route, choose a boarding window, and get your queue number. Buses run 6am to 6pm, Monday to Saturday.',
  },
  {
    icon: 'lock' as const,
    chip: 'Secure Paystack checkout',
    title: 'Pay safely.\nGet your ticket.',
    desc: 'Pay by card, transfer, or USSD. Your boarding pass with QR code appears the moment payment confirms.',
  },
  {
    icon: 'qr-code-2' as const,
    chip: 'Same-day boarding pass',
    title: 'Show. Scan.\nBoard.',
    desc: 'Each pass works once, for today only. Show your QR at the terminal and listen for your queue number.',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: W } = useWindowDimensions();
  const ref = useRef<FlatList>(null);
  const [page, setPage] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, ONBOARDING_VALUE);
    } catch {}
    // Authenticated users revisiting onboarding go home, not back to auth.
    try {
      const session = await Promise.race([
        supabase.auth.getSession(),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]) as any;
      if (session?.data?.session?.user) {
        router.replace('/(tabs)');
        return;
      }
    } catch {}
    router.replace('/auth');
  }, [router, finishing]);

  const next = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (page < PAGES.length - 1) ref.current?.scrollToOffset({ offset: (page + 1) * W, animated: true });
    else finish();
  }, [page, finish, W]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brand}>
          <View style={styles.mark}>
            <MaterialIcons name="directions-bus" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.brandText}>UniAbuja Shuttle</Text>
        </View>
        <TouchableOpacity onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={ref}
        data={PAGES}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: W, offset: W * index, index })}
        initialNumToRender={PAGES.length}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        onViewableItemsChanged={({ viewableItems }) => {
          if (viewableItems.length > 0 && viewableItems[0].index != null) {
            setPage(viewableItems[0].index);
          }
        }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          // Width must be the measured window (W), not '100%': percentage
          // widths resolve against the scroll content, which smeared one
          // visual across all three pages.
          <View style={[styles.page, { width: W }]}>
            <View style={styles.hero}>
              <View style={styles.heroGlow} />
              <View style={styles.heroCard}>
                <MaterialIcons name={item.icon} size={84} color={GREEN} />
                <View style={styles.heroBadge}>
                  <MaterialIcons name="check" size={16} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.chip}>
                <View style={styles.chipDot} />
                <Text style={styles.chipText}>{item.chip}</Text>
              </View>
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.desc}>{item.desc}</Text>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <TouchableOpacity
              key={i}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={`Go to page ${i + 1}`}
              accessibilityRole="button"
              onPress={() => {
                setPage(i);
                ref.current?.scrollToOffset({ offset: i * W, animated: true });
              }}
            >
              <View style={[styles.dot, i === page && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
        <AppleButton
          title={page === PAGES.length - 1 ? 'Get Started' : 'Continue'}
          icon={page === PAGES.length - 1 ? undefined : 'arrow-forward'}
          onPress={next}
        />
        <Text style={styles.hint}>Pay per trip • No cash needed</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { fontSize: 16, fontWeight: '700', color: '#1C1C1E', letterSpacing: -0.3 },
  skip: { fontSize: 16, fontWeight: '600', color: GREEN, padding: 8 },
  page: { paddingHorizontal: 28, paddingTop: 18 },
  hero: { alignItems: 'center', marginBottom: 30, marginTop: 8 },
  heroGlow: {
    position: 'absolute',
    top: 10,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#EAF6ED',
  },
  heroCard: {
    width: 190,
    height: 190,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDF0E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: Platform.OS === 'ios' ? 0.1 : 0.18,
    shadowRadius: 24,
    elevation: 6,
  },
  heroBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 18,
    backgroundColor: '#F0F9F3',
    borderWidth: 1,
    borderColor: '#D2ECD8',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  chipText: { fontSize: 13, fontWeight: '700', color: GREEN },
  title: { fontSize: 34, fontWeight: '800', color: '#1C1C1E', letterSpacing: -1, lineHeight: 40, textAlign: 'center' },
  desc: { fontSize: 16, color: '#6B7280', lineHeight: 24, textAlign: 'center', marginTop: 12, paddingHorizontal: 8 },
  footer: { paddingHorizontal: 22, gap: 14 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D9D9DE' },
  dotActive: { width: 26, backgroundColor: GREEN },
  hint: { textAlign: 'center', fontSize: 13, color: '#8E8E93', fontWeight: '500' },
});
