import { Router, type Request, type Response } from "express";
import { requireDeviceSecret } from "../auth/device.js";
import {
  registerDevice,
  recordTelemetry,
  recordEvent,
  pingDevice,
} from "../services/devices.js";
import { drainCommands } from "../services/commands.js";
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
    phone_number: firstString(input.phone_number, input.phoneNumber),
    app_version: firstString(input.app_version, input.appVersion),
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
    console.log(`Device registration: uid=${body.uid} name=${body.device_name}`);
    const result = await registerDevice(body);
    res.status(result.is_new ? 201 : 200).json({
      uid: result.device.uid,
      connection_secret: result.connection_secret,
      tracking_server_url: process.env.PUBLIC_BASE_URL ?? "",
      message: result.is_new
        ? "Device registered. Store connection_secret in MDM managed config."
        : "Device re-registered.",
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
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
    res.json({ ok: true, commands });
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
    const commands = await drainCommands(uid);
    res.json({ commands });
  } catch (err) {
    console.error("Commands poll error:", err);
    res.status(500).json({ error: "Failed to fetch commands" });
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
    res.json({ ok: true });
  } catch (err) {
    console.error("Event error:", err);
    res.status(500).json({ error: "Failed to record event" });
  }
});
