import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const SETTINGS_DIR =
  process.env.PORTAL_SETTINGS_DIR ?? path.join(process.cwd(), "data");
const SETTINGS_PATH =
  process.env.PORTAL_SETTINGS_PATH ??
  path.join(SETTINGS_DIR, "portal-settings.json");

type PortalSettingsFile = {
  githubToken?: string;
  serverPort?: number;
};

let portalGithubToken: string | undefined;
let portalServerPort: number | undefined;

function envGithubToken(): string | undefined {
  return config.github.token;
}

export function getGithubApkRepo(): string {
  return config.github.repo;
}

export function getEffectiveGithubToken(): string | undefined {
  return envGithubToken() ?? portalGithubToken;
}

export type PortalConfigStatus = {
  apkRepo: string;
  tokenConfigured: boolean;
  tokenSource: "environment" | "portal" | null;
  serverPort: number;
};

export function getPortalConfigStatus(): PortalConfigStatus {
  const port = portalServerPort ?? 8448;

  if (envGithubToken()) {
    return {
      apkRepo: getGithubApkRepo(),
      tokenConfigured: true,
      tokenSource: "environment",
      serverPort: port,
    };
  }

  if (portalGithubToken) {
    return {
      apkRepo: getGithubApkRepo(),
      tokenConfigured: true,
      tokenSource: "portal",
      serverPort: port,
    };
  }

  return {
    apkRepo: getGithubApkRepo(),
    tokenConfigured: false,
    tokenSource: null,
    serverPort: port,
  };
}

export async function loadPortalSettings(): Promise<void> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PortalSettingsFile;
    portalGithubToken = parsed.githubToken?.trim() || undefined;
    portalServerPort = parsed.serverPort;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("Failed to load portal settings:", err);
    }
    portalGithubToken = undefined;
    portalServerPort = undefined;
  }
}

async function persistPortalSettings(): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });

  const payload: PortalSettingsFile = {};
  if (portalGithubToken) {
    payload.githubToken = portalGithubToken;
  }
  if (portalServerPort !== undefined) {
    payload.serverPort = portalServerPort;
  }

  await writeFile(SETTINGS_PATH, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });

  try {
    await chmod(SETTINGS_PATH, 0o600);
  } catch {
    // Best effort on platforms that restrict chmod.
  }
}

export async function setPortalGithubToken(token: string): Promise<void> {
  if (envGithubToken()) {
    throw new Error(
      "GitHub token is configured in server environment (.env). Remove GITHUB_TOKEN from .env to manage it in the portal."
    );
  }

  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("GitHub token is required.");
  }

  if (!/^gh[pousr]_/.test(trimmed) && !/^github_pat_/.test(trimmed)) {
    throw new Error(
      "Token format is not recognized. Use a GitHub classic personal access token (ghp_...)."
    );
  }

  portalGithubToken = trimmed;
  await persistPortalSettings();
}

export async function clearPortalGithubToken(): Promise<void> {
  if (envGithubToken()) {
    throw new Error(
      "GitHub token is configured in server environment (.env). Remove GITHUB_TOKEN from .env to clear it here."
    );
  }

  portalGithubToken = undefined;
  await persistPortalSettings();
}

export async function setPortalServerPort(port: number): Promise<void> {
  if (port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535");
  }
  portalServerPort = port;
  await persistPortalSettings();
}

export async function validateGithubToken(
  token: string,
  repo: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "eud-remote-assist-portal",
      },
      cache: "no-store",
    }
  );

  if (res.status === 401) {
    throw new Error("GitHub rejected this token. Check that it is valid and not expired.");
  }

  if (res.status === 403) {
    throw new Error(
      "GitHub denied access. For a public APK repo, use a classic token with the public_repo scope."
    );
  }

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} while validating the token.`);
  }
}
