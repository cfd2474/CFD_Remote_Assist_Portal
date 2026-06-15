import { GITHUB_REPO_URL, PORTAL_VERSION } from "../config/portal";

export function AppFooter() {
  return (
    <footer className="app-footer">
      <p>
        Developed by TAK-Solutions, LLC.{" "}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open-source license
        </a>
        . Admin Portal version {PORTAL_VERSION}.
      </p>
    </footer>
  );
}
