export interface StreamDimensions {
  width: number;
  height: number;
}

const LAYOUT_EVENTS = new Set(["ORIENTATION_CHANGED", "CAPTURE_RESIZED"]);

export function isLayoutEvent(event: string | undefined): boolean {
  return event != null && LAYOUT_EVENTS.has(event);
}

export function parseStreamDimensions(payload: unknown): StreamDimensions | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function isLandscape(dimensions: StreamDimensions): boolean {
  return dimensions.width > dimensions.height;
}

/** Prefer device-reported size when video track is still on the old orientation. */
export function mergeStreamDimensions(
  videoDimensions: StreamDimensions | null,
  deviceHint: StreamDimensions | null
): StreamDimensions | null {
  if (!deviceHint) return videoDimensions;
  if (!videoDimensions) return deviceHint;

  const videoLandscape = isLandscape(videoDimensions);
  const hintLandscape = isLandscape(deviceHint);

  if (videoLandscape !== hintLandscape) {
    return deviceHint;
  }

  return videoDimensions;
}
