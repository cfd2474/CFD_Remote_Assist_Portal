import type { User } from "oidc-client-ts";
import type { ControlPacket, Device, DeviceCommand, LatestApkRelease, LocationHistoryPoint, PortalGithubConfig, SignalingStatus } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function apiFetch<T>(
  path: string,
  user: User | null | undefined,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };

  if (user?.access_token) {
    headers.Authorization = `Bearer ${user.access_token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchDevices(user: User): Promise<Device[]> {
  const data = await apiFetch<{ devices: Device[] }>("/api/admin/devices", user);
  return data.devices;
}

export async function fetchDevice(user: User, uid: string): Promise<Device> {
  const data = await apiFetch<{ device: Device }>(
    `/api/admin/devices/${uid}`,
    user
  );
  return data.device;
}

export async function sendCommand(
  user: User,
  uid: string,
  command: DeviceCommand,
  options?: { pin?: string }
): Promise<{ delivery: "websocket" | "queued" }> {
  const body: { command: DeviceCommand; pin?: string } = { command };
  if (options?.pin) {
    body.pin = options.pin;
  }

  const data = await apiFetch<{ delivery: "websocket" | "queued" }>(
    `/api/admin/devices/${uid}/command`,
    user,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return { delivery: data.delivery };
}

export async function sendControl(
  user: User,
  uid: string,
  packet: ControlPacket
): Promise<void> {
  await apiFetch(`/api/admin/devices/${uid}/control`, user, {
    method: "POST",
    body: JSON.stringify(packet),
  });
}

export async function removeDevice(user: User, uid: string): Promise<void> {
  await apiFetch(`/api/admin/devices/${uid}`, user, {
    method: "DELETE",
  });
}

export async function fetchSignalingStatus(
  user: User,
  uid: string
): Promise<SignalingStatus> {
  const data = await apiFetch<{ signaling: SignalingStatus }>(
    `/api/admin/devices/${uid}/signaling`,
    user
  );
  return data.signaling;
}

export async function fetchSignalingReplay(
  user: User,
  uid: string
): Promise<{ messages: Record<string, unknown>[] }> {
  return apiFetch<{ messages: Record<string, unknown>[] }>(
    `/api/admin/devices/${uid}/signaling/replay`,
    user
  );
}

export async function fetchReverseGeocode(
  user: User,
  lat: number,
  lon: number
): Promise<{ address: string }> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  return apiFetch<{ address: string }>(
    `/api/admin/geocode/reverse?${params}`,
    user
  );
}

export async function fetchLocationHistory(
  user: User,
  uid: string,
  fromAt: Date,
  toAt: Date,
  options?: { full?: boolean }
): Promise<LocationHistoryPoint[]> {
  const params = new URLSearchParams({
    from_at: fromAt.toISOString(),
    to_at: toAt.toISOString(),
  });
  if (options?.full) {
    params.set("full", "1");
  }
  const data = await apiFetch<{ points: LocationHistoryPoint[] }>(
    `/api/admin/devices/${uid}/location-history?${params}`,
    user
  );
  return data.points;
}

export async function fetchLatestApk(user: User): Promise<LatestApkRelease> {
  const data = await apiFetch<{ apk: LatestApkRelease }>(
    "/api/admin/app/latest-apk",
    user
  );
  return data.apk;
}

export async function fetchPortalGithubConfig(
  user: User
): Promise<PortalGithubConfig> {
  return apiFetch<PortalGithubConfig>("/api/admin/portal-config/github", user);
}

export async function applyPortalGithubToken(
  user: User,
  token: string
): Promise<PortalGithubConfig & { ok: true }> {
  return apiFetch<PortalGithubConfig & { ok: true }>(
    "/api/admin/portal-config/github",
    user,
    {
      method: "PUT",
      body: JSON.stringify({ token }),
    }
  );
}

export async function clearPortalGithubToken(
  user: User
): Promise<PortalGithubConfig & { ok: true }> {
  return apiFetch<PortalGithubConfig & { ok: true }>(
    "/api/admin/portal-config/github",
    user,
    { method: "DELETE" }
  );
}
