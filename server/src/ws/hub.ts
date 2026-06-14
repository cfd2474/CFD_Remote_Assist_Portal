import { WebSocket } from "ws";
import type { DeviceCommand, ControlPacket } from "../types.js";
import {
  setDeviceOnline,
  setRemoteAdminActive,
} from "../services/devices.js";
import { formatCommandForDevice } from "../services/commands.js";
import type { CommandDeliveryOptions } from "../services/commands.js";
import {
  normalizeSignaling,
  SIGNALING_HINT_PAYLOAD,
} from "../services/signalingNormalize.js";
import type { NormalizedSignaling } from "../services/signalingNormalize.js";
import {
  recordAdminToDevice,
  recordDeviceToAdmin,
  recordHintSent,
  setRemoteSessionActive,
  getSignalingStatus,
  getSignalingReplay,
} from "../services/signalingSession.js";

type ClientRole = "device" | "admin";

interface ConnectedClient {
  ws: WebSocket;
  role: ClientRole;
  uid?: string;
  adminSessionId?: string;
}

function toWebRtcPayload(message: NormalizedSignaling): Record<string, unknown> {
  const payload: Record<string, unknown> = { type: "webrtc" };
  if (message.sdp) payload.sdp = message.sdp;
  if (message.ice) payload.ice = message.ice;
  return payload;
}

export class ConnectionHub {
  private devices = new Map<string, WebSocket>();
  private admins = new Map<string, Set<WebSocket>>();
  private clients = new WeakMap<WebSocket, ConnectedClient>();
  private offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly OFFLINE_GRACE_MS = 8_000;

  registerDevice(ws: WebSocket, uid: string): void {
    const pendingOffline = this.offlineTimers.get(uid);
    if (pendingOffline) {
      clearTimeout(pendingOffline);
      this.offlineTimers.delete(uid);
    }

    const existing = this.devices.get(uid);
    const replacing = existing && existing !== ws;

    if (replacing) {
      console.log(`Device WebSocket replaced: uid=${uid} (keeping remote session)`);
      existing.close(4000, "Replaced by new connection");
    }

    this.devices.set(uid, ws);
    this.clients.set(ws, { ws, role: "device", uid });
    void setDeviceOnline(uid, true);

    this.broadcastToAdmins(uid, { type: "device_status", uid, online: true });
  }

  registerAdmin(ws: WebSocket, sessionId: string, watchUid?: string): void {
    this.clients.set(ws, { ws, role: "admin", adminSessionId: sessionId, uid: watchUid });

    if (watchUid) {
      if (!this.admins.has(watchUid)) {
        this.admins.set(watchUid, new Set());
      }
      this.admins.get(watchUid)!.add(ws);

      const online = this.isDeviceOnline(watchUid);
      ws.send(JSON.stringify({ type: "device_status", uid: watchUid, online }));
      this.sendSignalingStatus(watchUid);

      for (const message of getSignalingReplay(watchUid)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(toWebRtcPayload(message)));
        }
      }
    }
  }

  unregister(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    if (client.role === "device" && client.uid) {
      const uid = client.uid;
      const current = this.devices.get(uid);
      if (current === ws) {
        this.devices.delete(uid);

        const existing = this.offlineTimers.get(uid);
        if (existing) clearTimeout(existing);

        this.offlineTimers.set(
          uid,
          setTimeout(() => {
            this.offlineTimers.delete(uid);
            if (this.isDeviceOnline(uid)) return;

            console.log(`Device WebSocket offline: uid=${uid} (grace elapsed)`);
            void setDeviceOnline(uid, false);

            const session = getSignalingStatus(uid);
            if (!session.remoteActive) {
              void setRemoteAdminActive(uid, false);
            }

            this.broadcastToAdmins(uid, {
              type: "device_status",
              uid,
              online: false,
            });
          }, ConnectionHub.OFFLINE_GRACE_MS)
        );
      }
    }

    if (client.role === "admin" && client.uid) {
      const set = this.admins.get(client.uid);
      set?.delete(ws);
      if (set?.size === 0) {
        this.admins.delete(client.uid);
      }
    }

    this.clients.delete(ws);
  }

  sendCommand(
    uid: string,
    command: DeviceCommand,
    secret: string,
    options?: CommandDeliveryOptions
  ): boolean {
    const ws = this.devices.get(uid);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(JSON.stringify(formatCommandForDevice(command, secret, options)));

    console.log(`Command sent via WebSocket: uid=${uid} command=${command}`);

    if (command === "START_REMOTE_ADMIN") {
      void setRemoteAdminActive(uid, true);
      setRemoteSessionActive(uid, true);
      this.sendSignalingHint(uid);
    } else if (command === "STOP_REMOTE_ADMIN" || command === "LOCK_DEVICE") {
      void setRemoteAdminActive(uid, false);
      setRemoteSessionActive(uid, false);
    }

    return true;
  }

  sendSignalingHint(uid: string): void {
    const ws = this.devices.get(uid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify(SIGNALING_HINT_PAYLOAD));
    recordHintSent(uid);
    this.sendSignalingStatus(uid);
    console.log(`Signaling hint sent: uid=${uid}`);
  }

  sendControl(uid: string, packet: ControlPacket): boolean {
    const ws = this.devices.get(uid);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(JSON.stringify({ type: "control", ...packet }));
    if (packet.action === "KEY") {
      console.log(`Control KEY uid=${uid} key=${packet.key ?? "?"}`);
    }
    return true;
  }

  ingestDeviceSignaling(uid: string, message: NormalizedSignaling): void {
    recordDeviceToAdmin(uid, message, "http");
    const payload = toWebRtcPayload(message);
    this.broadcastToAdmins(uid, payload);

    const kind = message.sdp?.type ?? "ice";
    console.log(`WebRTC ingest device→admin uid=${uid} kind=${kind} channel=http`);

    this.sendSignalingStatus(uid);
  }

  relaySignaling(from: WebSocket, message: Record<string, unknown>): void {
    const client = this.clients.get(from);
    if (!client?.uid) return;

    const normalized = normalizeSignaling(message);
    if (!normalized) return;

    const targetUid = message.target_uid as string | undefined;
    const uid = targetUid ?? client.uid;
    const payload = toWebRtcPayload(normalized);
    const kind = normalized.sdp?.type ?? "ice";

    if (client.role === "admin") {
      const deviceWs = this.devices.get(uid);
      const wsDelivered = deviceWs?.readyState === WebSocket.OPEN;

      recordAdminToDevice(uid, normalized, "websocket", {
        queueForPoll: !wsDelivered,
      });

      if (wsDelivered) {
        deviceWs!.send(JSON.stringify(payload));
        console.log(`WebRTC relay admin→device uid=${uid} kind=${kind}`);
      } else {
        console.log(
          `WebRTC relay dropped: device uid=${uid} not connected (queued for GET /api/v1/signaling)`
        );
      }
      this.sendSignalingStatus(uid);
      return;
    }

    if (client.role === "device") {
      recordDeviceToAdmin(uid, normalized, "websocket");

      const adminSet = this.admins.get(uid);
      if (!adminSet?.size) {
        console.log(`WebRTC relay dropped: no admin watching uid=${uid}`);
      }
      adminSet?.forEach((adminWs) => {
        if (adminWs.readyState === WebSocket.OPEN) {
          adminWs.send(JSON.stringify(payload));
          console.log(`WebRTC relay device→admin uid=${uid} kind=${kind}`);
        }
      });
      this.sendSignalingStatus(uid);
    }
  }

  relayDeviceEvent(uid: string, event: Record<string, unknown>): void {
    this.broadcastToAdmins(uid, { type: "device_event", uid, ...event });
  }

  sendSignalingStatus(uid: string): void {
    this.broadcastToAdmins(uid, {
      type: "signaling_status",
      ...getSignalingStatus(uid),
      deviceWsConnected: this.isDeviceOnline(uid),
    });
  }

  private broadcastToAdmins(uid: string, payload: Record<string, unknown>): void {
    const set = this.admins.get(uid);
    const message = JSON.stringify(payload);
    set?.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  isDeviceOnline(uid: string): boolean {
    const ws = this.devices.get(uid);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  getClientUid(ws: WebSocket): string | undefined {
    return this.clients.get(ws)?.uid;
  }

  disconnectDevice(uid: string): void {
    const ws = this.devices.get(uid);
    if (ws) {
      ws.close(4001, "Device removed from portal");
    }
    this.broadcastToAdmins(uid, { type: "device_removed", uid });
    this.admins.delete(uid);
  }
}

export const hub = new ConnectionHub();
