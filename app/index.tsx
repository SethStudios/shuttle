import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Animated, Easing, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { UniAbujaGreen } from '@/constants/theme';
import { ONBOARDING_KEY, SPLASH_MIN_MS, SESSION_TIMEOUT_MS, STORAGE_TIMEOUT_MS } from '@/constants/app';

export default function SplashScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Animated values live in state, not refs: reading ref.current during
  // render breaks render purity (and the animation handles are stable).
  const [scale] = useState(() => new Animated.Value(0.86));
  const [opacity] = useState(() => new Animated.Value(0));
  const [bar] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: false, easing: Easing.out(Easing.ease) }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: false, damping: 16, stiffness: 140 }),
      Animated.timing(bar, { toValue: 1, duration: 900, useNativeDriver: false, easing: Easing.inOut(Easing.ease) }),
    ]).start();

    let done = false;
    const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    // Start the auth check IMMEDIATELY on mount — in parallel with the
    // branding animation — instead of waiting ~900ms first. Previously
    // the sequence was serial (900ms + up to 2.5s session + up to 2.5s
    // user ≈ 6s worst case), which is the hang felt after Metro hits 100%.
    type Dest = '/(tabs)' | '/auth' | '/onboarding';
    const sessionCheck: Promise<Dest> = (async (): Promise<Dest> => {
      try {
        const [{ data }, seen, seenLegacy] = await Promise.all([
          withTimeout(supabase.auth.getSession() as Promise<any>, SESSION_TIMEOUT_MS, { data: { session: null } } as any),
          withTimeout(AsyncStorage.getItem(ONBOARDING_KEY), STORAGE_TIMEOUT_MS, null),
          // Legacy key from older builds — honored, then migrated on finish.
          withTimeout(AsyncStorage.getItem('hasSeenOnboarding:true'), STORAGE_TIMEOUT_MS, null),
        ]);
        const hasOnboarded = seen === 'true' || seen === 'v1' || seenLegacy === 'true';
        if (data.session?.user) {
          const { data: confirmed, error } = (await withTimeout(
            supabase.auth.getUser() as Promise<any>,
            SESSION_TIMEOUT_MS,
            { data: { user: null }, error: { message: 'timeout' } } as any
          )) as any;
          if (!error && confirmed.user) {
            return '/(tabs)';
          }
          if (error?.message === 'timeout') {
            // Offline/slow: keep the cached session and enter the app.
            // AuthContext revalidates silently when connectivity returns.
            return '/(tabs)';
          }
          await supabase.auth.signOut().catch(() => {});
        }
        return hasOnboarded ? '/auth' : '/onboarding';
      } catch {
        // Storage failure: don't strand returning users on onboarding.
        // Default to auth (safe) — onboarding can still be visited manually.
        return '/auth';
      }
    })();
    // Minimum branding time so the splash never flashes by.
    const minDelay = new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS));

    let cancelled = false;
    const navigationLock = { current: false };
    const go = async () => {
      if (done || navigationLock.current) return;
      done = true;
      navigationLock.current = true;
      const [dest] = await Promise.all([sessionCheck, minDelay]);
      if (!cancelled) router.replace(dest);
    };
    go();
    return () => {
      cancelled = true;
    };
  }, [router, opacity, scale, bar]);

  const barWidth = bar.interpolate({ inputRange: [0, 1], outputRange: ['8%', '100%'] });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
        <View style={styles.logoShadow}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.name}>UniAbuja Shuttle</Text>
        <Text style={styles.tag}>Main Campus ⇄ Mini Campus</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: barWidth }]} />
        </View>
      </Animated.View>
      <Text style={[styles.foot, { bottom: Math.max(insets.bottom, 16) + 28 }]}>Safe • Fast • Cashless</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UniAbujaGreen[700],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: { alignItems: 'center', width: '100%' },
  logoShadow: {
    width: 112,
    height: 112,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: Platform.OS === 'ios' ? 0.25 : 0.4,
    shadowRadius: 24,
    elevation: 10,
    overflow: 'hidden',
  },
  logo: { width: 96, height: 96 },
  name: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.8 },
  tag: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.82)', marginTop: 6, marginBottom: 28 },
  track: {
    width: 168,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 3 },
  foot: {
    position: 'absolute',
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.4,
  },
});
