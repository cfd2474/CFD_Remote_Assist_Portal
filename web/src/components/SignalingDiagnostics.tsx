import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { fetchSignalingStatus } from "../api/client";
import type { SignalingStatus } from "../types";

interface SignalingDiagnosticsProps {
  uid: string;
  visible: boolean;
  liveStatus?: SignalingStatus | null;
  onHide?: () => void;
}

export function SignalingDiagnostics({
  uid,
  visible,
  liveStatus,
  onHide,
}: SignalingDiagnosticsProps) {
  const auth = useAuth();
  const [status, setStatus] = useState<SignalingStatus | null>(liveStatus ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (liveStatus) setStatus(liveStatus);
  }, [liveStatus]);

  useEffect(() => {
    if (!visible || !auth.user) return;

    const load = async () => {
      try {
        const data = await fetchSignalingStatus(auth.user!, uid);
        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load signaling status");
      }
    };

    void load();
    const interval = setInterval(() => void load(), 3000);
    return () => clearInterval(interval);
  }, [visible, auth.user, uid]);

  if (!visible && !status?.trace.length) return null;

  return (
    <div className="signaling-diagnostics">
      <div className="signaling-diagnostics-header">
        <h3>WebRTC signaling diagnostics</h3>
        {onHide && (
          <button type="button" className="btn-link" onClick={onHide}>
            Hide
          </button>
        )}
      </div>
      {!visible && status?.trace.length ? (
        <p className="remote-hint">
          Session ended — showing the last signaling trace from this attempt.
        </p>
      ) : null}
      {error && <p className="remote-error">{error}</p>}
      {status && (
        <>
          <dl className="signaling-stats">
            <div>
              <dt>Device WS</dt>
              <dd>{status.deviceWsConnected ? "Connected" : "Disconnected"}</dd>
            </div>
            <div>
              <dt>Offer sent</dt>
              <dd>{status.offerSent ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Answer received</dt>
              <dd>{status.answerReceived ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Admin ICE</dt>
              <dd>{status.adminIceCount}</dd>
            </div>
            <div>
              <dt>Device ICE</dt>
              <dd>{status.deviceIceCount}</dd>
            </div>
            <div>
              <dt>HTTP posts</dt>
              <dd>{status.deviceHttpPosts}</dd>
            </div>
          </dl>

          {status.issues.length > 0 && (
            <ul className="signaling-issues">
              {status.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          <table className="signaling-trace">
            <thead>
              <tr>
                <th>Time</th>
                <th>Dir</th>
                <th>Kind</th>
                <th>Channel</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {status.trace.length === 0 ? (
                <tr>
                  <td colSpan={5}>No signaling activity yet</td>
                </tr>
              ) : (
                status.trace.map((entry, i) => (
                  <tr key={`${entry.at}-${i}`}>
                    <td>{new Date(entry.at).toLocaleTimeString()}</td>
                    <td>{entry.direction}</td>
                    <td>{entry.kind}</td>
                    <td>{entry.channel}</td>
                    <td>{entry.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <p className="remote-hint">
            If WebSocket signaling fails, the app can use{" "}
            <code>GET /api/v1/signaling</code> to poll offers and{" "}
            <code>POST /api/v1/signaling</code> to send the SDP answer.
          </p>
        </>
      )}
    </div>
  );
}
