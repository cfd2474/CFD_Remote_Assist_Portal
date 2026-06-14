import https from "node:https";
import { config } from "../config.js";

/**
 * Resolves Android Build.MODEL codes to marketing names via PhoneDB.
 * @see https://phonedb.net/
 */

const PHONEDB_SEARCH_URL =
  "https://phonedb.net/index.php?m=device&s=query&d=detailed_specs";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const MARKETING_NAME_RE =
  /^(Samsung|Google|Motorola|Huawei|Xiaomi|OnePlus|Sony|LG|Nokia)\s+(?:SM-[A-Z0-9]+\s+)?(.+?)\s+(?:5G|4G|TD-LTE|Dual SIM|\d+\s*GB)/i;

const RESULT_TITLE_RE = /content_block_title"><a title="([^"]+)"/g;

/** Fallback when PhoneDB is unreachable or has no match. */
const STATIC_MODEL_NAMES: Readonly<Record<string, string>> = {
  "SM-G736U1": "Samsung Galaxy XCover6 Pro",
  "SM-G736U": "Samsung Galaxy XCover6 Pro",
};

const STATIC_PREFIX_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["SM-G736", "Samsung Galaxy XCover6 Pro"],
  ["SM-G556", "Samsung Galaxy XCover7"],
];

interface CacheEntry {
  friendlyName: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

function normalizeCacheKey(model: string): string {
  return model.trim().toUpperCase();
}

function toModelQuery(model: string): string {
  const trimmed = model.trim();
  const samsung = trimmed.match(/\b(SM-[A-Z0-9]+)/i);
  if (samsung) {
    return samsung[1].toUpperCase();
  }
  return trimmed;
}

function lookupStaticFriendlyName(model: string): string | null {
  const key = normalizeCacheKey(model);
  const exact = STATIC_MODEL_NAMES[key];
  if (exact) {
    return exact;
  }

  for (const [prefix, name] of STATIC_PREFIX_NAMES) {
    if (key.startsWith(prefix.toUpperCase())) {
      return name;
    }
  }

  return null;
}

function parseMarketingName(title: string): string | null {
  const cleaned = title.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const match = cleaned.match(MARKETING_NAME_RE);
  if (!match) {
    return null;
  }
  return `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim();
}

function extractMatchingTitles(html: string, modelQuery: string): string[] {
  const query = modelQuery.toUpperCase();
  const titles: string[] = [];

  for (const match of html.matchAll(RESULT_TITLE_RE)) {
    const title = match[1];
    if (title.toUpperCase().includes(query)) {
      titles.push(title);
    }
  }

  return titles;
}

async function postPhoneDbSearch(body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      PHONEDB_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "eud-remote-assist-portal/1.0 (+https://phonedb.net/)",
        },
        rejectUnauthorized: !config.phonedb.tlsInsecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`PhoneDB request failed: ${res.statusCode}`));
            return;
          }
          resolve(html);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function fetchFromPhoneDb(model: string): Promise<string | null> {
  const modelQuery = toModelQuery(model);
  const body = new URLSearchParams({
    query_start2: "",
    brand: "",
    model: modelQuery,
    released_min: "",
    released_max: "",
    cat: "1",
  }).toString();

  const html = await postPhoneDbSearch(body);
  const titles = extractMatchingTitles(html, modelQuery);
  for (const title of titles) {
    const name = parseMarketingName(title);
    if (name) {
      return name;
    }
  }

  return null;
}

function setCache(model: string, friendlyName: string | null): void {
  const ttl = friendlyName ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  cache.set(normalizeCacheKey(model), {
    friendlyName,
    expiresAt: Date.now() + ttl,
  });
}

export async function lookupPhoneDbModel(
  model: string | null | undefined
): Promise<string | null> {
  if (!model?.trim()) {
    return null;
  }

  const key = normalizeCacheKey(model);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.friendlyName;
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const fromPhoneDb = await fetchFromPhoneDb(model);
        if (fromPhoneDb) {
          setCache(model, fromPhoneDb);
          return fromPhoneDb;
        }
      } catch (err) {
        console.error(`PhoneDB lookup failed for ${model}:`, err);
      }

      const fallback = lookupStaticFriendlyName(model);
      setCache(model, fallback);
      return fallback;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
  }

  return promise;
}

export function formatModelDisplay(
  model: string | null | undefined,
  friendlyName: string | null | undefined
): string {
  if (!model?.trim()) {
    return "—";
  }

  const raw = model.trim();
  if (!friendlyName || friendlyName.trim() === raw) {
    return raw;
  }

  return `${friendlyName.trim()} (${raw})`;
}

export async function getModelDisplay(
  model: string | null | undefined
): Promise<string> {
  const friendlyName = await lookupPhoneDbModel(model);
  return formatModelDisplay(model, friendlyName);
}

export async function resolveModelDisplays(
  models: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      models
        .filter((model): model is string => Boolean(model?.trim()))
        .map((model) => model.trim())
    ),
  ];

  const displays = await Promise.all(
    unique.map(async (model) => {
      const friendlyName = await lookupPhoneDbModel(model);
      return [model, formatModelDisplay(model, friendlyName)] as const;
    })
  );

  return new Map(displays);
}
