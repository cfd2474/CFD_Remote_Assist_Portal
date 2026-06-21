interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  region?: string;
  postcode?: string;
}

interface NominatimResponse {
  display_name?: string;
  address?: NominatimAddress;
}

const cache = new Map<string, { address: string; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function formatAddress(data: NominatimResponse): string {
  const a = data.address;
  if (a) {
    const line1 = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city ?? a.town ?? a.village ?? a.hamlet;
    const region = a.state ?? a.region;
    const parts = [line1, city, region, a.postcode].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(", ");
    }
  }
  return data.display_name ?? "Address unavailable";
}

export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.address;
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "EUD-Remote-Assist-Portal/1.0 (https://remote.tak-solutions.com)",
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as NominatimResponse;
  const address = formatAddress(data);
  cache.set(key, { address, expiresAt: Date.now() + CACHE_TTL_MS });
  return address;
}
