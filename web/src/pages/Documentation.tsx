import { Link } from "react-router-dom";
import { GITHUB_REPO_URL } from "../config/portal";
import { documentationGuides } from "../guides";

export function Documentation() {
  return (
    <div className="page documentation-page">
      <div className="page-header">
        <h1>Documentation</h1>
        <p>User guides and release notes for the EUD Remote Assist portal.</p>
      </div>

      <section className="panel documentation-panel">
        <ul className="documentation-guide-list">
          <li className="documentation-guide-item">
            <Link
              to="/documentation/release-notes"
              className="documentation-guide-link"
            >
              Release Notes
            </Link>
            <p className="documentation-guide-description">
              Version history and changes for each portal release.
            </p>
          </li>
          {documentationGuides.map((guide) => (
            <li key={guide.slug} className="documentation-guide-item">
              <Link
                to={`/documentation/${guide.slug}`}
                className="documentation-guide-link"
              >
                {guide.title}
              </Link>
              <p className="documentation-guide-description">{guide.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="documentation-repo-link">
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub repository
        </a>
      </p>
    </div>
  );
}
