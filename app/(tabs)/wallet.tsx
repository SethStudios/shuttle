import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { UniAbujaGreen } from '@/constants/theme';

const GREEN = UniAbujaGreen[700];

export default function WalletScreen() {
  const insets = useSafeAreaInsets();

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
          <MaterialIcons name="account-balance-wallet" size={24} color="rgba(255,255,255,0.9)" />
          <Text style={styles.cardLabel}>Wallet Balance</Text>
          <Text style={styles.cardAmount}>₦0.00</Text>
          <Text style={styles.cardSubtitle}>Available Balance</Text>
        </View>

        {/* Top up and Transfer buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.topUpBtn} onPress={() => {}}>
            <MaterialIcons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.topUpText}>Top up</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.transferBtn} onPress={() => {}}>
            <MaterialIcons name="send" size={20} color="#FFFFFF" />
            <Text style={styles.topUpText}>Transfer</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Transactions */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <View style={styles.emptyList}>
            <MaterialIcons name="receipt" size={32} color="#8E8E93" />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        </View>
      </ScrollView>
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
  },
  cardIcon: {
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1,
    marginBottom: 8,
  },
  cardAmount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  topUpBtn: {
    backgroundColor: GREEN,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flex: 1,
    marginRight: 8,
  },
  transferBtn: {
    backgroundColor: GREEN,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flex: 1,
    marginLeft: 8,
  },
  topUpText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionsRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#E9E9EE', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#6B7280', marginBottom: 12 },
  emptyList: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
});
