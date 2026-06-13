import { useEffect, useState, type RefObject } from "react";

export interface StreamDimensions {
  width: number;
  height: number;
}

export function useVideoStreamLayout(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean
) {
  const [dimensions, setDimensions] = useState<StreamDimensions | null>(null);

  useEffect(() => {
    if (!active) {
      setDimensions(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const readDimensions = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setDimensions({
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

  const landscape = dimensions ? dimensions.width > dimensions.height : false;

  return {
    dimensions,
    landscape,
    aspectRatio: dimensions
      ? `${dimensions.width} / ${dimensions.height}`
      : undefined,
  };
}
