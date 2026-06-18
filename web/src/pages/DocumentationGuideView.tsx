import { Navigate, useParams } from "react-router-dom";
import { DocumentationToolbar } from "../components/DocumentationToolbar";
import { MarkdownGuide } from "../components/MarkdownGuide";
import { getDocumentationGuide } from "../guides";
import { useLiveGuide } from "../hooks/useLiveDocs";

export function DocumentationGuideView() {
  const { slug } = useParams<{ slug: string }>();
  const guide = getDocumentationGuide(slug);
  const { content, status } = useLiveGuide(slug);

  if (!guide) {
    return <Navigate to="/documentation" replace />;
  }

  return (
    <div className="page documentation-guide-page">
      <div className="page-header documentation-guide-header">
        <DocumentationToolbar
          backTo="/documentation"
          backLabel="← Documentation"
          openInNewTabHref={`/documentation/${guide.slug}`}
          status={status}
        />
      </div>

      <section className="panel guide-panel">
        <MarkdownGuide content={content} />
      </section>
    </div>
  );
}
