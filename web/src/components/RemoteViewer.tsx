import type { User } from "oidc-client-ts";
import { useRemoteVideoControl } from "../hooks/useRemoteVideoControl";
import { useWebRtcViewer } from "../hooks/useWebRtcViewer";
import { keyboardExitHint } from "../utils/remoteKeyboard";

import type { ControlPacket } from "../types";

interface RemoteViewerProps {
  uid: string;
  user: User;
  sendWebRtc: (msg: Record<string, unknown>) => void;
  sendControl?: (packet: ControlPacket) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  active: boolean;
  deviceOnline: boolean;
  deviceReconnecting?: boolean;
  adminWsConnected: boolean;
  deviceStreamReady: boolean;
  serverAnswerReceived?: boolean;
}

function statusLabel(
  status: string,
  streamActive: boolean,
  deviceOnline: boolean,
  deviceReconnecting: boolean,
  deviceStreamReady: boolean
): string {
  if (streamActive) return "Streaming";
  if (deviceReconnecting) return "Device reconnecting WebSocket…";
  if (!deviceOnline) return "Device offline (WebSocket)";
  if (status === "waiting") return deviceStreamReady ? "Capture started — preparing offer…" : "Waiting for screen capture permission on device…";
  if (status === "negotiating") return "Offer sent — waiting for SDP answer…";
  if (status === "connecting") return "Answer received — establishing video stream…";
  if (status === "failed") return "Stream failed";
  return "Waiting for stream";
}

export function RemoteViewer({
  uid,
  user,
  sendWebRtc,
  sendControl,
  onSignaling,
  active,
  deviceOnline,
  deviceReconnecting = false,
  adminWsConnected,
  deviceStreamReady,
  serverAnswerReceived = false,
}: RemoteViewerProps) {
  const { videoRef, streamActive, status, error, startSession } = useWebRtcViewer({
    sendSignaling: sendWebRtc,
    onSignaling,
    enabled: active,
    signalingReady: active && deviceOnline && adminWsConnected,
    deviceStreamReady,
    deviceUid: uid,
    user,
    serverAnswerReceived,
  });

  const {
    panelRef,
    locked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
    onFocus,
  } = useRemoteVideoControl({
    uid,
    user,
    enabled: streamActive,
    videoRef,
    sendControlWs: adminWsConnected ? sendControl : undefined,
  });

  const exitHint = keyboardExitHint();

  if (!active) {
    return (
      <div className="remote-viewer remote-viewer--inactive">
        <p>Remote session is not active. Click <strong>Connect</strong> above to start.</p>
        <p className="remote-hint">Signaling diagnostics below retain the last attempt trace.</p>
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
          {statusLabel(status, streamActive, deviceOnline, deviceReconnecting, deviceStreamReady)}
        </span>
        {streamActive && locked && (
          <span className="remote-lock-badge">Input locked to panel</span>
        )}
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

      {error && status === "failed" && <p className="remote-error">{error}</p>}

      <div
        ref={panelRef}
        tabIndex={streamActive ? 0 : -1}
        className={[
          "remote-video-wrap",
          streamActive ? "remote-video-wrap--interactive" : "",
          locked ? "remote-video-wrap--locked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={streamActive ? "Remote device control panel" : undefined}
        onPointerDown={streamActive ? onPointerDown : undefined}
        onPointerMove={streamActive ? onPointerMove : undefined}
        onPointerUp={streamActive ? onPointerUp : undefined}
        onPointerCancel={streamActive ? onPointerCancel : undefined}
        onContextMenu={streamActive ? onContextMenu : undefined}
        onFocus={streamActive ? onFocus : undefined}
      >
        <video
          ref={videoRef}
          className="remote-video"
          autoPlay
          playsInline
          muted
        />
      </div>
      <p className="remote-hint">
        {streamActive ? (
          locked ? (
            <>
              Mouse and keyboard are locked to the video panel. Click/drag to touch; swipe up
              from the bottom edge for the app drawer. Press <kbd>{exitHint}</kbd> to release.
            </>
          ) : (
            <>
              Click the video to lock input. Click, drag, or swipe for touch; right-click for
              long-press. Press <kbd>{exitHint}</kbd> to release when locked.
            </>
          )
        ) : (
          "The portal sends a WebRTC offer after Connect. The Android app must capture the screen and reply with an SDP answer on the device WebSocket. Optionally send { \"type\": \"webrtc_ready\" } when capture has started."
        )}
      </p>
    </div>
  );
}
