export interface Device {
  uid: string;
  serial: string | null;
  imei: string | null;
  device_name: string;
  model: string | null;
  phone_number: string | null;
  app_version: string | null;
  registered_at: string;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lon: number | null;
  last_battery: number | null;
  last_is_charging: boolean | null;
  last_telemetry_at: string | null;
  is_online: boolean;
  remote_admin_active: boolean;
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
