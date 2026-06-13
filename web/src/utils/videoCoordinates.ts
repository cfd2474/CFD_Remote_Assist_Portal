/** Map pointer coords to device screen fractions, accounting for object-fit: contain letterboxing. */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface VideoPoint {
  x_percent: number;
  y_percent: number;
}

/** Visible video frame within the rendered <video> element (excludes letterbox bars). */
export function videoRenderRect(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (!vw || !vh || rect.width <= 0 || rect.height <= 0) {
    return {
      rect,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  const elementAspect = rect.width / rect.height;
  const videoAspect = vw / vh;

  let width: number;
  let height: number;
  if (videoAspect > elementAspect) {
    width = rect.width;
    height = rect.width / videoAspect;
  } else {
    height = rect.height;
    width = rect.height * videoAspect;
  }

  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;

  return { rect, left, top, width, height };
}

export function pointOnVideo(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number
): VideoPoint {
  const frame = videoRenderRect(video);
  if (frame.width <= 0 || frame.height <= 0) {
    return { x_percent: 0.5, y_percent: 0.5 };
  }

  return {
    x_percent: clamp01((clientX - frame.left) / frame.width),
    y_percent: clamp01((clientY - frame.top) / frame.height),
  };
}

export function moveThresholdPx(video: HTMLVideoElement): number {
  const frame = videoRenderRect(video);
  const minDim = Math.min(frame.width, frame.height);
  return Math.max(6, minDim * 0.02);
}
