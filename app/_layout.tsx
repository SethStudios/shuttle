import { useEffect } from 'react';
import { Linking } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { supabase } from '@/utils/supabase';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/contexts/AuthContext';
import { startNotificationListener, stopNotificationListener } from '@/services/notifications';

// Keep the native splash visible until the JS below is ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── expo-notifications setup (lazy — never static-import) ───────
// expo-notifications fires a module-level side effect on import
// (DevicePushTokenAutoRegistration.fx) that console-errors in
// Expo Go SDK 53+. Gating the require() behind isRunningInExpoGo
// prevents the module from ever loading in Expo Go.
if (!isRunningInExpoGo()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async (notification: any) => {
      const data = notification?.request?.content?.data as any;
      // Shuttle DATE triggers are never scheduled for Sunday, but keep as safety:
      // only suppress shuttle-availability on Sunday, allow boarding reminders always (banner + sound)
      if (data?.type === 'shuttle-availability' && new Date().getDay() === 0) {
        return {
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
      return {
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });
}

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Start the notification listener so native push notifications
  // are synced into the in-app AsyncStorage store immediately.
  useEffect(() => {
    startNotificationListener();
    return () => stopNotificationListener();
  }, []);

  // Hand over to our own JS splash screen (app/index.tsx) once mounted.
  // Small delay lets the layout settle; index.tsx owns the real routing.
  useEffect(() => {
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // Password-recovery deep link: uniabujashuttle://reset-password?code=…
  // Only recovery URLs are handled, and we navigate only after the code
  // exchange succeeds — never onto the reset screen without a session.
  useEffect(() => {
    let alive = true;
    const isRecoveryUrl = (url: string) => {
      const lower = url.toLowerCase();
      return lower.startsWith('uniabujashuttle://reset-password');
    };
    const handle = async (url: string | null) => {
      if (!url || !isRecoveryUrl(url)) return;
      try {
        // PKCE flow: ?code=… — exchange it for a recovery session.
        const match = url.match(/[?&]code=([^&#]+)/);
        if (match) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            decodeURIComponent(match[1])
          );
          if (alive) {
            router.replace(error ? '/forgot-password' : '/reset-password');
          }
          return;
        }
        // Implicit flow: #access_token=…&refresh_token=…&type=recovery —
        // older email templates use this. Establish the session directly.
        const frag = url.split('#')[1] || '';
        const access = frag.match(/(?:^|&)access_token=([^&]+)/);
        const refresh = frag.match(/(?:^|&)refresh_token=([^&]+)/);
        if (access && refresh) {
          const { error } = await supabase.auth.setSession({
            access_token: decodeURIComponent(access[1]),
            refresh_token: decodeURIComponent(refresh[1]),
          });
          if (alive) {
            router.replace(error ? '/forgot-password' : '/reset-password');
          }
          return;
        }
        if (alive) router.replace('/forgot-password');
      } catch {
        if (alive) router.replace('/forgot-password');
      }
    };
    // Let the splash route first so it cannot overwrite the recovery nav.
    const t = setTimeout(() => {
      Linking.getInitialURL().then(handle).catch(() => {});
    }, 1200);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => {
      alive = false;
      clearTimeout(t);
      sub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack
          screenOptions={{
            headerShown: false,
            // Calm cross-fade between screens instead of the default
            // platform push. Consistent on iOS and Android.
            animation: 'fade',
            animationDuration: 200,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="change-password" options={{ headerShown: false }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
          <Stack.Screen name="booking" options={{ headerShown: false }} />
          <Stack.Screen name="subscription" options={{ headerShown: false }} />
          <Stack.Screen name="payment" options={{ headerShown: false }} />
          <Stack.Screen name="ticket" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="terms" options={{ headerShown: false }} />
          <Stack.Screen name="scan" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
    </SafeAreaProvider>
  );
}