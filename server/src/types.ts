export interface DeviceRegistration {
  uid: string;
  serial?: string;
  imei?: string;
  device_name: string;
  model?: string;
  phone_number?: string;
  app_version?: string;
}

export interface TelemetryPayload {
  uid: string;
  lat?: number;
  lon?: number;
  battery?: number;
  timestamp?: number;
  is_charging?: boolean;
}

export interface DeviceEventPayload {
  uid: string;
  event: string;
  payload?: Record<string, unknown>;
}

export type DeviceCommand =
  | "TRIGGER_PING"
  | "REQUEST_LOCATION"
  | "START_REMOTE_ADMIN"
  | "STOP_REMOTE_ADMIN";

export interface ControlPacket {
  action: "CLICK" | "SWIPE" | "KEY";
  x_percent?: number;
  y_percent?: number;
  x2_percent?: number;
  y2_percent?: number;
  key?: string;
}

export interface DeviceRow {
  uid: string;
  serial: string | null;
  imei: string | null;
  device_name: string;
  model: string | null;
  phone_number: string | null;
  app_version: string | null;
  connection_secret: string;
  registered_at: Date;
  last_seen_at: Date | null;
  last_lat: number | null;
  last_lon: number | null;
  last_battery: number | null;
  last_is_charging: boolean | null;
  last_telemetry_at: Date | null;
  is_online: boolean;
  remote_admin_active: boolean;
}
