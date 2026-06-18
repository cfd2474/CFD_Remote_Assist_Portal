import { config } from "../config.js";
import { getEffectiveGithubToken } from "./portalSettings.js";

export interface LatestApkRelease {
  version: string;
  filename: string;
  downloadUrl: string;
  releaseTag: string;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

type SemverTriple = [number, number, number];

function parseApkVersion(filename: string, tagName: string): SemverTriple | null {
  const fileMatch = filename.match(/(\d+)\.(\d+)\.(\d+)/);
  if (fileMatch) {
    return [Number(fileMatch[1]), Number(fileMatch[2]), Number(fileMatch[3])];
  }
  const tagMatch = tagName.match(/(\d+)\.(\d+)\.(\d+)/);
  if (tagMatch) {
    return [Number(tagMatch[1]), Number(tagMatch[2]), Number(tagMatch[3])];
  }
  return null;
}

function formatVersion(version: SemverTriple): string {
  return version.join(".");
}

function compareVersions(a: SemverTriple, b: SemverTriple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

export async function getLatestApkRelease(): Promise<LatestApkRelease | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "eud-remote-assist-portal",
  };

  const token = getEffectiveGithubToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `https://api.github.com/repos/${config.github.repo}/releases?per_page=100`;
  const res = await fetch(url, { headers, cache: "no-store" });

  if (!res.ok) {
    if ((res.status === 403 || res.status === 401) && !getEffectiveGithubToken()) {
      throw new Error(
        `GitHub API returned ${res.status}. Add a GitHub token under Portal Configuration or set GITHUB_TOKEN in .env.`
      );
    }
    throw new Error(`GitHub releases request failed: ${res.status}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  let latest: LatestApkRelease | null = null;
  let latestVersion: SemverTriple | null = null;

  for (const release of releases) {
    for (const asset of release.assets) {
      if (!asset.name.toLowerCase().endsWith(".apk")) {
        continue;
      }

      const version = parseApkVersion(asset.name, release.tag_name);
      if (!version) {
        continue;
      }

      if (!latestVersion || compareVersions(version, latestVersion) > 0) {
        latestVersion = version;
        latest = {
          version: formatVersion(version),
          filename: asset.name,
          downloadUrl: asset.browser_download_url,
          releaseTag: release.tag_name,
        };
      }
    }
  }

  return latest;
}
