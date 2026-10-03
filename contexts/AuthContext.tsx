import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  deleteAccount: async () => ({ ok: false, error: 'Not ready' }),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    // Validate session server-side so stale/invalid tokens never linger.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session) {
          const { error } = await supabase.auth.getUser();
          if (error) {
            await supabase.auth.signOut().catch(() => {});
            if (mounted) setSession(null);
          } else if (mounted) {
            setSession(session);
          }
        }
      } catch {
        // keep null session on failure
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Listen for auth changes. A recovery session is NOT an app session:
    // force the reset screen so it can never wander into the tabs.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        if (event === 'SIGNED_OUT') {
          setSession(null);
        } else if (event === 'PASSWORD_RECOVERY') {
          setSession(session);
          router.replace('/reset-password');
        } else {
          setSession(session);
        }
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Everything tied to the signed-in user — including the notification
  // inbox and reminders — is wiped so the next account on a shared phone
  // never sees the previous one. Kept: onboarding flag, matric map.
  const wipeUserCaches = async () => {
    // (Direct removeItem — not via useBookings — to avoid a module cycle.)
    try { await AsyncStorage.removeItem('@dev_bookings'); } catch {}
    try { await AsyncStorage.removeItem('@scan_history'); } catch {}
    try { await AsyncStorage.removeItem('@shuttle_notifications'); } catch {}
    try { await AsyncStorage.removeItem('@shuttle_reminders'); } catch {}
    try { await AsyncStorage.removeItem('@queue_counters'); } catch {}
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    await wipeUserCaches();
  };

  const deleteAccount = async (): Promise<{ ok: boolean; error?: string }> => {
    // Try the server-side delete first — this removes the auth.users
    // row so the account disappears from Supabase Dashboard → Authentication.
    // If the SQL function hasn't been deployed yet, we fall back to
    // manual deletes and return the error so the UI can tell the user.
    try {
      const { error } = await supabase.rpc('delete_own_account');
      if (!error) {
        // Server wiped bookings + profile + auth user — now clear local.
        await supabase.auth.signOut().catch(() => {});
        setSession(null);
        await wipeUserCaches();
        return { ok: true };
      }
      // Function not deployed or RLS — do NOT sign out or wipe local.
      // Keep the account intact so the user can retry after deploy.
      return { ok: false, error: error.message || 'Could not delete account on server.' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Delete failed.' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
