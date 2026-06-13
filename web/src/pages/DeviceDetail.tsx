import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevice, removeDevice, sendCommand } from "../api/client";
import { useAdminWebSocket } from "../hooks/useAdminWebSocket";
import { DeviceMap } from "../components/DeviceMap";
import { RemoteViewer } from "../components/RemoteViewer";
import { SignalingDiagnostics } from "../components/SignalingDiagnostics";
import type { Device } from "../types";

export function DeviceDetail() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [remoteActive, setRemoteActive] = useState(false);
  const [diagnosticsPinned, setDiagnosticsPinned] = useState(false);
  const [remoteSessionId, setRemoteSessionId] = useState(0);
  const [webrtcReadySessionId, setWebrtcReadySessionId] = useState(0);
  const remoteSessionIdRef = useRef(0);
  const [removing, setRemoving] = useState(false);
  const initialLoadDone = useRef(false);

  const { connected, deviceOnline, deviceReconnecting, lastEvent, signalingStatus, sendWebRtc, setWebRtcHandler } =
    useAdminWebSocket(uid, auth.user ?? null);

  const loadDevice = useCallback(async () => {
    if (!auth.user || !uid) return;
    try {
      const data = await fetchDevice(auth.user, uid);
      setDevice(data);
      if (!initialLoadDone.current) {
        setRemoteActive(data.remote_admin_active);
        if (data.remote_admin_active) setDiagnosticsPinned(true);
        initialLoadDone.current = true;
      } else if (data.remote_admin_active) {
        setRemoteActive(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load device");
    } finally {
      setLoading(false);
    }
  }, [auth.user, uid]);

  const refreshDeviceMeta = useCallback(async () => {
    if (!auth.user || !uid) return;
    try {
      const data = await fetchDevice(auth.user, uid);
      setDevice(data);
    } catch {
      // Keep existing device card data if a background refresh fails.
    }
  }, [auth.user, uid]);

  useEffect(() => {
    if (lastEvent?.event === "WEBRTC_READY") {
      setWebrtcReadySessionId(remoteSessionIdRef.current);
    }
  }, [lastEvent]);

  useEffect(() => {
    void loadDevice();
    const interval = setInterval(() => void loadDevice(), 10000);
    return () => clearInterval(interval);
  }, [loadDevice]);

  const runCommand = async (
    command: "TRIGGER_PING" | "REQUEST_LOCATION" | "START_REMOTE_ADMIN" | "STOP_REMOTE_ADMIN"
  ) => {
    if (!auth.user || !uid) return;
    setActionMessage(null);
    try {
      const result = await sendCommand(auth.user, uid, command);
      if (command === "START_REMOTE_ADMIN") {
        setRemoteActive(true);
        setDiagnosticsPinned(true);
        remoteSessionIdRef.current += 1;
        setRemoteSessionId(remoteSessionIdRef.current);
        setWebrtcReadySessionId(0);
      }
      if (command === "STOP_REMOTE_ADMIN") setRemoteActive(false);
      setActionMessage(
        result.delivery === "queued"
          ? `Command queued: ${command} — device is not on live WebSocket; it will receive this on the next poll (usually within ~30s). Remote assist requires a live WebSocket connection.`
          : `Command sent: ${command}`
      );
      void refreshDeviceMeta();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Command failed");
    }
  };

  const handleRemoveDevice = async () => {
    if (!auth.user || !uid || !device) return;

    const confirmed = window.confirm(
      `Remove "${device.device_name}" from the portal?\n\nThis permanently deletes the device record, telemetry history, and event log. The phone can register again later as a new enrollment.`
    );
    if (!confirmed) return;

    setRemoving(true);
    setActionMessage(null);
    try {
      await removeDevice(auth.user, uid);
      navigate("/", { replace: true });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to remove device");
      setRemoving(false);
    }
  };

  if (loading) return <p className="loading">Loading device…</p>;
  if (error || !device) return <p className="error">{error ?? "Device not found"}</p>;

  const hasLocation = device.last_lat != null && device.last_lon != null;
  const deviceStreamReady =
    remoteSessionId > 0 &&
    webrtcReadySessionId === remoteSessionId &&
    (lastEvent?.event === "WEBRTC_READY" ||
      lastEvent?.event === "REMOTE_SESSION_STARTED" ||
      lastEvent?.event === "REMOTE_READY");

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/" className="back-link">
          ← All devices
        </Link>
        <h1>{device.device_name}</h1>
        <div className="device-meta">
          <span
            className={`badge ${
              deviceOnline
                ? "badge-online"
                : deviceReconnecting
                  ? "badge-neutral"
                  : "badge-offline"
            }`}
          >
            {deviceOnline
              ? "Live"
              : deviceReconnecting
                ? "Reconnecting…"
                : "Not connected"}
          </span>
          <span className="badge badge-neutral">
            WS {connected ? "connected" : "disconnected"}
          </span>
          {remoteActive && (
            <span className="badge badge-remote">Remote active</span>
          )}
        </div>
      </div>

      {actionMessage && <p className="action-message">{actionMessage}</p>}

      <section className="panel">
        <h2>Actions</h2>
        <div className="action-row">
          <button type="button" onClick={() => void runCommand("TRIGGER_PING")}>
            Ping device
          </button>
          <button
            type="button"
            onClick={() => void runCommand("REQUEST_LOCATION")}
          >
            Locate now
          </button>
          {!remoteActive ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void runCommand("START_REMOTE_ADMIN")}
            >
              Connect
            </button>
          ) : (
            <button
              type="button"
              className="btn-danger"
              onClick={() => void runCommand("STOP_REMOTE_ADMIN")}
            >
              Disconnect
            </button>
          )}
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <h2>Device info</h2>
          <dl className="info-list">
            <div>
              <dt>UID</dt>
              <dd>{device.uid}</dd>
            </div>
            <div>
              <dt>Serial</dt>
              <dd>{device.serial ?? "—"}</dd>
            </div>
            <div>
              <dt>IMEI</dt>
              <dd>{device.imei ?? "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{device.phone_number ?? "—"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{device.model ?? "—"}</dd>
            </div>
            <div>
              <dt>App version</dt>
              <dd>{device.app_version ?? "—"}</dd>
            </div>
            <div>
              <dt>Battery</dt>
              <dd>
                {device.last_battery != null
                  ? `${device.last_battery}%${device.last_is_charging ? " (charging)" : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>
                {device.last_seen_at
                  ? new Date(device.last_seen_at).toLocaleString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Last telemetry</dt>
              <dd>
                {device.last_telemetry_at
                  ? new Date(device.last_telemetry_at).toLocaleString()
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Location</h2>
          {hasLocation ? (
            <>
              <p>
                {device.last_lat!.toFixed(5)}, {device.last_lon!.toFixed(5)}
              </p>
              <DeviceMap
                lat={device.last_lat!}
                lon={device.last_lon!}
                label={device.device_name}
              />
            </>
          ) : (
            <p className="empty-state">No location data yet.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Remote assist</h2>
        <RemoteViewer
          uid={device.uid}
          user={auth.user!}
          sendWebRtc={sendWebRtc}
          onSignaling={setWebRtcHandler}
          active={remoteActive}
          deviceOnline={deviceOnline || deviceReconnecting}
          deviceReconnecting={deviceReconnecting}
          adminWsConnected={connected}
          deviceStreamReady={deviceStreamReady}
        />
        <SignalingDiagnostics
          uid={device.uid}
          visible={diagnosticsPinned || remoteActive}
          liveStatus={signalingStatus}
          onHide={() => setDiagnosticsPinned(false)}
        />
      </section>

      {lastEvent && (
        <section className="panel">
          <h2>Latest event</h2>
          <pre className="event-log">{JSON.stringify(lastEvent, null, 2)}</pre>
        </section>
      )}

      <section className="panel panel-danger">
        <h2>Remove device</h2>
        <p>
          Permanently delete this device and all associated telemetry and event
          history from the portal.
        </p>
        <button
          type="button"
          className="btn-danger"
          disabled={removing}
          onClick={() => void handleRemoveDevice()}
        >
          {removing ? "Removing…" : "Remove device and clear data"}
        </button>
      </section>
    </div>
  );
}
