import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  TextInput, Dimensions,
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
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [balance, setBalance] = useState(0);
  const [hasPin, setHasPin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transferLoading, setTransferLoading] = useState(false);

  // Transfer flow state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferStep, setTransferStep] = useState<'matric' | 'amount' | 'pin' | 'success'>('matric');
  const [recipientMatric, setRecipientMatric] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
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

  // Fetch wallet balance and PIN status
  const fetchWallet = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('wallets')
        .select('balance, pin_hash')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      setBalance((data as any)?.balance || 0);
      setHasPin(!!(data as any)?.pin_hash);
    } catch {
      setBalance(0);
      setHasPin(false);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  // ── Transfer Step 1: Look up recipient by matric ──
  const lookupRecipient = async () => {
    if (!recipientMatric.trim()) {
      showAlert('Enter matric', 'Please enter the recipient matric number.', 'error');
      return;
    }
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

  // ── Transfer Step 2: Execute transfer with PIN ──
  const executeTransfer = async () => {
    if (!transferPin || transferPin.length !== 4) {
      showAlert('PIN required', 'Please enter your 4-digit wallet PIN.', 'error');
      return;
    }
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) {
      showAlert('Invalid amount', 'Please enter a valid transfer amount.', 'error');
      return;
    }
    if (amt > balance) {
      showAlert('Insufficient balance', `You only have ₦${balance.toFixed(2)} in your wallet.`, 'error');
      return;
    }

    setTransferLoading(true);
    try {
      const { data, error } = await supabase.rpc('wallet_transfer', {
        p_from_user_id: user!.id,
        p_to_matric: recipientMatric.trim(),
        p_amount: amt,
        p_pin: transferPin,
      });
      if (error) throw error;
      if (!data?.ok) {
        const reason = (data as any)?.reason;
        if (reason === 'invalid_pin') {
          showAlert('Wrong PIN', 'The PIN you entered is incorrect. Please try again.', 'error');
          return;
        }
        if (reason === 'wallet_not_found') {
          showAlert('No wallet', 'You do not have a wallet yet. Please add funds first.', 'error', () => {
            setShowTransfer(false);
            router.push('/wallet-topup' as any);
          });
          return;
        }
        if (reason === 'insufficient_balance') {
          showAlert('Insufficient balance', `You only have ₦${balance.toFixed(2)} in your wallet.`, 'error');
          return;
        }
        if (reason === 'recipient_not_found') {
          showAlert('Recipient not found', 'The recipient could not be found.', 'error');
          return;
        }
        if (reason === 'cannot_transfer_to_self') {
          showAlert('Cannot transfer', 'You cannot transfer money to yourself.', 'error');
          return;
        }
        showAlert('Transfer failed', reason || 'Transfer could not be completed.', 'error');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setBalance((data as any)?.from_balance ?? balance - amt);
      setTransferStep('success');
    } catch (err: any) {
      showAlert('Transfer failed', err?.message || 'Transfer could not be completed. Please check your connection.', 'error');
    } finally {
      setTransferLoading(false);
    }
  };

  const resetTransfer = () => {
    setShowTransfer(false);
    setTransferStep('matric');
    setRecipientMatric('');
    setRecipientName('');
    setTransferAmount('');
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
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.title}>Wallet</Text>
            <Text style={styles.subtitle}>Manage your shuttle wallet balance</Text>
          </View>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceLeft}>
            <MaterialIcons name="account-balance-wallet" size={32} color="rgba(255,255,255,0.9)" />
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <Text style={styles.balanceAmount}>₦{balance.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.balanceRight}>
            <MaterialIcons name="arrow-right" size={20} color="rgba(255,255,255,0.7)" />
          </View>
        </View>

        {/* PIN Notice */}
        {!hasPin && (
          <View style={styles.pinNotice}>
            <MaterialIcons name="lock-outline" size={18} color="#F59E0B" />
            <Text style={styles.pinNoticeText}>
              Set a 4-digit PIN to send money to friends
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push('/wallet-topup' as any)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={24} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Add Funds</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                if (!user) return;
                if (!hasPin) {
                  showAlert('Set PIN first', 'Please create a 4-digit PIN before you can transfer funds.', 'warning', () => {
                    setShowTransfer(true);
                  });
                  return;
                }
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
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
          </View>
          <View style={styles.emptyList}>
            <MaterialIcons name="receipt" size={40} color="#8E8E93" />
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptySubtitle}>
              Your top-ups and transfers will appear here
            </Text>
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
              <View style={styles.stepContent}>
                <Text style={styles.modalStepTitle}>Send money to</Text>
                <Text style={styles.modalSubtle}>Enter the recipient&apos;s matric number</Text>
                <View style={styles.inputRow}>
                  <MaterialIcons name="school" size={20} color="#8E8E93" />
                  <TextInputStyled
                    value={recipientMatric}
                    onChangeText={setRecipientMatric}
                    placeholder="Enter matric number"
                    autoCapitalize="characters"
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
                  <AppleButton
                    title="Cancel"
                    onPress={resetTransfer}
                    variant="plain"
                  />
                  <AppleButton
                    title={transferLoading ? 'Looking up…' : 'Next'}
                    loading={transferLoading}
                    disabled={transferLoading || !recipientMatric.trim()}
                    onPress={lookupRecipient}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 2: Amount */}
            {transferStep === 'amount' && (
              <View style={styles.stepContent}>
                <View style={styles.modalRecipientRow}>
                  <View style={styles.recipientInfo}>
                    <MaterialIcons name="person" size={20} color={GREEN} />
                    <View>
                      <Text style={styles.recipientName}>{recipientName}</Text>
                      <Text style={styles.recipientMeta}>{recipientMatric}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.modalStepTitle}>Amount to send</Text>
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
                  <Text>Available balance:</Text>
                  <Text style={styles.balanceHintValue}>₦{balance.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
                  <AppleButton
                    title="Back"
                    onPress={() => setTransferStep('matric')}
                    variant="plain"
                  />
                  <AppleButton
                    title="Continue"
                    onPress={() => setTransferStep('pin')}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 3: PIN */}
            {transferStep === 'pin' && (
              <View style={styles.stepContent}>
                <Text style={styles.modalStepTitle}>Confirm with PIN</Text>
                <Text style={styles.modalSubtle}>Enter your 4-digit wallet PIN to authorize this transfer</Text>
                <View style={styles.pinRow}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={styles.pinBox}>
                      <Text style={styles.pinText}>{transferPin[i] || ''}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: 24 }}>
                  <AppleButton
                    title="Back"
                    onPress={() => setTransferStep('amount')}
                    variant="plain"
                  />
                </View>
                <View style={{ marginTop: 12 }}>
                  <AppleButton
                    title={transferLoading ? 'Transferring…' : 'Confirm transfer'}
                    loading={transferLoading}
                    disabled={transferLoading || transferPin.length < 4}
                    onPress={executeTransfer}
                    variant="primary"
                  />
                </View>
              </View>
            )}

            {/* Step 4: Success */}
            {transferStep === 'success' && (
              <View style={styles.successState}>
                <MaterialIcons name="check-circle" size={56} color={GREEN} />
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
function TextInputStyled(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'numeric' | 'default';
  maxLength?: number;
}) {
  return (
    <TextInput
      style={styles.textInput}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      autoCapitalize={props.autoCapitalize}
      keyboardType={props.keyboardType}
      maxLength={props.maxLength}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  header: { marginBottom: 24 },
  headerContent: {
    alignItems: 'center',
  },
  title: { fontSize: 34, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#6B7280', marginTop: 6, textAlign: 'center' },
  balanceCard: {
    backgroundColor: GREEN,
    borderRadius: 30,
    padding: 24,
    marginBottom: 24,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...StyleSheet.flatten([
      { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16 },
      { elevation: 8 },
    ]),
  },
  balanceLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  balanceInfo: { marginLeft: 12 },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  balanceAmount: { fontSize: 56, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
  balanceRight: { marginRight: 4 },
  pinNotice: {
    marginTop: 0,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pinNoticeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  actionsContainer: { marginBottom: 24 },
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
    minHeight: 56,
    ...StyleSheet.flatten([
      { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8 },
      { elevation: 5 },
    ]),
  },
  actionBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  sectionContainer: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  emptyList: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    width: '88%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1C1C1E' },
  stepContent: { flex: 1 },
  modalStepTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E', marginBottom: 4 },
  modalSubtle: { fontSize: 13, color: '#6B7280', marginBottom: 16 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 56,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  currencyPrefix: { fontSize: 18, fontWeight: '800', color: '#1C1C1E', marginRight: 6 },
  textInput: { flex: 1, color: '#1C1C1E', fontSize: 17 },
  balanceHint: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  balanceHintValue: { fontSize: 15, fontWeight: '700', color: GREEN },
  modalRecipientRow: { marginBottom: 16 },
  recipientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0F9F3',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#CDE8D3',
  },
  recipientName: { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },
  recipientMeta: { fontSize: 13, color: '#6B7280' },
  pinRow: { justifyContent: 'center', gap: 8, marginTop: 16 },
  pinBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  pinText: { fontSize: 22, fontWeight: '800', color: '#1C1C1E' },
  // Success
  successState: { alignItems: 'center', textAlign: 'center', marginTop: 24 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#1C1C1E', marginTop: 16 },
  successSubtle: { fontSize: 15, color: '#6B7280', marginTop: 6 },
});
