import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { pool } from "../db/pool.js";
import type { DeviceRow } from "../types.js";
import { hub } from "./hub.js";
import { config } from "../config.js";
import { drainCommands } from "../services/commands.js";

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

function isWebRtcSignaling(message: Record<string, unknown>): boolean {
  if (message.type === "webrtc") return true;
  if (message.sdp || message.ice || message.candidate) return true;
  const signal = message.signal as string | undefined;
  return signal === "offer" || signal === "answer" || signal === "ice";
}

function normalizeWebRtcMessage(
  message: Record<string, unknown>
): Record<string, unknown> {
  if (message.type === "webrtc") return message;
  return { type: "webrtc", ...message };
}

function summarizeDeviceMessage(message: Record<string, unknown>): string {
  if (message.type === "webrtc" || message.sdp || message.ice) {
    const sdp = message.sdp as { type?: string } | undefined;
    if (sdp?.type) return `webrtc sdp=${sdp.type}`;
    if (message.ice || message.candidate) return "webrtc ice";
    return "webrtc";
  }
  return `type=${String(message.type ?? "unknown")} keys=${Object.keys(message).join(",")}`;
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
        console.log(`Device WS message: ${summarizeDeviceMessage(message)}`);
      }

      if (isWebRtcSignaling(message)) {
        hub.relaySignaling(ws, normalizeWebRtcMessage(message));
        return;
      }

      if (message.type === "device_event") {
        const clientUid = (message.uid as string) ?? "";
        hub.relayDeviceEvent(clientUid, message);
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
