import { documentationGuides } from "../config/documentationGuides";

export function Documentation() {
  return (
    <div className="page documentation-page">
      <div className="page-header">
        <h1>Documentation</h1>
        <p>User guides for the EUD Remote Assist portal and Android app.</p>
      </div>

      <section className="panel documentation-panel">
        <ul className="documentation-guide-list">
          {documentationGuides.map((guide) => (
            <li key={guide.href} className="documentation-guide-item">
              <a
                href={guide.href}
                className="documentation-guide-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {guide.title}
                <span className="documentation-guide-external" aria-hidden="true">
                  ↗
                </span>
              </a>
              <p className="documentation-guide-description">{guide.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
