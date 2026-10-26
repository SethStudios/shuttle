-- ============================================
-- 15. WALLETS TABLE (₦ wallet for booking payments)
-- Users top up their wallet via Paystack, then
-- deduct from it to book shuttle tickets.
-- Transfers between users via matric number + 4-digit PIN.
-- ============================================

CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  pin_hash TEXT,                                 -- 4-digit PIN (stored as plain text for simplicity; hash in production)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallets FROM anon, authenticated;
GRANT SELECT ON public.wallets TO authenticated;

DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet" ON public.wallets
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);

-- ------------------------------------------------------------------
-- RPC: wallet_top_up — credit wallet after Paystack verification
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_top_up(
  p_reference TEXT,
  p_user_id UUID,
  p_amount NUMERIC,
  p_paystack_metadata JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance, currency)
    VALUES (p_user_id, p_amount, 'NGN')
    RETURNING * INTO v_wallet;
  ELSE
    UPDATE public.wallets SET
      balance = balance + p_amount,
      updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING * INTO v_wallet;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'wallet_id', v_wallet.id,
    'balance', v_wallet.balance,
    'currency', v_wallet.currency
  );
END;
$$;

-- ------------------------------------------------------------------
-- RPC: wallet_transfer — transfer balance between users via matric
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_transfer(
  p_from_user_id UUID,
  p_to_matric TEXT,
  p_amount NUMERIC,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_wallet public.wallets%ROWTYPE;
  v_to_profile public.profiles%ROWTYPE;
  v_to_wallet public.wallets%ROWTYPE;
BEGIN
  -- Sender wallet + PIN check
  SELECT * INTO v_from_wallet FROM public.wallets WHERE user_id = p_from_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  END IF;

  IF v_from_wallet.pin_hash IS NULL OR v_from_wallet.pin_hash <> p_pin THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  END IF;

  IF v_from_wallet.balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
  END IF;

  -- Recipient lookup by matric number
  SELECT * INTO v_to_profile FROM public.profiles
  WHERE UPPER(matric_number) = UPPER(TRIM(p_to_matric)) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_found');
  END IF;

  IF v_to_profile.id = p_from_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_transfer_to_self');
  END IF;

  -- Recipient wallet (create if missing)
  SELECT * INTO v_to_wallet FROM public.wallets WHERE user_id = v_to_profile.id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance, currency)
    VALUES (v_to_profile.id, p_amount, 'NGN')
    RETURNING * INTO v_to_wallet;
  ELSE
    UPDATE public.wallets SET
      balance = balance + p_amount,
      updated_at = NOW()
    WHERE user_id = v_to_profile.id
    RETURNING * INTO v_to_wallet;
  END IF;

  -- Deduct from sender
  UPDATE public.wallets SET
    balance = balance - p_amount,
    updated_at = NOW()
  WHERE user_id = p_from_user_id
  RETURNING * INTO v_from_wallet;

  RETURN jsonb_build_object(
    'ok', true,
    'from_balance', v_from_wallet.balance,
    'to_balance', v_to_wallet.balance,
    'recipient', v_to_profile.full_name,
    'recipient_matric', v_to_profile.matric_number
  );
END;
$$;

-- ------------------------------------------------------------------
-- RPC: wallet_deduct — deduct from wallet when booking a ticket
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_deduct(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  END IF;

  IF v_wallet.balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
  END IF;

  UPDATE public.wallets SET
    balance = balance - p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING * INTO v_wallet;

  RETURN jsonb_build_object(
    'ok', true,
    'balance', v_wallet.balance
  );
END;
$$;

-- ------------------------------------------------------------------
-- RPC: wallet_set_pin — set or change 4-digit PIN
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_set_pin(
  p_user_id UUID,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, balance, currency, pin_hash)
    VALUES (p_user_id, 0, 'NGN', p_pin)
    RETURNING * INTO v_wallet;
  ELSE
    UPDATE public.wallets SET pin_hash = p_pin, updated_at = NOW()
    WHERE user_id = p_user_id
    RETURNING * INTO v_wallet;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.wallet_top_up(TEXT, UUID, NUMERIC, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wallet_transfer(UUID, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_deduct(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_set_pin(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------------
-- REALTIME
-- ------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
