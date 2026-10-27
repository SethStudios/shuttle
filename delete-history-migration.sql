-- ============================================
-- 16. DELETE OWN HISTORY RPC
-- Deletes all non-active bookings for a user
-- (used to clear history screen).
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_own_history(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.bookings
  WHERE user_id = p_user_id
    AND NOT (payment_status = 'paid' AND ticket_status = 'unused')
  RETURNING id;
  
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_history(UUID) TO authenticated;