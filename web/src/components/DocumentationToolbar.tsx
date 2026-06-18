import { Link } from "react-router-dom";

type DocumentationToolbarProps = {
  backTo: string;
  backLabel: string;
  openInNewTabHref: string;
  status?: "cached" | "checking" | "updated" | "failed";
};

export function DocumentationToolbar({
  backTo,
  backLabel,
  openInNewTabHref,
  status,
}: DocumentationToolbarProps) {
  return (
    <div className="documentation-guide-toolbar">
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
        <p className="documentation-guide-back">
          <Link to={backTo}>{backLabel}</Link>
        </p>
        {status && (
          <span className={`doc-update-badge doc-update-badge-${status}`}>
            {status === "checking" && "Checking for updates..."}
            {status === "updated" && "Updated from GitHub"}
            {status === "failed" && "Offline (using cached version)"}
            {status === "cached" && "Using cached version"}
          </span>
        )}
      </div>
      <a
        href={openInNewTabHref}
        target="_blank"
        rel="noopener noreferrer"
        className="documentation-open-tab-button"
      >
        Open in New Tab
      </a>
    </div>
  );
}
