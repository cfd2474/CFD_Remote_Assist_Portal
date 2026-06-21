function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: requireEnv("DATABASE_URL"),
  oidc: {
    issuer: requireEnv("OIDC_ISSUER"),
    audience: requireEnv("OIDC_AUDIENCE"),
    jwksUri:
      process.env.OIDC_JWKS_URI ??
      `${requireEnv("OIDC_ISSUER").replace(/\/$/, "")}/.well-known/jwks`,
    adminGroup: process.env.OIDC_ADMIN_GROUP || undefined,
    adminEmails: process.env.OIDC_ADMIN_EMAILS
      ? process.env.OIDC_ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
      : undefined,
  },
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  commandSecretHeader: "x-connection-secret",
  github: {
    repo: process.env.GITHUB_APK_REPO ?? "cfd2474/EUD_Remote_Assist_Portal",
    token: process.env.GITHUB_TOKEN || undefined,
  },
  phonedb: {
    /** PhoneDB serves an incomplete TLS chain; enable in production if lookups fail. */
    tlsInsecure: process.env.PHONEDB_TLS_INSECURE === "true",
  },
};
