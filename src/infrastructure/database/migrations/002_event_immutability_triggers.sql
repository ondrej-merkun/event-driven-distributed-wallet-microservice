-- ============================================================================
-- Database Triggers for Event Immutability
-- ============================================================================
-- These triggers enforce immutability of wallet_events at the database level.
-- This is the final layer of defense-in-depth, protecting against:
-- - Direct SQL modifications bypassing the application
-- - Bugs in application code
-- - Accidental updates from database admin tools
-- ============================================================================

-- Function to prevent modifications to wallet_events
CREATE OR REPLACE FUNCTION prevent_wallet_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'wallet_events table is immutable. % operations are not allowed. Events form a permanent audit trail and cannot be modified or deleted after creation.',
    TG_OP
    USING ERRCODE = '23506'; -- integrity_constraint_violation
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent UPDATE operations
CREATE TRIGGER prevent_wallet_event_update
  BEFORE UPDATE ON wallet_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_wallet_event_modification();

-- Trigger to prevent DELETE operations  
CREATE TRIGGER prevent_wallet_event_delete
  BEFORE DELETE ON wallet_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_wallet_event_modification();

-- ============================================================================
-- Verification Queries
-- ============================================================================
-- To verify triggers are installed:
-- SELECT trigger_name, event_manipulation, event_object_table 
-- FROM information_schema.triggers 
-- WHERE event_object_table = 'wallet_events';
--
-- Expected output:
-- prevent_wallet_event_update  | UPDATE | wallet_events
-- prevent_wallet_event_delete  | DELETE | wallet_events
-- ============================================================================
