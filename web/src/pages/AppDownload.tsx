import {
  ANDROID_APK_FILENAME,
  getApkDownloadUrl,
  getApkVersion,
} from "../config/appDownload";

const apkUrl = getApkDownloadUrl();
const apkVersion = getApkVersion();

export function AppDownload() {
  return (
    <div className="page app-download-page">
      <div className="page-header">
        <h1>Download EUD Remote Assist</h1>
        <p>Android application for managed device enrollment and remote assist.</p>
      </div>

      <section className="panel app-download-panel">
        <div className="app-download-hero">
          <a
            href={apkUrl}
            className="app-download-icon-link"
            download={ANDROID_APK_FILENAME}
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
              Current version: <strong>{apkVersion}</strong>
            </p>
            <p className="app-download-filename">{ANDROID_APK_FILENAME}</p>
            <a
              href={apkUrl}
              className="app-download-button"
              download={ANDROID_APK_FILENAME}
              rel="noopener noreferrer"
            >
              Download .apk
            </a>
            <p className="app-download-hint">
              Tap the app icon or use the button above to download from GitHub.
            </p>
          </div>
        </div>
      </section>

      <section className="panel app-download-screenshots">
        <h2>Screenshots</h2>
        <p className="app-download-screenshots-placeholder">
          Screenshots will be added here soon.
        </p>
      </section>
    </div>
  );
}
