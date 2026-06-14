# Android App — Server Integration Requirements

This document describes everything the CFD Assist Android app must implement to work with the **CFD Remote Assist Portal** at `https://remote.tak-solutions.com`.

Use this as the primary integration spec for app developers. Related docs:

- [mdm-config.md](mdm-config.md) — EMM managed configuration keys
- [android-webrtc-requirements.md](android-webrtc-requirements.md) — WebRTC remote assist details
- [android-control-handler-handoff.md](android-control-handler-handoff.md) — Kotlin touch + keyboard control handler

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
  "accuracy_m": 12.5,
  "battery": 87,
  "is_charging": false,
  "timestamp": 1718294400000
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `accuracy_m` | number | No | Horizontal GPS accuracy in meters from `Location.getAccuracy()`. Portal shows this as GPS confidence. |

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
| `device_event` | Push real-time events to admin portal (`ORIENTATION_CHANGED`, `WEBRTC_READY`, etc.) |
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
| `LOCK_DEVICE` | Tear down remote assist if active, then lock the device screen |

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

### 8.1 Screen rotation (portrait ↔ landscape)

The admin portal resizes the remote-view panel from the **intrinsic size of the incoming WebRTC video track** (`videoWidth` / `videoHeight` in the browser). It also listens for optional `ORIENTATION_CHANGED` / `CAPTURE_RESIZED` device events (see below).

If the device physically rotates but the portal still shows **Portrait** and the panel size does not change, the app is still sending portrait-sized frames (e.g. 540×1204) even though the UI is landscape. **The app must update screen capture dimensions when orientation changes.**

#### What the portal expects

| Signal | Source | Portal behavior |
|--------|--------|-----------------|
| Video track dimensions | WebRTC decoded frames | Primary — panel aspect ratio and Portrait/Landscape badge |
| `ORIENTATION_CHANGED` event | Device WebSocket (optional) | Immediate layout hint until video track catches up |
| `CAPTURE_RESIZED` event | Device WebSocket (optional) | Same as above after capture pipeline resize |

Landscape is detected when **width > height** on whichever signal is current.

#### Required app behavior during `START_REMOTE_ADMIN`

1. **Capture at current display size** — On each orientation change, read the **current** display metrics (not cached values from session start):

   ```kotlin
   val bounds = windowManager.currentWindowMetrics.bounds
   val captureWidth = bounds.width()
   val captureHeight = bounds.height()
   ```

   Use display width/height for VirtualDisplay/WebRTC capturer **or** a scaled-down size for bandwidth — but always map control packets using **display** bounds (see step 3).

2. **Update capture on rotation** — Register for configuration/orientation changes in the foreground service that owns MediaProjection (not only the Activity):

   ```kotlin
   // Option A: WebRTC ScreenCapturerAndroid (preferred if already in use)
   screenCapturer.changeCaptureFormat(newWidth, newHeight, fps)

   // Option B: Custom VirtualDisplay
   virtualDisplay.resize(newWidth, newHeight, displayDensity)
   // or release and recreate VirtualDisplay + VideoSource
   ```

3. **Keep touch coordinates aligned** — Remote `control` packets use `x_percent` / `y_percent` (0.0–1.0) as fractions of **full screen content** (same proportional point on stream and display). Inject gestures at **physical display pixels**, not WebRTC capture buffer size (capture may be half-res for bandwidth):

   ```kotlin
   val bounds = windowManager.currentWindowMetrics.bounds
   val x = (x_percent * bounds.width()).toFloat()
   val y = (y_percent * bounds.height()).toFloat()
   ```

   Refresh display bounds on every rotation. **Do not** multiply by capture width/height unless capture exactly matches display size.

4. **Renegotiate WebRTC if required** — Some WebRTC builds fire `onRenegotiationNeeded` after `changeCaptureFormat` or track replacement. If so:

   - Create a new SDP answer (or offer, depending on your PeerConnection setup)
   - Send it on the device WebSocket:

   ```json
   {
     "type": "webrtc",
     "sdp": { "type": "answer", "sdp": "v=0\r\n..." }
   }
   ```

   The portal accepts a new answer during an active session and applies it automatically.

5. **Notify the portal (recommended)** — Send a device event **immediately** when capture size changes, before or while the video track updates:

   ```json
   {
     "type": "device_event",
     "uid": "568b166b3dd461eb",
     "event": "ORIENTATION_CHANGED",
     "payload": {
       "width": 2340,
       "height": 1080,
       "orientation": "landscape"
     }
   }
   ```

   `orientation` is `"landscape"` when `width > height`, otherwise `"portrait"`. You may also use `CAPTURE_RESIZED` with the same `width` / `height` payload after non-orientation resolution changes.

#### Implementation checklist (rotation)

- [ ] Foreground remote-assist service handles `onConfigurationChanged` or `OrientationEventListener`
- [ ] Capture width/height refreshed from `WindowManager` / `Display` on every rotation
- [ ] `ScreenCapturer.changeCaptureFormat()` or VirtualDisplay resize/recreate called
- [ ] Touch injection uses **display** dimensions from `WindowManager` (width for X, height for Y), not scaled-down capture size
- [ ] WebRTC renegotiation completed if `onRenegotiationNeeded` fires (new SDP answer sent)
- [ ] `ORIENTATION_CHANGED` device event sent with new `width` / `height`
- [ ] Do **not** lock the capture VirtualDisplay to portrait metrics for the whole session

#### Common mistakes

| Symptom | Likely cause |
|---------|----------------|
| Portal stays Portrait after device rotates | Capture still outputs portrait frame size; `changeCaptureFormat` not called |
| Panel aspect wrong but badge correct | Event sent but video track not resized — complete step 2 + renegotiation |
| Clicks land in wrong place (~2× offset) | Touch mapping uses WebRTC capture size (540×1204) instead of display size (1080×2408) |
| Horizontal swipes work, vertical do not | Touch mapping uses display/capture **width** for Y — use **height** for Y |
| Black flash on rotate | VirtualDisplay recreated without re-attaching to VideoSource — swap track or renegotiate |

#### Minimal Kotlin sketch

```kotlin
private var captureWidth = 0
private var captureHeight = 0

private fun onDisplayRotated() {
    val metrics = windowManager.currentWindowMetrics.bounds
    val newW = metrics.width()
    val newH = metrics.height()
    if (newW == captureWidth && newH == captureHeight) return

    captureWidth = newW
    captureHeight = newH

    screenCapturer.changeCaptureFormat(newW, newH, 30)

    sendDeviceEvent(
        "ORIENTATION_CHANGED",
        mapOf(
            "width" to newW,
            "height" to newH,
            "orientation" to if (newW > newH) "landscape" else "portrait"
        )
    )

    // If peerConnection.onRenegotiationNeeded fires:
    // createAnswer() → send webrtc SDP answer on WebSocket
}
```

---

## 9. Remote control (touch input)

During an active remote session, the admin may send touch packets on the device WebSocket:

**Click (with optional stream metadata for scale debugging):**

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.52,
  "y_percent": 0.41,
  "stream_width": 540,
  "stream_height": 1204
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
  "y2_percent": 0.50,
  "duration_ms": 350
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

**Key (hardware keyboard / navigation):**

```json
{
  "type": "control",
  "action": "KEY",
  "key": "KEYCODE_A",
  "input_method": "hardware_keyboard"
}
```

Supported `key` values use Android `KeyEvent` names: navigation (`BACK`, `HOME`, `RECENTS`), d-pad (`DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`), alphanumeric (`KEYCODE_A` … `KEYCODE_Z`, `KEYCODE_0` … `KEYCODE_9`), editing keys (`KEYCODE_ENTER`, `KEYCODE_DEL`, `KEYCODE_SPACE`, `KEYCODE_TAB`), and modifier combos (`Ctrl+c`, `Shift+KEYCODE_A`, etc.). When `input_method` is `"hardware_keyboard"`, inject with `KeyEvent` using `InputDevice.SOURCE_KEYBOARD` (external keyboard), not IME text injection.

When a remote stream is active, keyboard input is forwarded to the device as `KEY` packets by default. Typing is **not** forwarded only when the admin has focused an editable field on the portal page (input, textarea, select, or contenteditable). Focusing the browser address bar or another application stops delivery automatically.

Coordinates are **0.0–1.0** fractions of the **device screen** (not the letterboxed video element on the portal). The portal maps pointer positions through the visible video frame before sending percentages.

### Android injection requirements

| Action | Recommended API |
|--------|-----------------|
| `CLICK` | `AccessibilityService.dispatchGesture()` — short stroke (~50 ms) at `(x_percent * displayWidth, y_percent * displayHeight)` |
| `SWIPE` | `dispatchGesture()` — stroke from start to end; honor optional `duration_ms` (portal sends **250–900 ms**, default **350 ms**). Vertical system gestures (app drawer, notifications) require **both** correct Y coordinates and adequate duration. |
| `LONG_PRESS` | `dispatchGesture()` — hold stroke ~600 ms at point |
| `KEY` + `hardware_keyboard` | `Instrumentation` or accessibility `performGlobalAction` for `BACK`/`HOME`/`RECENTS`; otherwise inject `KeyEvent` with `SOURCE_KEYBOARD` |

Example swipe handler (Kotlin):

```kotlin
fun injectSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long = 350) {
    val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
    val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
    dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
}
```

Convert `x_percent` / `y_percent` using **physical display size** (`WindowManager.currentWindowMetrics.bounds`). Percentages are proportional to screen content; `dispatchGesture()` always expects full display coordinates:

```kotlin
val bounds = windowManager.currentWindowMetrics.bounds
val x = (x_percent * bounds.width()).toFloat()
val y = (y_percent * bounds.height()).toFloat()  // must use height, not width
```

**Common bugs:**
- Using WebRTC **capture** width/height when capture is scaled down (e.g. half-res) — touches land at ~half the correct position on both axes.
- Using display/capture **width** for both X and Y — breaks vertical swipes while horizontal swipes still appear to work.

### Reference implementation (Kotlin)

Copy-paste handler for touch + keyboard: **[android-control-handler-handoff.md](android-control-handler-handoff.md)**

Includes `RemoteControlHandler`, `PortalKeyParser`, `KeyInjector` (UiAutomation + shell fallback), accessibility manifest, and QA checklist. Production server logs confirm `KEY` packets reach the device WebSocket — the app must inject them.

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

- [ ] MediaProjection screen capture; send `webrtc_ready` only after first captured frame
- [ ] PeerConnection with Google STUN
- [ ] On offer: `setRemoteDescription(offer)` → **`addTrack(screen)`** → `createAnswer` → send answer (do not add send track before the offer — causes post-answer renegotiation and 0×0 video on the portal)
- [ ] Exchange ICE candidates in `webrtc` messages
- [ ] Handle remote `control` packets during session (`CLICK`, `SWIPE`, `LONG_PRESS`, and **`KEY`** with `input_method: "hardware_keyboard"`)
- [ ] On orientation change during stream: resize capture (`changeCaptureFormat` / VirtualDisplay), update touch mapping, send `ORIENTATION_CHANGED`, renegotiate WebRTC if needed (§8.1)

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
