import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function readVersionFile(): string | null {
  const candidates = [
    join(process.cwd(), "VERSION"),
    join(process.cwd(), "../VERSION"),
    join(moduleDir, "../../VERSION"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    const value = readFileSync(path, "utf8").trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export const VERSION = readVersionFile() ?? "unknown";
export const SERVICE_NAME = "eud-remote-assist-portal";
