/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#168038';
const tintColorDark = '#34D399';

// University of Abuja green palette - elevated with Apple aesthetic
export const UniAbujaGreen = {
  50: '#F0F9F3',
  100: '#DCF3E3',
  200: '#BCE5C8',
  300: '#8ED1A1',
  400: '#54B772',
  500: '#2E9C4F',
  600: '#1E823D',
  700: '#186832', // Apple Forest Green Primary
  800: '#145329',
  900: '#0E3C1D',
  accent: '#22C55E',
} as const;

export const AppleColors = {
  label: '#000000',
  secondaryLabel: '#3C3C43',
  tertiaryLabel: '#787880',
  quaternaryLabel: '#AEAEC2',
  placeholder: '#8E8E93',
  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  tertiarySystemBackground: '#FFFFFF',
  groupedBackground: '#F2F2F7',
  secondaryGroupedBackground: '#FFFFFF',
  separator: '#E5E5EA',
  opaqueSeparator: '#C6C6C8',
  systemGreen: '#186832',
  systemGreenLight: '#F0F9F3',
  systemGreenBorder: '#D2ECD8',
  systemRed: '#FF3B30',
  systemOrange: '#FF9500',
  systemBlue: '#007AFF',
};

export const Colors = {
  light: {
    text: '#1C1C1E',
    secondaryText: '#687076',
    tertiaryText: '#8E8E93',
    background: '#FFFFFF',
    surface: '#F2F2F7',
    card: '#FFFFFF',
    border: '#E5E5EA',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#8E8E93',
    tabIconSelected: tintColorLight,
    primary: UniAbujaGreen[700],
    primaryLight: UniAbujaGreen[50],
    primaryBorder: UniAbujaGreen[200],
    primaryDark: UniAbujaGreen[900],
    danger: '#FF3B30',
    dangerBg: '#FEE2E2',
    warning: '#FF9500',
    warningBg: '#FEF3C7',
    success: '#34C759',
    successBg: '#E8F5E9',
  },
  dark: {
    text: '#ECEDEE',
    secondaryText: '#9BA1A6',
    tertiaryText: '#687076',
    background: '#0D0E0E',
    surface: '#1C1C1E',
    card: '#18191A',
    border: '#2C2C2E',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorDark,
    primary: UniAbujaGreen[400],
    primaryLight: 'rgba(30, 130, 61, 0.2)',
    primaryBorder: 'rgba(30, 130, 61, 0.4)',
    primaryDark: UniAbujaGreen[800],
    danger: '#FF453A',
    dangerBg: 'rgba(255, 69, 58, 0.15)',
    warning: '#FF9F0A',
    warningBg: 'rgba(255, 159, 10, 0.15)',
    success: '#30D158',
    successBg: 'rgba(48, 209, 88, 0.15)',
  },
} as const;

export const AppleShadows = {
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 4,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  greenGlow: {
    shadowColor: UniAbujaGreen[700],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
};

export const AppleRadius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  full: 9999,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Icons', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});
