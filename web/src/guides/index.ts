import portalAdminGuide from "../../../docs/eud-remote-assist-portal-admin-guide.md?raw";
import appDeploymentGuide from "../../../docs/eud-remote-assist-app-deployment-guide.md?raw";

export type DocumentationGuide = {
  slug: string;
  title: string;
  description: string;
  content: string;
};

export const documentationGuides: DocumentationGuide[] = [
  {
    slug: "portal-admin",
    title: "Portal Administrator Guide",
    description:
      "Sign in, manage devices, ping, locate, remote assist, and troubleshooting for admins.",
    content: portalAdminGuide,
  },
  {
    slug: "app-deployment",
    title: "App Deployment & Device Guide",
    description:
      "Deploy the Android app via MDM, managed configuration keys, registration, and device troubleshooting.",
    content: appDeploymentGuide,
  },
];

export function getDocumentationGuide(
  slug: string | undefined
): DocumentationGuide | undefined {
  return documentationGuides.find((guide) => guide.slug === slug);
}

export const guideFilenameBySlug: Record<string, string> = {
  "portal-admin": "eud-remote-assist-portal-admin-guide.md",
  "app-deployment": "eud-remote-assist-app-deployment-guide.md",
};

export function getGuideFilename(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  return guideFilenameBySlug[slug];
}

const slugByGuideFilename = Object.fromEntries(
  Object.entries(guideFilenameBySlug).map(([slug, filename]) => [filename, slug])
) as Record<string, string>;

export function resolveGuideHref(href: string): string | null {
  const filename = href.split("/").pop() ?? href;
  const slug = slugByGuideFilename[filename];
  return slug ? `/documentation/${slug}` : null;
}

const REPO_DOCS_BASE =
  "https://github.com/cfd2474/EUD_Remote_Assist_Portal/blob/main/docs";

export function resolveExternalDocHref(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return `${REPO_DOCS_BASE}/${href.replace(/^\.\//, "")}`;
}
