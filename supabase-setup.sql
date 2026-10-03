-- ============================================
-- UniAbuja Shuttle — Complete Supabase SQL Setup
-- Run the entire file in your Supabase SQL Editor.
--
-- Covers:
--   1. User profiles (Students + Staff)
--   2. Automatic profile creation on sign-up
--   3. Bookings table (Paystack payment flow)
--   4. Shuttle routes (future use)
--
-- NOTE: If you have already created the OLD bookings table or any of
-- these objects from a previous setup, run the CLEANUP section first,
-- then the rest of the file. You can safely re-run the whole file.
-- ============================================

-- ============================================
-- 0. CLEANUP (optional — only if re-running on an existing DB)
--
-- IMPORTANT: Tables are dropped BEFORE any DROP TRIGGER that references
-- them. PostgreSQL's "DROP TRIGGER IF EXISTS ... ON <table>" still raises
-- error 42P01 if the TABLE itself does not exist (IF EXISTS only covers a
-- missing trigger, not a missing table). Dropping tables with CASCADE
-- removes their triggers automatically, so this is safe on any database —
-- fresh or existing.
-- ============================================

DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.shuttle_routes CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

-- ============================================
-- 1. PROFILES TABLE
-- Stores extended user profile data for both Students and Staff
-- ============================================

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'staff')),
  matric_number TEXT UNIQUE,           -- NULL for staff
  email TEXT,                           -- Used by staff (matches auth.users.email)
  phone_number TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Least privilege: clients SELECT/INSERT own rows only. No client UPDATE
-- or DELETE (blocks role->staff escalation and id swaps). All writes go
-- through the signup trigger or service-role Edge Functions.
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Data rules: staff need no matric, students must have one; non-empty phone; email shape.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_matric;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_matric CHECK (
    (role = 'staff') OR (role = 'student' AND matric_number IS NOT NULL AND matric_number <> '')
  );
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_nonempty;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_nonempty CHECK (phone_number <> '');
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_email_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_email_format CHECK (email IS NULL OR email LIKE '%@%.%');

-- ============================================
-- 2. HANDLE NEW USER SIGNUP TRIGGER
-- Automatically creates a profile row when a new user signs up
-- Parents: student or staff
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
  user_matric_number TEXT;
  user_phone_number TEXT;
  user_email TEXT;
BEGIN
  -- Never let a profile failure block signup: fall back to safe defaults.
  BEGIN
    user_role := NEW.raw_user_meta_data->>'role';
    user_full_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
    user_phone_number := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'phone_number', '')), '');
    user_email := NULLIF(TRIM(COALESCE(NEW.email, '')), '');

    IF user_role = 'staff' THEN
      INSERT INTO public.profiles (id, full_name, role, email, phone_number)
      VALUES (
        NEW.id,
        COALESCE(user_full_name, split_part(COALESCE(user_email, 'staff'), '@', 1), 'Staff'),
        'staff',
        user_email,
        COALESCE(user_phone_number, '08000000000')
      )
      ON CONFLICT (id) DO NOTHING;
    ELSE
      user_matric_number := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'matric_number', '')), '');
      INSERT INTO public.profiles (id, full_name, role, matric_number, email, phone_number)
      VALUES (
        NEW.id,
        COALESCE(user_full_name, COALESCE(user_matric_number, split_part(COALESCE(user_email, 'student'), '@', 1), 'Student')),
        'student',
        user_matric_number,
        COALESCE(user_email, LOWER(COALESCE(user_matric_number, NEW.id::TEXT)) || '@uniabuja.edu.ng'),
        COALESCE(user_phone_number, '08000000000')
      )
      ON CONFLICT (id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Last resort: minimal row so the FK chain never breaks. Real details
    -- can be backfilled by paystack-init or support.
    BEGIN
      INSERT INTO public.profiles (id, full_name, role, matric_number, email, phone_number)
      VALUES (NEW.id, 'Shuttle User', 'student', 'PENDING-' || substr(NEW.id::TEXT, 1, 8), NEW.email, '08000000000')
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- auth user creation must never fail because of profiles
    END;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. UPDATED_AT TRIGGER (shared by profiles + bookings)
-- ============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 4. INDEXES FOR PROFILES
-- ============================================

CREATE INDEX idx_profiles_matric_number ON public.profiles(matric_number);
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- ============================================
-- 5. BOOKINGS TABLE  (Paystack payment flow)
-- Each paid booking generates a digital ticket.
-- Created by the paystack-init Edge Function with payment_status = 'pending'
-- and flipped to 'paid' only after Paystack verification succeeds.
-- ============================================

CREATE TABLE public.bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,

  -- Booking details
  shuttle_type TEXT NOT NULL CHECK (shuttle_type IN ('public', 'private')),
  route TEXT NOT NULL DEFAULT 'Main Campus → Mini Campus',

  -- Pricing (computed server-side, stored for reference)
  fare NUMERIC(10, 2) NOT NULL,
  service_fee NUMERIC(10, 2) NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',

  -- Payment status
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled')),

  -- Paystack integration
  paystack_reference TEXT UNIQUE,
  paystack_metadata JSONB,

  -- Digital ticket fields (assigned by backend after payment verification)
  travel_date DATE NOT NULL DEFAULT CURRENT_DATE,
  boarding_period TEXT,
  queue_number INTEGER,
  ticket_id TEXT UNIQUE,
  ticket_status TEXT NOT NULL DEFAULT 'unused'
    CHECK (ticket_status IN ('unused', 'used', 'cancelled')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Least privilege: clients READ own rows only. Every write (pending
-- insert, paid confirmation, failure marking) goes through service-role
-- Edge Functions or SECURITY DEFINER RPCs below. This closes direct
-- paid-ticket forgery via the anon key.
REVOKE ALL ON public.bookings FROM anon, authenticated;
GRANT SELECT ON public.bookings TO authenticated;

DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can delete own bookings" ON public.bookings;

-- Data rules: money math, enums, formats, and status consistency.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_money_sane;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_money_sane CHECK (
    fare >= 0 AND service_fee >= 0 AND total_amount >= 0
    AND total_amount = fare + service_fee
  );
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_currency_ngn;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_currency_ngn CHECK (currency = 'NGN');
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_route_known;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_route_known CHECK (
    route IN ('Main Campus → Mini Campus', 'Mini Campus → Main Campus')
  );
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_period_format;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_period_format CHECK (
    boarding_period IS NULL OR boarding_period ~ '^\d{2}:00-\d{2}:00$'
  );
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_queue_positive;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_queue_positive CHECK (
    queue_number IS NULL OR queue_number > 0
  );
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_ticket_format;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_ticket_format CHECK (
    ticket_id IS NULL OR ticket_id LIKE 'TKT-%'
  );
-- Non-paid rows must stay unused: only paid tickets can be used/cancelled.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_coherent;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_coherent CHECK (
    payment_status = 'paid' OR ticket_status = 'unused'
  );

-- Trigger for bookings.updated_at
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for bookings
CREATE INDEX idx_bookings_user_id ON public.bookings(user_id);
CREATE INDEX idx_bookings_reference ON public.bookings(paystack_reference);
CREATE INDEX idx_bookings_status ON public.bookings(payment_status);
CREATE INDEX idx_bookings_created ON public.bookings(created_at DESC);
CREATE INDEX idx_bookings_travel_date ON public.bookings(travel_date);
CREATE INDEX idx_bookings_ticket_id ON public.bookings(ticket_id);

-- ============================================
-- 6. SHUTTLE ROUTES TABLE (future use)
-- ============================================

CREATE TABLE public.shuttle_routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_name TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_time TIME NOT NULL,
  arrival_time TIME NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  capacity INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.shuttle_routes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shuttle_routes FROM anon, authenticated;
GRANT SELECT ON public.shuttle_routes TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view active routes" ON public.shuttle_routes;
CREATE POLICY "Anyone can view active routes" ON public.shuttle_routes
  FOR SELECT USING (is_active IS TRUE);

-- Sane route data (managed via service_role / dashboard only).
ALTER TABLE public.shuttle_routes
  DROP CONSTRAINT IF EXISTS routes_sane;
ALTER TABLE public.shuttle_routes
  ADD CONSTRAINT routes_sane CHECK (
    price >= 0 AND capacity > 0 AND departure_time < arrival_time
    AND is_active IS NOT NULL
  );
ALTER TABLE public.shuttle_routes
  DROP CONSTRAINT IF EXISTS routes_unique_slot;
ALTER TABLE public.shuttle_routes
  ADD CONSTRAINT routes_unique_slot UNIQUE (origin, destination, departure_time);
CREATE INDEX IF NOT EXISTS idx_routes_active ON public.shuttle_routes (is_active) WHERE is_active IS TRUE;

-- ============================================
-- 7. AUTH SETTINGS
-- Ensure email confirmation is disabled for seamless sign-in
-- ============================================

-- Set in Supabase Dashboard:
-- Authentication → Providers → Email → "Enable email confirmations" = OFF
-- (Required for the current sign-in flow: no email verification step.)

-- ============================================
-- 8. MATRIC → EMAIL LOOKUP (student sign-in)
-- Lets students sign in with their matric number while the auth
-- account uses their real email. SECURITY DEFINER so it works
-- before sign-in; it only reveals the email for an exact matric.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_email_by_matric(p_matric TEXT)
RETURNS TEXT AS $$
  SELECT email FROM public.profiles
  WHERE UPPER(matric_number) = UPPER(TRIM(p_matric))
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Login-time lookup: students are NOT signed in yet when they type
-- their matric, so the anon key must be allowed too. This is safe:
-- the function only reveals the email for an EXACT matric match
-- (no listing or harvesting possible).
-- IMPORTANT: if matric sign-in ever stops working, re-run just this
-- GRANT block in the Supabase SQL Editor.
REVOKE ALL ON FUNCTION public.get_email_by_matric(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_matric(TEXT) TO anon, authenticated;

-- Functional index so the UPPER() lookup never seq-scans.
CREATE INDEX IF NOT EXISTS idx_profiles_matric_upper
  ON public.profiles (UPPER(matric_number));

-- ============================================
-- 9. STAFF CHECKPOINT ADD-ON (safe on existing DB — no drops)
-- Run ONLY this section in the Supabase SQL Editor to enable the
-- staff QR scanner. Lets signed-in staff accounts verify any rider
-- ticket and mark it used at boarding.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

REVOKE ALL ON FUNCTION public.is_staff() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- Staff can look up any booking when scanning a QR code
DROP POLICY IF EXISTS "Staff can view all bookings" ON public.bookings;
CREATE POLICY "Staff can view all bookings" ON public.bookings
  FOR SELECT USING (public.is_staff());

-- Boarding is confirmed ONLY through this RPC: it flips unused->used and
-- touches nothing else (fares, references, queues, owners are immutable).
-- The broad staff UPDATE policy is dropped so staff JWTs cannot rewrite rows.
DROP POLICY IF EXISTS "Staff can mark tickets used" ON public.bookings;

CREATE OR REPLACE FUNCTION public.mark_ticket_used(p_ticket_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_staff() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_staff');
  END IF;
  UPDATE public.bookings
  SET ticket_status = 'used', updated_at = NOW()
  WHERE ticket_id = p_ticket_id AND ticket_status = 'unused'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found_or_used');
  END IF;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_ticket_used(TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_ticket_used(TEXT) TO authenticated;

-- Staff can see rider names/matric numbers on scanned tickets
DROP POLICY IF EXISTS "Staff can view rider profiles" ON public.profiles;
CREATE POLICY "Staff can view rider profiles" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_staff());

-- ============================================
-- 10. DELETE OWN ACCOUNT (Supabase Auth + all data)
-- Lets a signed-in user permanently delete their own auth account
-- and every row tied to it. The phone alone cannot delete from
-- auth.users — this SECURITY DEFINER function can.
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  live_count INTEGER;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- Refuse while live (paid + unused) tickets exist: refund/use them first
  -- so money is never silently destroyed with the account.
  SELECT COUNT(*) INTO live_count FROM public.bookings
  WHERE user_id = uid AND payment_status = 'paid' AND ticket_status = 'unused';
  IF live_count > 0 THEN
    RAISE EXCEPTION 'You still have % unused paid ticket(s). Use them or contact support for a refund before deleting your account.', live_count;
  END IF;
  -- Children first (FK: bookings.user_id → profiles.id)
  DELETE FROM public.bookings WHERE user_id = uid;
  -- Then profile
  DELETE FROM public.profiles WHERE id = uid;
  -- Finally the auth account itself (this is what the Dashboard
  -- shows under Authentication → Users)
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ============================================
-- 11. ATOMIC QUEUE NUMBER ASSIGNMENT
-- Prevents race conditions when two payments verify at the same time.
-- Returns the next queue number for a given date + period + shuttle_type.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_next_queue_number(
  p_travel_date DATE,
  p_boarding_period TEXT,
  p_shuttle_type TEXT,
  p_route TEXT DEFAULT 'Main Campus → Mini Campus'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Serialize concurrent verifications for the same bus slot, even when
  -- no paid rows exist yet (MAX … FOR UPDATE locks nothing on empty sets).
  PERFORM pg_advisory_xact_lock(
    hashtext(p_travel_date::TEXT || '|' || p_boarding_period || '|' || p_shuttle_type || '|' || p_route)
  );
  SELECT COALESCE(MAX(queue_number), 0) + 1
  INTO next_num
  FROM public.bookings
  WHERE travel_date = p_travel_date
    AND boarding_period = p_boarding_period
    AND shuttle_type = p_shuttle_type
    AND route = p_route
    AND payment_status = 'paid';

  RETURN next_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_queue_number(DATE, TEXT, TEXT, TEXT) TO authenticated;
-- Back-compat wrapper for already-deployed 3-arg callers.
CREATE OR REPLACE FUNCTION public.get_next_queue_number(
  p_travel_date DATE,
  p_boarding_period TEXT,
  p_shuttle_type TEXT
)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.get_next_queue_number(p_travel_date, p_boarding_period, p_shuttle_type, 'Main Campus → Mini Campus') $$;

GRANT EXECUTE ON FUNCTION public.get_next_queue_number(DATE, TEXT, TEXT) TO authenticated;

-- Unique guard per bus, paid rows only: pending rows never squat numbers,
-- and NULL periods/queues can't slip through (both are set when paid).
ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_unique_queue;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_unique_queue
UNIQUE (travel_date, boarding_period, shuttle_type, route, queue_number);

-- Composite indexes the hot paths actually use (replaces seq-scans).
CREATE INDEX IF NOT EXISTS idx_bookings_queue_slot ON public.bookings
  (travel_date, boarding_period, shuttle_type, route, payment_status, queue_number);
CREATE INDEX IF NOT EXISTS idx_bookings_user_list ON public.bookings
  (user_id, payment_status, ticket_status, travel_date, created_at DESC);

-- Self-service profile edits: name + phone only. Role, matric, email
-- and id are immutable here (blocks privilege escalation).
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_full_name TEXT,
  p_phone_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := TRIM(COALESCE(p_full_name, ''));
  v_digits TEXT := regexp_replace(COALESCE(p_phone_number, ''), '\D', '', 'g');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF char_length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_name');
  END IF;
  IF char_length(v_digits) < 7 OR char_length(v_digits) > 15 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_phone');
  END IF;
  UPDATE public.profiles
  SET full_name = v_name, phone_number = v_digits, updated_at = NOW()
  WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_profile');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_own_profile(TEXT, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_profile(TEXT, TEXT) TO authenticated;

-- ============================================
-- 12. ATOMIC PAYMENT CONFIRMATION (single-transaction verify)
-- The Edge Function verifies with Paystack, then calls this ONE rpc:
-- lock slot -> assign queue -> mark paid -> return stored ticket.
-- Re-verifies return the STORED ticket (never a freshly invented one).
-- Direct client UPDATEs are revoked, so this is the only path to paid.
-- ============================================

CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_reference TEXT,
  p_user_id UUID,
  p_paystack_metadata JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_queue INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
  WHERE paystack_reference = p_reference AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;

  -- Idempotent replay: hand back what was already issued.
  IF v_booking.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'ticket_id', v_booking.ticket_id,
      'travel_date', v_booking.travel_date,
      'boarding_period', v_booking.boarding_period,
      'queue_number', v_booking.queue_number,
      'amount', v_booking.total_amount,
      'currency', v_booking.currency
    );
  END IF;

  IF v_booking.payment_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  -- Serialize this exact bus slot (works even with zero paid rows yet).
  PERFORM pg_advisory_xact_lock(hashtext(
    v_booking.travel_date::TEXT || '|' || COALESCE(v_booking.boarding_period, '')
    || '|' || v_booking.shuttle_type || '|' || v_booking.route
  ));

  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue
  FROM public.bookings
  WHERE travel_date = v_booking.travel_date
    AND boarding_period IS NOT DISTINCT FROM v_booking.boarding_period
    AND shuttle_type = v_booking.shuttle_type
    AND route = v_booking.route
    AND payment_status = 'paid';

  UPDATE public.bookings SET
    payment_status = 'paid',
    updated_at = NOW(),
    paystack_metadata = COALESCE(p_paystack_metadata, paystack_metadata),
    queue_number = v_queue,
    ticket_id = 'TKT-' || to_char(v_booking.travel_date, 'YYYYMMDD')
      || '-' || upper(substr(md5(random()::TEXT || clock_timestamp()::TEXT), 1, 6)),
    ticket_status = 'unused'
  WHERE id = v_booking.id AND payment_status = 'pending'
  RETURNING * INTO v_booking;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'confirm_race');
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'ticket_id', v_booking.ticket_id,
    'travel_date', v_booking.travel_date,
    'boarding_period', v_booking.boarding_period,
    'queue_number', v_booking.queue_number,
    'amount', v_booking.total_amount,
    'currency', v_booking.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_booking_payment(TEXT, UUID, JSONB) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(TEXT, UUID, JSONB) TO authenticated, service_role;

-- ============================================
-- 13. REALTIME (admin dashboard + rider refresh)
-- New tables are NOT published by default; without this, realtime
-- subscribers silently receive nothing.
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- ============================================
-- 14. MONTHLY SUBSCRIPTIONS (₦1,000 / 30 days, required to book)
-- Run ONLY this section on an existing DB (safe — creates new objects only).
-- Clients READ own rows only; all writes go through service-role Edge
-- Functions (paystack-sub-init / verify / webhook) or the RPC below.
-- ============================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 1000 CHECK (amount = 1000),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'expired', 'failed')),
  paystack_reference TEXT UNIQUE,
  paystack_metadata JSONB,
  starts_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active ON public.subscriptions (user_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_reference ON public.subscriptions (paystack_reference);

-- Activate a subscription after Paystack confirms ₦1,000. Idempotent:
-- re-verifies return the stored expiry. Grants 30 days from now
-- (or extends the current expiry when renewing early).
CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(
  p_reference TEXT,
  p_user_id UUID,
  p_paystack_metadata JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_base TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions
  WHERE paystack_reference = p_reference AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  END IF;

  IF v_sub.status = 'active' AND v_sub.expires_at IS NOT NULL AND v_sub.expires_at > NOW() THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'expires_at', v_sub.expires_at);
  END IF;

  IF v_sub.status <> 'pending' AND v_sub.status <> 'failed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  v_base := NOW();
  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at > NOW() THEN
    v_base := v_sub.expires_at;
  END IF;

  UPDATE public.subscriptions SET
    status = 'active',
    starts_at = NOW(),
    expires_at = v_base + INTERVAL '30 days',
    paystack_metadata = COALESCE(p_paystack_metadata, paystack_metadata)
  WHERE id = v_sub.id
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object('ok', true, 'already', false, 'expires_at', v_sub.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_subscription_payment(TEXT, UUID, JSONB) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_subscription_payment(TEXT, UUID, JSONB) TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;

-- ============================================
-- DONE! Your database is now fully set up.
-- Sections 9-14 are safe to run on an existing DB (no drops of data).
-- WARNING: the CLEANUP block at the top wipes all data — never run the
-- whole file on a live database. Run sections individually instead.
-- ============================================