# MDM Managed Configuration

Push this app restrictions bundle to the CFD Assist Android app via your EMM/MDM.

```xml
<restrictions>
  <restriction android:key="settings_password" android:restrictionType="string" />
  <restriction android:key="connection_secret" android:restrictionType="string" />
  <restriction android:key="tracking_server_url" android:restrictionType="string" />
  <restriction android:key="tracking_interval" android:restrictionType="integer" />
</restrictions>
```

## Values

| Key | Source |
|-----|--------|
| `settings_password` | Your org-defined PIN to block local app settings |
| `connection_secret` | Returned from `POST /api/v1/register` on first registration |
| `tracking_server_url` | Device API base URL: `https://remote.tak-solutions.com` (port 443) |
| `tracking_interval` | Minutes between location pulses (e.g. `15`) |

## Registration flow

1. Deploy app via MDM without `connection_secret` initially, or pre-generate secrets server-side.
2. On first launch, app calls `POST /api/v1/register` on the device port (see below).
3. Store returned `connection_secret` in MDM and push updated managed config.
4. App uses `connection_secret` in `X-Connection-Secret` header for telemetry, events, and WebSocket auth.

## Device API (HTTPS port 443)

Android devices use the **same hostname** as the admin portal — standard HTTPS port 443 (no custom port required):

| Endpoint | URL |
|----------|-----|
| Register | `POST https://remote.tak-solutions.com/api/v1/register` |
| Ping | `GET` or `POST https://remote.tak-solutions.com/api/v1/ping` (pass `uid`) |
| Telemetry | `POST https://remote.tak-solutions.com/api/v1/telemetry` |
| Events | `POST https://remote.tak-solutions.com/api/v1/event` |
| Health | `GET https://remote.tak-solutions.com/health` |
| Commands poll | `GET https://remote.tak-solutions.com/api/v1/commands` |
| WebSocket | `wss://remote.tak-solutions.com/ws/device` |

Set MDM `tracking_server_url` to `https://remote.tak-solutions.com`.

> Port **8443** remains available as a fallback if your network blocks non-standard ports.

Registration request (no auth required):

```json
{
  "uid": "<android_id>",
  "serial": "<serial>",
  "imei": "<imei>",
  "device_name": "Tech-Support-Tablet-01",
  "model": "Samsung SM-G991U",
  "phone_number": "+15551234567",
  "app_version": "1.0.0"
}
```

Registration response includes `connection_secret` — store it in MDM managed config.

## WebSocket endpoint

Devices connect to: `wss://remote.tak-solutions.com/ws/device`

**Required for instant admin commands** (ping, locate, remote assist). Without WebSocket, commands are queued and delivered on the next telemetry POST or `GET /api/v1/commands` poll.

Auth message (first frame):

```json
{
  "type": "auth",
  "uid": "<android_id>",
  "connection_secret": "<secret>"
}
```
