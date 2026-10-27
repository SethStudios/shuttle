-- ============================================
-- 15. DELETE OWN BOOKING RPC
-- Allows users to delete their own bookings
-- from history (not active paid tickets).
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_own_booking(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;

  -- Only allow deleting cancelled, failed, used, or expired bookings
  -- Not active (paid + unused) ones
  IF v_booking.payment_status = 'paid' AND v_booking.ticket_status = 'unused' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_delete_active');
  END IF;

  DELETE FROM public.bookings WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_booking(UUID) TO authenticated;