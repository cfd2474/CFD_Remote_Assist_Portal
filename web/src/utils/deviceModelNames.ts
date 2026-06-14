/**
 * Maps Android Build.MODEL codes to marketing names for display in the portal.
 * Unknown codes are shown as-is.
 */

/** Longest-prefix wins — list more specific prefixes before shorter ones. */
const MODEL_PREFIX_NAMES: ReadonlyArray<readonly [prefix: string, name: string]> = [
  // Samsung Galaxy XCover (rugged / field devices)
  ["SM-G736", "Samsung XCover6 Pro"],
  ["SM-G556", "Samsung XCover7"],
  ["SM-G525", "Samsung XCover5"],
  ["SM-G526", "Samsung XCover5"],
  ["SM-G715", "Samsung XCover Pro"],
  ["SM-G389", "Samsung XCover4s"],
  ["SM-G398", "Samsung XCover4s"],
  ["SM-G390", "Samsung XCover4"],
  // Samsung Galaxy S (common enterprise)
  ["SM-S928", "Samsung Galaxy S24 Ultra"],
  ["SM-S926", "Samsung Galaxy S24+"],
  ["SM-S921", "Samsung Galaxy S24"],
  ["SM-S918", "Samsung Galaxy S23 Ultra"],
  ["SM-S916", "Samsung Galaxy S23+"],
  ["SM-S911", "Samsung Galaxy S23"],
  ["SM-S908", "Samsung Galaxy S22 Ultra"],
  ["SM-S901", "Samsung Galaxy S22"],
  // Google Pixel
  ["Pixel 9 Pro XL", "Google Pixel 9 Pro XL"],
  ["Pixel 9 Pro", "Google Pixel 9 Pro"],
  ["Pixel 9", "Google Pixel 9"],
  ["Pixel 8 Pro", "Google Pixel 8 Pro"],
  ["Pixel 8", "Google Pixel 8"],
  ["Pixel 7 Pro", "Google Pixel 7 Pro"],
  ["Pixel 7", "Google Pixel 7"],
];

const MODEL_EXACT_NAMES: Readonly<Record<string, string>> = {
  "SM-G736U1": "Samsung XCover6 Pro",
  "SM-G736U": "Samsung XCover6 Pro",
  "SM-G736W": "Samsung XCover6 Pro",
  "SM-G736B": "Samsung XCover6 Pro",
  "SM-G736T": "Samsung XCover6 Pro",
};

function normalizeModelKey(model: string): string {
  return model.trim().toUpperCase();
}

function lookupFriendlyName(model: string): string | undefined {
  const key = normalizeModelKey(model);

  const exact = MODEL_EXACT_NAMES[key];
  if (exact) return exact;

  for (const [prefix, name] of MODEL_PREFIX_NAMES) {
    if (key.startsWith(prefix.toUpperCase())) return name;
  }

  return undefined;
}

/** e.g. SM-G736U1 → Samsung Galaxy XCover6 Pro (SM-G736U1) */
export function formatDeviceModel(model: string | null | undefined): string {
  if (!model?.trim()) return "—";

  const raw = model.trim();
  const friendly = lookupFriendlyName(raw);
  if (!friendly) return raw;

  return `${friendly} (${raw})`;
}
