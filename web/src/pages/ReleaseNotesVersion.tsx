import { Navigate, useParams } from "react-router-dom";
import { DocumentationToolbar } from "../components/DocumentationToolbar";
import { MarkdownGuide } from "../components/MarkdownGuide";
import { getReleaseNote } from "../guides/releaseNotes";

export function ReleaseNotesVersion() {
  const { version } = useParams<{ version: string }>();
  const note = getReleaseNote(version);

  if (!note) {
    return <Navigate to="/documentation/release-notes" replace />;
  }

  const pagePath = `/documentation/release-notes/${note.version}`;

  return (
    <div className="page release-notes-version-page">
      <div className="page-header documentation-guide-header">
        <DocumentationToolbar
          backTo="/documentation/release-notes"
          backLabel="← Release Notes"
          openInNewTabHref={pagePath}
        />
      </div>

      <section className="panel guide-panel">
        <MarkdownGuide content={note.content} />
      </section>
    </div>
  );
}
