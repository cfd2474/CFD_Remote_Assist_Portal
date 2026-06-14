import { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { fetchLatestApk } from "../api/client";
import type { LatestApkRelease } from "../types";

export function AppDownload() {
  const auth = useAuth();
  const [apk, setApk] = useState<LatestApkRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.user) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const latest = await fetchLatestApk(auth.user!);
        if (!cancelled) {
          setApk(latest);
        }
      } catch (err) {
        if (!cancelled) {
          setApk(null);
          setError(
            err instanceof Error ? err.message : "Failed to load latest APK"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  return (
    <div className="page app-download-page">
      <div className="page-header">
        <h1>Download EUD Remote Assist</h1>
        <p>Android application for managed device enrollment and remote assist.</p>
      </div>

      {loading && <p className="loading">Checking GitHub for the latest release…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && apk && (
        <section className="panel app-download-panel">
          <div className="app-download-hero">
            <a
              href={apk.downloadUrl}
              className="app-download-icon-link"
              download={apk.filename}
              rel="noopener noreferrer"
            >
              <img
                src="/eud-remote-assist-icon.png"
                alt="EUD Remote Assist app icon — click to download APK"
                className="app-download-icon"
              />
            </a>
            <div className="app-download-meta">
              <p className="app-download-version">
                Current version: <strong>{apk.version}</strong>
              </p>
              <p className="app-download-filename">{apk.filename}</p>
              <a
                href={apk.downloadUrl}
                className="app-download-button"
                download={apk.filename}
                rel="noopener noreferrer"
              >
                Download .apk
              </a>
              <p className="app-download-hint">
                Tap the app icon or use the button above to download the latest
                release from GitHub.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="panel app-download-screenshots">
        <h2>Screenshots</h2>
        <p className="app-download-screenshots-placeholder">
          Screenshots will be added here soon.
        </p>
      </section>
    </div>
  );
}
