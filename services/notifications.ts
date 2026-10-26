/**
 * Notification Service — handles scheduling hourly shuttle
 * notifications, requesting permissions, and storing
 * in-app notification history.
 *
 * Shuttle runs 6:00 AM → 6:00 PM, Monday–Saturday (no Sunday service).
 * Boarding periods: 6-7, 7-8, … 5-6 PM (12 hourly slots).
 * Each notification fires at the start of the hour.
 *
 * ─── expo-notifications ───────────────────────────────────
 * Local scheduled notifications (no push server needed). IMPORTANT:
 * system-tray delivery requires a real build (dev client or
 * production) — Expo Go has no native notification module, so in
 * Expo Go only the in-app Alerts fallback runs (see getNotifications
 * below). Test tray notifications on a dev/production build, never
 * in Expo Go.
 */

import { isRunningInExpoGo } from 'expo';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShuttleType } from '@/constants/pricing';

// ── Constants ────────────────────────────────────────────────────

const CHANNEL_ID = 'shuttle-updates';
const CHANNEL_NAME = 'Shuttle Updates';
const NOTIFICATION_STORAGE_KEY = '@shuttle_notifications';
const REMINDER_STORAGE_KEY = '@shuttle_reminders';

// 12 boarding periods: 6 AM through 5 PM (last slot ends 6 PM)
const BOARDING_HOURS = Array.from({ length: 12 }, (_, i) => i + 6); // [6,7,8,...,17]

// Weekdays 1=Mon ... 6=Sat (0=Sun excluded)
const SERVICE_WEEKDAYS = [1, 2, 3, 4, 5, 6];

// ── Types ────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

// ── Notifications module (lazy — never static-import) ───────
// expo-notifications fires a module-level side effect on import
// (DevicePushTokenAutoRegistration.fx) that errors in Expo Go SDK 53+.
// Gated behind isRunningInExpoGo() to prevent crashes.

let _Notifications: any = null;
let _loaded = false;

function getNotifications(): any {
  if (_loaded) return _Notifications;
  _loaded = true;
  if (isRunningInExpoGo()) {
    // Must not load in Expo Go — native module unavailable.
    _Notifications = null;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _Notifications = require('expo-notifications');
  return _Notifications;
}

// ── Permissions ──────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: CHANNEL_NAME,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2E7D32',
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
        allowAnnouncements: true,
      },
    });
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

// ── Format a boarding period label ───────────────────────────────

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour12}:00 ${period}`;
}

function getPeriodLabel(startHour: number): string {
  return `${formatHour(startHour)} – ${formatHour(startHour + 1)}`;
}

// ── Schedule daily repeating notifications (Mon–Sat only) ────────
// Uses DATE triggers for the next 5 service weekdays (not 72 WEEKLY, not 12 DAILY).
// This guarantees: (1) no Sunday trigger even when app is killed/background
// (OS delivers DATE triggers without JS handler), (2) stays under iOS 64-limit
// (5 days × 12 hrs = 60 triggers). Rescheduled on every app foreground via
// startNotificationListener's AppState polling and via HomeScreen mount.

export async function scheduleShuttleNotifications(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) {
    // Expo Go: native scheduling unavailable — in-app fallback polling
    // (started in startNotificationListener) will generate hourly Alerts within 60s.
    console.log('Expo Go: skipping native shuttle scheduling, using in-app fallback');
    return;
  }

  const granted = await requestNotificationPermissions();
  if (!granted) {
    console.log('Notification permissions not granted — skipping scheduling (in-app fallback will still show Alerts while foregrounded)');
    return;
  }

  // Cancel any existing scheduled shuttle notifications first (handles legacy DAILY/WEEKLY ids too)
  await cancelShuttleNotifications();

  console.log('Scheduling shuttle notifications for hours:', BOARDING_HOURS);

  const now = new Date();
  let daysScheduled = 0;
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setHours(0, 0, 0, 0);

  // Schedule next 5 service weekdays (Mon–Sat), each with 12 DATE triggers
  while (daysScheduled < 5) {
    const weekday = cursor.getDay(); // 0=Sun
    if (weekday !== 0) {
      const dateStr = cursor.toISOString().slice(0, 10);
      for (const hour of BOARDING_HOURS) {
        const triggerDate = new Date(cursor);
        triggerDate.setHours(hour, 0, 0, 0);
        if (triggerDate.getTime() <= now.getTime()) continue; // skip past hours today
        const periodLabel = getPeriodLabel(hour);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🚌 Shuttle Available',
            body: `${periodLabel} bus is now available. Book your shuttle!`,
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.HIGH,
            data: { type: 'shuttle-availability', hour, dateStr },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
            channelId: CHANNEL_ID,
          },
          identifier: `shuttle-${dateStr}-${hour}`,
        });
      }
      daysScheduled++;
    }
    cursor.setDate(cursor.getDate() + 1);
    // Safety: don't loop forever (cap at 14 calendar days)
    if (cursor.getTime() - now.getTime() > 14 * 24 * 60 * 60 * 1000) break;
  }
  const count = (await Notifications.getAllScheduledNotificationsAsync()).filter((n: any) => n.identifier.startsWith('shuttle-')).length;
  console.log(`Shuttle notifications scheduled: ${count} DATE triggers for next ${daysScheduled} service days`);
}

// ── Cancel all shuttle notifications ─────────────────────────────

export async function cancelShuttleNotifications(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    // Handles both new `shuttle-15` and legacy `shuttle-15-3` ids
    if (n.identifier.startsWith('shuttle-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

// ── Personalized 10-minute boarding reminder ─────────────────────
// Call this when a booking is confirmed (payment verified).
// Schedules a local notification for 10 minutes before the boarding period.
// Reminder is scoped to this booking (by ticket_id) so it can be cancelled
// if the ticket is used/cancelled/refunded.

export async function scheduleBoardingReminder(params: {
  ticketId: string;
  boardingPeriod: string; // e.g. "15:00-16:00"
  travelDate: string;     // YYYY-MM-DD
  routeLabel: string;
  shuttleType: ShuttleType;
}): Promise<void> {
  // Strict 24h "HH:MM-HH:MM" only — 12h display strings ("6:00 – 7:00 AM")
  // would mis-schedule PM reminders 12h early.
  const m = params.boardingPeriod.match(/^(\d{2}):00-(\d{2}):00$/);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(params.travelDate);
  if (!m || !dateOk) return;
  const startHour = parseInt(m[1], 10);
  if (startHour < 0 || startHour > 23) return;

  // 10 minutes before boarding start, zeroed seconds for exact firing.
  const [year, month, day] = params.travelDate.split('-').map(Number);
  const triggerDate = new Date(year, month - 1, day, startHour, 0, 0, 0);
  triggerDate.setTime(triggerDate.getTime() - 10 * 60_000);

  // If the reminder time is in the past, don't schedule
  if (triggerDate.getTime() <= Date.now()) return;

  const identifier = `reminder-${params.ticketId}`;

  // Always persist reminder metadata for fallback polling (Expo Go & native cancel)
  try {
    const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
    const reminders: Record<string, any> = raw ? JSON.parse(raw) : {};
    reminders[params.ticketId] = {
      ticketId: params.ticketId,
      identifier,
      boardingPeriod: params.boardingPeriod,
      travelDate: params.travelDate,
      routeLabel: params.routeLabel,
      shuttleType: params.shuttleType,
      triggerAt: triggerDate.getTime(),
    };
    await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(reminders));
  } catch {}

  const Notifications = getNotifications();
  if (!Notifications) {
    console.log('Expo Go: boarding reminder stored for polling fallback', identifier);
    return;
  }

  const granted = await requestNotificationPermissions();
  if (!granted) return;

  // Cancel any existing reminder for this ticket first
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⏰ Boarding Soon',
      body: `Your ${params.shuttleType === 'private' ? 'Private' : params.shuttleType === 'petrol' ? 'Petrol' : 'CNG'} shuttle (${params.routeLabel}) departs in 10 minutes. Head to the terminal now!`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: { type: 'boarding-reminder', ticketId: params.ticketId, dateStr: params.travelDate, hour: startHour },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
      channelId: CHANNEL_ID,
    },
    identifier,
  });
}

// Cancel the 10-minute reminder for a ticket (call when ticket is used/cancelled/refunded)
export async function cancelBoardingReminder(ticketId: string): Promise<void> {
  const Notifications = getNotifications();
  const identifier = `reminder-${ticketId}`;
  if (Notifications) {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
  }

  // Remove from local storage — always, even in Expo Go
  try {
    const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
    const reminders: Record<string, any> = raw ? JSON.parse(raw) : {};
    delete reminders[ticketId];
    await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(reminders));
  } catch {}
}

// ── Fallback generators (for Expo Go & as safety net when native denied) ─

async function maybeGenerateHourlyFallback(): Promise<void> {
  // No service on Sunday, only 6am-6pm slots
  if (new Date().getDay() === 0) return;
  const now = new Date();
  const hour = now.getHours();
  if (!BOARDING_HOURS.includes(hour)) return;
  // Only fire once per hour per day — dedupe by date + hour.
  // Canonical id shape (must match scheduler + listener): shuttle-<date>-<hour>
  const dateStr = now.toISOString().slice(0, 10);
  const id = `shuttle-${dateStr}-${hour}`;
  const existing = await loadNotifications();
  if (existing.some((n) => n.id === id)) return;
  const periodLabel = getPeriodLabel(hour);
  await storeNotification({
    id,
    title: '🚌 Shuttle Available',
    body: `${periodLabel} bus is now available. Book your shuttle!`,
    timestamp: Date.now(),
    read: false,
  });
}

async function maybeCheckBoardingReminders(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) return;
    const reminders: Record<string, any> = JSON.parse(raw);
    const now = Date.now();
    for (const key of Object.keys(reminders)) {
      const r = reminders[key];
      if (!r?.triggerAt) continue;
      // Fire once when triggerAt is reached (10 min before boarding) — 5 min window
      // to handle polling interval, then delete so it doesn't re-fire.
      if (now >= r.triggerAt && now < r.triggerAt + 5 * 60 * 1000) {
        const already = await loadNotifications();
        if (already.some((n) => n.id === `reminder-${r.ticketId}`)) {
          delete reminders[key];
          continue;
        }
        await storeNotification({
          id: `reminder-${r.ticketId}`,
          title: '⏰ Boarding Soon',
          body: `Your ${r.shuttleType === 'private' ? 'Private' : r.shuttleType === 'petrol' ? 'Petrol' : 'CNG'} shuttle (${r.routeLabel}) departs in 10 minutes. Head to the terminal now!`,
          timestamp: Date.now(),
          read: false,
        });
        // Remove so we don't notify twice; keep for native cancel if needed but flag as fired
        delete reminders[key];
      } else if (now > r.triggerAt + 5 * 60 * 1000) {
        // Expired without firing (device was off) — clean up
        delete reminders[key];
      }
    }
    await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(reminders));
  } catch {}
}

// ── Real-time notification listener ──────────────────────────────
// Call this once (e.g., in app/_layout.tsx) to sync native push
// notifications into the in-app AsyncStorage store so they appear
// immediately in the Alerts tab. Also starts fallback polling so
// Expo Go (where native scheduling is unavailable) still gets hourly
// and 10-min in-app alerts.

let _listener: any = null;
let _fallbackInterval: ReturnType<typeof setInterval> | null = null;

export function startNotificationListener(): void {
  if (_listener || _fallbackInterval) return;

  const Notifications = getNotifications();

  if (!Notifications) {
    // Expo Go (SDK 53+): native listener unavailable — use polling fallback only.
    const goTick = () => {
      if (AppState.currentState !== 'active') return;
      maybeGenerateHourlyFallback().catch(() => {});
      maybeCheckBoardingReminders().catch(() => {});
    };
    goTick();
    _fallbackInterval = setInterval(goTick, 60 * 1000);
    return;
  }

  // SDK 57: native notification APIs available.
  _listener = Notifications.addNotificationReceivedListener(async (notification: any) => {
    const content = notification.request.content;
    const data = content.data as any;
    // Use deterministic id so fallback dedupe works (date + hour, canonical)
    const dateStr = data?.dateStr || new Date().toISOString().slice(0, 10);
    const hour = data?.hour ?? new Date().getHours();
    const id = data?.type === 'boarding-reminder' && data?.ticketId ? `reminder-${data.ticketId}` : `shuttle-${dateStr}-${hour}`;
    // Avoid duplicating if fallback already stored this hour
    const existing = await loadNotifications();
    if (existing.some((n) => n.id === id)) return;
    await storeNotification({
      id,
      title: content.title || '',
      body: content.body || '',
      timestamp: Date.now(),
      read: false,
    });
  });

  // Also handle notifications that were tapped when app was closed
  Notifications.getLastNotificationResponseAsync()
    .then((response: any) => {
      if (response) {
        const content = response.notification.request.content;
        const data = content.data as any;
        const dateStr = data?.dateStr || new Date().toISOString().slice(0, 10);
        const hour = data?.hour ?? new Date().getHours();
        const id = data?.type === 'boarding-reminder' && data?.ticketId ? `reminder-${data.ticketId}` : `shuttle-${dateStr}-${hour}`;
        loadNotifications().then((existing) => {
          if (existing.some((n) => n.id === id)) return;
          storeNotification({
            id,
            title: content.title || '',
            body: content.body || '',
            timestamp: Date.now(),
            read: false,
          }).catch(() => {});
        }).catch(() => {});
      }
    })
    .catch(() => {});

  // Polling fallback as safety net even in native builds (e.g., permission denied)
  // Ensures Alerts tab still gets hourly + boarding items without native delivery.
  // Also reschedules DATE triggers when <12 remain (rolling 5-day window).
  // Paused while the app is backgrounded to save battery and server quota.
  const tick = async () => {
    if (AppState.currentState !== 'active') return;
    maybeGenerateHourlyFallback().catch(() => {});
    maybeCheckBoardingReminders().catch(() => {});
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const shuttleCount = scheduled.filter((n: any) => n.identifier.startsWith('shuttle-')).length;
      if (shuttleCount < 12) {
        scheduleShuttleNotifications().catch(() => {});
      }
    } catch {}
  };
  _fallbackInterval = setInterval(tick, 60 * 1000);
}

export function stopNotificationListener(): void {
  if (_listener) {
    _listener.remove();
    _listener = null;
  }
  if (_fallbackInterval) {
    clearInterval(_fallbackInterval);
    _fallbackInterval = null;
  }
}

// ── In-app notification storage ──────────────────────────────────

async function storeNotification(notification: AppNotification): Promise<void> {
  try {
    const existing = await loadNotifications();
    // Avoid duplicates by id
    const filtered = existing.filter((n) => n.id !== notification.id);
    filtered.unshift(notification);
    // Keep last 50
    await AsyncStorage.setItem(
      NOTIFICATION_STORAGE_KEY,
      JSON.stringify(filtered.slice(0, 50))
    );
  } catch {
    // Non-fatal
  }
}

export async function loadNotifications(): Promise<AppNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    const all = await loadNotifications();
    const updated = all.map((n) => (n.id === id ? { ...n, read: true } : n));
    await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Non-fatal
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    const all = await loadNotifications();
    const updated = all.map((n) => ({ ...n, read: true }));
    await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Non-fatal
  }
}

export async function getUnreadCount(): Promise<number> {
  const all = await loadNotifications();
  return all.filter((n) => !n.read).length;
}


