import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';
import { CustomAlert } from '@/components/ui/CustomAlert';

const GREEN = UniAbujaGreen[700];

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [transferLoading, setTransferLoading] = useState(false);

  // Transfer flow state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferStep, setTransferStep] = useState<'matric' | 'amount' | 'confirm' | 'pin' | 'success'>('matric');
  const [recipientMatric, setRecipientMatric] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [transferPin, setTransferPin] = useState('');

  // Custom alert states
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [alertOnConfirm, setAlertOnConfirm] = useState(() => () => {});

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', onConfirm: () => void = () => {}) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertType(type);
    setAlertOnConfirm(onConfirm);
    setAlertVisible(true);
  };

  // Fetch wallet balance
  const fetchBalance = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      setBalance((data as any)?.balance || 0);
    } catch {
      setBalance(0);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // ── Transfer flow ──
  const lookupRecipient = async () => {
    if (!recipientMatric.trim()) return;
    setTransferLoading(true);
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, matric_number')
        .eq('matric_number', recipientMatric.trim())
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) {
        showAlert('Recipient not found', 'No user found with this matric number.', 'error');
        return;
      }
      setRecipientName(profile.full_name);
      setTransferStep('amount');
    } catch (err: any) {
      showAlert('Lookup failed', err?.message || 'Could not find recipient.', 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  const confirmTransfer = async () => {
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) {
      showAlert('Invalid amount', 'Please enter a valid transfer amount.', 'error');
      return;
    }
    if (amt > balance) {
      showAlert('Insufficient balance', `You only have ₦${balance.toFixed(2)} in your wallet.`, 'error');
      return;
    }
    setTransferStep('pin');
  };

  const executeTransfer = async () => {
    if (!transferPin || transferPin.length !== 4) {
      showAlert('PIN required', 'Please enter your 4-digit wallet PIN.', 'error');
      return;
    }
    setTransferLoading(true);
    try {
      const { data, error } = await supabase.rpc('wallet_transfer', {
        p_from_user_id: user!.id,
        p_to_matric: recipientMatric.trim(),
        p_amount: parseFloat(transferAmount),
        p_pin: transferPin,
      });
      if (error) throw error;
      if (!data?.ok) {
        showAlert('Transfer failed', (data as any)?.reason || 'Transfer could not be completed.', 'error');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setBalance((data as any).from_balance);
      setTransferStep('success');
    } catch (err: any) {
      showAlert('Transfer failed', err?.message || 'Transfer could not be completed.', 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  const resetTransfer = () => {
    setShowTransfer(false);
    setTransferStep('matric');
    setRecipientMatric('');
    setTransferAmount('');
    setRecipientName('');
    setTransferPin('');
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Loading wallet…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <Text style={[styles.title, { textAlign: 'center' }]}>Wallet</Text>
        </View>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <MaterialIcons name="account-balance-wallet" size={28} color="#FFFFFF" />
          <View style={styles.balanceInfo}>
            <Text style={styles.balanceLabel}>Available Balance</Text>
            <Text style={styles.balanceAmount}>₦{balance.toFixed(2)}</Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actionsContainer}>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push('/wallet-topup' as any)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={24} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Add funds</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                if (!user) return;
                setShowTransfer(true);
              }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="send" size={24} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Transfer</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Transactions */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <View style={styles.emptyList}>
            <MaterialIcons name="receipt" size={32} color="#8E8E93" />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        </View>
      </ScrollView>

      {/* Transfer Modal */}
      {showTransfer && (
        <TouchableOpacity style={styles.modalBackdrop} onPress={() => resetTransfer()} activeOpacity={1}>
          <TouchableOpacity style={styles.modalCard} onPress={(e: any) => e.stopPropagation()} activeOpacity={1}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transfer Wallet</Text>
              <TouchableOpacity onPress={resetTransfer}>
                <MaterialIcons name="close" size={24} color="#8E8E93" />
              </TouchableOpacity>
            </View>

            {/* Step 1: Matric Number */}
            {transferStep === 'matric' && (
              <View>
                <Text style={styles.modalStepTitle}>Recipient Matric Number</Text>
                <View style={styles.inputRow}>
                  <MaterialIcons name="school" size={20} color="#8E8E93" />
                  <TextInputStyled
                    value={recipientMatric}
                    onChangeText={setRecipientMatric}
                    placeholder="Enter matric number"
                    autoCapitalize="characters"
                  />
                </View>
                <AppleButton
                  title={transferLoading ? 'Looking up…' : 'Look up recipient'}
                  loading={transferLoading}
                  disabled={transferLoading || !recipientMatric.trim()}
                  onPress={lookupRecipient}
                  variant="plain"
                  style={{ marginTop: 16 }}
                />
                <Text style={styles.modalHint}>Ask the recipient for their matric number.</Text>
              </View>
            )}

            {/* Step 2: Amount */}
            {transferStep === 'amount' && (
              <View>
                <View style={styles.modalRecipientRow}>
                  <View style={styles.recipientInfo}>
                    <MaterialIcons name="person" size={20} color={GREEN} />
                    <View>
                      <Text style={styles.modalStepTitle}>{recipientName}</Text>
                      <Text style={styles.modalSubtle}>{recipientMatric}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.modalStepTitle}>Transfer Amount</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.currencyPrefix}>₦</Text>
                  <TextInputStyled
                    value={transferAmount}
                    onChangeText={setTransferAmount}
                    placeholder="0"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.balanceHint}>
                  <Text>Available balance: ₦{balance.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <AppleButton
                    title="Back"
                    onPress={() => setTransferStep('matric')}
                    variant="plain"
                  />
                  <AppleButton
                    title="Continue"
                    onPress={confirmTransfer}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 3: Confirm */}
            {transferStep === 'confirm' && (
              <View>
                <Text style={styles.modalStepTitle}>Confirm Transfer</Text>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>To:</Text>
                  <Text style={styles.confirmValue}>{recipientName}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Matric:</Text>
                  <Text style={styles.confirmValue}>{recipientMatric}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Amount:</Text>
                  <Text style={styles.confirmValue}>₦{parseFloat(transferAmount || '0').toFixed(2)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>New balance:</Text>
                  <Text style={styles.confirmValue}>₦{(balance - parseFloat(transferAmount || '0')).toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
                  <AppleButton
                    title="Back"
                    onPress={() => setTransferStep('amount')}
                    variant="plain"
                  />
                  <AppleButton
                    title="Confirm"
                    onPress={() => setTransferStep('pin')}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 4: PIN */}
            {transferStep === 'pin' && (
              <View>
                <Text style={styles.modalStepTitle}>Enter Wallet PIN</Text>
                <Text style={styles.modalSubtle}>Enter your 4-digit PIN to authorize the transfer.</Text>
                <View style={styles.pinRow}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={styles.pinBox}>
                      <Text style={styles.pinText}>{transferPin[i] || ''}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
                  <AppleButton
                    title="Back"
                    onPress={() => setTransferStep('confirm')}
                    variant="plain"
                  />
                  <AppleButton
                    title={transferLoading ? 'Transferring…' : 'Transfer'}
                    loading={transferLoading}
                    disabled={transferLoading || transferPin.length < 4}
                    onPress={executeTransfer}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 5: Success */}
            {transferStep === 'success' && (
              <View style={styles.successState}>
                <MaterialIcons name="check-circle" size={48} color={GREEN} />
                <Text style={styles.successTitle}>Transfer Successful</Text>
                <Text style={styles.successSubtle}>
                  ₦{parseFloat(transferAmount || '0').toFixed(2)} sent to {recipientName}
                </Text>
                <AppleButton
                  title="Done"
                  onPress={resetTransfer}
                  variant="primary"
                  style={{ marginTop: 20 }}
                />
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Custom Alert */}
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        type={alertType}
        onConfirm={alertOnConfirm}
        loading={transferLoading}
      />
    </View>
  );
}

// ── TextInput component ──
import { TextInput } from 'react-native';

function TextInputStyled(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'numeric' | 'default';
}) {
  return (
    <TextInput
      style={styles.textInput}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      autoCapitalize={props.autoCapitalize}
      keyboardType={props.keyboardType}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  nav: { marginBottom: 24 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8, textAlign: 'center' },
  balanceCard: {
    backgroundColor: GREEN,
    borderRadius: 28,
    padding: 28,
    marginBottom: 28,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  actionsContainer: { marginBottom: 28 },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    minHeight: 60,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionContainer: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#6B7280', marginBottom: 12 },
  emptyList: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    width: '88%',
    maxWidth: 340,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1E' },
  modalStepTitle: { fontSize: 15, fontWeight: '700', color: '#1C1C1E', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 52,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  currencyPrefix: { fontSize: 17, fontWeight: '800', color: '#1C1C1E', marginRight: 4 },
  textInput: { flex: 1, color: '#1C1C1E', fontSize: 17 },
  modalHint: { fontSize: 13, color: '#8E8E93', marginTop: 8, textAlign: 'center' },
  balanceHint: { fontSize: 13, color: '#6B7280', marginTop: 12, textAlign: 'center' },
  modalRecipientRow: { marginBottom: 16 },
  recipientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F9F3',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CDE8D3',
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F4',
  },
  confirmLabel: { fontSize: 14, color: '#6B7280' },
  confirmValue: { fontSize: 14, fontWeight: '700', color: '#1C1C1E' },
  pinRow: { justifyContent: 'center', gap: 8, marginTop: 16 },
  pinBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  pinText: { fontSize: 20, fontWeight: '800', color: '#1C1C1E' },
  modalSubtle: { fontSize: 13, color: '#8E8E93', marginTop: 4, textAlign: 'center' },
  // Success
  successState: { alignItems: 'center', textAlign: 'center', marginTop: 20 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1E', marginTop: 12 },
  successSubtle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
});
