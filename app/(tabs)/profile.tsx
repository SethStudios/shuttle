import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/contexts/AuthContext';
import { UniAbujaGreen } from '@/constants/theme';
import Constants from 'expo-constants';

const GREEN = UniAbujaGreen[700];

// Hoisted: a component declared inside render resets its state on every
// render and trips the compiler. Rows also get screen-reader semantics.
function Item({ icon, label, sub, danger, go }: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  sub?: string;
  danger?: boolean;
  go?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.item}
      activeOpacity={0.7}
      onPress={go}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={sub}
    >
      <View style={[styles.itemIcon, danger && styles.dangerBg]}>
        <MaterialIcons name={icon} size={20} color={danger ? '#FF3B30' : GREEN} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemT, danger && styles.dangerT]}>{label}</Text>
        {sub ? <Text style={styles.itemS}>{sub}</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={20} color={danger ? '#FF3B30' : '#C7C7CC'} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, deleteAccount } = useAuth();

  const roleLabel = user?.user_metadata?.role || 'student';
  const name = user?.user_metadata?.full_name || (roleLabel === 'staff' ? 'Staff' : 'Student');
  const email = user?.email || '';
  const role = user?.user_metadata?.role || 'student';
  const matric = user?.user_metadata?.matric_number || '';
  const phone = user?.user_metadata?.phone_number || '';
  const initials = (() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase() || 'U';
    return (name.trim().slice(0, 2) || 'U').toUpperCase();
  })();

  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const out = () => {
    if (signingOut) return;
    Alert.alert('Sign out?', 'You will need to sign in again to book shuttles.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/auth');
          } catch {
            Alert.alert('Sign out failed', 'Check your connection and try again.');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const removeAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account, bookings, and profile from the server, then signs you out.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user || deleting) return;
            setDeleting(true);
            try {
              const result = await deleteAccount();
              if (result.ok) {
                router.replace('/auth');
              } else if (result.error) {
                Alert.alert('Delete failed', result.error);
              }
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: 28 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.avatarT}>{initials}</Text></View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email} numberOfLines={1}>{email}</Text>
          <View style={styles.badges}>
            <View style={styles.badge}>
              <MaterialIcons name={role === 'staff' ? 'work' : 'school'} size={14} color={GREEN} />
              <Text style={styles.badgeT}>{role === 'staff' ? 'Staff' : 'Student'}</Text>
            </View>
            {role === 'student' && matric ? (
              <View style={[styles.badge, styles.badgeGrey]}>
                <Text style={styles.badgeGreyT}>{matric}</Text>
              </View>
            ) : null}
          </View>
          {phone ? <Text style={styles.phone}>{phone}</Text> : null}
        </View>

        <Text style={styles.sec}>Account</Text>
        <View style={styles.group}>
          <Item icon="card-membership" label="Subscription" sub="₦1,000 monthly pass required to book" go={() => router.push('/subscription' as any)} />
          <View style={styles.sep} />
          <Item icon="person-outline" label="Edit profile" sub="Update your name and phone number" go={() => router.push('/edit-profile')} />
          <View style={styles.sep} />
          <Item icon="lock-outline" label="Change password" sub="Update your sign-in password" go={() => router.push('/change-password')} />
          <View style={styles.sep} />
          <Item icon="privacy-tip" label="Privacy Policy" sub="How your data is used" go={() => router.push('/privacy')} />
          <View style={styles.sep} />
          <Item icon="description" label="Terms of Service" sub="Fares, tickets and boarding rules" go={() => router.push('/terms')} />
        </View>

        <View style={[styles.group, { marginTop: 20 }]}>
          <Item icon="logout" label={signingOut ? 'Signing out…' : 'Sign out'} go={out} />
          <View style={styles.sep} />
          <TouchableOpacity style={styles.item} activeOpacity={0.7} onPress={removeAccount} disabled={deleting}>
            <View style={[styles.itemIcon, styles.dangerBg]}>
              {deleting ? (
                <ActivityIndicator size="small" color="#FF3B30" />
              ) : (
                <MaterialIcons name="delete-outline" size={20} color="#FF3B30" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemT, styles.dangerT]}>{deleting ? 'Deleting…' : 'Delete account'}</Text>
              <Text style={styles.itemS}>Remove your bookings and profile</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#FF3B30" />
          </TouchableOpacity>
        </View>

        <Text style={styles.ver}>UniAbuja Shuttle • v{Constants.expoConfig?.version ?? '1.0.0'}{'\n'}Green & white • Made for campus</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  body: { paddingHorizontal: 18 },
  title: { fontSize: 32, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.8, marginBottom: 16, textAlign: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#E9E9EE', marginBottom: 6 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarT: { fontSize: 27, fontWeight: '800', color: '#FFFFFF' },
  name: { fontSize: 21, fontWeight: '800', color: '#1C1C1E', letterSpacing: -0.4 },
  email: { fontSize: 14, color: '#6B7280', marginTop: 3, maxWidth: '100%' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF6ED', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#CDE8D3' },
  badgeT: { fontSize: 13, fontWeight: '700', color: GREEN },
  badgeGrey: { backgroundColor: '#F2F2F7', borderColor: '#E5E5EA' },
  badgeGreyT: { fontSize: 13, fontWeight: '700', color: '#3C3C43' },
  phone: { fontSize: 13.5, color: '#8E8E93', marginTop: 8 },
  sec: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  group: { backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#E9E9EE' },
  item: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 13 },
  itemIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F0F9F3', alignItems: 'center', justifyContent: 'center' },
  dangerBg: { backgroundColor: '#FFE9E8' },
  itemT: { fontSize: 16, fontWeight: '600', color: '#1C1C1E' },
  dangerT: { color: '#FF3B30' },
  itemS: { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  sep: { height: 1, backgroundColor: '#F0F0F4', marginLeft: 66 },
  ver: { fontSize: 12.5, color: '#8E8E93', textAlign: 'center', marginTop: 22, lineHeight: 18 },
});
