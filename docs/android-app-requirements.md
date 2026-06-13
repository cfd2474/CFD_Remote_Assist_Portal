# Android App — Server Integration Requirements

This document describes everything the CFD Assist Android app must implement to work with the **CFD Remote Assist Portal** at `https://remote.tak-solutions.com`.

Use this as the primary integration spec for app developers. Related docs:

- [mdm-config.md](mdm-config.md) — EMM managed configuration keys
- [android-webrtc-requirements.md](android-webrtc-requirements.md) — WebRTC remote assist details

---

## 1. Server URLs

| Purpose | URL |
|---------|-----|
| **Base URL (MDM `tracking_server_url`)** | `https://remote.tak-solutions.com` |
| Register | `POST /api/v1/register` |
| Ping | `GET` or `POST /api/v1/ping` |
| Telemetry | `POST /api/v1/telemetry` |
| Events | `POST /api/v1/event` |
| Command poll | `GET /api/v1/commands` |
| Health check | `GET /health` |
| Device WebSocket | `wss://remote.tak-solutions.com/ws/device` |

**Port 443 is required.** Do not hard-code port 8443 unless your network blocks 443 — 8443 is a fallback only.

All requests must use **HTTPS/WSS** with valid TLS (Let's Encrypt on production).

---

## 2. MDM managed configuration

Push these restriction keys via your EMM/MDM:

| Key | Type | Description |
|-----|------|-------------|
| `tracking_server_url` | string | `https://remote.tak-solutions.com` |
| `connection_secret` | string | Hex secret from registration (see §3) |
| `tracking_interval` | integer | Minutes between location telemetry (e.g. `15`) |
| `settings_password` | string | Org-defined PIN to lock local app settings |

Example restriction schema:

```xml
<restrictions>
  <restriction android:key="settings_password" android:restrictionType="string" />
  <restriction android:key="connection_secret" android:restrictionType="string" />
  <restriction android:key="tracking_server_url" android:restrictionType="string" />
  <restriction android:key="tracking_interval" android:restrictionType="integer" />
</restrictions>
```

The app must read `tracking_server_url` and append API paths — do not bake in a separate hostname.

---

## 3. Device identity and registration

### UID

Use the device **Android ID** (`Settings.Secure.ANDROID_ID`) as `uid`. This is the primary key on the server.

### First registration

`POST {tracking_server_url}/api/v1/register`

**Authentication:** None

**Request body** (only `uid` is strictly required; include others when available):

```json
{
  "uid": "568b166b3dd461eb",
  "serial": "R58M123456X",
  "imei": "352637001234567",
  "device_name": "Galaxy XCover6 Pro",
  "model": "Samsung SM-G736U",
  "phone_number": "+15551234567",
  "app_version": "1.2.0"
}
```

The server also accepts camelCase aliases: `androidId`, `deviceName`, `phoneNumber`, `appVersion`.

**Response (201 new / 200 re-register):**

```json
{
  "uid": "568b166b3dd461eb",
  "connection_secret": "a1b2c3d4e5f6...",
  "tracking_server_url": "https://remote.tak-solutions.com",
  "message": "Device registered. Store connection_secret in MDM managed config."
}
```

**App responsibilities:**

1. Call register on first launch if no `connection_secret` is available.
2. Persist `connection_secret` locally (encrypted) and report it to MDM for managed config push.
3. Re-call register on app upgrade if device metadata changed (optional but recommended).

---

## 4. Authentication (all requests after registration)

Send the device secret on every authenticated REST call:

```
X-Connection-Secret: <connection_secret>
```

Alternative (also supported):

```
Authorization: Bearer <connection_secret>
```

For `GET /api/v1/commands`, the secret alone is sufficient — **uid is not required** in the request. The server resolves the device from the secret.

Invalid or missing secret → `401 Unauthorized`.

---

## 5. REST endpoints

### 5.1 Ping (connectivity check)

Used by the in-app **"Ping Management Server"** button.

`GET {base}/api/v1/ping?uid=<uid>`

or

`POST {base}/api/v1/ping` with body/query containing `uid`.

**Authentication:** None (uid only)

**Response 200:**

```json
{
  "ok": true,
  "uid": "568b166b3dd461eb",
  "device_name": "Galaxy XCover6 Pro"
}
```

**Response 404:** Device not registered — call `/register` first.

---

### 5.2 Telemetry

`POST {base}/api/v1/telemetry`

**Headers:** `X-Connection-Secret`, `Content-Type: application/json`

**Request body:**

```json
{
  "uid": "568b166b3dd461eb",
  "lat": 39.7392,
  "lon": -104.9903,
  "battery": 87,
  "is_charging": false,
  "timestamp": 1718294400000
}
```

**Response 200:**

```json
{
  "ok": true,
  "commands": [
    {
      "type": "command",
      "command": "TRIGGER_PING",
      "connection_secret": "a1b2c3..."
    }
  ]
}
```

The `commands` array may contain zero or more pending admin commands. **Process every command** in the response (same format as WebSocket commands — see §7).

Send telemetry on the MDM `tracking_interval` schedule and whenever location/battery changes significantly.

---

### 5.3 Events

`POST {base}/api/v1/event`

**Headers:** `X-Connection-Secret`, `Content-Type: application/json`

**Request body:**

```json
{
  "uid": "568b166b3dd461eb",
  "event": "PING_COMPLETED",
  "payload": {
    "latency_ms": 42
  }
}
```

**Response 200:** `{ "ok": true }`

Use for operational events the admin portal should see (ping results, errors, remote session state, etc.).

---

### 5.4 Command poll (fallback delivery)

`GET {base}/api/v1/commands`

**Headers:** `X-Connection-Secret`

**Response 200:**

```json
{
  "commands": [
    {
      "type": "command",
      "command": "REQUEST_LOCATION",
      "connection_secret": "a1b2c3..."
    }
  ]
}
```

**Poll every 30 seconds** when the app is running, even if WebSocket is connected (WebSocket is preferred for instant delivery; poll is the fallback).

When the server restarts, queued commands are delivered on the next poll or on WebSocket reconnect.

---

## 6. WebSocket (required)

A **persistent WebSocket** to `wss://remote.tak-solutions.com/ws/device` is required for:

- Instant command delivery (ping, locate, remote assist)
- WebRTC signaling for remote screen viewing
- Remote touch control packets

HTTP polling alone works for basic commands with ~30s delay but **cannot** support remote assist.

### 6.1 Connection lifecycle

1. Open WebSocket to `{tracking_server_url}` with path `/ws/device` (scheme `wss://`).
2. Send auth frame within **10 seconds** or the server closes with code `4001`.
3. On `auth_ok`, mark connection live and process any commands the server may push immediately.
4. **Reconnect automatically** on disconnect, network change, app restart, and **server restart**. Exponential backoff (e.g. 1s → 2s → 5s → 30s max).
5. Run the WebSocket in a **foreground service** so Android does not kill it.

### 6.2 Auth frame (first message only)

```json
{
  "type": "auth",
  "uid": "568b166b3dd461eb",
  "connection_secret": "a1b2c3d4e5f6..."
}
```

**Server response:**

```json
{
  "type": "auth_ok",
  "uid": "568b166b3dd461eb"
}
```

On auth failure the server closes with code `4003`.

After auth, the server may immediately send queued commands as `{ type: "command", ... }` messages.

### 6.3 Keepalive

The server responds to app-initiated keepalive:

**Send:** `{ "type": "ping" }`  
**Receive:** `{ "type": "pong" }`

Send a ping every 30–60s if no other traffic.

### 6.4 Incoming message types (after auth)

| `type` | Action |
|--------|--------|
| `command` | Handle admin command (§7) |
| `webrtc` | WebRTC signaling for remote assist (§8) |
| `control` | Remote touch/key input (§9) |
| `pong` | Keepalive response |
| `error` | Log and continue |

### 6.5 Outgoing message types (after auth)

| `type` | Purpose |
|--------|---------|
| `webrtc` | SDP answer and ICE candidates after receiving admin offer (§8) — **required for remote view** |
| `webrtc_ready` | Optional signal that screen capture has started; portal sends offer immediately |
| `device_event` | Push real-time events to admin portal |
| `ping` | Keepalive |

**Device event example:**

```json
{
  "type": "device_event",
  "uid": "568b166b3dd461eb",
  "event": "REMOTE_SESSION_STARTED",
  "payload": {}
}
```

---

## 7. Admin commands

Commands arrive via **WebSocket** (instant) or **telemetry/commands poll** (queued).

### Message format

```json
{
  "type": "command",
  "command": "TRIGGER_PING",
  "connection_secret": "a1b2c3d4e5f6..."
}
```

Verify `connection_secret` matches the device's stored secret before acting (defense in depth).

### Command types

| Command | App action |
|---------|------------|
| `TRIGGER_PING` | Run connectivity check; POST event or telemetry with result |
| `REQUEST_LOCATION` | Obtain current GPS fix; POST telemetry with lat/lon |
| `START_REMOTE_ADMIN` | Start screen capture + WebRTC session (§8) |
| `STOP_REMOTE_ADMIN` | Tear down WebRTC and screen capture immediately |

After handling any command, POST an event if useful for admin visibility:

```json
{
  "uid": "...",
  "event": "COMMAND_HANDLED",
  "payload": { "command": "TRIGGER_PING" }
}
```

---

## 8. Remote assist (WebRTC)

Full detail: [android-webrtc-requirements.md](android-webrtc-requirements.md)

### Prerequisites

- Live WebSocket to `/ws/device`
- `MediaProjection` / screen-capture permission
- Foreground service while streaming

### Flow

1. Admin clicks **Connect** → device receives `START_REMOTE_ADMIN`.
2. Start screen capture (30 fps, half resolution is acceptable).
3. Create `PeerConnection` with STUN: `stun:stun.l.google.com:19302`.
4. Admin sends WebRTC **offer** via WebSocket relay.
5. Device sets remote description, creates **answer**, sends it back on the **same WebSocket** (see below).
6. Both sides exchange ICE candidates on the WebSocket.
7. Video streams to admin browser.
8. Admin sends `STOP_REMOTE_ADMIN` → tear down immediately.

**Optional:** After screen capture starts, send `{ "type": "webrtc_ready" }` so the portal sends the offer immediately instead of waiting 3 seconds.

**Required answer (device → server → admin):**

```json
{
  "type": "webrtc",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

Without this message, remote view will fail even if the app shows "remote connected" locally.

### ICE candidates are required (common failure)

Sending only the SDP **answer** is not enough. The portal diagnostics will show **Answer received: Yes** but **Device ICE: 0** and video will not start.

After `createAnswer()`, register `PeerConnection.Observer.onIceCandidate` (or equivalent) and **send every candidate** to the server:

```json
{
  "type": "webrtc",
  "ice": {
    "candidate": "candidate:842163049 1 udp 1677729535 203.0.113.10 54400 typ srflx ...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

Send each candidate on the **same WebSocket** used for the answer, or `POST /api/v1/signaling` per candidate.

Do **not** reconnect the WebSocket during an active remote session — it disrupts signaling and causes the portal to briefly show the device as offline. Keep one persistent connection open for the entire session.

If using trickle ICE, candidates arrive after the answer; both are required. Bundling all candidates inside the SDP string can work but only if the SDP actually contains `a=candidate:` lines.

### HTTP signaling fallback (recommended)

If WebSocket signaling is unreliable, use these REST endpoints in parallel:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/signaling` | Poll pending admin offers and ICE (same auth header) |
| `POST /api/v1/signaling` | Post SDP answer and device ICE candidates |

**Poll admin messages** (after `START_REMOTE_ADMIN`):

```
GET {base}/api/v1/signaling
X-Connection-Secret: <secret>
```

Response:

```json
{
  "messages": [
    { "type": "webrtc", "sdp": { "type": "offer", "sdp": "v=0\r\n..." } },
    { "type": "webrtc", "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }
  ]
}
```

**Post SDP answer**:

```
POST {base}/api/v1/signaling
X-Connection-Secret: <secret>
Content-Type: application/json
```

```json
{
  "type": "webrtc",
  "sdp": { "type": "answer", "sdp": "v=0\r\n..." }
}
```

The server accepts many formats (`type: "answer"` with string `sdp`, nested `payload`, etc.) and normalizes them.

After `START_REMOTE_ADMIN`, the server may also send a `signaling_hint` WebSocket message or include `signaling_hint` in command/telemetry responses with exact expected formats.

### Signaling format (canonical)

**Session description:**

```json
{
  "type": "webrtc",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

```json
{
  "type": "webrtc",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

**ICE candidate:**

```json
{
  "type": "webrtc",
  "ice": {
    "candidate": "candidate:842163049 1 udp 1677729535 192.168.1.100 54400 typ srflx ...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

The portal relays messages unchanged between admin and device for the same `uid`. The device **must send an SDP answer** after receiving an offer — without it the admin sees a black screen.

Legacy formats (`candidate` instead of `ice`, or raw `sdp` without `type: "webrtc"`) are accepted by the server but the canonical format above is preferred.

---

## 9. Remote control (touch input)

During an active remote session, the admin may send touch packets on the device WebSocket:

**Click:**

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.52,
  "y_percent": 0.41
}
```

**Swipe:**

```json
{
  "type": "control",
  "action": "SWIPE",
  "x_percent": 0.10,
  "y_percent": 0.50,
  "x2_percent": 0.90,
  "y2_percent": 0.50
}
```

**Long-press (right-click on portal):**

```json
{
  "type": "control",
  "action": "LONG_PRESS",
  "x_percent": 0.52,
  "y_percent": 0.41
}
```

**Key (navigation / text):**

```json
{
  "type": "control",
  "action": "KEY",
  "key": "BACK"
}
```

Supported `key` values include Android navigation keys (`BACK`, `HOME`, `RECENTS`), arrow keys (`DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`), and typed characters (`a`, `Enter`, `Space`, `Backspace`, etc.). Modifier combos are sent as `Ctrl+c`, `Shift+A`, etc.

When the admin portal video panel is focused, all keyboard input is forwarded as `KEY` packets until the admin presses **⌘+Esc** (Mac) or **Ctrl+Esc** (Windows/Linux).

Coordinates are **0.0–1.0** fractions of screen width/height. Inject input via accessibility service or device-owner APIs as appropriate.

---

## 10. Background behavior requirements

| Requirement | Detail |
|-------------|--------|
| WebSocket | Persistent foreground service; auto-reconnect with backoff |
| Command poll | `GET /api/v1/commands` every **30s** while app/process is active |
| Telemetry | On `tracking_interval` from MDM (e.g. every 15 minutes) |
| Server restart | Reconnect WebSocket; poll will deliver any queued commands |
| Network change | Reconnect WebSocket immediately on Wi‑Fi ↔ cellular switch |
| Boot | Start tracking service on `BOOT_COMPLETED` if MDM policy requires |

---

## 11. Implementation checklist

### Registration and auth

- [ ] Read `tracking_server_url` from MDM managed config
- [ ] Register with `POST /api/v1/register` if no secret exists
- [ ] Store and use `connection_secret` on all authenticated calls
- [ ] Send `X-Connection-Secret` header (or Bearer token)

### REST

- [ ] Ping button calls `GET /api/v1/ping?uid=...`
- [ ] Periodic telemetry POST with location and battery
- [ ] Event POST for operational logging
- [ ] Poll `GET /api/v1/commands` every 30s
- [ ] Process `commands[]` from telemetry and poll responses

### WebSocket

- [ ] Connect to `wss://{host}/ws/device`
- [ ] Send auth frame within 10s of connect
- [ ] Auto-reconnect on disconnect and after server restart
- [ ] Handle incoming `command`, `webrtc`, and `control` messages
- [ ] Send keepalive `ping` / handle `pong`

### Commands

- [ ] `TRIGGER_PING` — respond with event/telemetry
- [ ] `REQUEST_LOCATION` — POST telemetry with current fix
- [ ] `START_REMOTE_ADMIN` — start capture + WebRTC
- [ ] `STOP_REMOTE_ADMIN` — stop capture + WebRTC

### Remote assist

- [ ] MediaProjection screen capture
- [ ] PeerConnection with Google STUN
- [ ] On offer: `setRemoteDescription` → `createAnswer` → send answer
- [ ] Exchange ICE candidates in `webrtc` messages
- [ ] Handle remote `control` packets during session

---

## 12. Testing

### Verify registration

```bash
curl -sS -X POST https://remote.tak-solutions.com/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"uid":"test-device-001","device_name":"Test Device"}'
```

### Verify ping

```bash
curl -sS 'https://remote.tak-solutions.com/api/v1/ping?uid=<uid>'
```

### Verify authenticated telemetry

```bash
curl -sS -X POST https://remote.tak-solutions.com/api/v1/telemetry \
  -H 'Content-Type: application/json' \
  -H 'X-Connection-Secret: <secret>' \
  -d '{"uid":"<uid>","battery":100,"lat":39.7,"lon":-104.9}'
```

### Verify command poll

```bash
curl -sS https://remote.tak-solutions.com/api/v1/commands \
  -H 'X-Connection-Secret: <secret>'
```

### Verify WebSocket (wscat)

```bash
wscat -c wss://remote.tak-solutions.com/ws/device
# then send:
{"type":"auth","uid":"<uid>","connection_secret":"<secret>"}
```

Expected: `{"type":"auth_ok","uid":"..."}`

### Portal verification

1. Device appears on admin dashboard at `https://remote.tak-solutions.com`
2. Badge shows **Live** when WebSocket is connected
3. **Ping device** returns "Command sent" (not queued) when Live
4. **Connect** shows video within a few seconds when WebRTC is implemented

---

## 13. Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Device not on dashboard | No register/telemetry traffic | Confirm `tracking_server_url` uses port 443 |
| Commands always "queued" in portal | No live WebSocket | Implement persistent WS + auto-reconnect |
| Ping works from app but portal ping queued | Same as above | WebSocket not connected |
| Black screen on remote assist | No SDP answer from device | Send `{ type: "webrtc", sdp: { type: "answer", ... } }` |
| 401 on command poll | Wrong/missing secret header | Use `X-Connection-Secret` |
| WS closes immediately | Auth not sent within 10s | Send auth as first message |
| Works until server restart | No WS reconnect | Reconnect on disconnect; poll delivers queued cmds in ~30s |

---

## 14. Production reference

| Item | Value |
|------|-------|
| Admin portal | `https://remote.tak-solutions.com` |
| Device API base | `https://remote.tak-solutions.com` |
| Device WebSocket | `wss://remote.tak-solutions.com/ws/device` |
| Auth header | `X-Connection-Secret` |
| STUN server | `stun:stun.l.google.com:19302` |
| Command poll interval | 30 seconds |
| WebSocket auth timeout | 10 seconds |
