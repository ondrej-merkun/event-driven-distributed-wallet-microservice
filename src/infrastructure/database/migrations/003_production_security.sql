-- ============================================================================
-- Production Database Security Setup for Audit Compliance
-- ============================================================================
-- This script demonstrates proper database-level security for audit compliance.
-- 
-- Key Principles:
-- 1. Application uses restricted role (cannot UPDATE/DELETE events)
-- 2. DBA role separate from application role (separation of duties)
-- 3. Even if application code is compromised, events remain immutable
-- 4. Satisfies SOX, PCI-DSS, and GDPR audit requirements
-- ============================================================================

-- ============================================================================
-- PART 1: Create Roles with Separation of Duties
-- ============================================================================

-- DBA Role: Can modify schema, triggers, permissions
-- Used by: Database administrators only
-- Access: Restricted, requires approval for changes
CREATE ROLE wallet_dba WITH 
  LOGIN 
  PASSWORD 'CHANGE_ME_IN_PRODUCTION'
  SUPERUSER;

COMMENT ON ROLE wallet_dba IS 'Database administrator role with full privileges. Used for schema changes and maintenance only.';

-- Application Role: Limited to INSERT and SELECT on events
-- Used by: The wallet microservice application
-- Access: Cannot modify or delete events, even if code is compromised
CREATE ROLE wallet_app WITH 
  LOGIN 
  PASSWORD 'CHANGE_ME_IN_PRODUCTION'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE;

COMMENT ON ROLE wallet_app IS 'Application role with restricted permissions. Cannot UPDATE or DELETE events.';

-- ============================================================================
-- PART 2: Grant Minimal Required Permissions to Application
-- ============================================================================

-- Grant database connection
GRANT CONNECT ON DATABASE wallet_db TO wallet_app;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO wallet_app;

-- ============================================================================
-- PART 3: Wallet Events Table - Immutable Audit Trail
-- ============================================================================

-- Grant INSERT and SELECT only (no UPDATE, no DELETE)
GRANT INSERT, SELECT ON TABLE wallet_events TO wallet_app;

-- Grant sequence usage for auto-incrementing IDs
GRANT USAGE, SELECT ON SEQUENCE wallet_events_id_seq TO wallet_app;

-- Explicitly revoke UPDATE and DELETE to make it clear
REVOKE UPDATE, DELETE ON TABLE wallet_events FROM wallet_app;

COMMENT ON TABLE wallet_events IS 'Immutable audit trail. Application can only INSERT and SELECT. UPDATE/DELETE blocked at database level.';

-- ============================================================================
-- PART 4: Other Tables - Normal CRUD Operations
-- ============================================================================

-- Wallets table: Full CRUD access (balance can be updated)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wallets TO wallet_app;
GRANT USAGE, SELECT ON SEQUENCE wallets_id_seq TO wallet_app;

-- Transfer sagas: Full CRUD access (saga state changes)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE transfer_sagas TO wallet_app;

-- Idempotency keys: Full CRUD access (can be cleaned up)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE idempotency_keys TO wallet_app;

-- Fraud alerts: INSERT and SELECT only (audit data)
GRANT INSERT, SELECT ON TABLE fraud_alerts TO wallet_app;

-- ============================================================================
-- PART 5: Row-Level Security (Optional Additional Layer)
-- ============================================================================

-- Enable Row-Level Security on wallet_events for extra protection
ALTER TABLE wallet_events ENABLE ROW LEVEL SECURITY;

-- Policy: Allow INSERT for application role
CREATE POLICY wallet_events_insert_policy ON wallet_events
  FOR INSERT
  TO wallet_app
  WITH CHECK (true);

-- Policy: Allow SELECT for application role
CREATE POLICY wallet_events_select_policy ON wallet_events
  FOR SELECT
  TO wallet_app
  USING (true);

-- No UPDATE or DELETE policies = those operations are blocked
-- Even if someone grants UPDATE permission, RLS prevents it

COMMENT ON POLICY wallet_events_insert_policy ON wallet_events IS 'Allow application to insert new events';
COMMENT ON POLICY wallet_events_select_policy ON wallet_events IS 'Allow application to read events';

-- ============================================================================
-- PART 6: Audit Logging Configuration
-- ============================================================================

-- Enable statement logging for all modifications
ALTER SYSTEM SET log_statement = 'mod';

-- Log all DDL (CREATE, ALTER, DROP)
ALTER SYSTEM SET log_min_duration_statement = 0;

-- Log connections and disconnections
ALTER SYSTEM SET log_connections = 'on';
ALTER SYSTEM SET log_disconnections = 'on';

-- Log who is executing queries
ALTER SYSTEM SET log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ';

-- Reload configuration
SELECT pg_reload_conf();

-- ============================================================================
-- PART 7: Monitoring Queries for Compliance
-- ============================================================================

-- Query to verify wallet_app cannot UPDATE/DELETE events
-- Run this as part of compliance checks
CREATE OR REPLACE FUNCTION verify_event_immutability_permissions()
RETURNS TABLE(
  role_name TEXT,
  table_name TEXT,
  can_select BOOLEAN,
  can_insert BOOLEAN,
  can_update BOOLEAN,
  can_delete BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'wallet_app'::TEXT,
    'wallet_events'::TEXT,
    has_table_privilege('wallet_app', 'wallet_events', 'SELECT'),
    has_table_privilege('wallet_app', 'wallet_events', 'INSERT'),
    has_table_privilege('wallet_app', 'wallet_events', 'UPDATE'),
    has_table_privilege('wallet_app', 'wallet_events', 'DELETE');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION verify_event_immutability_permissions() IS 'Compliance check: Verify wallet_app cannot UPDATE/DELETE events. Expected: SELECT=true, INSERT=true, UPDATE=false, DELETE=false';

-- Query to verify triggers are active
CREATE OR REPLACE FUNCTION verify_event_immutability_triggers()
RETURNS TABLE(
  trigger_name TEXT,
  event_type TEXT,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.trigger_name::TEXT,
    t.event_manipulation::TEXT,
    (t.trigger_name IS NOT NULL) AS is_active
  FROM information_schema.triggers t
  WHERE t.event_object_table = 'wallet_events'
    AND t.trigger_name IN ('prevent_wallet_event_update', 'prevent_wallet_event_delete');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION verify_event_immutability_triggers() IS 'Compliance check: Verify immutability triggers are active. Expected: 2 triggers (UPDATE and DELETE)';

-- ============================================================================
-- PART 8: Compliance Verification Script
-- ============================================================================

-- Run this to generate compliance report
CREATE OR REPLACE FUNCTION generate_compliance_report()
RETURNS TEXT AS $$
DECLARE
  report TEXT := '';
  perm_check RECORD;
  trigger_check RECORD;
BEGIN
  report := E'=== Event Immutability Compliance Report ===\n\n';
  
  -- Check permissions
  report := report || E'1. Application Permissions:\n';
  FOR perm_check IN SELECT * FROM verify_event_immutability_permissions() LOOP
    report := report || format(E'   Role: %s, Table: %s\n', perm_check.role_name, perm_check.table_name);
    report := report || format(E'   - SELECT: %s (Expected: true)\n', perm_check.can_select);
    report := report || format(E'   - INSERT: %s (Expected: true)\n', perm_check.can_insert);
    report := report || format(E'   - UPDATE: %s (Expected: false) %s\n', 
      perm_check.can_update, 
      CASE WHEN NOT perm_check.can_update THEN '✓' ELSE '✗ VIOLATION' END);
    report := report || format(E'   - DELETE: %s (Expected: false) %s\n\n', 
      perm_check.can_delete,
      CASE WHEN NOT perm_check.can_delete THEN '✓' ELSE '✗ VIOLATION' END);
  END LOOP;
  
  -- Check triggers
  report := report || E'2. Database Triggers:\n';
  FOR trigger_check IN SELECT * FROM verify_event_immutability_triggers() LOOP
    report := report || format(E'   - %s (%s): %s\n', 
      trigger_check.trigger_name, 
      trigger_check.event_type,
      CASE WHEN trigger_check.is_active THEN '✓ Active' ELSE '✗ MISSING' END);
  END LOOP;
  
  report := report || E'\n3. Row-Level Security:\n';
  report := report || format(E'   - RLS Enabled: %s\n',
    CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE relname = 'wallet_events') 
    THEN '✓ Yes' ELSE '✗ No' END);
  
  RETURN report;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 9: Usage Instructions
-- ============================================================================

-- To apply this configuration:
-- 1. Run this script as PostgreSQL superuser
-- 2. Update docker-compose.yml to use wallet_app credentials
-- 3. Restart application
-- 4. Verify with: SELECT generate_compliance_report();

-- To test immutability:
-- SET ROLE wallet_app;
-- UPDATE wallet_events SET amount = 999 WHERE id = 1;
-- Expected: ERROR: permission denied for table wallet_events

-- ============================================================================
-- PART 10: Automated Compliance Monitoring
-- ============================================================================

-- Create table to log compliance checks
CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id SERIAL PRIMARY KEY,
  check_timestamp TIMESTAMP DEFAULT NOW(),
  check_type VARCHAR(100),
  status VARCHAR(20),
  details TEXT
);

-- Function to run automated compliance check
CREATE OR REPLACE FUNCTION run_compliance_check()
RETURNS VOID AS $$
DECLARE
  perm_check RECORD;
  trigger_count INTEGER;
  violations TEXT := '';
BEGIN
  -- Check permissions
  FOR perm_check IN SELECT * FROM verify_event_immutability_permissions() LOOP
    IF perm_check.can_update OR perm_check.can_delete THEN
      violations := violations || format('Permission violation: wallet_app has %s on wallet_events; ',
        CASE WHEN perm_check.can_update THEN 'UPDATE' ELSE 'DELETE' END);
    END IF;
  END LOOP;
  
  -- Check triggers
  SELECT COUNT(*) INTO trigger_count FROM verify_event_immutability_triggers();
  IF trigger_count < 2 THEN
    violations := violations || format('Trigger violation: Only %s/2 triggers active; ', trigger_count);
  END IF;
  
  -- Log result
  INSERT INTO compliance_audit_log (check_type, status, details)
  VALUES (
    'event_immutability',
    CASE WHEN violations = '' THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN violations = '' THEN 'All checks passed' ELSE violations END
  );
  
  -- Alert on violations
  IF violations != '' THEN
    RAISE WARNING 'COMPLIANCE VIOLATION: %', violations;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Schedule this to run periodically (e.g., via cron or pg_cron extension)
-- SELECT run_compliance_check();

COMMENT ON FUNCTION run_compliance_check() IS 'Automated compliance monitoring. Run periodically to detect permission or trigger changes.';
