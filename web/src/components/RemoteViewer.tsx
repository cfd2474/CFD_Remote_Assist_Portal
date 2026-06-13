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
  deviceOnline: boolean;
  adminWsConnected: boolean;
}

function statusLabel(
  status: string,
  streamActive: boolean,
  deviceOnline: boolean
): string {
  if (streamActive) return "Streaming";
  if (!deviceOnline) return "Device offline (WebSocket)";
  if (status === "negotiating") return "Negotiating with device…";
  if (status === "failed") return "Stream failed";
  return "Waiting for stream";
}

export function RemoteViewer({
  uid,
  user,
  sendWebRtc,
  onSignaling,
  active,
  deviceOnline,
  adminWsConnected,
}: RemoteViewerProps) {
  const { videoRef, streamActive, status, error, startSession } = useWebRtcViewer({
    sendSignaling: sendWebRtc,
    onSignaling,
    enabled: active,
  });

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLVideoElement>) => {
      if (!streamActive) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x_percent = (e.clientX - rect.left) / rect.width;
      const y_percent = (e.clientY - rect.top) / rect.height;

      await sendControl(user, uid, {
        action: "CLICK",
        x_percent: Math.min(1, Math.max(0, x_percent)),
        y_percent: Math.min(1, Math.max(0, y_percent)),
      });
    },
    [uid, user, streamActive]
  );

  if (!active) {
    return (
      <div className="remote-viewer remote-viewer--inactive">
        <p>Remote session is not active. Click <strong>Connect</strong> above to start.</p>
      </div>
    );
  }

  return (
    <div className="remote-viewer">
      <div className="remote-toolbar">
        <button type="button" onClick={() => void startSession()}>
          {streamActive ? "Restart stream" : "Retry WebRTC"}
        </button>
        <span className={streamActive ? "status-ok" : "status-warn"}>
          {statusLabel(status, streamActive, deviceOnline)}
        </span>
      </div>

      {!adminWsConnected && (
        <p className="remote-error">
          Admin WebSocket disconnected — signaling cannot reach the device.
        </p>
      )}

      {!deviceOnline && adminWsConnected && (
        <p className="remote-error">
          Device is not connected via WebSocket. Remote video requires the app to
          maintain <code>wss://remote.tak-solutions.com/ws/device</code>.
        </p>
      )}

      {error && <p className="remote-error">{error}</p>}

      <video
        ref={videoRef}
        className="remote-video"
        autoPlay
        playsInline
        muted
        onClick={handleClick}
      />
      <p className="remote-hint">
        {streamActive
          ? "Click on the video to send touch events to the device."
          : "The portal sends a WebRTC offer after Connect. The Android app must capture the screen and reply with an SDP answer."}
      </p>
    </div>
  );
}
