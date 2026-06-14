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
  last_location_accuracy_m: number | null;
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
  /** Hint for KEY packets: inject as hardware keyboard KeyEvent on device */
  input_method?: "hardware_keyboard";
}

export interface SignalingTraceEntry {
  at: string;
  direction: "admin→device" | "device→admin" | "system";
  kind: string;
  channel: "websocket" | "http";
  detail: string;
}

export interface SignalingStatus {
  uid: string;
  remoteActive: boolean;
  offerSent: boolean;
  answerReceived: boolean;
  adminIceCount: number;
  deviceIceCount: number;
  deviceHttpPosts: number;
  lastActivityAt: string | null;
  trace: SignalingTraceEntry[];
  issues: string[];
  deviceWsConnected: boolean;
}
