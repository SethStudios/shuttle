/**
 * Shared scan validation logic — pure TypeScript, no React Native imports.
 * Used by both native (app/scan.tsx) and web (app/scan.web.tsx).
 */

import { supabase } from '@/utils/supabase';
import { parseTicketId, isWithinTicketLife, formatPeriod12, getShuttleShortLabel, formatPrice } from '@/utils/tickets';
import { cancelBoardingReminder } from '@/services/notifications';

export type ScanStatus = 'valid' | 'used' | 'boarded' | 'invalid';

export interface ScanReport {
  status: ScanStatus;
  title: string;
  message: string;
  name?: string;
  meta?: string;
  route?: string;
  boarding?: string;
  queue?: string;
  paid?: string;
  bookingId?: string;
  ticketId?: string;
  /** Set when the ticket was valid but could not be consumed — Retry re-verifies this code. */
  retryCode?: string;
}

export interface ScanEntry {
  code: string;
  time: string;
  result: 'ADMIT' | 'DENY' | 'USED';
}

const SCAN_HISTORY_KEY = '@scan_history_web';

/** Re-export parseTicketId for convenience. */
export { parseTicketId } from '@/utils/tickets';

/** Build a time string for scan history. */
function formatTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Load scan history from localStorage (web equivalent of AsyncStorage). */
export function loadScanHistory(): ScanEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SCAN_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save scan history to localStorage. */
export function saveScanHistory(history: ScanEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  } catch {}
}

/** Push a new scan entry to history. */
export function pushScanHistory(code: string, result: ScanEntry['result']): void {
  const history = loadScanHistory();
  const entry: ScanEntry = { code, time: formatTime(), result };
  const next = [entry, ...history].slice(0, 50);
  saveScanHistory(next);
}

/** Build the validation report from a booking row. */
export function buildScanReport(b: any): ScanReport {
  const prof = b.profiles || {};
  const name = prof.full_name || 'Rider';
  const matric = prof.matric_number ? ` • ${prof.matric_number}` : '';
  const route = b.route || (b.route_direction === 'mini-to-main' ? 'Mini Campus → Main Campus' : 'Main Campus → Mini Campus');
  const queue = b.queue_number ? `#${String(b.queue_number).padStart(2, '0')}` : '—';
  const base = {
    name: `${name}${matric}`,
    route,
    boarding: b.boarding_period ? formatPeriod12(b.boarding_period) : '—',
    queue,
    paid: b.total_amount > 0 ? formatPrice(b.total_amount) : undefined,
    bookingId: b.id,
    ticketId: b.ticket_id,
  };

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const today = todayStr();
  const day = (b.travel_date || '').slice(0, 10);

  if (b.payment_status === 'cancelled' || b.ticket_status === 'cancelled') {
    return { status: 'invalid', title: 'Ticket cancelled', message: 'This booking was cancelled. Do not allow boarding.', ...base };
  }
  if (b.payment_status !== 'paid') {
    return { status: 'invalid', title: 'Not paid', message: 'Payment was never confirmed for this ticket. Do not allow boarding.', ...base };
  }
  if (b.ticket_status === 'used') {
    return { status: 'used', title: 'Already used', message: 'This ticket was already scanned for boarding. Do not admit twice.', ...base };
  }
  if (b.created_at && !isWithinTicketLife(b.created_at)) {
    return { status: 'invalid', title: 'Ticket expired', message: 'This pass is older than 24 hours. Do not allow boarding.', ...base };
  }
  if (day && day < today) {
    return { status: 'invalid', title: 'Ticket expired', message: `This pass was for ${day}, not today. Do not allow boarding.`, ...base };
  }
  if (day && day > today) {
    return { status: 'invalid', title: 'Not valid today', message: `This pass is for ${day}, not today. Do not allow boarding.`, ...base };
  }

  return {
    status: 'valid',
    title: 'Valid ticket — admit',
    message: 'Payment confirmed. Allow this rider to board.',
    meta: `${getShuttleShortLabel(b.shuttle_type)} shuttle`,
    ...base,
  };
}

/** Consume a valid ticket via the mark_ticket_used RPC. */
export async function consumeTicket(ticketId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc('mark_ticket_used', {
      p_ticket_id: ticketId,
    });

    if (error) {
      return { ok: false, reason: error.message };
    }
    if (!data?.ok) {
      return { ok: false, reason: data?.reason || 'unknown' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

/** Verify a ticket code — returns the report and handles consumption if valid. */
export async function verifyTicketCode(rawCode: string): Promise<ScanReport> {
  const code = parseTicketId(rawCode);
  if (!code) {
    return {
      status: 'invalid',
      title: 'Empty code',
      message: 'No QR data detected. Please try again.',
    };
  }

  // Fetch booking from database
  let data: any = null;
  let fetchError: any = null;
  try {
    const res = await supabase
      .from('bookings')
      .select('*, profiles(full_name, role, matric_number)')
      .eq('ticket_id', code)
      .maybeSingle();
    data = res.data;
    fetchError = res.error;
  } catch (e) {
    fetchError = e;
  }

  if (fetchError) {
    const msg = typeof fetchError.message === 'string' ? fetchError.message : '';
    const isNetwork = /fetch|network|Failed to fetch|Load failed/i.test(msg);
    return {
      status: 'invalid',
      title: isNetwork ? 'No connection' : 'Scan failed',
      message: isNetwork
        ? 'Could not reach the server. Check your internet and try again. Do not allow boarding until the ticket is verified online.'
        : 'Could not verify this ticket. Please try again.',
    };
  }

  if (!data) {
    return {
      status: 'invalid',
      title: 'Ticket not recognised',
      message: 'No booking matches this code in the database. Do not allow boarding.',
    };
  }

  const report = buildScanReport(data);

  // Auto-consume valid tickets
  if (report.status === 'valid' && report.ticketId) {
    const consumeResult = await consumeTicket(report.ticketId);
    if (!consumeResult.ok) {
      if (consumeResult.reason === 'not_staff') {
        return {
          status: 'invalid',
          title: 'Not a staff account',
          message: 'This account is not registered as shuttle staff. Sign in with a staff account to scan.',
          ...report,
        };
      }
      // Already used by another scan
      return {
        status: 'used',
        title: 'Already used',
        message: 'This ticket was just scanned for boarding by another device. Do not admit twice.',
        name: report.name,
        route: report.route,
        boarding: report.boarding,
        queue: report.queue,
        paid: report.paid,
        bookingId: report.bookingId,
      };
    }

    // Cancel the 10-minute boarding reminder
    cancelBoardingReminder(report.ticketId).catch(() => {});

    return { ...report, status: 'boarded', title: 'Admitted — pass consumed', message: 'Ticket marked as used. This QR can no longer be used. Next rider please.' };
  }

  return report;
}