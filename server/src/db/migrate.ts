import { pool } from "./pool.js";

const migrations = `
CREATE TABLE IF NOT EXISTS devices (
  uid TEXT PRIMARY KEY,
  serial TEXT,
  imei TEXT,
  device_name TEXT NOT NULL,
  model TEXT,
  phone_number TEXT,
  app_version TEXT,
  connection_secret TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lon DOUBLE PRECISION,
  last_battery REAL,
  last_is_charging BOOLEAN,
  last_telemetry_at TIMESTAMPTZ,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  remote_admin_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS device_events (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES devices(uid) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry_history (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES devices(uid) ON DELETE CASCADE,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  battery REAL,
  is_charging BOOLEAN,
  recorded_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_uid_recorded ON telemetry_history(uid, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_uid ON device_events(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_commands (
  id BIGSERIAL PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES devices(uid) ON DELETE CASCADE,
  command TEXT NOT NULL,
  connection_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_commands_uid ON pending_commands(uid, created_at ASC);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_location_accuracy_m REAL;
ALTER TABLE telemetry_history ADD COLUMN IF NOT EXISTS accuracy_m REAL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS agency TEXT;
ALTER TABLE pending_commands ADD COLUMN IF NOT EXISTS command_payload JSONB;
ALTER TABLE pending_commands DROP COLUMN IF EXISTS connection_secret;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_key TEXT;

CREATE TABLE IF NOT EXISTS enrollment_tokens (
  token TEXT PRIMARY KEY,
  description TEXT,
  agency TEXT,
  tls_pin_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'qr';
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS max_uses INTEGER;
ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS uses INTEGER NOT NULL DEFAULT 0;
`;

async function migrate() {
  await pool.query(migrations);
  console.log("Database migrations applied.");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
