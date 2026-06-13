import { WebSocket } from "ws";
import type { DeviceCommand, ControlPacket } from "../types.js";
import {
  setDeviceOnline,
  setRemoteAdminActive,
} from "../services/devices.js";

type ClientRole = "device" | "admin";

interface ConnectedClient {
  ws: WebSocket;
  role: ClientRole;
  uid?: string;
  adminSessionId?: string;
}

export class ConnectionHub {
  private devices = new Map<string, WebSocket>();
  private admins = new Map<string, Set<WebSocket>>();
  private clients = new WeakMap<WebSocket, ConnectedClient>();

  registerDevice(ws: WebSocket, uid: string): void {
    const existing = this.devices.get(uid);
    if (existing && existing !== ws) {
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

      const online = this.devices.has(watchUid);
      ws.send(JSON.stringify({ type: "device_status", uid: watchUid, online }));
    }
  }

  unregister(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    if (client.role === "device" && client.uid) {
      const current = this.devices.get(client.uid);
      if (current === ws) {
        this.devices.delete(client.uid);
        void setDeviceOnline(client.uid, false);
        void setRemoteAdminActive(client.uid, false);
        this.broadcastToAdmins(client.uid, {
          type: "device_status",
          uid: client.uid,
          online: false,
        });
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

  sendCommand(uid: string, command: DeviceCommand, secret: string): boolean {
    const ws = this.devices.get(uid);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(
      JSON.stringify({
        type: "command",
        command,
        connection_secret: secret,
      })
    );

    if (command === "START_REMOTE_ADMIN") {
      void setRemoteAdminActive(uid, true);
    } else if (command === "STOP_REMOTE_ADMIN") {
      void setRemoteAdminActive(uid, false);
    }

    return true;
  }

  sendControl(uid: string, packet: ControlPacket): boolean {
    const ws = this.devices.get(uid);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(JSON.stringify({ type: "control", ...packet }));
    return true;
  }

  relaySignaling(
    from: WebSocket,
    message: Record<string, unknown>
  ): void {
    const client = this.clients.get(from);
    if (!client?.uid) return;

    const targetUid = message.target_uid as string | undefined;
    const uid = targetUid ?? client.uid;

    if (client.role === "admin") {
      const deviceWs = this.devices.get(uid);
      if (deviceWs?.readyState === WebSocket.OPEN) {
        deviceWs.send(JSON.stringify({ type: "webrtc", ...message }));
      } else {
        console.log(`WebRTC relay dropped: device uid=${uid} not connected`);
      }
      return;
    }

    if (client.role === "device") {
      const adminSet = this.admins.get(uid);
      if (!adminSet?.size) {
        console.log(`WebRTC relay dropped: no admin watching uid=${uid}`);
      }
      adminSet?.forEach((adminWs) => {
        if (adminWs.readyState === WebSocket.OPEN) {
          adminWs.send(JSON.stringify({ type: "webrtc", ...message }));
        }
      });
    }
  }

  relayDeviceEvent(uid: string, event: Record<string, unknown>): void {
    this.broadcastToAdmins(uid, { type: "device_event", uid, ...event });
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
