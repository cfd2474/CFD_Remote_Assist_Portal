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

/**
 * Size the panel from the **actual decoded video frame** whenever it is known, so
 * the visible frame always fills the panel. The device orientation hint only seeds
 * the layout before the first frame arrives.
 *
 * Previously this preferred the device hint whenever its orientation differed from
 * the current frame. That flipped the panel to the new orientation *before* the
 * video resolution changed, letterboxing the old frame into the new aspect ratio —
 * which shows up as a black panel on rotation.
 */
export function mergeStreamDimensions(
  videoDimensions: StreamDimensions | null,
  deviceHint: StreamDimensions | null
): StreamDimensions | null {
  if (videoDimensions) return videoDimensions;
  return deviceHint;
}
