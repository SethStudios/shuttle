import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert, Platform,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen, AppleShadows } from '@/constants/theme';
import { AppleButton } from '@/components/ui/Apple';

const GREEN = UniAbujaGreen[700];

const TOP_UP_AMOUNTS = [1000, 2000, 5000, 10000];

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);

  // Transfer flow state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferStep, setTransferStep] = useState<'matric' | 'amount' | 'confirm' | 'pin' | 'success'>('matric');
  const [recipientMatric, setRecipientMatric] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [transferPin, setTransferPin] = useState('');

  // Top up state
  const [selectedTopUpAmount, setSelectedTopUpAmount] = useState<number | null>(null);
  const [topUpReference, setTopUpReference] = useState('');

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

  // ── Top up ──
  const handleTopUp = async () => {
    if (!selectedTopUpAmount) return;
    setTopUpLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wallet-top-up', {
        body: { amount: selectedTopUpAmount },
      });
      if (error) throw new Error(error.message || 'Top up failed');
      if (!data?.success) throw new Error(data?.error || 'Top up initialization failed');
      setTopUpReference(data.data.reference);
      router.push({
        pathname: '/payment',
        params: {
          walletTopUp: 'true',
          amount: String(selectedTopUpAmount),
          reference: data.data.reference,
          authorizationUrl: data.data.authorization_url,
        } as any,
      });
    } catch (err: any) {
      Alert.alert('Top up failed', err?.message || 'Could not start top up. Try again.');
    } finally {
      setTopUpLoading(false);
    }
  };

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
        Alert.alert('Recipient not found', 'No user found with this matric number.');
        return;
      }
      setRecipientName(profile.full_name);
      setTransferStep('amount');
    } catch (err: any) {
      Alert.alert('Lookup failed', err?.message || 'Could not find recipient.');
    } finally {
      setTransferLoading(false);
    }
  };

  const confirmTransfer = async () => {
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid transfer amount.');
      return;
    }
    if (amt > balance) {
      Alert.alert('Insufficient balance', `You only have ₦${balance.toFixed(2)} in your wallet.`);
      return;
    }
    setTransferStep('pin');
  };

  const executeTransfer = async () => {
    if (!transferPin || transferPin.length !== 4) {
      Alert.alert('PIN required', 'Please enter your 4-digit wallet PIN.');
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
        Alert.alert('Transfer failed', (data as any)?.reason || 'Transfer could not be completed.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setBalance((data as any).from_balance);
      setTransferStep('success');
    } catch (err: any) {
      Alert.alert('Transfer failed', err?.message || 'Transfer could not be completed.');
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

        {/* ATM-style bank card */}
        <View style={styles.atmCard}>
          <Image source={require('@/assets/images/icon.png')} style={styles.cardImage} />
          <MaterialIcons name="account-balance-wallet" size={24} color="rgba(255,255,255,0.9)" />
          <Text style={styles.cardLabel}>Wallet Balance</Text>
          <Text style={styles.cardAmount}>₦{balance.toFixed(2)}</Text>
          <Text style={styles.cardSubtitle}>Available Balance</Text>
        </View>

        {/* Top up amounts */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Add Funds</Text>
          <View style={styles.amountRow}>
            {TOP_UP_AMOUNTS.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[styles.amountBtn, selectedTopUpAmount === amt && styles.amountBtnSelected]}
                onPress={() => setSelectedTopUpAmount(selectedTopUpAmount === amt ? null : amt)}
              >
                <Text style={[styles.amountText, selectedTopUpAmount === amt && styles.amountTextSelected]}>
                  ₦{amt.toLocaleString()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <AppleButton
            title="Top up wallet"
            loading={topUpLoading}
            disabled={!selectedTopUpAmount}
            onPress={handleTopUp}
            variant="primary"
            style={{ marginTop: 16 }}
          />
        </View>

        {/* Transfer */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Send Money</Text>
          <AppleButton
            title="Transfer to another user"
            loading={transferLoading}
            onPress={() => {
              if (!user) return;
              setShowTransfer(true);
            }}
            variant="plain"
            style={{ marginTop: 8 }}
          />
        </View>

        {/* Recent Transactions */}
        <View style={styles.sectionRow}>
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
                  <TextInput
                    style={styles.textInput}
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
                  <TextInput
                    style={styles.textInput}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 20 },
  nav: { marginBottom: 20 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8, textAlign: 'center' },
  atmCard: {
    backgroundColor: GREEN,
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    ...AppleShadows.greenGlow,
  },
  cardImage: {
    position: 'absolute',
    right: -40,
    bottom: -40,
    width: 140,
    height: 140,
    opacity: 0.12,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1,
    marginBottom: 8,
  },
  cardAmount: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  sectionRow: {
    flexDirection: 'column',
    gap: 10,
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#6B7280', marginBottom: 8 },
  amountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amountBtn: {
    flex: 1,
    minWidth: 70,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  amountBtnSelected: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  amountText: { fontSize: 14, fontWeight: '700', color: '#1C1C1E' },
  amountTextSelected: { color: '#FFFFFF' },
  emptyList: { alignItems: 'center', paddingVertical: 30, gap: 8 },
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
