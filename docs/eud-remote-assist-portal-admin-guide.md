# EUD Remote Assist Portal — Administrator Guide

**Release 2.2.1**

The Remote Assist Portal is the web console for managing your fleet of company-owned Android devices. From a single browser you can see where every device is, confirm it's online, push a ping or location request, and take live control of the screen for hands-on support.

---

## 1. What the portal does

| Capability | Description |
|---|---|
| Device registry | Every enrolled device appears in one list with status, last check-in, model, and phone number. |
| Location tracking | Devices report location and battery on a set interval (default 15 min). |
| Ping | Make a device alert the user so they can locate it or confirm it's in hand. |
| Locate on demand | Force an immediate location report outside the normal interval. |
| Remote Assist | View the device screen live and drive it with remote touch (WebRTC). |
| Remove device | Delete a device and all of its data from the server. |

---

## 2. Signing in

The portal is protected by **single sign-on (OIDC / Authentik)**.

1. Open the portal URL in a browser (e.g. `https://<FQDN>`).
2. You'll be redirected to the Authentik login page.
3. Enter your admin credentials.
4. After login you land on the **Devices** list.

> Only accounts authorized in Authentik can reach the portal. Device APIs use a separate per-device secret and never log in here.

See [authentik-setup.md](authentik-setup.md) for identity provider configuration.

---

## 3. The Devices list

The landing page shows every registered device. For each one you'll typically see:

- **Device name** (e.g. `Tech-Support-Tablet-01`)
- **Status** — online / offline based on the last check-in
- **Last seen** — timestamp of the most recent telemetry
- **Battery** and **location** from the last pulse
- **Model** and **phone number**

Click any row to open the **Device detail** view.

---

## 4. Device detail & actions

The detail view is where you act on a single device. Available actions:

### Ping
Sends `TRIGGER_PING`. The device alerts so the user (or you, if it's nearby) can find it. The device replies with a `PING_ACKNOWLEDGED` event once the user responds.

### Locate
Sends `REQUEST_LOCATION` for an immediate position fix rather than waiting for the next scheduled pulse. Useful when a device just moved or hasn't checked in recently.

### Remote Assist (screen view + control)
1. Click **Start Remote Assist**. This sends `START_REMOTE_ADMIN`.
2. The device begins streaming its screen to your browser over WebRTC.
3. Click or tap on the streamed image to drive the device — each interaction is sent as a touch packet (`CLICK` with x/y as a percentage of the screen, so it works across any resolution).
4. Click **Stop Remote Assist** (`STOP_REMOTE_ADMIN`) when finished. Always stop the session when you're done so the device isn't left in a controllable state.

### Remove device
Deletes the device record and **all associated data** from the server. This does not wipe the device — it only removes it from the portal. The device would need to re-register to reappear.

---

## 5. Understanding delivery: instant vs. queued

Commands reach devices two ways:

- **Instant (WebSocket):** When a device holds an open `wss://.../ws/device` connection, ping/locate/remote-assist commands fire immediately. This is the normal, expected state.
- **Queued (fallback):** If the WebSocket is down, commands are held and delivered on the device's next telemetry POST or command poll — so they may lag by up to one tracking interval.

If an action seems slow or unresponsive, the most common cause is that the device's WebSocket isn't connected (poor signal, app backgrounded/killed, or network blocking `wss`).

---

## 6. Quick troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Device shows offline | No recent check-in | Device powered off, no network, or app not running. |
| Ping/Locate slow | WebSocket not connected | Command is queued; will arrive on next pulse. Confirm device has data/Wi-Fi. |
| Remote Assist won't start | Accessibility/screen-capture not granted on device | See the [App Deployment Guide](eud-remote-assist-app-deployment-guide.md) — accessibility service and media-projection permission must be active. |
| Device missing from list | Never registered or was removed | Confirm MDM pushed the app and managed config; re-register if needed. |
| Can't reach portal | OIDC/login issue | Confirm your Authentik account is authorized; check with your identity admin. |

---

## 7. Privacy & operational notes

- Remote Assist gives full live view and control of the device. Use it only for legitimate support, and stop the session when done.
- All admin access is tied to a named Authentik identity — actions are attributable.
- Removing a device deletes its server-side history; export anything you need first.

---

*EUD Remote Assist Portal · TAK-Solutions · mike@tak-solutions.com*
