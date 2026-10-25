import { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Platform,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/contexts/AuthContext';
import { verifyTicketCode, ScanReport, loadScanHistory, pushScanHistory, parseTicketId, saveScanHistory } from '@/utils/scanValidation';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';

const GREEN = UniAbujaGreen[700];

type ScanEntry = { code: string; time: string; result: 'ADMIT' | 'DENY' | 'USED' };

const SCAN_HISTORY_KEY = '@scan_history';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [history, setHistory] = useState<ScanEntry[]>([]);
  const [showManual, setShowManual] = useState(false);
  const busy = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBoarded = useRef<{ code: string; at: number } | null>(null);

  const role = user?.user_metadata?.role || 'student';

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SCAN_HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw));
      } catch {}
    })();
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const pushHistory = (code: string, result: ScanEntry['result']) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setHistory((p) => {
      const next = [{ code, time, result }, ...p].slice(0, 50);
      AsyncStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const verifyAndLog = async (rawCode: string) => {
    const code = parseTicketId(rawCode);
    if (
      lastBoarded.current &&
      lastBoarded.current.code === code &&
      Date.now() - lastBoarded.current.at < 5000
    ) {
      return;
    }
    if (busy.current) return;
    if (!code) {
      setReport({
        status: 'invalid',
        title: 'Empty code',
        message: 'No QR data detected. Hold steady and try again.',
      });
      return;
    }
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    busy.current = true;
    setChecking(true);
    setReport(null);

    try {
      const result = await verifyTicketCode(code);
      setReport(result);
      pushHistory(code, result.status === 'used' || result.status === 'boarded' ? 'USED' : result.status === 'invalid' ? 'DENY' : 'ADMIT');

      if (result.status === 'boarded') {
        lastBoarded.current = { code, at: Date.now() };
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        flashTimer.current = setTimeout(() => {
          setReport((cur) => (cur && cur.status === 'boarded' ? null : cur));
        }, 1500);
      } else if (result.status === 'invalid') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      setChecking(false);
      busy.current = false;
    }
  };

  const reset = () => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    setReport(null);
    setManual('');
  };

  const renderManualEntry = () => (
    <>
      <Text style={styles.label}>Ticket code (manual)</Text>
      <View style={styles.manualRow}>
        <View style={styles.input}>
          <MaterialIcons name="confirmation-num" size={20} color="#8E8E93" />
          <TextInput
            style={styles.text}
            placeholder="e.g. TKT-2026…"
            placeholderTextColor="#8E8E93"
            value={manual}
            onChangeText={setManual}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Ticket code"
          />
        </View>
        <TouchableOpacity
          style={[styles.verifyBtn, (!manual.trim() || checking) && { opacity: 0.45 }]}
          disabled={!manual.trim() || checking}
          onPress={() => verifyAndLog(manual)}
          activeOpacity={0.85}
          accessibilityLabel="Verify ticket code"
          accessibilityRole="button"
        >
          <Text style={styles.verifyT}>Verify</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (authLoading || !user) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  if (role !== 'staff') {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }]}>
        <StatusBar style="dark" />
        <MaterialIcons name="block" size={52} color="#FF3B30" />
        <Text style={styles.deniedT}>Staff only</Text>
        <Text style={styles.deniedS}>The ticket scanner is for shuttle staff accounts.</Text>
        <View style={{ height: 18 }} />
        <AppleButton title="Go Back" onPress={() => router.back()} />
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }]}>
        <StatusBar style="dark" />
        <View style={styles.permIcon}>
          <MaterialIcons name="qr-code-scanner" size={40} color={GREEN} />
        </View>
        <Text style={styles.deniedT}>Camera access needed</Text>
        <Text style={styles.deniedS}>Allow camera access to scan rider QR codes at the terminal, or enter the ticket code manually below.</Text>
        <View style={{ height: 18, width: '100%' }} />
        <AppleButton title="Allow Camera" icon="photo-camera" onPress={requestPermission} />
        {!permission.canAskAgain ? (
          <AppleButton title="Open Settings" variant="plain" onPress={() => Linking.openSettings()} />
        ) : null}
        <AppleButton
          title={showManual ? 'Hide Manual Entry' : 'Enter Code Manually'}
          variant="plain"
          onPress={() => setShowManual((v) => !v)}
        />
        {showManual ? (
          <View style={{ width: '100%', marginTop: 4 }}>
            {renderManualEntry()}
            {report ? (
              <Text style={[styles.deniedS, { marginTop: 10 }]}>{report.title}: {report.message}</Text>
            ) : null}
          </View>
        ) : null}
        <AppleButton title="Go Back" variant="plain" onPress={() => router.back()} />
      </View>
    );
  }

  const badgeColor = !report ? GREEN : report.status === 'valid' ? '#22C55E' : report.status === 'boarded' ? GREEN : report.status === 'used' ? '#FF9F0A' : '#FF3B30';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.nav}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Go back" accessibilityRole="button">
            <MaterialIcons name={Platform.OS === 'ios' ? 'chevron-left' : 'arrow-back'} size={24} color="#1C1C1E" />
          </TouchableOpacity>
          <View style={styles.staffPill}>
            <MaterialIcons name="verified-user" size={14} color={GREEN} />
            <Text style={styles.staffPillT}>Checkpoint</Text>
          </View>
        </View>
        <Text style={styles.title}>Scan ticket</Text>
        <Text style={styles.sub}>Point at each rider QR in turn. Admits clear by themselves — red reports stay until you tap Scan Next.</Text>

        {/* Camera stays mounted at all times — unmounting it is what
            left a black preview after Scan Next. Scanning pauses
            while a report is on screen. */}
        <View style={styles.scanner}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(e) => { if (!checking && (!report || report.status === 'boarded')) verifyAndLog(e.data); }}
          />
          <View style={styles.frame} pointerEvents="none">
            <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 }]} />
            <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 }]} />
            <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 }]} />
            <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 }]} />
          </View>
          {checking ? (
            <View style={styles.checking}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.checkingT}>Verifying…</Text>
            </View>
          ) : null}
        </View>
        {report ? (
          <View style={[styles.report, { borderColor: badgeColor }]}>
            <View style={[styles.badge, { backgroundColor: badgeColor }]}>
              <MaterialIcons
                name={report.status === 'valid' ? 'check' : report.status === 'boarded' ? 'done-all' : report.status === 'used' ? 'history' : 'close'}
                size={34}
                color="#FFFFFF"
              />
            </View>
            <Text style={[styles.reportTitle, { color: badgeColor }]}>{report.title}</Text>
            <Text style={styles.reportMsg}>{report.message}</Text>
            {report.name ? (
              <View style={styles.fields}>
                <View style={styles.fieldRow}><Text style={styles.fk}>Rider</Text><Text style={styles.fv}>{report.name}</Text></View>
                {report.route ? <View style={styles.fieldRow}><Text style={styles.fk}>Route</Text><Text style={styles.fv}>{report.route}</Text></View> : null}
                {report.meta ? <View style={styles.fieldRow}><Text style={styles.fk}>Shuttle</Text><Text style={styles.fv}>{report.meta}</Text></View> : null}
                {report.boarding ? <View style={styles.fieldRow}><Text style={styles.fk}>Boarding</Text><Text style={styles.fv}>{report.boarding}</Text></View> : null}
                {report.queue ? <View style={styles.fieldRow}><Text style={styles.fk}>Queue</Text><Text style={[styles.fv, { color: GREEN, fontWeight: '800' }]}>{report.queue}</Text></View> : null}
                {report.paid ? <View style={styles.fieldRow}><Text style={styles.fk}>Paid</Text><Text style={styles.fv}>{report.paid}</Text></View> : null}
              </View>
            ) : null}
            <AppleButton title="Scan Next" variant={report.status === 'boarded' ? 'plain' : undefined} onPress={reset} />
            {report.retryCode ? (
              <View style={{ width: '100%', marginTop: 4 }}>
                <AppleButton
                  title="Retry Scan"
                  icon="refresh"
                  onPress={() => { const c = report.retryCode as string; setReport(null); verifyAndLog(c); }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {renderManualEntry()}

        {history.length > 0 ? (
          <>
            <Text style={[styles.label, { marginTop: 20 }]}>Scan log (kept on this phone)</Text>
            <View style={styles.histCard}>
              {history.map((h, i) => (
                <View key={`${h.code}-${i}`}>
                  <View style={styles.histRow}>
                    <View style={[styles.histDot, { backgroundColor: h.result === 'ADMIT' ? '#22C55E' : h.result === 'USED' ? '#FF9F0A' : '#FF3B30' }]} />
                    <Text style={styles.histCode} numberOfLines={1}>{h.code}</Text>
                    <Text style={styles.histMeta}>{h.result} • {h.time}</Text>
                  </View>
                  {i < history.length - 1 ? <View style={styles.histSep} /> : null}
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  staffPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF6ED', borderWidth: 1, borderColor: '#CDE8D3', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  staffPillT: { fontSize: 12.5, fontWeight: '700', color: GREEN },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8 },
  sub: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 16 },
  scanner: { height: 300, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000', marginBottom: 16, position: 'relative' },
  camera: { flex: 1 },
  frame: { position: 'absolute', top: 52, left: 52, right: 52, bottom: 52 },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: '#FFFFFF' },
  checking: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  checkingT: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  report: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 2, padding: 22, alignItems: 'center', marginBottom: 16 },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  reportTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  reportMsg: { fontSize: 15, color: '#3C3C43', textAlign: 'center', lineHeight: 22, marginTop: 8 },
  fields: { width: '100%', marginTop: 16, backgroundColor: '#F2F2F7', borderRadius: 14, padding: 14, gap: 9 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  fk: { fontSize: 13, color: '#8E8E93', fontWeight: '600' },
  fv: { fontSize: 14, color: '#1C1C1E', fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43', marginBottom: 8 },
  manualRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E5EA', minHeight: 54, gap: 10 },
  text: { flex: 1, fontSize: 16, color: '#1C1C1E', height: 52 },
  verifyBtn: { backgroundColor: GREEN, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  verifyT: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  histCard: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E9E9EE', paddingHorizontal: 14 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  histDot: { width: 9, height: 9, borderRadius: 5 },
  histCode: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#1C1C1E' },
  histMeta: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  histSep: { height: 1, backgroundColor: '#F0F0F4' },
  deniedT: { fontSize: 24, fontWeight: '800', color: '#1C1C1E', marginTop: 16 },
  deniedS: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  permIcon: { width: 88, height: 88, borderRadius: 28, backgroundColor: '#EAF6ED', alignItems: 'center', justifyContent: 'center', marginBottom: 6, borderWidth: 1, borderColor: '#CDE8D3' },
});