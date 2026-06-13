import type { User } from "oidc-client-ts";
import type { ControlPacket, Device, DeviceCommand, SignalingStatus } from "../types";

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
  command: DeviceCommand
): Promise<{ delivery: "websocket" | "queued" }> {
  const data = await apiFetch<{ delivery: "websocket" | "queued" }>(
    `/api/admin/devices/${uid}/command`,
    user,
    {
      method: "POST",
      body: JSON.stringify({ command }),
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
