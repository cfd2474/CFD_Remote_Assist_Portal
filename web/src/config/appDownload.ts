/** Update when a new APK is published to GitHub Releases. */
export const ANDROID_APK_RELEASE_TAG = "EUD_remote_assist";
export const ANDROID_APK_FILENAME = "EUD_remote_assist.1.2.0.apk";

const GITHUB_REPO = "cfd2474/CFD_Remote_Assist_Portal";

export function getApkVersion(filename = ANDROID_APK_FILENAME): string {
  const match = filename.match(/\.(\d+\.\d+\.\d+)\.apk$/i);
  return match?.[1] ?? "unknown";
}

export function getApkDownloadUrl(
  filename = ANDROID_APK_FILENAME,
  releaseTag = ANDROID_APK_RELEASE_TAG
): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(filename)}`;
}
