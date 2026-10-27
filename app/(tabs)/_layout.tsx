import { Tabs } from 'expo-router';
import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

const TABS: { name: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { name: 'index', icon: 'home' },
  { name: 'history', icon: 'confirmation-num' },
  { name: 'wallet', icon: 'account-balance-wallet' },
  { name: 'profile', icon: 'person-outline' },
];

function AppleTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 16);

  return (
    <View
      style={{
        position: 'absolute',
        left: '50%',
        bottom: bottomPad,
        width: 260,
        transform: [{ translateX: -130 }],
        backgroundColor: '#FFFFFF',
        borderRadius: 26,
        paddingVertical: 8,
        paddingHorizontal: 6,
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        ...(Platform.OS === 'android'
          ? { elevation: 16 }
          : {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -6 },
              shadowOpacity: 0.12,
              shadowRadius: 16,
            }),
      }}
    >
      {state.routes
        .filter((r: { name: string }) => TABS.some((t) => t.name === r.name))
        .map((route: { key: string; name: string }, tabIndex: number) => {
          const meta = TABS.find((t) => t.name === route.name)!;
          const index = state.routes.findIndex((r: { key: string }) => r.key === route.key);
          const focused = state.index === index;
          const onPress = () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            if (!focused) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={{ padding: 8, borderRadius: 20 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.name}
            >
              <MaterialIcons
                name={meta.icon}
                size={32}
                color={focused ? GREEN : '#8E8E93'}
              />
            </Pressable>
          );
        })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}
      tabBar={(props) => <AppleTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'Tickets' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', href: null }} />
      <Tabs.Screen name="wallet-topup" options={{ title: 'Add Funds' }} />
      <Tabs.Screen name="wallet-set-pin" options={{ title: 'Set Wallet PIN' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
