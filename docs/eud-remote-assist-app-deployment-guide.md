# EUD Remote Assist App — Deployment & Device Guide

The Remote Assist Android app is the client that runs on each managed device. It registers the device with the portal, reports location and battery on a schedule, and lets an authorized admin ping, locate, and remotely assist the device.

**MDM/EMM deployment is preferred** for fleet rollout and consistent configuration. The app can also be **installed manually on a device via APK** and registered by scanning a QR code when MDM is not available.

---

## 1. Requirements

- Android device (tested on standard Android handsets).
- **MDM/EMM (preferred):** an EMM that can install the APK and push **managed configuration** (any EMM supporting app restrictions).
- **Manual install (alternative):** the `.apk` file and the ability to scan a QR code from the portal.
- Network access to the device API on **port 8448** (`https://<FQDN>:8448`).

> Port 8448 is used deliberately to avoid colliding with TAK Server admin on 8443 when co-hosted on an infra-TAK box.

---

## 2. Deploy by MDM or manual APK install

### Option A — MDM (preferred)

1. **Generate an MDM Token** in the portal's Enrollment section.
2. **Upload the APK** to your MDM and assign it to the target device group.
3. **Push managed configuration** (see next section) using the JSON values provided by the portal.
4. **Install** on target devices.

MDM deployment allows **basic runtime permissions** to be accepted automatically on launch depending on your MDM capabilities. **Special permissions** — including Accessibility and screen capture (media projection) — must still be **enabled manually** on the device for Remote Assist to work.

### Option B — Manual APK install & QR Enrollment

1. **Generate a QR Token** in the portal's Enrollment section. Select an appropriate expiration limit (e.g., Single Use).
2. Download the latest `.apk` from the portal (**Download EUD Remote Assist .apk**).
3. Transfer and install the APK on the device (enable "Install unknown apps" if prompted).
4. Open the app, grant basic permissions, and tap the **Scan QR** button to scan the code from the portal.

---

## 3. Managed configuration keys

When deploying via MDM, copy the "MDM Provisioning Config" from the portal and push these keys as the app restrictions bundle:

| Key | Type | Purpose | Example |
|---|---|---|---|
| `enrollment_token` | string | Token used to authenticate the device during enrollment | `1234abcd...` |
| `tracking_server_url` | string | Device API base URL | `https://<FQDN>:8448` |
| `tls_pin_hash` | string | (Optional) Trust hash for self-signed certificates | `sha256/...` |
| `tracking_interval` | integer | (Optional) Minutes between location/battery pulses | `15` |

---

## 4. Registration flow

### With MDM managed configuration

1. Launch the app.
2. **Accept or enable special permissions** (Accessibility, screen capture) on the device.
3. Tap **Register**. The `enrollment_token` and `tracking_server_url` are automatically pulled from the MDM managed config.

After registration, the app secures a permanent device-specific identity and uses it for telemetry, events, and the device WebSocket connection. The enrollment token is no longer needed by that device.

### Without MDM (QR Code Enrollment)

1. Launch the app and **accept all basic permissions** when prompted.
2. Tap the button to scan a QR code.
3. Point the device camera at the QR token displayed in the portal.
4. Enable **special permissions** (Accessibility, screen capture) if not already done.
5. Tap **Register**. 

The device should appear in the portal device list shortly after a successful registration.

---

## 5. Permissions

The app requests a broad permission set so support staff can fully assist a device: location (incl. background), camera, microphone, screen capture (media projection), accessibility (for remote touch control), phone/SMS/contacts/calendar, and foreground-service permissions to keep tracking and assist sessions alive.

- **Basic permissions** — location, notifications, phone state, etc. 
- **Special permissions** — **Accessibility** and **screen capture** must be enabled manually on every device, including MDM-managed installs. Remote Assist will not work without them.

---

## 6. What the device does in the background

- **Heartbeat / ping check** — confirms the device UID is still registered.
- **Telemetry** — sends location + battery every `tracking_interval` minutes.
- **WebSocket** — holds an open `wss://.../ws/device` connection so admin commands (ping, locate, remote assist) arrive instantly. If it drops, commands queue and arrive on the next pulse.
- **Remote Assist** — on `START_REMOTE_ADMIN`, streams the screen and accepts remote touch until `STOP_REMOTE_ADMIN`.

---

## 7. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Device never appears in portal | Registration didn't complete | Confirm server URL uses `:8448` and the device has network access. Tap **Register** after scanning/configuring. |
| Remote Assist fails to start | Special permissions off | Enable **Accessibility** and **screen capture** manually on the device. |
| Commands lag | WebSocket disconnected | Check signal/data; commands deliver on next telemetry pulse meanwhile. |
| Location stale | Tracking interval too long, or background location denied | Lower `tracking_interval`; confirm background location is granted. |

---

*EUD Remote Assist App · TAK-Solutions · mike@tak-solutions.com*
