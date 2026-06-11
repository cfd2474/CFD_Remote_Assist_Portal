import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

const jwks = createRemoteJWKSet(new URL(config.oidc.jwksUri));

export interface AdminUser extends JWTPayload {
  email?: string;
  preferred_username?: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.oidc.issuer,
      ...(config.oidc.audience ? { audience: config.oidc.audience } : {}),
    });
    req.adminUser = payload as AdminUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
