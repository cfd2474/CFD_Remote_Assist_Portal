import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { pool } from "../db/pool.js";
import type { DeviceRow } from "../types.js";
import { hub } from "./hub.js";
import { config } from "../config.js";
import { drainCommands } from "../services/commands.js";
import {
  isSignalingMessage,
  describeSignaling,
  SIGNALING_HINT_PAYLOAD,
} from "../services/signalingNormalize.js";
import {
  recordUnrecognizedDeviceMessage,
  setRemoteSessionActive,
} from "../services/signalingSession.js";

interface DeviceAuthMessage {
  type: "auth";
  uid: string;
  connection_secret: string;
}

interface AdminAuthMessage {
  type: "auth";
  role: "admin";
  uid: string;
  token: string;
}

function previewMessage(message: Record<string, unknown>): string {
  const text = JSON.stringify(message);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

async function verifyDevice(uid: string, secret: string): Promise<DeviceRow | null> {
  const result = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE uid = $1 AND connection_secret = $2",
    [uid, secret]
  );
  return result.rows[0] ?? null;
}

async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(config.oidc.jwksUri));
    await jwtVerify(token, jwks, {
      issuer: config.oidc.issuer,
      ...(config.oidc.audience ? { audience: config.oidc.audience } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

function isDeviceEvent(message: Record<string, unknown>): boolean {
  if (message.type === "device_event") return true;
  return typeof message.event === "string" && typeof message.uid === "string";
}

export function attachWebSocketHandlers(
  wss: WebSocketServer,
  path: "/ws/device" | "/ws/admin"
): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, "Authentication timeout");
      }
    }, 10000);

    ws.on("message", async (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (!authenticated) {
        if (path === "/ws/device") {
          const auth = message as unknown as DeviceAuthMessage;
          if (auth.type !== "auth" || !auth.uid || !auth.connection_secret) {
            ws.close(4003, "Device auth required");
            return;
          }

          const device = await verifyDevice(auth.uid, auth.connection_secret);
          if (!device) {
            ws.close(4003, "Invalid credentials");
            return;
          }

          console.log(`Device WebSocket connected: uid=${auth.uid} ip=${req.socket.remoteAddress}`);
          authenticated = true;
          clearTimeout(authTimeout);
          hub.registerDevice(ws, auth.uid);
          ws.send(JSON.stringify({ type: "auth_ok", uid: auth.uid }));

          const pending = await drainCommands(auth.uid);
          for (const command of pending) {
            ws.send(JSON.stringify(command));
            if (command.command === "START_REMOTE_ADMIN") {
              setRemoteSessionActive(auth.uid, true);
              hub.sendSignalingHint(auth.uid);
            }
          }
          if (pending.length > 0) {
            console.log(`WebSocket delivered ${pending.length} queued command(s) to uid=${auth.uid}`);
          }
          return;
        }

        if (path === "/ws/admin") {
          const auth = message as unknown as AdminAuthMessage;
          if (
            auth.type !== "auth" ||
            auth.role !== "admin" ||
            !auth.token ||
            !auth.uid
          ) {
            ws.close(4003, "Admin auth required");
            return;
          }

          const valid = await verifyAdminToken(auth.token);
          if (!valid) {
            ws.close(4003, "Invalid token");
            return;
          }

          authenticated = true;
          clearTimeout(authTimeout);
          hub.registerAdmin(ws, auth.token.slice(0, 16), auth.uid);
          ws.send(JSON.stringify({ type: "auth_ok", uid: auth.uid }));
          return;
        }
      }

      if (!authenticated) return;

      if (path === "/ws/device") {
        const uid = hub.getClientUid(ws);
        const summary = describeSignaling(message);
        console.log(`Device WS message: ${summary}`);

        if (
          !isSignalingMessage(message) &&
          !isDeviceEvent(message) &&
          message.type !== "webrtc_ready" &&
          message.type !== "ping"
        ) {
          if (uid) {
            recordUnrecognizedDeviceMessage(
              uid,
              `type=${String(message.type ?? "?")} ${previewMessage(message)}`
            );
            hub.sendSignalingStatus(uid);
          }
          console.log(
            `Device WS unrecognized: type=${String(message.type ?? "?")} ${previewMessage(message)}`
          );
        }
      }

      if (isSignalingMessage(message)) {
        hub.relaySignaling(ws, message);
        return;
      }

      if (isDeviceEvent(message)) {
        const clientUid =
          (message.uid as string) ?? hub.getClientUid(ws) ?? "";
        hub.relayDeviceEvent(clientUid, {
          type: "device_event",
          uid: clientUid,
          event: message.event,
          payload: message.payload,
        });
        return;
      }

      if (message.type === "webrtc_ready") {
        const client = hub.getClientUid(ws);
        if (client) {
          console.log(`Device WebRTC ready: uid=${client}`);
          hub.relayDeviceEvent(client, {
            event: "WEBRTC_READY",
            uid: client,
          });
          hub.sendSignalingStatus(client);
        }
        return;
      }

      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      hub.unregister(ws);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      hub.unregister(ws);
    });
  });
}
