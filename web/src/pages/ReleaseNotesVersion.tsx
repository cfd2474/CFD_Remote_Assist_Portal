import { Navigate, useParams } from "react-router-dom";
import { DocumentationToolbar } from "../components/DocumentationToolbar";
import { MarkdownGuide } from "../components/MarkdownGuide";
import { useLiveReleaseNotes } from "../hooks/useLiveDocs";

export function ReleaseNotesVersion() {
  const { version } = useParams<{ version: string }>();
  const { notes, status } = useLiveReleaseNotes();
  const note = notes.find((n) => n.version === version);

  if (!note && status !== "checking") {
    return <Navigate to="/documentation/release-notes" replace />;
  }

  const pagePath = `/documentation/release-notes/${version}`;

  return (
    <div className="page release-notes-version-page">
      <div className="page-header documentation-guide-header">
        <DocumentationToolbar
          backTo="/documentation/release-notes"
          backLabel="← Release Notes"
          openInNewTabHref={pagePath}
          status={status}
        />
      </div>

      <section className="panel guide-panel">
        {note ? (
          <MarkdownGuide content={note.content} />
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Checking GitHub for version {version} release notes...
          </p>
        )}
      </section>
    </div>
  );
}
