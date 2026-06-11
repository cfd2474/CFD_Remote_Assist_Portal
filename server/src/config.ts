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
    audience: process.env.OIDC_AUDIENCE || undefined,
    jwksUri:
      process.env.OIDC_JWKS_URI ??
      `${requireEnv("OIDC_ISSUER").replace(/\/$/, "")}/.well-known/jwks`,
  },
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  commandSecretHeader: "x-connection-secret",
};
