import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { fetchDevice, fetchLatestApk, removeDevice, sendCommand } from "../api/client";
import { useAdminWebSocket } from "../hooks/useAdminWebSocket";
import { DeviceLocationPanel } from "../components/DeviceLocationPanel";
import { ConfirmModal } from "../components/ConfirmModal";
import { RemoteViewer } from "../components/RemoteViewer";
import type { Device, DeviceCommand } from "../types";
import { isLayoutEvent, parseStreamDimensions, parseStreamOrientation } from "../utils/streamDimensions";
import { formatPhoneNumber } from "../utils/formatPhoneNumber";
import { isNewerVersion } from "../utils/compareSemver";
import type { StreamDimensions, StreamOrientation } from "../utils/streamDimensions";

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
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [locking, setLocking] = useState(false);
  const [deviceLocked, setDeviceLocked] = useState(false);
  const [deviceLockedReason, setDeviceLockedReason] = useState<string | null>(
    null
  );
  const [unlockPin, setUnlockPin] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [streamLayoutHint, setStreamLayoutHint] = useState<StreamDimensions | null>(
    null
  );
  const [streamLayoutRevision, setStreamLayoutRevision] = useState(0);
  const [deviceOrientation, setDeviceOrientation] = useState<StreamOrientation | null>(
    null
  );
  const [latestApkVersion, setLatestApkVersion] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  const [showInactivityModal, setShowInactivityModal] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const lastActivityRef = useRef<number>(Date.now());
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authUserRef = useRef(auth.user);
  const uidRef = useRef(uid);
  const remoteActiveRef = useRef(remoteActive);

  // Sync refs with state/props
  useEffect(() => {
    authUserRef.current = auth.user;
    uidRef.current = uid;
    remoteActiveRef.current = remoteActive;
  }, [auth.user, uid, remoteActive]);

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

  const runCommand = useCallback(async (command: DeviceCommand) => {
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
      if (command === "STOP_REMOTE_ADMIN") {
        setRemoteActive(false);
        setDeviceLocked(false);
        setDeviceLockedReason(null);
        setUnlockPin("");
      }
      setActionMessage(
        result.delivery === "queued"
          ? `Command queued: ${command} — device is not on live WebSocket; it will receive this on the next poll (usually within ~30s). Remote assist requires a live WebSocket connection.`
          : `Command sent: ${command}`
      );
      void refreshDeviceMeta();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Command failed");
    }
  }, [auth.user, uid, refreshDeviceMeta]);

  useEffect(() => {
    if (lastEvent?.event === "WEBRTC_READY") {
      setWebrtcReadySessionId(remoteSessionIdRef.current);
      setDeviceLocked(false);
      setDeviceLockedReason(null);
      setUnlockPin("");
    }
    if (isLayoutEvent(String(lastEvent?.event))) {
      setStreamLayoutRevision((revision) => revision + 1);
      const orientation = parseStreamOrientation(lastEvent?.payload);
      if (orientation) setDeviceOrientation(orientation);
      const dimensions = parseStreamDimensions(lastEvent?.payload);
      if (dimensions) setStreamLayoutHint(dimensions);
    }
    if (lastEvent?.event === "DEVICE_LOCKED") {
      setDeviceLocked(true);
      const payload = lastEvent.payload as Record<string, unknown> | undefined;
      const reason =
        typeof payload?.reason === "string"
          ? payload.reason
          : "PIN required for full access";
      setDeviceLockedReason(reason);
    }
    if (lastEvent?.event === "COMMAND_HANDLED") {
      const payload = lastEvent.payload as Record<string, unknown> | undefined;
      const handledCommand =
        typeof payload?.command === "string" ? payload.command : null;
      if (handledCommand === "REMOTE_UNLOCK") {
        setDeviceLocked(false);
        setDeviceLockedReason(null);
        setUnlockPin("");
        setActionMessage("Unlock command processed — waiting for video stream…");
      }
    }
    if (lastEvent?.event === "COMMAND_FAILED") {
      const payload = lastEvent.payload as Record<string, unknown> | undefined;
      const failedCommand =
        typeof payload?.command === "string" ? payload.command : null;
      const error =
        typeof payload?.error === "string" ? payload.error : "Command failed";
      if (failedCommand === "REMOTE_UNLOCK") {
        setActionMessage(`Unlock failed: ${error}`);
      }
    }
  }, [lastEvent]);

  useEffect(() => {
    if (remoteActive) {
      lastActivityRef.current = Date.now();
      setShowInactivityModal(false);
    } else {
      setStreamLayoutHint(null);
      setStreamLayoutRevision(0);
      setDeviceOrientation(null);
      setDeviceLocked(false);
      setDeviceLockedReason(null);
      setUnlockPin("");
      setShowInactivityModal(false);
    }
  }, [remoteActive]);

  useEffect(() => {
    void loadDevice();
    const interval = setInterval(() => void loadDevice(), 10000);
    return () => clearInterval(interval);
  }, [loadDevice]);

  // Tab-close/refresh beforeunload handler
  useEffect(() => {
    if (!remoteActive || !uid || !auth.user) return;

    const handleBeforeUnload = () => {
      const url = `${import.meta.env.VITE_API_BASE ?? ""}/api/admin/devices/${uid}/command`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (auth.user?.access_token) {
        headers.Authorization = `Bearer ${auth.user.access_token}`;
      }
      void fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ command: "STOP_REMOTE_ADMIN" }),
        keepalive: true,
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [remoteActive, uid, auth.user]);

  // SPA navigation unmount handler
  useEffect(() => {
    return () => {
      if (remoteActiveRef.current && authUserRef.current && uidRef.current) {
        void sendCommand(authUserRef.current, uidRef.current, "STOP_REMOTE_ADMIN").catch((err) => {
          console.warn("Failed to stop remote admin on navigation:", err);
        });
      }
    };
  }, []);

  // Inactivity detection check
  useEffect(() => {
    if (!remoteActive) {
      return;
    }

    const checkInterval = setInterval(() => {
      if (!showInactivityModal) {
        if (Date.now() - lastActivityRef.current >= 300_000) {
          setShowInactivityModal(true);
          setCountdown(120);
        }
      }
    }, 1000);

    return () => {
      clearInterval(checkInterval);
    };
  }, [remoteActive, showInactivityModal]);

  // Countdown timer decrement
  useEffect(() => {
    if (!showInactivityModal) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          setShowInactivityModal(false);
          void runCommand("STOP_REMOTE_ADMIN");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [showInactivityModal, runCommand]);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const handleKeepActive = useCallback(() => {
    setShowInactivityModal(false);
    lastActivityRef.current = Date.now();
  }, []);

  const handleTerminateSession = useCallback(() => {
    setShowInactivityModal(false);
    void runCommand("STOP_REMOTE_ADMIN");
  }, [runCommand]);

  useEffect(() => {
    if (!auth.user) {
      return;
    }

    let cancelled = false;

    const loadLatestApk = async () => {
      try {
        const latest = await fetchLatestApk(auth.user!);
        if (!cancelled) {
          setLatestApkVersion(latest.version);
        }
      } catch {
        if (!cancelled) {
          setLatestApkVersion(null);
        }
      }
    };

    void loadLatestApk();

    return () => {
      cancelled = true;
    };
  }, [auth.user]);



  const handleRemoteUnlock = async () => {
    if (!auth.user || !uid || !unlockPin.trim()) return;

    setUnlocking(true);
    setActionMessage(null);
    try {
      const result = await sendCommand(auth.user, uid, "REMOTE_UNLOCK", {
        pin: unlockPin.trim(),
      });
      setActionMessage(
        result.delivery === "queued"
          ? "Unlock command queued — device will receive it on next poll."
          : "Unlock command sent — device is entering the PIN…"
      );
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setUnlocking(false);
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

    setRemoveModalOpen(false);
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
  const newerApkAvailable = isNewerVersion(latestApkVersion, device.app_version);
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
            Locate Device
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
              className="btn-disconnect"
              onClick={() => void runCommand("STOP_REMOTE_ADMIN")}
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            className="btn-resync"
            onClick={() => void runCommand("RESYNC_DEVICE_INFO")}
          >
            Re-Sync Device Info
          </button>
          <button
            type="button"
            className="btn-lock"
            disabled={locking}
            onClick={() => setLockModalOpen(true)}
          >
            Lock Device
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

      <ConfirmModal
        open={showInactivityModal}
        title="Stay connected?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={handleKeepActive}
        onCancel={handleTerminateSession}
      >
        <p>
          You have been inactive for 5 minutes. The remote assist session will disconnect in {countdown} seconds unless you choose to stay connected.
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={removeModalOpen}
        title="Remove device?"
        confirmLabel="Remove Device & Clear Data"
        confirmClassName="btn-remove"
        onConfirm={() => void handleRemoveDevice()}
        onCancel={() => setRemoveModalOpen(false)}
      >
        <p>
          Remove &ldquo;{device.device_name}&rdquo; from the portal? This
          permanently deletes the device record, telemetry history, and event
          log. The phone can register again later as a new enrollment.
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
              <dd>{device.model_display}</dd>
            </div>
            <div className="info-list-app-version">
              <dt>App version</dt>
              <dd>{device.app_version ?? "—"}</dd>
              {newerApkAvailable ? (
                <p className="app-version-update-banner" role="status">
                  Newer application version available
                </p>
              ) : null}
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
        {remoteActive && deviceLocked && (
          <div className="remote-unlock-panel">
            <p className="remote-unlock-title">Device is locked</p>
            <p className="remote-unlock-reason">
              {deviceLockedReason ?? "PIN required for full access"}
            </p>
            <div className="remote-unlock-form">
              <input
                type="password"
                className="remote-unlock-input"
                placeholder="Device PIN"
                value={unlockPin}
                onChange={(event) => setUnlockPin(event.target.value)}
                autoComplete="off"
                aria-label="Device PIN"
              />
              <button
                type="button"
                className="btn-unlock"
                disabled={unlocking || !unlockPin.trim()}
                onClick={() => void handleRemoteUnlock()}
              >
                {unlocking ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </div>
        )}
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
          streamLayoutRevision={streamLayoutRevision}
          deviceOrientation={deviceOrientation}
          onActivity={handleActivity}
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
          className="btn-remove"
          disabled={removing}
          onClick={() => setRemoveModalOpen(true)}
        >
          {removing ? "Removing…" : "Remove Device & Clear Data"}
        </button>
      </section>
    </div>
  );
}
