export interface LocationHistoryPoint {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  recorded_at: Date;
}

export interface SampledLocationPoint {
  number: number;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  recorded_at: string;
}

const MS_MIN = 60_000;

/** Bucket key for downsampling by age relative to `now`. */
export function locationHistoryBucketKey(
  recordedAt: Date,
  now: Date
): number | null {
  const ageMs = now.getTime() - recordedAt.getTime();
  if (ageMs < 0) {
    return null;
  }

  const ageMin = ageMs / MS_MIN;

  if (ageMin <= 360) {
    return Math.floor(ageMin / 15);
  }
  if (ageMin <= 2880) {
    return 24 + Math.floor((ageMin - 360) / 60);
  }
  if (ageMin <= 5760) {
    return 24 + 42 + Math.floor((ageMin - 2880) / 360);
  }
  return 24 + 42 + 8 + Math.floor((ageMin - 5760) / 1440);
}

/**
 * Keep the newest point per age bucket (15m / 1h / 6h / 24h tiers).
 * Input must be sorted newest-first.
 */
export function downsampleLocationHistory(
  points: LocationHistoryPoint[],
  now: Date = new Date()
): SampledLocationPoint[] {
  const seen = new Set<number>();
  const sampled: LocationHistoryPoint[] = [];

  for (const point of points) {
    const ageMs = now.getTime() - point.recorded_at.getTime();
    if (ageMs < 0) continue;
    const ageMin = ageMs / MS_MIN;

    const key = locationHistoryBucketKey(point.recorded_at, now);

    // Keep all points within the first 2 hours (120 minutes)
    if (ageMin <= 120) {
      if (key != null) seen.add(key);
      sampled.push(point);
      continue;
    }

    if (key == null || seen.has(key)) {
      continue;
    }
    seen.add(key);
    sampled.push(point);
  }

  return sampled.map((point, index) => ({
    number: index + 1,
    lat: point.lat,
    lon: point.lon,
    accuracy_m: point.accuracy_m,
    recorded_at: point.recorded_at.toISOString(),
  }));
}
