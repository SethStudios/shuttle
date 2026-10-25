import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);

// Connection is baked in via admin/config.js (gitignored, machine-local).
// The anon key is public-by-design (it ships inside the student app) —
// the real lock is the staff email + password checked at login.
const CONFIG = (typeof window !== 'undefined' && window.__ADMIN_CONFIG) || {};

let sb = null;
let profile = null;
let manifestRows = [];
let bookingsRows = [];

const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const busLabel = (t) => (t === 'private' ? 'Petrol Bus' : 'CNG Bus');
const pill = (t) => `<span class="pill ${t}">${t}</span>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toCSV(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
}
function downloadCSV(name, rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function parseTicketId(raw) {
  const t = String(raw || '').trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t);
      if (typeof o.ticketId === 'string' && o.ticketId.trim()) return o.ticketId.trim();
      if (typeof o.ticket_id === 'string' && o.ticket_id.trim()) return o.ticket_id.trim();
    } catch { /* fall through */ }
  }
  return t;
}

// ─── Tabs ───
const TITLES = {
  overview: ['Overview', 'Revenue, buses and boarding windows for the operating date.'],
  manifest: ["Today's manifest", 'Per-window boarding lists with queue order. Queues restart every hour, per bus.'],
  validate: ['Validate ticket', 'Checkpoint: check + consume one-time passes.'],
  bookings: ['Bookings', 'All booking rows (staff read via is_staff()). Read-only.'],
  users: ['Users', 'Profiles (staff can view all). Search name / matric / email.'],
  subscriptions: ['Subscriptions', '₦1,000 / 30-day passes. Needs a staff read policy (see Settings).'],
  routes: ['Routes & fares', 'Active routes + server fare truth.'],
  payments: ['Payments', 'Pending / failed rows needing Paystack reconciliation.'],
  settings: ['Settings', 'Connection + RLS checklist.'],
};
document.querySelectorAll('#sidebar nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#sidebar nav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const tab = b.dataset.tab;
    document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
    $('view-' + tab).hidden = false;
    $('view-title').textContent = TITLES[tab][0];
    $('view-sub').textContent = TITLES[tab][1];
    loadTab(tab);
  };
});
const activeTab = () => document.querySelector('#sidebar nav button.active')?.dataset.tab || 'overview';
$('btn-refresh').onclick = () => loadTab(activeTab());

// ─── Auth ───
async function login() {
  const url = (CONFIG.url || '').trim();
  const key = (CONFIG.key || '').trim();
  const err = $('login-error');
  err.hidden = true;
  if (!url || !key || url.includes('your-project')) {
    err.textContent = 'Dashboard is not configured yet: copy admin/config.example.js to admin/config.js and fill in your project values.';
    err.hidden = false;
    return;
  }
  $('btn-login').disabled = true;
  try {
    sb = createClient(url, key);
    const { error } = await sb.auth.signInWithPassword({
      email: $('login-email').value.trim().toLowerCase(),
      password: $('login-pass').value,
    });
    if (error) throw error;
    const { data: { user } } = await sb.auth.getUser();
    const { data: prof, error: pErr } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if (pErr) throw new Error('Signed in, but profile lookup failed: ' + pErr.message);
    if (prof.role !== 'staff') {
      await sb.auth.signOut();
      throw new Error('This account is "' + prof.role + '" — only staff can use the dashboard.');
    }
    profile = prof;
    enter();
  } catch (e) {
    err.textContent = e.message || 'Sign-in failed.';
    err.hidden = false;
  } finally {
    $('btn-login').disabled = false;
  }
}
function enter() {
  $('login-card').hidden = true;
  $('views').hidden = false;
  $('btn-logout').hidden = false;
  $('auth-state').textContent = 'Staff: ' + (profile.full_name || profile.email || 'staff');
  const chip = $('staff-chip');
  chip.hidden = false;
  chip.textContent = 'Staff · ' + (profile.full_name || profile.email || '');
  const t = todayStr();
  if (!$('global-date').value) $('global-date').value = t;
  $('manifest-date').textContent = $('global-date').value;
  try {
    $('conn-status').textContent = 'Connected as ' + (profile.email || profile.id) + ' · project ' + new URL(CONFIG.url).hostname;
  } catch { $('conn-status').textContent = 'Connected as ' + (profile.email || profile.id); }
  loadTab(activeTab());
}
async function logout() {
  try { await sb?.auth.signOut(); } catch { /* ignore */ }
  profile = null;
  $('views').hidden = true;
  $('login-card').hidden = false;
  $('btn-logout').hidden = true;
  $('auth-state').textContent = 'Not signed in';
}
$('btn-login').onclick = login;
$('btn-logout').onclick = logout;

// ─── Loaders ───
async function loadTab(tab) {
  if (!sb || !profile) return;
  if (tab === 'overview') return loadOverview();
  if (tab === 'manifest') return loadManifest();
  if (tab === 'bookings') return loadBookings();
  if (tab === 'users') return loadUsers();
  if (tab === 'subscriptions') return loadSubs();
  if (tab === 'routes') return loadRoutes();
  if (tab === 'payments') return loadPayments();
}
function stampFresh() {
  $('data-fresh').textContent = 'Updated ' + new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function setBadge(id, n) {
  const el = $(id);
  if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = false; }
  else el.hidden = true;
}
const opDate = () => $('global-date').value || todayStr();
$('global-date').onchange = () => { $('manifest-date').textContent = opDate(); loadTab(activeTab()); };

async function loadOverview() {
  const date = opDate();
  const { data, error } = await sb.from('bookings').select('id,total_amount,shuttle_type,payment_status,ticket_status,boarding_period,route,queue_number,ticket_id,created_at,profiles(full_name)').eq('travel_date', date).order('created_at', { ascending: false }).limit(2000);
  if (error) { $('kpis').innerHTML = `<p class="error">Bookings read failed: ${esc(error.message)}</p>`; return; }
  const paid = data.filter((b) => b.payment_status === 'paid');
  const rev = paid.reduce((s, b) => s + Number(b.total_amount || 0), 0);
  const cng = paid.filter((b) => b.shuttle_type !== 'private');
  const pet = paid.filter((b) => b.shuttle_type === 'private');
  const unused = paid.filter((b) => b.ticket_status === 'unused').length;
  const used = paid.filter((b) => b.ticket_status === 'used').length;
  const pending = data.filter((b) => b.payment_status === 'pending');
  const failed = data.filter((b) => b.payment_status === 'failed');
  const cngRev = cng.reduce((s, b) => s + Number(b.total_amount || 0), 0);
  const petRev = pet.reduce((s, b) => s + Number(b.total_amount || 0), 0);
  const boardPct = paid.length ? Math.round((used / paid.length) * 100) : 0;

  $('day-summary').innerHTML = `<strong>${esc(date)}</strong> — <strong>${paid.length}</strong> paid passes (<strong>${naira(rev)}</strong>) · ` +
    `<strong>${unused}</strong> waiting to board · <strong>${used}</strong> boarded (${boardPct}%) · ` +
    `<strong>${pending.length}</strong> unpaid · <strong>${failed.length}</strong> failed`;

  const kpi = (k, v, s, cls) => `<div class="kpi${cls ? ' ' + cls : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('kpis').innerHTML =
    kpi('Revenue', naira(rev), `${naira(cngRev)} CNG · ${naira(petRev)} Petrol`) +
    kpi('Paid passes', paid.length, `${cng.length} CNG · ${pet.length} Petrol`) +
    kpi('Waiting to board', unused, 'paid + unused', unused > 0 ? '' : '') +
    kpi('Boarded', used, boardPct + '% of sold') +
    kpi('Unpaid', pending.length, 'pending checkout', pending.length ? 'alert' : '') +
    kpi('Failed', failed.length, 'need follow-up', failed.length ? 'bad' : '');

  $('rev-split').innerHTML =
    barRow('CNG Bus · ₦500', cng.length, Math.max(1, paid.length), '') +
    `<div class="muted small" style="margin:-2px 0 8px 139px">${naira(cngRev)} collected</div>` +
    barRow('Petrol Bus · ₦700', pet.length, Math.max(1, paid.length), 'petrol') +
    `<div class="muted small" style="margin:-2px 0 0 139px">${naira(petRev)} collected</div>`;

  // Per-window boarding progress
  const wins = {};
  paid.forEach((b) => {
    const p = b.boarding_period || '—';
    wins[p] = wins[p] || { total: 0, used: 0, cng: 0, pet: 0 };
    wins[p].total++;
    if (b.ticket_status === 'used') wins[p].used++;
    if (b.shuttle_type === 'private') wins[p].pet++; else wins[p].cng++;
  });
  $('period-bars').innerHTML = Object.keys(wins).sort().map((p) => {
    const w = wins[p];
    const pct = Math.round((w.used / w.total) * 100);
    return `<div class="win-row"><span><strong>${esc(p)}</strong></span>` +
      `<div class="track" style="flex:1;background:#e8ede8;border-radius:6px;height:9px;overflow:hidden"><div class="fill" style="width:${pct}%;background:var(--green-600);height:100%"></div></div>` +
      `<span class="meta">${w.used}/${w.total} boarded · ${w.cng} CNG · ${w.pet} Pet</span></div>`;
  }).join('') || '<p class="muted">No paid passes for this date yet.</p>';

  $('recent-list').innerHTML = data.slice(0, 8).map((b) =>
    `<div class="feed-item"><span><strong>${esc(b.profiles?.full_name || 'Rider')}</strong> · ${esc(busLabel(b.shuttle_type))} · ${esc(b.route)} · ${esc(b.boarding_period || '')}${b.queue_number ? ' · Q#' + String(b.queue_number).padStart(2, '0') : ''}</span><span>${pill(b.payment_status)} ${pill(b.ticket_status)}</span></div>`
  ).join('') || '<p class="muted">Nothing booked for this date yet.</p>';

  const att = [];
  if (pending.length) att.push(`<p><strong>${pending.length} unpaid checkout${pending.length === 1 ? '' : 's'}</strong> <span class="muted">— riders started payment but never completed. See Payments tab for references.</span></p>`);
  if (failed.length) att.push(`<p><strong>${failed.length} failed payment${failed.length === 1 ? '' : 's'}</strong> <span class="muted">— provider declined or checkout broke. Confirm in Paystack before asking anyone to repay.</span></p>`);
  if (!pending.length && !failed.length) att.push('<p>Clear. Every booking for this date is paid.</p>');
  const nowH = new Date().getHours();
  if ((date === todayStr()) && nowH >= 6 && nowH < 18) att.push(`<p class="muted small">Sales window open (6:00 AM – 6:00 PM). Next departure board: Manifest tab.</p>`);
  else if (date === todayStr()) att.push('<p class="muted small">Sales window closed (opens 6:00 AM). Passes already sold stay valid until used or expired.</p>');
  $('attention').innerHTML = att.join('');

  setBadge('badge-manifest', unused);
  setBadge('badge-payments', pending.length + failed.length);
  stampFresh();
}
function barRow(label, val, max, cls) {
  return `<div class="bar"><span style="width:130px">${esc(label)}</span><div class="track"><div class="fill${cls ? ' ' + cls : ''}" style="width:${max ? Math.round((val / max) * 100) : 0}%"></div></div><strong>${val}</strong></div>`;
}

async function loadManifest() {
  const date = opDate();
  $('manifest-date').textContent = date;
  const route = $('manifest-route').value, type = $('manifest-type').value, status = $('manifest-status').value;
  let q = sb.from('bookings').select('*,profiles(full_name,matric_number,phone_number)').eq('travel_date', date).eq('payment_status', 'paid').order('boarding_period').order('queue_number').limit(2000);
  if (route) q = q.eq('route', route);
  if (type) q = q.eq('shuttle_type', type);
  if (status === 'paid-unused') q = q.eq('ticket_status', 'unused');
  if (status === 'used') q = q.eq('ticket_status', 'used');
  const { data, error } = await q;
  if (error) { $('manifest-groups').innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  manifestRows = data;
  const groups = {};
  data.forEach((b) => { const k = `${b.boarding_period || '—'} · ${b.route} · ${busLabel(b.shuttle_type)}`; (groups[k] = groups[k] || []).push(b); });
  $('manifest-groups').innerHTML = Object.keys(groups).sort().map((k) => {
    const rows = groups[k];
    const boarded = rows.filter((b) => b.ticket_status === 'used').length;
    const pct = Math.round((boarded / rows.length) * 100);
    const body = rows.map((b) => `<tr><td class="num"><strong>Q#${String(b.queue_number || 0).padStart(2, '0')}</strong></td><td class="num">${esc(b.ticket_id || '—')}</td><td>${esc(b.profiles?.full_name || '—')}</td><td>${esc(b.profiles?.matric_number || '')}</td><td class="num">${esc(b.profiles?.phone_number || '')}</td><td>${pill(b.ticket_status)}</td></tr>`).join('');
    return `<h3 class="group-title">${esc(k)} — ${rows.length} passes</h3>` +
      `<div class="progress-line"><div style="width:${pct}%"></div></div>` +
      `<p class="muted small">${boarded}/${rows.length} boarded (${pct}%)</p>` +
      `<div class="table-wrap"><table><thead><tr><th>Queue</th><th>Ticket</th><th>Rider</th><th>Matric</th><th>Phone</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }).join('') || '<p class="muted">No rows match. Paid passes for this date will appear here.</p>';
  setBadge('badge-manifest', data.filter((b) => b.ticket_status === 'unused').length);
  stampFresh();
}
$('manifest-route').onchange = loadManifest; $('manifest-type').onchange = loadManifest; $('manifest-status').onchange = loadManifest;
$('btn-manifest-csv').onclick = () => downloadCSV(`manifest-${opDate()}.csv`, manifestRows.map((b) => ({
  boarding_period: b.boarding_period, route: b.route, bus: busLabel(b.shuttle_type),
  queue_number: b.queue_number, ticket_id: b.ticket_id, rider: b.profiles?.full_name || '',
  matric: b.profiles?.matric_number || '', phone: b.profiles?.phone_number || '', ticket_status: b.ticket_status, amount: b.total_amount,
})));
$('btn-manifest-print').onclick = () => window.print();

// ─── Validate ───
let lastChecked = null;
$('btn-validate').onclick = async () => {
  const code = parseTicketId($('validate-input').value);
  const box = $('validate-result');
  $('btn-consume').disabled = true;
  lastChecked = null;
  if (!code) { box.innerHTML = '<p class="error">Enter a ticket code.</p>'; return; }
  const { data: b, error } = await sb.from('bookings').select('*,profiles(full_name,matric_number,phone_number)').eq('ticket_id', code).maybeSingle();
  if (error) { box.innerHTML = `<div class="result invalid"><strong>Lookup failed.</strong> ${esc(error.message)}</div>`; return; }
  if (!b) { box.innerHTML = '<div class="result invalid"><strong>Not found.</strong> No booking carries this ticket_id.</div>'; return; }
  const checks = [
    ['payment_status = paid', b.payment_status === 'paid', b.payment_status],
    ['ticket_status = unused', b.ticket_status === 'unused', b.ticket_status],
    ['created within 24h', !!b.created_at && Date.now() - new Date(b.created_at).getTime() < 24 * 3600 * 1000, b.created_at || '—'],
    ['travel_date = today', (b.travel_date || '').slice(0, 10) === todayStr(), b.travel_date || '—'],
  ];
  const ok = checks.every((c) => c[1]);
  lastChecked = b;
  box.innerHTML = `<div class="result ${ok ? 'valid' : 'invalid'}">
    <h3>${ok ? 'Valid — admit' : 'Do not admit'} · ${esc(busLabel(b.shuttle_type))}</h3>
    <p><strong>${esc(b.profiles?.full_name || 'Rider')}</strong> · ${esc(b.profiles?.matric_number || '')} · ${esc(b.profiles?.phone_number || '')} · ${esc(b.route)} · ${esc(b.boarding_period || '')} · Q#${String(b.queue_number || 0).padStart(2, '0')}</p>
    <div class="checks">${checks.map(([k, good, v]) => `<div>${good ? '[PASS]' : '[FAIL]'} ${esc(k)} <span class="muted">(${esc(v)})</span></div>`).join('')}</div>
  </div>`;
  $('btn-consume').disabled = !ok;
};
$('btn-consume').onclick = async () => {
  if (!lastChecked) return;
  const { data, error } = await sb.rpc('mark_ticket_used', { p_ticket_id: lastChecked.ticket_id });
  const box = $('validate-result');
  if (error) { box.innerHTML += `<p class="error">Consume failed: ${esc(error.message)}</p>`; return; }
  if (!data?.ok) { box.innerHTML += `<p class="error">Not consumed: ${esc(data?.reason || 'unknown')}</p>`; return; }
  box.innerHTML += '<p><strong>Consumed — ticket is now used (one-time).</strong></p>';
  $('btn-consume').disabled = true;
};

// ─── Tables ───
async function loadBookings() {
  const pay = $('f-pay').value, tick = $('f-ticket').value, type = $('f-type').value, q = $('q-bookings').value.trim().toLowerCase();
  let query = sb.from('bookings').select('*,profiles(full_name,matric_number,phone_number)').order('created_at', { ascending: false }).limit(100);
  if (pay) query = query.eq('payment_status', pay);
  if (tick) query = query.eq('ticket_status', tick);
  if (type) query = query.eq('shuttle_type', type);
  const { data, error } = await query;
  if (error) { document.querySelector('#tbl-bookings tbody').innerHTML = `<tr><td>${esc(error.message)}</td></tr>`; return; }
  bookingsRows = (data || []).filter((b) => !q || [b.ticket_id, b.paystack_reference, b.route].some((v) => String(v || '').toLowerCase().includes(q)));
  document.querySelector('#tbl-bookings tbody').innerHTML = bookingsRows.map((b) => `<tr>
    <td class="num">${esc(b.ticket_id || '—')}</td><td>${esc(b.profiles?.full_name || '')}</td><td class="num">${esc(b.profiles?.matric_number || b.profiles?.phone_number || '')}</td><td>${esc(busLabel(b.shuttle_type))}</td>
    <td>${esc(b.route)}</td><td>${esc(b.boarding_period || '')}</td><td class="num">${b.queue_number ? 'Q#' + String(b.queue_number).padStart(2, '0') : '—'}</td>
    <td class="num">${naira(b.total_amount)}</td><td>${pill(b.payment_status)}</td><td>${pill(b.ticket_status)}</td>
    <td>${esc((b.travel_date || '').slice(0, 10))}</td><td class="num">${esc((b.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('') || '<tr><td>No rows.</td></tr>';
  stampFresh();
}
['f-pay', 'f-ticket', 'f-type'].forEach((id) => $(id).onchange = loadBookings);
$('q-bookings').oninput = () => loadBookings();
$('btn-bookings-csv').onclick = () => downloadCSV(`bookings-${opDate()}.csv`, bookingsRows.map((b) => ({
  ticket_id: b.ticket_id, reference: b.paystack_reference, rider: b.profiles?.full_name || '', matric: b.profiles?.matric_number || '', phone: b.profiles?.phone_number || '', bus: busLabel(b.shuttle_type),
  route: b.route, boarding_period: b.boarding_period, queue_number: b.queue_number, amount: b.total_amount,
  payment: b.payment_status, ticket: b.ticket_status, travel_date: b.travel_date, created_at: b.created_at,
})));

async function loadUsers() {
  const q = $('q-users').value.trim(), role = $('f-role').value;
  let query = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
  if (role) query = query.eq('role', role);
  if (q) query = query.or(`full_name.ilike.%${q}%,matric_number.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, error } = await query;
  document.querySelector('#tbl-users tbody').innerHTML = error ? `<tr><td>${esc(error.message)}</td></tr>`
    : (data || []).map((u) => `<tr><td>${esc(u.full_name)}</td><td>${pill(u.role)}</td><td class="num">${esc(u.matric_number || '')}</td><td>${esc(u.email || '')}</td><td class="num">${esc(u.phone_number || '')}</td><td>${esc((u.created_at || '').slice(0, 10))}</td></tr>`).join('') || '<tr><td>No users match.</td></tr>';
  stampFresh();
}
$('q-users').oninput = () => loadUsers(); $('f-role').onchange = loadUsers;

async function loadSubs() {
  const st = $('f-sub').value;
  let query = sb.from('subscriptions').select('*,profiles(full_name)').order('created_at', { ascending: false }).limit(200);
  if (st) query = query.eq('status', st);
  const { data, error } = await query;
  if (error) {
    $('sub-notice').innerHTML = `<div class="result invalid"><strong>Cannot list subscriptions with staff key.</strong><br><span class="muted">${esc(error.message)}</span><br>Run the <strong>Settings → Staff RLS checklist</strong> SQL once, then refresh.</div>`;
    document.querySelector('#tbl-subs tbody').innerHTML = '';
    return;
  }
  $('sub-notice').innerHTML = '';
  const now = Date.now();
  const expiring = (data || []).filter((s) => s.status === 'active' && s.expires_at && new Date(s.expires_at).getTime() - now < 7 * 86400000).length;
  if (expiring) $('sub-notice').innerHTML = `<div class="result invalid"><strong>${expiring} active pass${expiring === 1 ? '' : 'es'} expire${expiring === 1 ? 's' : ''} within 7 days.</strong> <span class="muted">Remind these riders to renew so booking never blocks.</span></div>`;
  document.querySelector('#tbl-subs tbody').innerHTML = (data || []).map((s) => `<tr>
    <td>${esc(s.profiles?.full_name || s.user_id.slice(0, 8))}</td><td class="num">${naira(s.amount)}</td><td>${pill(s.status)}</td>
    <td>${esc((s.starts_at || '').slice(0, 10))}</td><td>${esc((s.expires_at || '').slice(0, 10))}</td><td class="num">${esc(s.paystack_reference || '')}</td></tr>`).join('') || '<tr><td>No subscriptions match.</td></tr>';
  stampFresh();
}
$('f-sub').onchange = loadSubs;

async function loadRoutes() {
  $('fare-cards').innerHTML = [['CNG Bus', 500, 'public · Main ⇄ Mini'], ['Petrol Bus', 700, 'private · Main ⇄ Mini'], ['Monthly pass', 1000, '30 days · students only']].map(([n, p, d]) => `<div class="fare"><div><strong>${n}</strong></div><div class="p">${naira(p)}</div><div class="muted small">${d}</div></div>`).join('');
  const { data, error } = await sb.from('shuttle_routes').select('*').eq('is_active', true).order('departure_time').limit(100);
  $('routes-list').innerHTML = error ? `<p class="error">${esc(error.message)}</p>`
    : (data || []).map((r) => `<div class="bar"><span><strong>${esc(r.route_name)}</strong> ${esc(r.origin)} → ${esc(r.destination)} · ${esc(String(r.departure_time).slice(0, 5))}–${esc(String(r.arrival_time).slice(0, 5))} · cap ${r.capacity}</span></div>`).join('') || '<p class="muted">No active rows in shuttle_routes — booking runs on the two fixed campus directions (Main ⇄ Mini, 12 hourly windows 06:00–18:00).</p>';
  stampFresh();
}

async function loadPayments() {
  const q = $('q-pay').value.trim();
  let query = sb.from('bookings').select('*,profiles(full_name,matric_number,phone_number)').in('payment_status', ['pending', 'failed']).order('created_at', { ascending: false }).limit(100);
  if (q) query = query.ilike('paystack_reference', `%${q}%`);
  const { data, error } = await query;
  const ageH = (iso) => { const ms = Date.now() - new Date(iso).getTime(); if (Number.isNaN(ms) || ms < 0) return '—'; const h = Math.floor(ms / 3600000); return h < 1 ? Math.max(1, Math.floor(ms / 60000)) + ' min' : h + ' hr'; };
  document.querySelector('#tbl-pay tbody').innerHTML = error ? `<tr><td>${esc(error.message)}</td></tr>`
    : (data || []).map((b) => `<tr><td class="num">${esc(b.paystack_reference || '')}</td><td>${esc(b.profiles?.full_name || '')}</td><td class="num">${esc(b.profiles?.matric_number || b.profiles?.phone_number || '')}</td><td>${esc(busLabel(b.shuttle_type))}</td><td class="num">${naira(b.total_amount)}</td><td>${pill(b.payment_status)}</td><td>${ageH(b.created_at)}</td><td class="num">${esc((b.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('') || '<tr><td>No pending/failed rows — nothing to reconcile.</td></tr>';
  setBadge('badge-payments', (data || []).length);
  stampFresh();
}
$('q-pay').oninput = () => loadPayments();

// ─── Init ───
// Nothing to configure on screen: connection comes from config.js.
