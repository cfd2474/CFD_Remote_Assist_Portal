import { Router } from "express";
import { requireAdmin } from "../auth/oidc.js";
import {
  listDevices,
  getDevice,
  getTelemetryHistory,
  getLocationHistory,
  getLocationHistoryFull,
  getDeviceEvents,
  deleteDevice,
  setRemoteAdminActive,
} from "../services/devices.js";
import { hub } from "../ws/hub.js";
import { queueCommand } from "../services/commands.js";
import { setRemoteSessionActive, getSignalingStatus, getSignalingReplay } from "../services/signalingSession.js";
import { reverseGeocode } from "../services/geocode.js";
import { getLatestApkRelease } from "../services/githubReleases.js";
import {
  clearPortalGithubToken,
  getPortalConfigStatus,
  setPortalGithubToken,
  validateGithubToken,
  getGithubApkRepo,
} from "../services/portalSettings.js";
import { resolveModelDisplays, getModelDisplay } from "../services/phoneDb.js";
import type { ControlPacket, DeviceCommand } from "../types.js";
import crypto from "crypto";

export const adminApiRouter = Router();

function encryptPin(pin: string, publicKeyBase64: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(pin, "utf8")
  );
  return encrypted.toString("base64");
}

adminApiRouter.use(requireAdmin);

adminApiRouter.get("/devices", async (_req, res) => {
  try {
    const devices = await listDevices();
    const sanitized = devices.map((d) => ({
      uid: d.uid,
      serial: d.serial,
      imei: d.imei,
      device_name: d.device_name,
      model: d.model,
      agency: d.agency,
      phone_number: d.phone_number,
      app_version: d.app_version,
      registered_at: d.registered_at,
      last_seen_at: d.last_seen_at,
      last_lat: d.last_lat,
      last_lon: d.last_lon,
      last_location_accuracy_m: d.last_location_accuracy_m,
      last_battery: d.last_battery,
      last_is_charging: d.last_is_charging,
      last_telemetry_at: d.last_telemetry_at,
      is_online: hub.isDeviceOnline(d.uid),
      remote_admin_active: d.remote_admin_active,
    }));
    const modelDisplays = await resolveModelDisplays(
      sanitized.map((device) => device.model)
    );
    res.json({
      devices: sanitized.map((device) => ({
        ...device,
        model_display:
          (device.model && modelDisplays.get(device.model)) ||
          device.model ||
          "—",
      })),
    });
  } catch (err) {
    console.error("List devices error:", err);
    res.status(500).json({ error: "Failed to list devices" });
  }
});

adminApiRouter.get("/devices/:uid", async (req, res) => {
  try {
    const device = await getDevice(req.params.uid);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const { connection_secret: _, ...sanitized } = device;
    const model_display = await getModelDisplay(sanitized.model);
    res.json({
      device: {
        ...sanitized,
        is_online: hub.isDeviceOnline(sanitized.uid),
        model_display,
      },
    });
  } catch (err) {
    console.error("Get device error:", err);
    res.status(500).json({ error: "Failed to get device" });
  }
});

adminApiRouter.get("/devices/:uid/telemetry", async (req, res) => {
  try {
    const history = await getTelemetryHistory(req.params.uid);
    res.json({ telemetry: history });
  } catch (err) {
    console.error("Telemetry history error:", err);
    res.status(500).json({ error: "Failed to get telemetry history" });
  }
});

adminApiRouter.get("/devices/:uid/location-history", async (req, res) => {
  const fromAtRaw = req.query.from_at as string | undefined;
  const toAtRaw = req.query.to_at as string | undefined;

  if (!fromAtRaw || !toAtRaw) {
    res.status(400).json({ error: "from_at and to_at are required ISO timestamps" });
    return;
  }

  const fromAt = new Date(fromAtRaw);
  const toAt = new Date(toAtRaw);

  if (Number.isNaN(fromAt.getTime()) || Number.isNaN(toAt.getTime())) {
    res.status(400).json({ error: "Invalid from_at or to_at" });
    return;
  }

  if (toAt.getTime() > fromAt.getTime()) {
    res.status(400).json({ error: "to_at must be on or before from_at" });
    return;
  }

  try {
    const device = await getDevice(req.params.uid);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    const fullHistory = req.query.full === "1" || req.query.full === "true";
    const points = fullHistory
      ? await getLocationHistoryFull(req.params.uid, fromAt, toAt)
      : await getLocationHistory(req.params.uid, fromAt, toAt);
    res.json({ points });
  } catch (err) {
    console.error("Location history error:", err);
    res.status(500).json({ error: "Failed to get location history" });
  }
});

adminApiRouter.get("/devices/:uid/events", async (req, res) => {
  try {
    const events = await getDeviceEvents(req.params.uid);
    res.json({ events });
  } catch (err) {
    console.error("Events history error:", err);
    res.status(500).json({ error: "Failed to get events" });
  }
});

adminApiRouter.post("/devices/:uid/command", async (req, res) => {
  const command = req.body?.command as DeviceCommand;
  const valid: DeviceCommand[] = [
    "TRIGGER_PING",
    "REQUEST_LOCATION",
    "START_REMOTE_ADMIN",
    "STOP_REMOTE_ADMIN",
    "LOCK_DEVICE",
    "RESYNC_DEVICE_INFO",
    "REMOTE_UNLOCK",
  ];

  if (!valid.includes(command)) {
    res.status(400).json({ error: "Invalid command" });
    return;
  }

  const pin =
    typeof req.body?.pin === "string" ? req.body.pin.trim() : undefined;

  if (command === "REMOTE_UNLOCK") {
    if (!pin) {
      res.status(400).json({ error: "pin is required for REMOTE_UNLOCK" });
      return;
    }
  } else if (pin) {
    res.status(400).json({ error: "pin is only valid for REMOTE_UNLOCK" });
    return;
  }

  try {
    const device = await getDevice(req.params.uid);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    let commandOptions: { pin?: string } | undefined = undefined;
    if (pin && command === "REMOTE_UNLOCK") {
      if (!device.public_key) {
        res.status(400).json({ error: "Device has no registered public key for E2EE" });
        return;
      }
      commandOptions = { pin: encryptPin(pin, device.public_key) };
    }

    const sent = hub.sendCommand(
      req.params.uid,
      command,
      commandOptions
    );

    if (command === "START_REMOTE_ADMIN") {
      await setRemoteAdminActive(req.params.uid, true);
      setRemoteSessionActive(req.params.uid, true);
    } else if (command === "STOP_REMOTE_ADMIN" || command === "LOCK_DEVICE") {
      await setRemoteAdminActive(req.params.uid, false);
      setRemoteSessionActive(req.params.uid, false);
    }

    if (!sent) {
      await queueCommand(
        req.params.uid,
        command,
        commandOptions
      );
      res.json({
        ok: true,
        command,
        delivery: "queued",
        hint: "Device is not on WebSocket. Command queued for next telemetry or poll.",
      });
      return;
    }

    res.json({ ok: true, command, delivery: "websocket" });
  } catch (err) {
    console.error("Command error:", err);
    res.status(500).json({ error: "Failed to send command" });
  }
});

adminApiRouter.get("/devices/:uid/signaling", async (req, res) => {
  try {
    res.json({
      signaling: {
        ...getSignalingStatus(req.params.uid),
        deviceWsConnected: hub.isDeviceOnline(req.params.uid),
      },
    });
  } catch (err) {
    console.error("Signaling status error:", err);
    res.status(500).json({ error: "Failed to get signaling status" });
  }
});

adminApiRouter.get("/devices/:uid/signaling/replay", async (req, res) => {
  try {
    const messages = getSignalingReplay(req.params.uid).map((message) => {
      const payload: Record<string, unknown> = { type: "webrtc" };
      if (message.sdp) payload.sdp = message.sdp;
      if (message.ice) payload.ice = message.ice;
      return payload;
    });
    res.json({ messages });
  } catch (err) {
    console.error("Signaling replay error:", err);
    res.status(500).json({ error: "Failed to get signaling replay" });
  }
});

adminApiRouter.post("/devices/:uid/control", async (req, res) => {
  const packet = req.body as ControlPacket;

  if (!packet?.action) {
    res.status(400).json({ error: "action is required" });
    return;
  }

  try {
    const sent = hub.sendControl(req.params.uid, packet);
    if (!sent) {
      res.status(409).json({ error: "Device is not connected" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Control error:", err);
    res.status(500).json({ error: "Failed to send control packet" });
  }
});

adminApiRouter.delete("/devices/:uid", async (req, res) => {
  try {
    const device = await getDevice(req.params.uid);
    if (!device) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    hub.disconnectDevice(req.params.uid);
    const removed = await deleteDevice(req.params.uid);
    if (!removed) {
      res.status(404).json({ error: "Device not found" });
      return;
    }

    res.json({ ok: true, uid: req.params.uid });
  } catch (err) {
    console.error("Delete device error:", err);
    res.status(500).json({ error: "Failed to remove device" });
  }
});

adminApiRouter.get("/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: "Invalid lat or lon" });
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: "lat or lon out of range" });
    return;
  }

  try {
    const address = await reverseGeocode(lat, lon);
    if (!address) {
      res.status(502).json({ error: "Reverse geocode failed" });
      return;
    }
    res.json({ address });
  } catch (err) {
    console.error("Reverse geocode error:", err);
    res.status(500).json({ error: "Reverse geocode failed" });
  }
});

adminApiRouter.get("/me", (req, res) => {
  res.json({
    user: {
      email: req.adminUser?.email,
      username: req.adminUser?.preferred_username,
      name: req.adminUser?.name,
    },
  });
});

adminApiRouter.get("/app/latest-apk", async (_req, res) => {
  try {
    const latest = await getLatestApkRelease();
    if (!latest) {
      res.status(404).json({ error: "No APK release found on GitHub" });
      return;
    }
    res.json({ apk: latest });
  } catch (err) {
    console.error("Latest APK lookup error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch latest APK from GitHub";
    res.status(502).json({ error: message });
  }
});

adminApiRouter.get("/portal-config", (_req, res) => {
  res.json(getPortalConfigStatus());
});

adminApiRouter.put("/portal-config/github", async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const repo = getGithubApkRepo();
    const trimmed = token.trim();
    await validateGithubToken(trimmed, repo);
    await setPortalGithubToken(trimmed);
    res.json({ ok: true, ...getPortalConfigStatus() });
  } catch (err) {
    console.error("Apply GitHub token error:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to apply GitHub token",
    });
  }
});

adminApiRouter.delete("/portal-config/github", async (_req, res) => {
  try {
    await clearPortalGithubToken();
    res.json({ ok: true, ...getPortalConfigStatus() });
  } catch (err) {
    console.error("Clear GitHub token error:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to clear GitHub token",
    });
  }
});

adminApiRouter.put("/portal-config/server-port", async (req, res) => {
  const port = req.body?.port;
  if (typeof port !== "number") {
    res.status(400).json({ error: "port is required and must be a number" });
    return;
  }

  try {
    const { setPortalServerPort } = await import("../services/portalSettings.js");
    await setPortalServerPort(port);
    res.json({ ok: true, ...getPortalConfigStatus() });
  } catch (err) {
    console.error("Apply Server Port error:", err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to apply Server Port",
    });
  }
});

import { randomBytes } from "crypto";
import { pool } from "../db/pool.js";

adminApiRouter.get("/enrollment-tokens", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM enrollment_tokens ORDER BY created_at DESC"
    );
    res.json({ tokens: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to list enrollment tokens" });
  }
});

adminApiRouter.post("/enrollment-tokens", async (req, res) => {
  const { agency, description, tls_pin_hash } = req.body;
  const token = randomBytes(24).toString("hex");
  try {
    const result = await pool.query(
      `INSERT INTO enrollment_tokens (token, agency, description, tls_pin_hash, is_active)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
      [token, agency || null, description || null, tls_pin_hash || null]
    );
    res.json({ token: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to create enrollment token" });
  }
});

adminApiRouter.delete("/enrollment-tokens/:token", async (req, res) => {
  try {
    await pool.query(
      "UPDATE enrollment_tokens SET is_active = FALSE WHERE token = $1",
      [req.params.token]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

adminApiRouter.delete("/enrollment-tokens/:token/remove", async (req, res) => {
  try {
    await pool.query("DELETE FROM enrollment_tokens WHERE token = $1", [
      req.params.token,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove token" });
  }
});
