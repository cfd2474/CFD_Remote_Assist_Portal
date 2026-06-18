import { Link } from "react-router-dom";
import { useLiveReleaseNotes } from "../hooks/useLiveDocs";

export function ReleaseNotesList() {
  const { notes, status } = useLiveReleaseNotes();

  return (
    <div className="page release-notes-page">
      <div className="page-header documentation-guide-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <p className="documentation-guide-back">
            <Link to="/documentation">← Documentation</Link>
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
        <h1>Release Notes</h1>
        <p>Select a version to view its changes.</p>
      </div>

      <section className="panel documentation-panel">
        <ul className="documentation-guide-list">
          {notes.map((note) => (
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
