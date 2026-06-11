import { useCallback } from "react";
import type { User } from "oidc-client-ts";
import { sendControl } from "../api/client";
import { useWebRtcViewer } from "../hooks/useWebRtcViewer";

interface RemoteViewerProps {
  uid: string;
  user: User;
  sendWebRtc: (msg: Record<string, unknown>) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  active: boolean;
}

export function RemoteViewer({
  uid,
  user,
  sendWebRtc,
  onSignaling,
  active,
}: RemoteViewerProps) {
  const { videoRef, streamActive, startSession } = useWebRtcViewer({
    sendSignaling: sendWebRtc,
    onSignaling,
    enabled: active,
  });

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLVideoElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x_percent = (e.clientX - rect.left) / rect.width;
      const y_percent = (e.clientY - rect.top) / rect.height;

      await sendControl(user, uid, {
        action: "CLICK",
        x_percent: Math.min(1, Math.max(0, x_percent)),
        y_percent: Math.min(1, Math.max(0, y_percent)),
      });
    },
    [uid, user]
  );

  if (!active) {
    return (
      <div className="remote-viewer remote-viewer--inactive">
        <p>Remote session is not active.</p>
      </div>
    );
  }

  return (
    <div className="remote-viewer">
      <div className="remote-toolbar">
        <button type="button" onClick={() => void startSession()}>
          {streamActive ? "Restart stream" : "Start WebRTC stream"}
        </button>
        <span className={streamActive ? "status-ok" : "status-warn"}>
          {streamActive ? "Streaming" : "Waiting for stream"}
        </span>
      </div>
      <video
        ref={videoRef}
        className="remote-video"
        autoPlay
        playsInline
        muted
        onClick={handleClick}
      />
      <p className="remote-hint">Click on the video to send touch events to the device.</p>
    </div>
  );
}
