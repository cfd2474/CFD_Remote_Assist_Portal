import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import {
  applyPortalGithubToken,
  clearPortalGithubToken,
  fetchPortalGithubConfig,
} from "../api/client";
import type { PortalGithubConfig } from "../types";

export function PortalConfiguration() {
  const auth = useAuth();
  const [config, setConfig] = useState<PortalGithubConfig | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadConfig = async () => {
    if (!auth.user) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchPortalGithubConfig(auth.user);
      setConfig(data);
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
    </div>
  );
}
