import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Public-by-design keys only. Inlined at build time from .env locally
// (see .env.example) or EAS environment variables in cloud builds.
// Never put secret/service_role keys in EXPO_PUBLIC_ vars — they ship
// in plain text inside the compiled app.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file."
  );
}

// Native (iOS/Android) always persists via AsyncStorage.
// Web SSR (Node, no window) skips storage to avoid "window is not defined".
const isServer = typeof window === "undefined" && Platform.OS === "web";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: !isServer,
    detectSessionInUrl: false,
    storage: isServer ? undefined : AsyncStorage,
  },
});
