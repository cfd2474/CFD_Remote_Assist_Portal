import { Router, type Request, type Response } from "express";
import { requireDeviceSecret } from "../auth/device.js";
import {
  registerDevice,
  recordTelemetry,
  recordEvent,
  pingDevice,
  touchLastSeen,
} from "../services/devices.js";
import { drainCommands } from "../services/commands.js";
import {
  normalizeSignaling,
  describeSignaling,
  toWebRtcPayload,
  SIGNALING_HINT_PAYLOAD,
} from "../services/signalingNormalize.js";
import {
  drainPendingToDevice,
  setRemoteSessionActive,
} from "../services/signalingSession.js";
import { hub } from "../ws/hub.js";
import type { DeviceRegistration, TelemetryPayload, DeviceEventPayload } from "../types.js";

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function extractUid(input: Record<string, unknown>): string | undefined {
  const nested =
    input.device && typeof input.device === "object" && !Array.isArray(input.device)
      ? (input.device as Record<string, unknown>)
      : undefined;

  return firstString(
    input.uid,
    input.android_id,
    input.androidId,
    nested?.uid,
    nested?.android_id,
    nested?.androidId
  );
}

function mergeRequestInput(req: Request): Record<string, unknown> {
  return {
    ...(req.query as Record<string, unknown>),
    ...(req.body as Record<string, unknown>),
  };
}

function normalizeRegistration(
  input: Record<string, unknown> | undefined
): DeviceRegistration | null {
  if (!input) return null;

  const uid = extractUid(input);
  if (!uid) return null;

  const deviceName =
    firstString(
      input.device_name,
      input.deviceName,
      input.name,
      input.model
    ) ?? `Device-${uid.slice(-6)}`;

  return {
    uid,
    serial: firstString(input.serial),
    imei: firstString(input.imei),
    device_name: deviceName,
    model: firstString(input.model),
    agency: firstString(input.agency),
    phone_number: firstString(input.phone_number, input.phoneNumber),
    app_version: firstString(input.app_version, input.appVersion),
    enrollment_token: firstString(input.enrollment_token, input.token),
    public_key: firstString(input.public_key, input.publicKey),
  };
}

function extractPingUid(req: Request): string | undefined {
  const input = mergeRequestInput(req);
  return extractUid(input) ?? firstString(input.uid);
}

export const deviceApiRouter = Router();

deviceApiRouter.post("/register", async (req, res) => {
  const input = mergeRequestInput(req);
  const body = normalizeRegistration(input);

  if (!body) {
    console.log(
      `Device registration rejected: ip=${req.ip} content-type=${req.get("content-type") ?? "none"} keys=${JSON.stringify(Object.keys(input))}`
    );
    res.status(400).json({ error: "uid is required" });
    return;
  }

  try {
    const providedSecret = req.headers["x-connection-secret"] as string | undefined;
    console.log(`Device registration: uid=${body.uid} name=${body.device_name}`);
    const result = await registerDevice(body, providedSecret);
    res.status(result.is_new ? 201 : 200).json({
      uid: result.device.uid,
      connection_secret: result.connection_secret,
      tracking_server_url: process.env.PUBLIC_BASE_URL ?? "",
      message: result.is_new
        ? "Device registered. Store connection_secret in MDM managed config."
        : "Device re-registered.",
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes("enrollment_token") ||
      error.message.includes("enrollment token") ||
      error.message.includes("re-registration")
    )) {
      console.log(`Registration error: ${error.message}`);
      res.status(400).json({ error: error.message });
      return;
    }
    console.error(`Registration error:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

deviceApiRouter.post("/telemetry", requireDeviceSecret, async (req, res) => {
  const body = req.body as TelemetryPayload;

  if (!body?.uid) {
    res.status(400).json({ error: "uid is required" });
    return;
  }

  try {
    await recordTelemetry(body);
    const commands = await drainCommands(body.uid);
    const response: Record<string, unknown> = { ok: true, commands };
    if (commands.some((c) => c.command === "START_REMOTE_ADMIN")) {
      setRemoteSessionActive(body.uid, true);
      response.signaling_hint = SIGNALING_HINT_PAYLOAD;
    }
    res.json(response);
  } catch (err) {
    console.error("Telemetry error:", err);
    res.status(500).json({ error: "Failed to record telemetry" });
  }
});

async function handlePing(req: Request, res: Response): Promise<void> {
  const uid = extractPingUid(req);

  if (!uid) {
    res.status(400).json({ error: "uid is required" });
    return;
  }

  try {
    const device = await pingDevice(uid);
    if (!device) {
      console.log(`Device ping: uid=${uid} not recognized`);
      res.status(404).json({
        error: "Device not recognized",
        hint: "Call POST /api/v1/register to enroll this device.",
      });
      return;
    }
    console.log(`Device ping: uid=${uid} recognized`);
    res.json({
      ok: true,
      uid: device.uid,
      device_name: device.device_name,
    });
  } catch (err) {
    console.error("Ping error:", err);
    res.status(500).json({ error: "Ping failed" });
  }
}

deviceApiRouter.get("/ping", handlePing);
deviceApiRouter.post("/ping", handlePing);

deviceApiRouter.get("/commands", requireDeviceSecret, async (req, res) => {
  try {
    const uid = req.device!.uid;
    await touchLastSeen(uid);
    const commands = await drainCommands(uid);
    const response: Record<string, unknown> = { commands };
    if (commands.some((c) => c.command === "START_REMOTE_ADMIN")) {
      setRemoteSessionActive(uid, true);
      response.signaling_hint = SIGNALING_HINT_PAYLOAD;
      if (hub.isDeviceOnline(uid)) {
        hub.sendSignalingHint(uid);
      }
    }
    res.json(response);
  } catch (err) {
    console.error("Commands poll error:", err);
    res.status(500).json({ error: "Failed to fetch commands" });
  }
});

/** HTTP fallback: device polls admin offers/ICE when WebSocket signaling is missed */
deviceApiRouter.get("/signaling", requireDeviceSecret, async (req, res) => {
  try {
    const uid = req.device!.uid;
    await touchLastSeen(uid);
    const messages = drainPendingToDevice(uid).map((message) =>
      toWebRtcPayload(message)
    );
    res.json({
      messages,
      format_hint: SIGNALING_HINT_PAYLOAD.format,
    });
  } catch (err) {
    console.error("Signaling poll error:", err);
    res.status(500).json({ error: "Failed to fetch signaling messages" });
  }
});

/** HTTP fallback: device posts SDP answer and ICE candidates */
deviceApiRouter.post("/signaling", requireDeviceSecret, async (req, res) => {
  try {
    const uid = req.device!.uid;
    await touchLastSeen(uid);
    const body = req.body as Record<string, unknown>;
    const normalized = normalizeSignaling(body);

    if (!normalized) {
      console.log(
        `Signaling POST rejected: uid=${uid} body=${JSON.stringify(body).slice(0, 200)}`
      );
      res.status(400).json({
        error: "Not a recognized signaling message",
        accepted_formats: SIGNALING_HINT_PAYLOAD.format,
        received_keys: Object.keys(body),
      });
      return;
    }

    hub.ingestDeviceSignaling(uid, normalized);
    console.log(`Signaling POST accepted: uid=${uid} ${describeSignaling(body)}`);
    res.json({
      ok: true,
      accepted: describeSignaling(body),
    });
  } catch (err) {
    console.error("Signaling post error:", err);
    res.status(500).json({ error: "Failed to post signaling" });
  }
});

deviceApiRouter.post("/event", requireDeviceSecret, async (req, res) => {
  const body = req.body as DeviceEventPayload;

  if (!body?.uid || !body?.event) {
    res.status(400).json({ error: "uid and event are required" });
    return;
  }

  try {
    await recordEvent(body);
    hub.relayDeviceEvent(body.uid, {
      type: "device_event",
      uid: body.uid,
      event: body.event,
      payload: body.payload,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Event error:", err);
    res.status(500).json({ error: "Failed to record event" });
  }
});
