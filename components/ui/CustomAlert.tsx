import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

type AlertType = 'success' | 'error' | 'warning' | 'info';

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message: string;
  type?: AlertType;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  loading?: boolean;
}

export function CustomAlert({
  visible,
  title,
  message,
  type = 'info',
  onConfirm,
  confirmText = 'OK',
  cancelText,
  showCancel = false,
  loading = false,
}: CustomAlertProps) {
  if (!visible) return null;

  const iconMap: Record<AlertType, { name: string; color: string }> = {
    success: { name: 'check-circle', color: '#22C55E' },
    error: { name: 'error-outline', color: '#FF3B30' },
    warning: { name: 'warning', color: '#F59E0B' },
    info: { name: 'information', color: '#3B82F6' },
  };

  const { name: iconName, color: iconColor } = iconMap[type];

  return (
    <View style={[styles.backdrop, { opacity: visible ? 1 : 0 }]}>
      <TouchableOpacity
        style={styles.backdropPress}
        onPress={() => {
          if (cancelText) onConfirm();
        }}
        activeOpacity={1}
      />
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MaterialIcons name={iconName as any} size={48} color={iconColor} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message} numberOfLines={3}>
          {message}
        </Text>
        {loading ? (
          <ActivityIndicator size="large" color={GREEN} style={styles.loading} />
        ) : (
          <View style={styles.buttons}>
            {showCancel && cancelText ? (
              <TouchableOpacity style={styles.cancelBtn} onPress={onConfirm}>
                <Text style={styles.cancelBtnText}>{cancelText}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm}>
              <Text style={styles.confirmBtnText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1001,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '88%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 16,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14.5,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  loading: {
    marginTop: 10,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
