import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { Colors, UniAbujaGreen, AppleShadows } from '@/constants/theme';

export const AppleGreen = UniAbujaGreen[700];
export const AppleBg = '#F2F2F7';
export const AppleCard = '#FFFFFF';
export const AppleText = '#1C1C1E';
export const AppleSecondary = '#6B7280';
export const AppleTertiary = '#8E8E93';
export const AppleBorder = '#E5E5EA';

export function hapticLight() {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }
}

export function AppleButton({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'plain';
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  style?: ViewStyle;
}) {
  if (variant === 'plain') {
    return (
      <TouchableOpacity
        onPress={() => {
          hapticLight();
          onPress();
        }}
        activeOpacity={0.6}
        disabled={disabled || loading}
        style={[styles.plainBtn, style]}
      >
        <Text style={styles.plainText}>{loading ? 'Please wait…' : title}</Text>
      </TouchableOpacity>
    );
  }
  if (variant === 'secondary') {
    return (
      <TouchableOpacity
        onPress={() => {
          hapticLight();
          onPress();
        }}
        activeOpacity={0.8}
        disabled={disabled || loading}
        style={[styles.secondaryBtn, (disabled || loading) && { opacity: 0.5 }, style]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={AppleGreen} />
        ) : (
          <Text style={styles.secondaryText}>{title}</Text>
        )}
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      onPress={() => {
        hapticLight();
        onPress();
      }}
      activeOpacity={0.85}
      disabled={disabled || loading}
      style={[styles.primaryBtn, (disabled || loading) && styles.primaryDisabled, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <MaterialIcons name={icon} size={19} color="#FFFFFF" /> : null}
          <Text style={styles.primaryText}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function Field({
  label,
  icon,
  error,
  focused,
  ...props
}: TextInputProps & {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  error?: string;
  focused?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldWrap, focused && styles.fieldFocused, error && styles.fieldError]}>
        <MaterialIcons name={icon} size={20} color={error ? '#FF3B30' : '#8E8E93'} />
        <TextInput
          {...props}
          style={styles.fieldInput}
          placeholderTextColor="#8E8E93"
          selectionColor={AppleGreen}
        />
      </View>
      {error ? <Text style={styles.fieldErrorText}>{error}</Text> : null}
    </View>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        {onBack ? (
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              onBack();
            }}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons
              name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'}
              size={26}
              color={AppleText}
            />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={{ flex: 1 }} />
        {right ?? <View style={{ width: 40 }} />}
      </View>
      <Text style={styles.largeTitle}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => {
              hapticLight();
              onChange(o.value);
            }}
            activeOpacity={0.8}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <MaterialIcons name={o.icon} size={17} color={active ? '#FFFFFF' : AppleSecondary} />
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  primaryBtn: {
    backgroundColor: AppleGreen,
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    ...AppleShadows.greenGlow,
  },
  primaryDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  primaryText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 },
  secondaryBtn: {
    backgroundColor: '#FFFFFF',
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppleBorder,
  },
  secondaryText: { fontSize: 17, fontWeight: '600', color: AppleText },
  plainBtn: { paddingVertical: 12, alignItems: 'center' },
  plainText: { fontSize: 16, fontWeight: '600', color: AppleGreen },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8, letterSpacing: 0.1 },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: AppleBorder,
    minHeight: 54,
    gap: 10,
  },
  fieldFocused: { borderColor: AppleGreen, borderWidth: 1.5 },
  fieldError: { borderColor: '#FF3B30' },
  fieldInput: { flex: 1, fontSize: 17, color: AppleText, height: 52, paddingVertical: 0 },
  fieldErrorText: { fontSize: 13, color: '#FF3B30', marginTop: 6, marginLeft: 4 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppleBorder,
    ...AppleShadows.subtle,
  },
  largeTitle: { fontSize: 32, fontWeight: '800', color: AppleText, letterSpacing: -0.8, lineHeight: 38 },
  subtitle: { fontSize: 16, color: AppleSecondary, marginTop: 6, lineHeight: 22 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#E9E9EE',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    gap: 6,
  },
  segmentActive: {
    backgroundColor: AppleGreen,
    ...AppleShadows.card,
  },
  segmentText: { fontSize: 15, fontWeight: '600', color: AppleSecondary },
  segmentTextActive: { color: '#FFFFFF' },
});

export { Colors };
