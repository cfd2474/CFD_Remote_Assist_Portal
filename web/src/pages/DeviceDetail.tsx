import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevice, removeDevice, sendCommand } from "../api/client";
import { useAdminWebSocket } from "../hooks/useAdminWebSocket";
import { DeviceLocationPanel } from "../components/DeviceLocationPanel";
import { ConfirmModal } from "../components/ConfirmModal";
import { RemoteViewer } from "../components/RemoteViewer";
import type { Device, DeviceCommand } from "../types";
import { isLayoutEvent, parseStreamDimensions } from "../utils/streamDimensions";
import { formatDeviceModel } from "../utils/deviceModelNames";
import { formatPhoneNumber } from "../utils/formatPhoneNumber";
import type { StreamDimensions } from "../utils/streamDimensions";

export function DeviceDetail() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [remoteActive, setRemoteActive] = useState(false);
  const [remoteSessionId, setRemoteSessionId] = useState(0);
  const [webrtcReadySessionId, setWebrtcReadySessionId] = useState(0);
  const remoteSessionIdRef = useRef(0);
  const [removing, setRemoving] = useState(false);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [locking, setLocking] = useState(false);
  const [streamLayoutHint, setStreamLayoutHint] = useState<StreamDimensions | null>(
    null
  );
  const initialLoadDone = useRef(false);

  const { connected, deviceOnline, deviceReconnecting, lastEvent, signalingStatus, sendWebRtc, sendControl, setWebRtcHandler } =
    useAdminWebSocket(uid, auth.user ?? null);

  const loadDevice = useCallback(async () => {
    if (!auth.user || !uid) return;
    try {
      const data = await fetchDevice(auth.user, uid);
      setDevice(data);
      if (!initialLoadDone.current) {
        setRemoteActive(data.remote_admin_active);
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
    if (isLayoutEvent(String(lastEvent?.event))) {
      const dimensions = parseStreamDimensions(lastEvent?.payload);
      if (dimensions) setStreamLayoutHint(dimensions);
    }
  }, [lastEvent]);

  useEffect(() => {
    if (!remoteActive) {
      setStreamLayoutHint(null);
    }
  }, [remoteActive]);

  useEffect(() => {
    void loadDevice();
    const interval = setInterval(() => void loadDevice(), 10000);
    return () => clearInterval(interval);
  }, [loadDevice]);

  const runCommand = async (command: DeviceCommand) => {
    if (!auth.user || !uid) return;
    setActionMessage(null);
    try {
      const result = await sendCommand(auth.user, uid, command);
      if (command === "START_REMOTE_ADMIN") {
        setRemoteActive(true);
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

  const handleLockDevice = async () => {
    if (!auth.user || !uid) return;

    setLockModalOpen(false);
    setLocking(true);
    setActionMessage(null);

    try {
      if (remoteActive) {
        await sendCommand(auth.user, uid, "STOP_REMOTE_ADMIN");
        setRemoteActive(false);
      }

      const result = await sendCommand(auth.user, uid, "LOCK_DEVICE");
      setActionMessage(
        result.delivery === "queued"
          ? "Lock command queued — device will lock on next poll. Remote assist has been stopped."
          : "Lock command sent. Remote assist has been stopped."
      );
      void refreshDeviceMeta();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Lock command failed");
    } finally {
      setLocking(false);
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
          <button
            type="button"
            className="btn-sound"
            onClick={() => void runCommand("TRIGGER_PING")}
          >
            Play Sound on Device
          </button>
          <button
            type="button"
            className="btn-locate"
            onClick={() => void runCommand("REQUEST_LOCATION")}
          >
            Locate now
          </button>
          {!remoteActive ? (
            <button
              type="button"
              className="btn-connect"
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
          <button
            type="button"
            className="btn-lock"
            disabled={locking}
            onClick={() => setLockModalOpen(true)}
          >
            Lock device
          </button>
        </div>
      </section>

      <ConfirmModal
        open={lockModalOpen}
        title="Lock device?"
        confirmLabel="Lock device"
        confirmClassName="btn-lock"
        onConfirm={() => void handleLockDevice()}
        onCancel={() => setLockModalOpen(false)}
      >
        <p>
          This will terminate any active remote assist session. Remote assist
          will not be available until the phone is unlocked manually.
        </p>
      </ConfirmModal>

      <div className="detail-grid">
        <section className="panel">
          <h2>Device info</h2>
          <dl className="info-list">
            <div>
              <dt>UID</dt>
              <dd>{device.uid}</dd>
            </div>
            <div>
              <dt>Agency</dt>
              <dd>{device.agency ?? "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{formatPhoneNumber(device.phone_number)}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{formatDeviceModel(device.model)}</dd>
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
            <DeviceLocationPanel
              uid={device.uid}
              lat={device.last_lat!}
              lon={device.last_lon!}
              accuracyM={device.last_location_accuracy_m}
              label={device.device_name}
              user={auth.user!}
            />
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
          sendControl={sendControl}
          onSignaling={setWebRtcHandler}
          active={remoteActive}
          deviceOnline={deviceOnline || deviceReconnecting}
          deviceReconnecting={deviceReconnecting}
          adminWsConnected={connected}
          deviceStreamReady={deviceStreamReady}
          serverAnswerReceived={signalingStatus?.answerReceived ?? false}
          streamLayoutHint={streamLayoutHint}
        />
      </section>

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
