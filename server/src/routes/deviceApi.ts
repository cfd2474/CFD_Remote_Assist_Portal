import { Router, type Request, type Response } from "express";
import { requireDeviceSecret } from "../auth/device.js";
import {
  registerDevice,
  recordTelemetry,
  recordEvent,
  pingDevice,
} from "../services/devices.js";
import type { DeviceRegistration, TelemetryPayload, DeviceEventPayload } from "../types.js";

function normalizeRegistration(
  body: Record<string, unknown> | undefined
): DeviceRegistration | null {
  if (!body?.uid || typeof body.uid !== "string") return null;

  const deviceName =
    (typeof body.device_name === "string" && body.device_name) ||
    (typeof body.deviceName === "string" && body.deviceName) ||
    (typeof body.name === "string" && body.name) ||
    (typeof body.model === "string" && body.model) ||
    `Device-${body.uid.slice(-6)}`;

  return {
    uid: body.uid,
    serial: typeof body.serial === "string" ? body.serial : undefined,
    imei: typeof body.imei === "string" ? body.imei : undefined,
    device_name: deviceName,
    model: typeof body.model === "string" ? body.model : undefined,
    phone_number:
      typeof body.phone_number === "string"
        ? body.phone_number
        : typeof body.phoneNumber === "string"
          ? body.phoneNumber
          : undefined,
    app_version:
      typeof body.app_version === "string"
        ? body.app_version
        : typeof body.appVersion === "string"
          ? body.appVersion
          : undefined,
  };
}

export const deviceApiRouter = Router();

deviceApiRouter.post("/register", async (req, res) => {
  const body = normalizeRegistration(req.body as Record<string, unknown>);

  if (!body) {
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
    res.json({ ok: true });
  } catch (err) {
    console.error("Telemetry error:", err);
    res.status(500).json({ error: "Failed to record telemetry" });
  }
});

async function handlePing(req: Request, res: Response): Promise<void> {
  const uid =
    req.method === "GET"
      ? (req.query.uid as string | undefined)
      : (req.body as { uid?: string } | undefined)?.uid;

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
