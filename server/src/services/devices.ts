import { randomBytes } from "crypto";
import { pool } from "../db/pool.js";
import type {
  DeviceRegistration,
  DeviceRow,
  TelemetryPayload,
  DeviceEventPayload,
} from "../types.js";

function generateConnectionSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function registerDevice(
  data: DeviceRegistration
): Promise<{ device: DeviceRow; connection_secret: string; is_new: boolean }> {
  const existing = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE uid = $1",
    [data.uid]
  );

  if (existing.rows.length > 0) {
    const device = existing.rows[0];
    await pool.query(
      `UPDATE devices SET
        serial = COALESCE($2, serial),
        imei = COALESCE($3, imei),
        device_name = $4,
        model = COALESCE($5, model),
        phone_number = COALESCE($6, phone_number),
        app_version = COALESCE($7, app_version),
        last_seen_at = NOW()
      WHERE uid = $1`,
      [
        data.uid,
        data.serial ?? null,
        data.imei ?? null,
        data.device_name,
        data.model ?? null,
        data.phone_number ?? null,
        data.app_version ?? null,
      ]
    );
    const updated = await pool.query<DeviceRow>(
      "SELECT * FROM devices WHERE uid = $1",
      [data.uid]
    );
    return {
      device: updated.rows[0],
      connection_secret: device.connection_secret,
      is_new: false,
    };
  }

  const connection_secret = generateConnectionSecret();
  const result = await pool.query<DeviceRow>(
    `INSERT INTO devices (
      uid, serial, imei, device_name, model, phone_number, app_version,
      connection_secret, last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *`,
    [
      data.uid,
      data.serial ?? null,
      data.imei ?? null,
      data.device_name,
      data.model ?? null,
      data.phone_number ?? null,
      data.app_version ?? null,
      connection_secret,
    ]
  );

  return {
    device: result.rows[0],
    connection_secret,
    is_new: true,
  };
}

export async function recordTelemetry(data: TelemetryPayload): Promise<void> {
  const recordedAt = data.timestamp
    ? new Date(data.timestamp)
    : new Date();

  await pool.query(
    `UPDATE devices SET
      last_lat = COALESCE($2, last_lat),
      last_lon = COALESCE($3, last_lon),
      last_battery = COALESCE($4, last_battery),
      last_is_charging = COALESCE($5, last_is_charging),
      last_telemetry_at = $6,
      last_seen_at = NOW()
    WHERE uid = $1`,
    [
      data.uid,
      data.lat ?? null,
      data.lon ?? null,
      data.battery ?? null,
      data.is_charging ?? null,
      recordedAt,
    ]
  );

  await pool.query(
    `INSERT INTO telemetry_history (uid, lat, lon, battery, is_charging, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.uid,
      data.lat ?? null,
      data.lon ?? null,
      data.battery ?? null,
      data.is_charging ?? null,
      recordedAt,
    ]
  );
}

export async function recordEvent(data: DeviceEventPayload): Promise<void> {
  await pool.query(
    `INSERT INTO device_events (uid, event, payload) VALUES ($1, $2, $3)`,
    [data.uid, data.event, data.payload ? JSON.stringify(data.payload) : null]
  );

  await pool.query(
    "UPDATE devices SET last_seen_at = NOW() WHERE uid = $1",
    [data.uid]
  );
}

export async function listDevices(): Promise<DeviceRow[]> {
  const result = await pool.query<DeviceRow>(
    "SELECT * FROM devices ORDER BY device_name ASC"
  );
  return result.rows;
}

export async function getDevice(uid: string): Promise<DeviceRow | null> {
  const result = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE uid = $1",
    [uid]
  );
  return result.rows[0] ?? null;
}

export async function pingDevice(uid: string): Promise<DeviceRow | null> {
  const device = await getDevice(uid);
  if (!device) return null;

  await pool.query(
    "UPDATE devices SET last_seen_at = NOW() WHERE uid = $1",
    [uid]
  );
  return device;
}

export async function deleteDevice(uid: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM devices WHERE uid = $1", [uid]);
  return (result.rowCount ?? 0) > 0;
}

export async function setDeviceOnline(uid: string, online: boolean): Promise<void> {
  await pool.query(
    "UPDATE devices SET is_online = $2, last_seen_at = NOW() WHERE uid = $1",
    [uid, online]
  );
}

export async function touchLastSeen(uid: string): Promise<void> {
  await pool.query("UPDATE devices SET last_seen_at = NOW() WHERE uid = $1", [uid]);
}

/** In-memory WebSocket registry is lost on restart; clear stale flags. */
export async function resetLiveSessionFlags(): Promise<void> {
  await pool.query(
    "UPDATE devices SET is_online = false, remote_admin_active = false"
  );
}

export async function setRemoteAdminActive(
  uid: string,
  active: boolean
): Promise<void> {
  await pool.query(
    "UPDATE devices SET remote_admin_active = $2 WHERE uid = $1",
    [uid, active]
  );
}

export async function getTelemetryHistory(
  uid: string,
  limit = 50
): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT lat, lon, battery, is_charging, recorded_at
     FROM telemetry_history WHERE uid = $1
     ORDER BY recorded_at DESC LIMIT $2`,
    [uid, limit]
  );
  return result.rows;
}

export async function getDeviceEvents(uid: string, limit = 50): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT event, payload, created_at
     FROM device_events WHERE uid = $1
     ORDER BY created_at DESC LIMIT $2`,
    [uid, limit]
  );
  return result.rows;
}
