import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import type { DeviceRow } from "../types.js";

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
  const uid = (req.body?.uid ?? req.params?.uid) as string | undefined;
  const secret =
    req.headers[config.commandSecretHeader] ??
    req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!uid || !secret || typeof secret !== "string") {
    res.status(401).json({ error: "Device uid and connection secret required" });
    return;
  }

  const result = await pool.query<DeviceRow>(
    "SELECT * FROM devices WHERE uid = $1 AND connection_secret = $2",
    [uid, secret]
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "Invalid device credentials" });
    return;
  }

  req.device = result.rows[0];
  next();
}
