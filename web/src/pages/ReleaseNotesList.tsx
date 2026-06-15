import { Link } from "react-router-dom";
import { releaseNotes } from "../guides/releaseNotes";

export function ReleaseNotesList() {
  return (
    <div className="page release-notes-page">
      <div className="page-header documentation-guide-header">
        <p className="documentation-guide-back">
          <Link to="/documentation">← Documentation</Link>
        </p>
        <h1>Release Notes</h1>
        <p>Select a version to view its changes.</p>
      </div>

      <section className="panel documentation-panel">
        <ul className="documentation-guide-list">
          {releaseNotes.map((note) => (
            <li key={note.version} className="documentation-guide-item">
              <Link
                to={`/documentation/release-notes/${note.version}`}
                className="documentation-guide-link"
              >
                Version {note.version}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
