# Android App — Device API Port 8448 Handoff

**Date:** 2026-06-11  
**Audience:** Android / EUD app team  
**Production server:** `remote.tak-solutions.com`  
**Full integration spec:** [android-app-requirements.md](android-app-requirements.md)  
**MDM values:** [mdm-config.md](mdm-config.md)

---

## Executive summary

All **device** traffic (registration, REST API, WebSocket) must use **port 8448**, not 443.

| Traffic | Port | Used by app? |
|---------|------|:------------:|
| Admin portal (web UI, OIDC login) | **443** | No |
| Android device API + WebSocket | **8448** | **Yes** |

**MDM managed config** — set and read this value:

```text
tracking_server_url = https://remote.tak-solutions.com:8448
```

The app must build every device URL from `tracking_server_url`. Do **not** hard-code hostname or port.

---

## Why the change

Device API was previously reachable on port **8443** (and, on the current host, legacy nginx also exposes device routes on **443**). Production now uses **8448** so device traffic does not conflict with **TAK Server admin (8443)** on shared infra-TAK hosts.

**443 is for humans in the browser**, not for the Android app.

---

## What the app team must do

### 1. MDM / managed configuration

Push updated managed config to all enrolled devices:

| Key | New value |
|-----|-----------|
| `tracking_server_url` | `https://remote.tak-solutions.com:8448` |
| `connection_secret` | Unchanged (keep existing per-device secret) |
| `tracking_interval` | Unchanged |
| `settings_password` | Unchanged |

### 2. Code — use `tracking_server_url` everywhere

If the app already reads `tracking_server_url` from MDM and uses it for **all** HTTP and WebSocket calls, **no code change is required** — only the MDM value above.

If any of the following are hard-coded, update them to use `tracking_server_url`:

| Call | Correct pattern |
|------|-----------------|
| Registration | `POST {tracking_server_url}/api/v1/register` |
| Ping | `GET {tracking_server_url}/api/v1/ping?uid=…` |
| Telemetry | `POST {tracking_server_url}/api/v1/telemetry` |
| Events | `POST {tracking_server_url}/api/v1/event` |
| Command poll | `GET {tracking_server_url}/api/v1/commands` |
| WebSocket | `wss://` + host/port from `tracking_server_url` + `/ws/device` |

**Common mistake:** registration on one base URL but WebSocket hard-coded to `wss://remote.tak-solutions.com/ws/device` (port 443). WebSocket must use the **same** base URL as REST.

### 3. Registration response

After `POST /api/v1/register`, the server returns:

```json
{
  "uid": "568b166b3dd461eb",
  "connection_secret": "a1b2c3…",
  "tracking_server_url": "https://remote.tak-solutions.com:8448",
  "message": "Device registered. Store connection_secret in MDM managed config."
}
```

Persist and honor `tracking_server_url` from this response (it includes `:8448`). Do not strip the port or rewrite to 443.

### 4. What does **not** change

- API paths (`/api/v1/register`, `/api/v1/telemetry`, etc.)
- Auth: `X-Connection-Secret` header on authenticated REST calls
- WebSocket auth frame: `{ "type": "auth", "uid": "…", "connection_secret": "…" }`
- Request/response JSON schemas
- WebRTC, remote control, `REMOTE_UNLOCK`, and command handling

---

## Production endpoints (port 8448)

| Endpoint | URL |
|----------|-----|
| Health | `GET https://remote.tak-solutions.com:8448/health` |
| Register | `POST https://remote.tak-solutions.com:8448/api/v1/register` |
| Ping | `GET https://remote.tak-solutions.com:8448/api/v1/ping?uid=<uid>` |
| Telemetry | `POST https://remote.tak-solutions.com:8448/api/v1/telemetry` |
| Events | `POST https://remote.tak-solutions.com:8448/api/v1/event` |
| Commands | `GET https://remote.tak-solutions.com:8448/api/v1/commands` |
| WebSocket | `wss://remote.tak-solutions.com:8448/ws/device` |

Admin dashboard (for manual verification only): `https://remote.tak-solutions.com` (443).

---

## Verification checklist

- [ ] MDM `tracking_server_url` = `https://remote.tak-solutions.com:8448`
- [ ] App reads `tracking_server_url` from MDM (no hard-coded host/port)
- [ ] WebSocket uses same base URL as REST (not 443)
- [ ] Registration response `tracking_server_url` is stored/used as returned
- [ ] Device appears on admin dashboard with **Live** badge when WebSocket connected
- [ ] Telemetry and command poll succeed with `X-Connection-Secret`

### Quick smoke tests (from a workstation)

```bash
# Health
curl -sS https://remote.tak-solutions.com:8448/health

# Register (no auth)
curl -sS -X POST https://remote.tak-solutions.com:8448/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"uid":"smoke-test-001","device_name":"Smoke Test"}'

# WebSocket (wscat)
wscat -c wss://remote.tak-solutions.com:8448/ws/device
# first message: {"type":"auth","uid":"<uid>","connection_secret":"<secret>"}
```

Expected health response:

```json
{"status":"ok","service":"eud-remote-assist-portal","version":"2.2.0"}
```

---

## Legacy port 443 (do not rely on it)

On the current production host, device API routes on **443** have been removed. Use **8448** only.

---

## Rollout notes

1. Push MDM update with new `tracking_server_url` before or with the next app release.
2. Devices with old MDM (`https://remote.tak-solutions.com` without port, or `:8443`) may stop reporting after nginx cutover — prioritize fleet MDM update.
3. Existing `connection_secret` values remain valid; re-registration is not required unless the secret was lost.

---

## Questions / related docs

| Topic | Document |
|-------|----------|
| Full app integration | [android-app-requirements.md](android-app-requirements.md) |
| MDM keys and registration flow | [mdm-config.md](mdm-config.md) |
| WebRTC remote assist | [android-webrtc-requirements.md](android-webrtc-requirements.md) |
| Touch / keyboard control | [android-control-handler-handoff.md](android-control-handler-handoff.md) |
