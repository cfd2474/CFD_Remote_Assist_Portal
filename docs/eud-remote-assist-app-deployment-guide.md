# EUD Remote Assist App — Deployment & Device Guide

The Remote Assist Android app is the client that runs on each managed device. It registers the device with the portal, reports location and battery on a schedule, and lets an authorized admin ping, locate, and remotely assist the device.

**MDM/EMM deployment is preferred** for fleet rollout and consistent configuration. The app can also be **installed manually on a device via APK** when MDM is not available.

---

## 1. Requirements

- Android device (tested on standard Android handsets).
- **MDM/EMM (preferred):** an EMM that can install the APK and push **managed configuration** (e.g. Watchtower / Sherpa, or any EMM supporting app restrictions).
- **Manual install (alternative):** the `.apk` file and access to the on-device settings screen to enter server URL and agency.
- Network access to the device API on **port 8448** (`https://<FQDN>:8448`).

> Port 8448 is used deliberately to avoid colliding with TAK Server admin on 8443 when co-hosted on an infra-TAK box.

---

## 2. Deploy by MDM or manual APK install

### Option A — MDM (preferred)

1. **Upload the APK** to your MDM and assign it to the target device group.
2. **Push managed configuration** (see next section).
3. **Install** on target devices.

MDM deployment (especially with Device Owner provisioning) allows **basic runtime permissions** to be accepted automatically on launch. **Special permissions** — including Accessibility and screen capture (media projection) — must still be **enabled manually** on the device for Remote Assist to work.

### Option B — Manual APK install

1. Download the latest `.apk` from the portal (**Download EUD Remote Assist .apk**).
2. Transfer and install the APK on the device (enable “Install unknown apps” if prompted).
3. Open the app and complete configuration on the device settings screen (see [Registration flow](#4-registration-flow)).

Without MDM, all permissions are prompted on the device. Grant basic permissions when asked, then enable special permissions manually before registering.

---

## 3. Managed configuration keys

When deploying via MDM, push these as the app restrictions bundle:

| Key | Type | Purpose | Example |
|---|---|---|---|
| `tracking_server_url` | string | Device API base URL | `https://<FQDN>:8448` |
| `tracking_interval` | integer | Minutes between location/battery pulses | `15` |
| `agency` | string | Org this device belongs to | `Pender EMS` |
| `settings_password` | string | PIN that locks the on-device settings page | *(your org PIN)* |
| `auto_grant_permissions` | bool | Auto-grant basic permissions on launch (**requires Device Owner**) | `true` |

See also [mdm-config.md](mdm-config.md) for API URLs and server-side details.

---

## 4. Registration flow

### Without MDM (manual APK install)

1. Launch the app and **accept all basic permissions** when prompted.
2. Open **Settings** and enter the **server URL** (`https://<FQDN>:8448`), **agency**, and other fields as needed.
3. Tap **Save**.
4. Enable **special permissions** (Accessibility, screen capture) if not already done.
5. Tap **Register**. The app calls `POST /api/v1/register` and stores the device credentials locally.

The device should appear in the portal device list shortly after a successful registration.

### With MDM managed configuration

1. Launch the app — basic permissions may be granted automatically if Device Owner and `auto_grant_permissions` are configured.
2. **Accept or enable special permissions** (Accessibility, screen capture) on the device.
3. Tap **Register**. Server URL, agency, and interval come from MDM managed config.

After registration, the app uses its stored credentials for telemetry, events, and the device WebSocket connection.

---

## 5. Permissions

The app requests a broad permission set so support staff can fully assist a device: location (incl. background), camera, microphone, screen capture (media projection), accessibility (for remote touch control), phone/SMS/contacts/calendar, and foreground-service permissions to keep tracking and assist sessions alive.

- **Basic permissions** — location, notifications, phone state, etc. MDM with Device Owner can auto-grant these when `auto_grant_permissions=true`.
- **Special permissions** — **Accessibility** and **screen capture** must be enabled manually on every device, including MDM-managed installs. Remote Assist will not work without them.

---

## 6. On-device settings page

There's a single settings screen on the device. With MDM, it is locked behind `settings_password` for field troubleshooting only — normal configuration should come from managed config.

For **manual APK installs**, this screen is where you enter server URL, agency, and interval before registering. Set a `settings_password` via MDM when available so users cannot change production settings after enrollment.

---

## 7. What the device does in the background

- **Heartbeat / ping check** — confirms the device UID is still registered.
- **Telemetry** — sends location + battery every `tracking_interval` minutes.
- **WebSocket** — holds an open `wss://.../ws/device` connection so admin commands (ping, locate, remote assist) arrive instantly. If it drops, commands queue and arrive on the next pulse.
- **Remote Assist** — on `START_REMOTE_ADMIN`, streams the screen and accepts remote touch until `STOP_REMOTE_ADMIN`.

---

## 8. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Device never appears in portal | Registration didn't complete | Confirm server URL uses `:8448` and the device has network access. Tap **Register** after saving settings. |
| Basic permissions not granted | Manual install or no Device Owner | Accept prompts on device; for MDM, enable Device Owner and `auto_grant_permissions`. |
| Remote Assist fails to start | Special permissions off | Enable **Accessibility** and **screen capture** manually on the device. |
| Commands lag | WebSocket disconnected | Check signal/data; commands deliver on next telemetry pulse meanwhile. |
| Location stale | Tracking interval too long, or background location denied | Lower `tracking_interval`; confirm background location is granted. |
| User changed settings | Settings page unlocked | Set a strong `settings_password` via MDM. |

---

*EUD Remote Assist App · TAK-Solutions · mike@tak-solutions.com*
