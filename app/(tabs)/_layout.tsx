import { Tabs } from 'expo-router';
import React from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

const TABS: { name: string; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'history', label: 'Tickets', icon: 'confirmation-num' },
  { name: 'profile', label: 'Profile', icon: 'person-outline' },
];

function AppleTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 10);

  return (
    <View
      style={{
        backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        borderTopWidth: Platform.OS === 'ios' ? 0.5 : 0,
        borderTopColor: 'rgba(0,0,0,0.12)',
        paddingTop: 8,
        paddingBottom: bottomPad,
        paddingHorizontal: 6,
        flexDirection: 'row',
        ...(Platform.OS === 'android' ? { elevation: 12 } : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
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
              style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
            >
              <MaterialIcons
                name={focused ? (meta.icon === 'home' ? 'home' : meta.icon === 'person-outline' ? 'person' : meta.icon) : meta.icon}
                size={26}
                color={focused ? GREEN : '#8E8E93'}
              />
              <Text style={{ fontSize: 11, fontWeight: focused ? '700' : '500', color: focused ? GREEN : '#8E8E93' }}>
                {meta.label}
              </Text>
              {focused ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: GREEN, marginTop: 1 }} /> : <View style={{ height: 6 }} />}
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
      <Tabs.Screen name="notifications" options={{ title: 'Alerts', href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
