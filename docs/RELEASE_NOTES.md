# EUD Remote Assist Portal — Release Notes

Running changelog for the **portal server and admin UI**. Update this file on every version release.

**Format:** Each release is wrapped in `RELEASE_START` / `RELEASE_END` HTML comments with a `version=` attribute. New entries are added **at the top** (newest first). Automation and the admin portal parse these blocks.

---

<!-- RELEASE_START version=2.2.10 -->
## Version 2.2.10

**Server**

- WebRTC offers and ICE relayed to devices now include `connection_secret`, matching command auth and fixing Android "Secret mismatch" rejections during remote assist.

<!-- RELEASE_END version=2.2.10 -->

<!-- RELEASE_START version=2.2.9 -->
## Version 2.2.9

**Portal**

- **Portal Configuration** — optional GitHub classic `public_repo` token with Apply/Remove (no restart required).
- Default APK lookup remains standard unauthenticated GitHub access; token enables unthrottled repo access.
- Token persisted in `data/portal-settings.json` via Docker volume mount.

**Documentation**

- Added [github-apk-config.md](github-apk-config.md) for GitHub APK lookup and token setup.

<!-- RELEASE_END version=2.2.9 -->

<!-- RELEASE_START version=2.2.8 -->
## Version 2.2.8

**Portal**

- Footer now shows **Admin Portal version** with the installed release number.
- Added **Portal Configuration** nav link and placeholder page for upcoming advanced settings.

<!-- RELEASE_END version=2.2.8 -->

<!-- RELEASE_START version=2.2.7 -->
## Version 2.2.7

**Portal**

- Added a centered site footer with TAK-Solutions attribution, open-source license link, and installed portal version.
- Documentation index links to the GitHub repository at the bottom of the page.

<!-- RELEASE_END version=2.2.7 -->

<!-- RELEASE_START version=2.2.6 -->
## Version 2.2.6

**Portal**

- Added **Export all history** on the device location history page.
- Downloads a CSV of every stored location record (unsampled), filename includes device name and UID.

**API**

- Location history endpoint supports `?full=1` for complete export data (map/table still use sampled points).

<!-- RELEASE_END version=2.2.6 -->

<!-- RELEASE_START version=2.2.5 -->
## Version 2.2.5

**Portal**

- Device detail pages compare installed app version against the current APK release.
- Shows a yellow **Newer application version available** banner when the published APK is newer.

<!-- RELEASE_END version=2.2.5 -->

<!-- RELEASE_START version=2.2.4 -->
## Version 2.2.4

**Portal**

- Added row checkboxes and **select all** on the Managed Devices list.
- Added bulk **Remove Device & Clear Data** with the same confirmation modal as single-device removal.

<!-- RELEASE_END version=2.2.4 -->

<!-- RELEASE_START version=2.2.3 -->
## Version 2.2.3

**Portal**

- Added **Release Notes** under Documentation with a per-version index.
- Release notes are parsed from this file (`docs/RELEASE_NOTES.md`) and rendered in the portal with site styling.
- Each version has its own page; guide-style **Open in New Tab** is available on version detail pages.

**Documentation**

- Introduced `docs/RELEASE_NOTES.md` as the running release changelog (maintain on every version bump).

<!-- RELEASE_END version=2.2.3 -->

<!-- RELEASE_START version=2.2.2 -->
## Version 2.2.2

**Portal**

- Render user guides as in-portal markdown pages (no external GitHub links).
- Added **Managed Devices** subheader link (left); moved **Documentation** and **Download** to the right.
- Guide list opens in the same tab; added **Open in New Tab** on each guide page.

**Documentation**

- Updated app deployment guide for MDM-preferred and manual APK install flows.
- Removed vendor-specific MDM product references from docs.

<!-- RELEASE_END version=2.2.2 -->

<!-- RELEASE_START version=2.2.1 -->
## Version 2.2.1

**Documentation**

- Patch release for deployment guide and admin guide content updates.
- Deployment guide: MDM preferred, manual APK path, basic vs special permissions, simplified registration flow (no `connection_secret` in user-facing steps).

<!-- RELEASE_END version=2.2.1 -->

<!-- RELEASE_START version=2.2.0 -->
## Version 2.2.0

**Portal**

- Added **Documentation** page and subheader link.
- Published administrator and app deployment user guides in the repo.

**Documentation**

- Added `eud-remote-assist-portal-admin-guide.md` and `eud-remote-assist-app-deployment-guide.md`.

<!-- RELEASE_END version=2.2.0 -->

<!-- RELEASE_START version=2.1.1 -->
## Version 2.1.1

**Operations**

- Patch release to validate downstream version checking (`VERSION` file vs `GET /version` on port 8448).

<!-- RELEASE_END version=2.1.1 -->

<!-- RELEASE_START version=2.1.0 -->
## Version 2.1.0

**Deployment**

- **infra-TAK integration profile:** `NGINX_BIND_ADDR` and `HTTP_PORT` in `docker-compose.yml` (no compose file patching).
- Removed unused inner Docker HTTPS port mapping; external TLS (Caddy/host nginx) terminates TLS.
- Added `docs/infratak-integration.md`.
- `.gitignore` includes `docker-compose.override.yml`.

<!-- RELEASE_END version=2.1.0 -->

<!-- RELEASE_START version=2.0.0 -->
## Version 2.0.0

**Device API**

- Android device traffic moved to port **8448** (avoids conflict with TAK Server admin on 8443).
- Admin portal remains on **443**; device routes blocked on 443 in production nginx profile.

**Versioning**

- Root `VERSION` file, `GET /version`, and `version` field on `GET /health` (port 8448).
- Git tags `vX.Y.Z` matching `VERSION`.

**Documentation**

- Android device API port 8448 handoff for app team.
- Host nginx examples for admin-only 443 and device API 8448.

<!-- RELEASE_END version=2.0.0 -->
