# GitHub APK release lookup

The admin portal **Download** page and device **app version** banner read the latest `.apk` from GitHub Releases.

## Default behavior

With no token configured, the server uses **standard unauthenticated GitHub API** lookup. This works for public release repos but is subject to GitHub rate limits per server IP.

## Optional: GitHub token (recommended)

A **classic personal access token** with the **`public_repo`** scope gives this installation **unthrottled access to the GitHub repo** and improves reliability when checking for APK updates.

### Configure in the portal (recommended)

1. Sign in to the admin portal.
2. Open **Portal Configuration**.
3. Follow the on-screen steps to create a classic `public_repo` token.
4. Paste the token and click **Apply**.

The token is saved on the server at `data/portal-settings.json` (bind-mounted in Docker) and takes effect immediately — no container restart required.

### Configure in `.env` (optional)

Operators may instead set `GITHUB_TOKEN` in the repo root `.env` before starting Docker Compose. Environment tokens take precedence over the portal UI. Remove `GITHUB_TOKEN` from `.env` to manage the token from **Portal Configuration** instead.

```env
GITHUB_APK_REPO=owner/repo-with-apk-releases
GITHUB_TOKEN=ghp_xxxxxxxx
```

## Create a classic token (GitHub)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**.
2. **Generate new token (classic)** with the **`public_repo`** scope.
3. Copy the token (`ghp_...`) — GitHub shows it only once.

Use one token per portal installation. Do not share tokens across servers.

For a **public** APK repo owned by another organization, `public_repo` still works without collaborator access. Fine-grained tokens require repository access the token owner already has.

## Verify

Open **Download EUD Remote Assist .apk** in the portal or check **Portal Configuration** for an active token status.

## infra-TAK

Add `GITHUB_APK_REPO` to the gitignored `~/eud-remote-assist/.env`, or use **Portal Configuration** after deploy. Ensure `./data` is persisted on the host (default Docker bind mount).
