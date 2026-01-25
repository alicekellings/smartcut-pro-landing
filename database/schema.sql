-- License Management Database Schema
-- This script creates all necessary tables for license key management

-- Activations table: Stores device activation records
CREATE TABLE IF NOT EXISTS activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key VARCHAR(255) NOT NULL,
  product_id VARCHAR(50) NOT NULL,
  machine_id VARCHAR(255) NOT NULL,

  -- Payhip customer info
  customer_email VARCHAR(255),

  -- Activation timestamps
  activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TIMESTAMP,

  -- Offline grace period
  offline_expiry TIMESTAMP,

  -- Status: active, revoked, expired
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),

  -- Metadata
  user_agent TEXT,
  ip_address INET,

  -- Unique constraint: same key + machine_id = unique activation
  -- Prevents duplicate activation on same device
  -- Comment out if you want to allow re-activation on same device
  CONSTRAINT unique_machine_license UNIQUE (machine_id, license_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activations_license_key ON activations(license_key);
CREATE INDEX IF NOT EXISTS idx_activations_machine_id ON activations(machine_id);
CREATE INDEX IF NOT EXISTS idx_activations_status ON activations(status);
CREATE INDEX IF NOT EXISTS idx_activations_product_id ON activations(product_id);
CREATE INDEX IF NOT EXISTS idx_activations_offline_expiry ON activations(offline_expiry);

-- Refunded licenses table: Tracks refunded/revoked licenses
CREATE TABLE IF NOT EXISTS refunded_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255),
  refunded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,

  -- Payhip transaction reference (for tracking)
  payhip_transaction_id VARCHAR(255)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_refunded_licenses_key ON refunded_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_refunded_licenses_email ON refunded_licenses(email);

-- License stats view: For analytics and dashboard
CREATE OR REPLACE VIEW license_stats AS
SELECT
  product_id,
  COUNT(DISTINCT license_key) as total_licenses,
  COUNT(*) as total_activations,
  COUNT(DISTINCT machine_id) as unique_machines,
  COUNT(*) FILTER (WHERE status = 'active') as active_activations,
  COUNT(*) FILTER (WHERE status = 'revoked') as revoked_activations,
  COUNT(*) FILTER (WHERE status = 'expired') as expired_activations,
  COUNT(*) FILTER (WHERE offline_expiry > CURRENT_TIMESTAMP) as online_now
FROM activations
GROUP BY product_id;

-- Comments for documentation
COMMENT ON TABLE activations IS 'Stores device activation records for license keys';
COMMENT ON TABLE refunded_licenses IS 'Tracks refunded or revoked license keys';

COMMENT ON COLUMN activations.machine_id IS 'SHA256 hash of hardware fingerprint';
COMMENT ON COLUMN activations.offline_expiry IS 'Timestamp when offline grace period expires';
COMMENT ON COLUMN activations.status IS 'Activation status: active, revoked, or expired';

COMMENT ON COLUMN refunded_licenses.reason IS 'Reason for revocation (e.g., REFUND, CHARGEBACK, POLICY_VIOLATION)';
