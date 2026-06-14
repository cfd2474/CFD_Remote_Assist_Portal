/** Update when a new APK is added to `resources/`. */
export const ANDROID_APK_FILENAME = "EUD_remote_assist.1.2.1.apk";

const GITHUB_REPO = "cfd2474/CFD_Remote_Assist_Portal";
const GITHUB_BRANCH = "main";

export function getApkVersion(filename = ANDROID_APK_FILENAME): string {
  const match = filename.match(/\.(\d+\.\d+\.\d+)\.apk$/i);
  return match?.[1] ?? "unknown";
}

export function getApkDownloadUrl(filename = ANDROID_APK_FILENAME): string {
  return `https://github.com/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/resources/${encodeURIComponent(filename)}`;
}
