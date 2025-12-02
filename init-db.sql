-- Create fraud_alerts table for fraud detection worker
CREATE TABLE IF NOT EXISTS fraud_alerts (
    id SERIAL PRIMARY KEY,
    wallet_id VARCHAR(255) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_wallet_id ON fraud_alerts(wallet_id);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created_at ON fraud_alerts(created_at);

-- Note: Event immutability triggers are created by the application after TypeORM
-- initializes the wallet_events table. See: src/infrastructure/database/migrations/

-- Note: TypeORM synchronize=true will automatically add new wallet columns:
-- - currency (VARCHAR(3), default 'USD')
-- - status (ENUM: ACTIVE, FROZEN, CLOSED, default 'ACTIVE')
-- - daily_withdrawal_limit (DECIMAL(20,2), nullable)
