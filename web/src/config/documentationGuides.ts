export type DocumentationGuide = {
  title: string;
  description: string;
  href: string;
};

const REPO_DOCS_BASE =
  "https://github.com/cfd2474/EUD_Remote_Assist_Portal/blob/main/docs";

export const documentationGuides: DocumentationGuide[] = [
  {
    title: "Portal Administrator Guide",
    description:
      "Sign in, manage devices, ping, locate, remote assist, and troubleshooting for admins.",
    href: `${REPO_DOCS_BASE}/eud-remote-assist-portal-admin-guide.md`,
  },
  {
    title: "App Deployment & Device Guide",
    description:
      "Deploy the Android app via MDM, managed configuration keys, registration, and device troubleshooting.",
    href: `${REPO_DOCS_BASE}/eud-remote-assist-app-deployment-guide.md`,
  },
];
