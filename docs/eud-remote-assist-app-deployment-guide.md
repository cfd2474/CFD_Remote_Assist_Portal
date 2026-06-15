# EUD Remote Assist App — Deployment & Device Guide

The Remote Assist Android app is the client that runs on each managed device. It registers the device with the portal, reports location and battery on a schedule, and lets an authorized admin ping, locate, and remotely assist the device. It's designed to be deployed and configured **entirely through your MDM/EMM** — there is no manual end-user setup.

---

## 1. Requirements

- Android device (tested on standard Android handsets).
- An MDM/EMM that can install the APK and push **managed configuration** (e.g. Watchtower / Sherpa, or any EMM supporting app restrictions).
- **Device Owner** provisioning is strongly recommended so the app can auto-grant its permissions silently.
- Network access to the device API on **port 8448** (`https://<FQDN>:8448`).

> Port 8448 is used deliberately to avoid colliding with TAK Server admin on 8443 when co-hosted on an infra-TAK box.

---

## 2. Deploy via MDM

1. **Upload the APK** to your MDM and assign it to the target device group.
2. **Set the app as Device Owner** (during zero-touch / QR provisioning) if you want permissions granted automatically.
3. **Push managed configuration** (next section).
4. **Install.** On first launch the app self-registers and begins reporting.

---

## 3. Managed configuration keys

Push these as the app restrictions bundle:

| Key | Type | Purpose | Example |
|---|---|---|---|
| `tracking_server_url` | string | Device API base URL | `https://<FQDN>:8448` |
| `tracking_interval` | integer | Minutes between location/battery pulses | `15` |
| `agency` | string | Org this device belongs to | `Pender EMS` |
| `settings_password` | string | PIN that locks the on-device settings page | *(your org PIN)* |
| `connection_secret` | string | Per-device auth secret (see registration flow) | *(returned by server)* |
| `auto_grant_permissions` | bool | Auto-grant all system permissions on launch (**requires Device Owner**) | `true` |

See also [mdm-config.md](mdm-config.md) for the server-side registration flow and API URLs.

---

## 4. Registration flow

Registration is automatic, but here's what happens so you can manage the secret:

1. Deploy the app **without** `connection_secret` initially (or pre-generate secrets server-side).
2. On first launch the app calls `POST /api/v1/register` on port 8448, sending its Android ID, serial, IMEI, model, device name, phone number, and app version.
3. The server returns a **`connection_secret`**.
4. Store that secret back into the device's MDM managed config (`connection_secret`).
5. The app then uses it in the `X-Connection-Secret` header for all telemetry, events, and its WebSocket connection.

After this, the device appears in the portal's device list and starts checking in.

---

## 5. Permissions

The app requests a broad permission set so support staff can fully assist a device: location (incl. background), camera, microphone, screen capture (media projection), accessibility (for remote touch control), phone/SMS/contacts/calendar, and foreground-service permissions to keep tracking and assist sessions alive.

- With **Device Owner + `auto_grant_permissions=true`**, these are granted silently at launch — no user taps required.
- Without Device Owner, a user must grant them manually, and **Accessibility** and **screen capture** in particular must be enabled for Remote Assist to work.

---

## 6. On-device settings page

There's a single settings screen on the device, locked behind `settings_password`. It exists for field troubleshooting only — normal configuration should always come from MDM so it stays consistent and tamper-resistant. Without the password, the user can't change server URL, interval, or agency.

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
| Device never appears in portal | Registration didn't complete | Confirm `tracking_server_url` is set to the `:8448` URL and the device has network to it. |
| Permissions not granted | Not Device Owner | Re-provision as Device Owner, or grant manually; set `auto_grant_permissions=true`. |
| Remote Assist fails to start | Accessibility / screen capture off | Enable the accessibility service and media-projection permission on the device. |
| Commands lag | WebSocket disconnected | Check signal/data; commands deliver on next telemetry pulse meanwhile. |
| Location stale | Tracking interval too long, or background location denied | Lower `tracking_interval`; confirm background location is granted. |
| User changed settings | Settings page unlocked | Set a strong `settings_password` via MDM. |

---

*EUD Remote Assist App · TAK-Solutions · mike@tak-solutions.com*
