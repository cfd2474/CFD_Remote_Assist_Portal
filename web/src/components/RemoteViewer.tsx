import type { CSSProperties } from "react";
import type { User } from "oidc-client-ts";
import { useRemoteVideoControl } from "../hooks/useRemoteVideoControl";
import { useVideoStreamLayout } from "../hooks/useVideoStreamLayout";
import { useWebRtcViewer } from "../hooks/useWebRtcViewer";

import type { ControlPacket } from "../types";
import type { StreamDimensions, StreamOrientation } from "../utils/streamDimensions";

interface RemoteViewerProps {
  uid: string;
  user: User;
  sendWebRtc: (msg: Record<string, unknown>) => void;
  sendControl?: (packet: ControlPacket) => boolean;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  active: boolean;
  deviceOnline: boolean;
  deviceReconnecting?: boolean;
  adminWsConnected: boolean;
  deviceStreamReady: boolean;
  serverAnswerReceived?: boolean;
  streamLayoutHint?: StreamDimensions | null;
  streamLayoutRevision?: number;
  deviceOrientation?: StreamOrientation | null;
  onActivity?: () => void;
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
  streamLayoutHint = null,
  streamLayoutRevision = 0,
  deviceOrientation = null,
  onActivity,
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
    layoutHint: streamLayoutHint,
    layoutRevision: streamLayoutRevision,
  });

  const {
    panelRef,
    cursorPosition,
    showCursor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerEnter,
    onPointerLeave,
    onContextMenu,
  } = useRemoteVideoControl({
    uid,
    user,
    pointerEnabled: streamActive,
    keyboardEnabled: active && adminWsConnected,
    videoRef,
    sendControlWs: sendControl,
    onActivity,
  });

  const { landscape, aspectRatio } = useVideoStreamLayout(
    videoRef,
    streamActive,
    streamLayoutHint,
    deviceOrientation
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
          {statusLabel(status, streamActive, deviceOnline, deviceReconnecting, deviceStreamReady)}
        </span>
        {streamActive && (
          <span className="remote-orientation-badge">
            {landscape ? "Landscape" : "Portrait"}
          </span>
        )}
        {active && adminWsConnected && (
          <span className="remote-keyboard-badge">Keyboard → device</span>
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
        className={[
          "remote-video-wrap",
          streamActive ? "remote-video-wrap--interactive" : "",
          streamActive
            ? landscape
              ? "remote-video-wrap--landscape"
              : "remote-video-wrap--portrait"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          aspectRatio ? ({ aspectRatio } as CSSProperties) : undefined
        }
        aria-label={streamActive ? "Remote device control panel" : undefined}
        onPointerDown={streamActive ? onPointerDown : undefined}
        onPointerMove={streamActive ? onPointerMove : undefined}
        onPointerUp={streamActive ? onPointerUp : undefined}
        onPointerCancel={streamActive ? onPointerCancel : undefined}
        onPointerEnter={streamActive ? onPointerEnter : undefined}
        onPointerLeave={streamActive ? onPointerLeave : undefined}
        onContextMenu={streamActive ? onContextMenu : undefined}
      >
        <video
          ref={videoRef}
          className="remote-video"
          autoPlay
          playsInline
          muted
        />
        {showCursor && cursorPosition && (
          <div
            className="remote-cursor-indicator"
            style={{
              left: `${cursorPosition.x}px`,
              top: `${cursorPosition.y}px`,
            }}
            aria-hidden
          />
        )}
        {!streamActive && active && deviceOnline && adminWsConnected && status !== "failed" && (
          <div className="remote-connecting-overlay">
            <div className="spinner"></div>
            <h3>Establishing Secure Video</h3>
            <p>Please be patient! WebRTC negotiations and network routing can take up to 15 seconds depending on connection speed.</p>
          </div>
        )}
      </div>
      <p className="remote-hint">
        {active && adminWsConnected ? (
          <>
            Keyboard input is sent to the device while remote assist is active (click
            outside any text field on this page). Click, drag, or swipe on the video
            for touch; right-click for long-press.
          </>
        ) : (
          "The portal sends a WebRTC offer after Connect. The Android app must capture the screen and reply with an SDP answer on the device WebSocket. Optionally send { \"type\": \"webrtc_ready\" } when capture has started."
        )}
      </p>
    </div>
  );
}
