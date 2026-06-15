import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { resolveExternalDocHref, resolveGuideHref } from "../guides";

type MarkdownGuideProps = {
  content: string;
};

function GuideAnchor({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  if (!href) {
    return <>{children}</>;
  }

  const internal = resolveGuideHref(href);
  if (internal) {
    return <Link to={internal}>{children}</Link>;
  }

  if (href.startsWith("#")) {
    return <a href={href}>{children}</a>;
  }

  return (
    <a href={resolveExternalDocHref(href)} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) => <GuideAnchor href={href}>{children}</GuideAnchor>,
};

export function MarkdownGuide({ content }: MarkdownGuideProps) {
  return (
    <article className="guide-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
