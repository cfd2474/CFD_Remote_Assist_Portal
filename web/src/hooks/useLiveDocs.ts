import { useState, useEffect } from "react";
import { GITHUB_REPO_URL } from "../config/portal";
import { getDocumentationGuide, getGuideFilename } from "../guides";
import { parseReleaseNotes, ReleaseNote, releaseNotes as initialReleaseNotes } from "../guides/releaseNotes";

const getRawDocsUrl = (filename: string) => {
  return GITHUB_REPO_URL.replace("github.com", "raw.githubusercontent.com") + `/main/docs/${filename}`;
};

export function useLiveGuide(slug: string | undefined) {
  const guide = getDocumentationGuide(slug);
  const [content, setContent] = useState(guide?.content ?? "");
  const [status, setStatus] = useState<"cached" | "checking" | "updated" | "failed">("cached");

  useEffect(() => {
    if (!slug) return;
    const filename = getGuideFilename(slug);
    if (!filename) return;

    setStatus("checking");
    const url = getRawDocsUrl(filename);
    
    let active = true;
    fetch(url, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (active) {
          setContent(text);
          setStatus("updated");
        }
      })
      .catch((err) => {
        console.warn(`Failed to fetch live doc update for ${slug}:`, err);
        if (active) {
          setStatus("failed");
        }
      });

    return () => {
      active = false;
    };
  }, [slug]);

  return { content, status };
}

export function useLiveReleaseNotes() {
  const [notes, setNotes] = useState<ReleaseNote[]>(initialReleaseNotes);
  const [status, setStatus] = useState<"cached" | "checking" | "updated" | "failed">("cached");

  useEffect(() => {
    setStatus("checking");
    const url = getRawDocsUrl("RELEASE_NOTES.md");

    let active = true;
    fetch(url, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (active) {
          const parsed = parseReleaseNotes(text);
          if (parsed && parsed.length > 0) {
            setNotes(parsed);
            setStatus("updated");
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch live release notes update:", err);
        if (active) {
          setStatus("failed");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { notes, status };
}
