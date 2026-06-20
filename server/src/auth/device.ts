import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import type { DeviceRow } from "../types.js";
import bcrypt from "bcrypt";

declare global {
  namespace Express {
    interface Request {
      device?: DeviceRow;
    }
  }
}

export async function requireDeviceSecret(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const uid =
    (req.body?.uid as string | undefined) ??
    (req.params?.uid as string | undefined) ??
    (req.query?.uid as string | undefined);
  const secret =
    req.headers[config.commandSecretHeader] ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!secret || typeof secret !== "string") {
    res.status(401).json({ error: "Device connection secret required" });
    return;
  }

  if (!uid) {
    res.status(401).json({ error: "Device uid is required for authentication" });
    return;
  }

  const result = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE uid = $1",
    [uid]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "Invalid device credentials" });
    return;
  }

  const device = result.rows[0];
  const match = await bcrypt.compare(secret, device.connection_secret);

  if (!match) {
    res.status(401).json({ error: "Invalid device credentials" });
    return;
  }

  req.device = device;
  next();
}
