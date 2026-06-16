import { useEffect, useState, type RefObject } from "react";
import {
  mergeStreamDimensions,
} from "../utils/streamDimensions";
import type { StreamDimensions } from "../utils/streamDimensions";

export type { StreamDimensions };

export function useVideoStreamLayout(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  deviceHint: StreamDimensions | null = null,
  deviceOrientation: "portrait" | "landscape" | null = null
) {
  const [videoDimensions, setVideoDimensions] = useState<StreamDimensions | null>(
    null
  );

  useEffect(() => {
    if (!active) {
      setVideoDimensions(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const readDimensions = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({
          width: video.videoWidth,
          height: video.videoHeight,
        });
      }
    };

    readDimensions();
    video.addEventListener("loadedmetadata", readDimensions);
    video.addEventListener("resize", readDimensions);

    return () => {
      video.removeEventListener("loadedmetadata", readDimensions);
      video.removeEventListener("resize", readDimensions);
    };
  }, [active, videoRef]);

  const dimensions = mergeStreamDimensions(videoDimensions, deviceHint);
  const landscape =
    deviceOrientation != null
      ? deviceOrientation === "landscape"
      : dimensions
        ? dimensions.width > dimensions.height
        : false;

  return {
    dimensions,
    landscape,
    aspectRatio: dimensions
      ? `${dimensions.width} / ${dimensions.height}`
      : undefined,
  };
}
