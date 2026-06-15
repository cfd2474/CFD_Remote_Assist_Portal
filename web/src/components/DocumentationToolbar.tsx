import { Link } from "react-router-dom";

type DocumentationToolbarProps = {
  backTo: string;
  backLabel: string;
  openInNewTabHref: string;
};

export function DocumentationToolbar({
  backTo,
  backLabel,
  openInNewTabHref,
}: DocumentationToolbarProps) {
  return (
    <div className="documentation-guide-toolbar">
      <p className="documentation-guide-back">
        <Link to={backTo}>{backLabel}</Link>
      </p>
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
