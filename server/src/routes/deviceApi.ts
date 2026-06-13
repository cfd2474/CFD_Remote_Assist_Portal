import { Router, type Request, type Response } from "express";
import { requireDeviceSecret } from "../auth/device.js";
import {
  registerDevice,
  recordTelemetry,
  recordEvent,
  pingDevice,
} from "../services/devices.js";
import type { DeviceRegistration, TelemetryPayload, DeviceEventPayload } from "../types.js";

export const deviceApiRouter = Router();

deviceApiRouter.post("/register", async (req, res) => {
  const body = req.body as DeviceRegistration;

  if (!body?.uid || !body?.device_name) {
    res.status(400).json({ error: "uid and device_name are required" });
    return;
  }

  try {
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
      res.status(404).json({ error: "Device not recognized" });
      return;
    }
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
