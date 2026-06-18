# EUD Remote Assist Portal — Release Notes

Running changelog for the **portal server and admin UI**. Update this file on every version release.

**Format:** Each release is wrapped in `RELEASE_START` / `RELEASE_END` HTML comments with a `version=` attribute. New entries are added **at the top** (newest first). Automation and the admin portal parse these blocks.

---

<!-- RELEASE_START version=2.2.26 -->
## Version 2.2.26

**Portal**

- Fix APK version parsing fallback logic to correctly identify target application versions from Github repository assets.

<!-- RELEASE_END version=2.2.26 -->

<!-- RELEASE_START version=2.2.25 -->
## Version 2.2.25

**Portal**

- Added **Export Device List** link at the bottom of the Devices page. Admins can select specific columns (UID, Name, Model, Phone number, App version, Agency, Last location coordinate, Last location seen date/time) to include in the exported CSV.
- The exported CSV file is named `EUD_export_<date/time>.csv`.
- Display the device name at the top of the data elements list in the individual device info panel.

<!-- RELEASE_END version=2.2.25 -->

<!-- RELEASE_START version=2.2.24 -->
## Version 2.2.24

**Portal**

- Disabled browser autocomplete/autofill on the PIN input field in the remote unlock modal to prevent automated browser values from overriding or interfering with PIN entries.

<!-- RELEASE_END version=2.2.24 -->

<!-- RELEASE_START version=2.2.23 -->
## Version 2.2.23

**Portal**

- Optimized remote unlock user experience (UX) flow and transitions.

<!-- RELEASE_END version=2.2.23 -->

<!-- RELEASE_START version=2.2.22 -->
## Version 2.2.22

**Portal**

- Modified lock device modal wording and verification constraints to match the new operational specifications.

<!-- RELEASE_END version=2.2.22 -->

<!-- RELEASE_START version=2.2.21 -->
## Version 2.2.21

**Portal**

- Implemented a WebRTC inactivity warning modal that automatically terminates active streaming sessions upon navigation, tab unload, or idle timeout.

<!-- RELEASE_END version=2.2.21 -->

<!-- RELEASE_START version=2.2.20 -->
## Version 2.2.20

**Portal**

- Optimized WebRTC connection signaling handshake offer delay and video capture warmup delay on the device to minimize connection latency.

<!-- RELEASE_END version=2.2.20 -->

<!-- RELEASE_START version=2.2.19 -->
## Version 2.2.19

**Portal**

- Fixed video panel size logic for device rotation state and added renegotiation guard rules.

<!-- RELEASE_END version=2.2.19 -->

<!-- RELEASE_START version=2.2.18 -->
## Version 2.2.18

**Portal**

- Request inbound keyframes on every `ORIENTATION_CHANGED` layout event to ensure rapid recovery.

<!-- RELEASE_END version=2.2.18 -->

<!-- RELEASE_START version=2.2.17 -->
## Version 2.2.17

**Portal**

- After applying a device-initiated renegotiation offer (rotation recovery or PeerConnection restart), re-attach the video element and schedule stream recovery so the viewer resumes when ICE restarts.

<!-- RELEASE_END version=2.2.17 -->

<!-- RELEASE_START version=2.2.16 -->
## Version 2.2.16

**Portal**

- Accept device-initiated WebRTC offers during an active stream (rotation renegotiation): answer with a new SDP answer instead of ignoring offers when `signalingState` is stable.
- HTTP signaling replay also applies renegotiation offers when the stream is already active.

<!-- RELEASE_END version=2.2.16 -->

<!-- RELEASE_START version=2.2.15 -->
## Version 2.2.15

**Portal**

- Reduce black screen on rotation when `ORIENTATION_CHANGED` arrives before landscape RTP decodes: panel aspect ratio now follows decoded video until `video.videoWidth/Height` updates (reintroduces v2.2.13 `mergeStreamDimensions` behavior).
- Request an inbound keyframe when layout hints (`ORIENTATION_CHANGED` / `CAPTURE_RESIZED`) change during an active stream.

<!-- RELEASE_END version=2.2.15 -->

<!-- RELEASE_START version=2.2.14 -->
## Version 2.2.14

**Portal**

- Revert WebRTC viewer connection setup to the v2.2.6 behavior (`useWebRtcViewer`, `RemoteViewer`, `streamDimensions`). Removes 2.2.12–2.2.13 changes: RTP-stats media verification, 90s media deadline, H.264 codec preference, rotation keyframe requests, and hint-vs-frame dimension merge logic.

<!-- RELEASE_END version=2.2.14 -->

<!-- RELEASE_START version=2.2.13 -->
## Version 2.2.13

**Portal**

- Fix black screen on device rotation: panel aspect ratio now follows the actual decoded video frame instead of flipping early on `ORIENTATION_CHANGED` hints.
- Request a keyframe when orientation/size hints change so the browser recovers quickly after capture resize.

**Documentation**

- Expanded [android-app-requirements.md](android-app-requirements.md) with full WebRTC diagnosis, control handling, and rotation requirements for the app team.
- Corrected WebRTC troubleshooting in [android-webrtc-requirements.md](android-webrtc-requirements.md) based on `chrome://webrtc-internals` evidence.

<!-- RELEASE_END version=2.2.13 -->

<!-- RELEASE_START version=2.2.12 -->
## Version 2.2.12

**Portal**

- Fix indefinite "establishing video stream" state: media timeouts now verify inbound RTP, not just track objects; 90s hard deadline after answer; frame-wait timer no longer resets on duplicate attach.
- H.264 added to WebRTC codec preferences alongside VP8/VP9.

**Documentation**

- Updated [android-webrtc-requirements.md](android-webrtc-requirements.md) for Android team review (connection_secret, ICE, track ordering, HTTP fallback, stuck-connecting symptoms).

<!-- RELEASE_END version=2.2.12 -->

<!-- RELEASE_START version=2.2.11 -->
## Version 2.2.11

**Portal**

- Stop sending duplicate WebRTC offers after the device SDP answer is received (fixes stalled remote assist and unexpected `REMOTE_SESSION_STOPPED` on device).
- Retry WebRTC button now forces a clean renegotiation when a session has failed.

<!-- RELEASE_END version=2.2.11 -->

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
