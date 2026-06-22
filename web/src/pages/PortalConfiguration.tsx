import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import {
  applyPortalGithubToken,
  clearPortalGithubToken,
  fetchPortalConfig,
  applyPortalServerPort,
  applyPortalTurnSettings,
  clearPortalTurnSettings,
} from "../api/client";
import type { PortalGithubConfig } from "../types";

export function PortalConfiguration() {
  const auth = useAuth();
  const [config, setConfig] = useState<PortalGithubConfig | null>(null);
  const [token, setToken] = useState("");
  const [serverPort, setServerPort] = useState("8448");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [turnUrl, setTurnUrl] = useState("");
  const [turnUsername, setTurnUsername] = useState("");
  const [turnCredential, setTurnCredential] = useState("");

  const loadConfig = async () => {
    if (!auth.user) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchPortalConfig(auth.user);
      setConfig(data);
      setServerPort(data.serverPort.toString());
      setTurnUrl(data.turnServerUrl || "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load portal configuration"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, [auth.user]);

  const handleApply = async () => {
    if (!auth.user || !token.trim()) {
      return;
    }

    setApplying(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await applyPortalGithubToken(auth.user, token.trim());
      setConfig(data);
      setToken("");
      setSuccessMessage(
        "GitHub token applied. APK version checks now use unthrottled repo access."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply GitHub token");
    } finally {
      setApplying(false);
    }
  };

  const handleApplyPort = async () => {
    if (!auth.user) return;

    const portNum = parseInt(serverPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Please enter a valid port number (1-65535)");
      return;
    }

    setApplying(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await applyPortalServerPort(auth.user, portNum);
      setConfig(data);
      setSuccessMessage("Server port successfully updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply Server Port");
    } finally {
      setApplying(false);
    }
  };

  const handleClear = async () => {
    if (!auth.user) {
      return;
    }

    setClearing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await clearPortalGithubToken(auth.user);
      setConfig(data);
      setToken("");
      setSuccessMessage(
        "GitHub token removed. The portal will use standard unauthenticated GitHub lookup."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear GitHub token");
    } finally {
      setClearing(false);
    }
  };

  const handleApplyTurn = async () => {
    if (!auth.user || !turnUrl.trim()) return;
    setApplying(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const data = await applyPortalTurnSettings(
        auth.user,
        turnUrl.trim(),
        turnUsername.trim(),
        turnCredential.trim()
      );
      setConfig(data);
      setSuccessMessage("TURN server settings applied.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply TURN settings");
    } finally {
      setApplying(false);
    }
  };

  const handleClearTurn = async () => {
    if (!auth.user) return;
    setClearing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const data = await clearPortalTurnSettings(auth.user);
      setConfig(data);
      setTurnUrl("");
      setTurnUsername("");
      setTurnCredential("");
      setSuccessMessage("TURN server settings removed. Devices will use standard STUN.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear TURN settings");
    } finally {
      setClearing(false);
    }
  };

  const envManaged = config?.tokenSource === "environment";
  const portalManaged = config?.tokenSource === "portal";

  return (
    <div className="page portal-configuration-page">
      <div className="page-header">
        <h1>Portal Configuration</h1>
        <p>Site settings for this portal installation.</p>
      </div>

      {loading ? <p className="loading">Loading configuration…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {successMessage ? <p className="action-message">{successMessage}</p> : null}

      {config ? (
        <section className="panel portal-config-panel">
          <h2>GitHub APK access</h2>
          <p className="portal-config-intro">
            The Download page and device app-version checks read release metadata
            from <strong>{config.apkRepo}</strong>. By default the portal uses
            standard unauthenticated GitHub lookup. Adding a personal access token
            gives this server <strong>unthrottled access to the GitHub repo</strong>{" "}
            and improves reliability when checking for the latest APK.
          </p>

          <div className="portal-config-status">
            {config.tokenConfigured ? (
              <span className="badge badge-online">
                {envManaged
                  ? "Token configured in server environment (.env)"
                  : "GitHub token active"}
              </span>
            ) : (
              <span className="badge badge-offline">Using standard lookup (no token)</span>
            )}
          </div>

          <div className="portal-config-instructions">
            <h3>Create a classic GitHub token</h3>
            <ol>
              <li>
                Sign in to GitHub and open <strong>Settings</strong> →{" "}
                <strong>Developer settings</strong> →{" "}
                <strong>Personal access tokens</strong> →{" "}
                <strong>Tokens (classic)</strong>.
              </li>
              <li>Choose <strong>Generate new token (classic)</strong>.</li>
              <li>
                Select the <strong>public_repo</strong> scope (read access to public
                repositories).
              </li>
              <li>Generate the token and copy the value (shown once).</li>
              <li>Paste it below and click <strong>Apply</strong>.</li>
            </ol>
            <p className="portal-config-note">
              Use a token created on <em>this</em> server&apos;s GitHub account.
              Do not share tokens between installations.
            </p>
          </div>

          {envManaged ? (
            <p className="portal-config-env-note">
              A GitHub token is already set via <code>GITHUB_TOKEN</code> in the
              server <code>.env</code> file. Remove it there to manage the token
              from this page instead.
            </p>
          ) : (
            <div className="portal-config-form">
              <label className="filter-field portal-config-token-field">
                <span>GitHub classic token (public_repo)</span>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_xxxxxxxx"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="portal-config-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={applying || !token.trim()}
                  onClick={() => void handleApply()}
                >
                  {applying ? "Applying…" : "Apply"}
                </button>
                {portalManaged ? (
                  <button
                    type="button"
                    disabled={clearing}
                    onClick={() => void handleClear()}
                  >
                    {clearing ? "Removing…" : "Remove token"}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {config ? (
        <section className="panel portal-config-panel" style={{ marginTop: "2rem" }}>
          <h2>Tracking Server Port</h2>
          <p className="portal-config-intro">
            Set the port used by the device tracking server. The QR builder will automatically
            reference this port when building the configuration URL for new devices.
          </p>
          <div className="portal-config-form">
            <label className="filter-field portal-config-token-field">
              <span>Server Port</span>
              <input
                type="number"
                value={serverPort}
                onChange={(event) => setServerPort(event.target.value)}
                placeholder="8448"
                min="1"
                max="65535"
              />
            </label>
            <div className="portal-config-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={applying || !serverPort}
                onClick={() => void handleApplyPort()}
              >
                {applying ? "Saving…" : "Save Port"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {config ? (
        <section className="panel portal-config-panel" style={{ marginTop: "2rem" }}>
          <h2>Alternate TURN/STUN Server</h2>
          <p className="portal-config-intro">
            Define a custom TURN or STUN server to be used by Android devices when establishing
            the WebRTC connection. This is required if the device is on a network that blocks standard
            WebRTC traffic.
          </p>

          <div className="portal-config-status">
            {config.turnServerUrl ? (
              <span className="badge badge-online">
                Active: {config.turnServerUrl} {config.turnCredentialConfigured ? "(Authenticated)" : ""}
              </span>
            ) : (
              <span className="badge badge-offline">Using default STUN server (stun.l.google.com:19302)</span>
            )}
          </div>

          <div className="portal-config-form">
            <label className="filter-field portal-config-token-field">
              <span>Server URL</span>
              <input
                type="text"
                value={turnUrl}
                onChange={(event) => setTurnUrl(event.target.value)}
                placeholder="turn:turn.domain.com:port"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="filter-field portal-config-token-field">
              <span>Username (Optional)</span>
              <input
                type="text"
                value={turnUsername}
                onChange={(event) => setTurnUsername(event.target.value)}
                placeholder="username"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="filter-field portal-config-token-field">
              <span>Credential/Password (Optional)</span>
              <input
                type="password"
                value={turnCredential}
                onChange={(event) => setTurnCredential(event.target.value)}
                placeholder="password"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="portal-config-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={applying || !turnUrl.trim()}
                onClick={() => void handleApplyTurn()}
              >
                {applying ? "Applying…" : "Apply"}
              </button>
              {config.turnServerUrl ? (
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => void handleClearTurn()}
                >
                  {clearing ? "Removing…" : "Remove TURN Config"}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
