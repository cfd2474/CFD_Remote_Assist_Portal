export interface DeviceRegistration {
  uid: string;
  serial?: string;
  imei?: string;
  device_name: string;
  model?: string;
  agency?: string;
  phone_number?: string;
  app_version?: string;
}

export interface TelemetryPayload {
  uid: string;
  lat?: number;
  lon?: number;
  /** Horizontal GPS accuracy in meters (Android Location.getAccuracy()). */
  accuracy_m?: number;
  battery?: number;
  timestamp?: number;
  is_charging?: boolean;
}

export interface DeviceEventPayload {
  uid: string;
  event: string;
  payload?: Record<string, unknown>;
}

export interface LocationHistoryPoint {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  recorded_at: Date;
}

export interface SampledLocationPoint {
  number: number;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  recorded_at: string;
}

export type DeviceCommand =
  | "TRIGGER_PING"
  | "REQUEST_LOCATION"
  | "START_REMOTE_ADMIN"
  | "STOP_REMOTE_ADMIN"
  | "LOCK_DEVICE";

export interface ControlPacket {
  action: "CLICK" | "SWIPE" | "LONG_PRESS" | "KEY";
  x_percent?: number;
  y_percent?: number;
  x2_percent?: number;
  y2_percent?: number;
  /** Suggested gesture duration for device injection (ms). */
  duration_ms?: number;
  /** WebRTC frame width when touch was sent (portal metadata for Android scale checks). */
  stream_width?: number;
  /** WebRTC frame height when touch was sent (portal metadata for Android scale checks). */
  stream_height?: number;
  key?: string;
  input_method?: "hardware_keyboard";
}

export interface DeviceRow {
  uid: string;
  serial: string | null;
  imei: string | null;
  device_name: string;
  model: string | null;
  agency: string | null;
  phone_number: string | null;
  app_version: string | null;
  connection_secret: string;
  registered_at: Date;
  last_seen_at: Date | null;
  last_lat: number | null;
  last_lon: number | null;
  last_location_accuracy_m: number | null;
  last_battery: number | null;
  last_is_charging: boolean | null;
  last_telemetry_at: Date | null;
  is_online: boolean;
  remote_admin_active: boolean;
}
