# WebRTC Protocol Reference — Portal ↔ Android

**Purpose:** Self-contained normative runbook for remote-assist WebRTC, control input, screen sizing, and rotation. Everything required to implement or debug the portal (v2.2.15), portal server, and Android app is in **this document only** — no other doc is required.

**Portal version:** v2.2.15  
**Production server:** `https://remote.tak-solutions.com:8448` (device API) · `https://remote.tak-solutions.com` (admin UI on port 443)  
**Test device:** `fd72b785310f3536` (Galaxy S21 5G)

**Normative sections** (implement exactly):
- [Device connectivity](#device-connectivity-and-authentication)
- [Session start runbook](#session-start-runbook-normative)
- [Rotation runbook](#rotation-runbook-normative)
- [Three coordinate spaces](#three-coordinate-spaces-critical-for-debugging)
- [Control and keyboard](#control-packet-reference)
- [Appendices](#appendix-a-negotiation-rules-mandatory)

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│  Admin browser      │  WS     │  Portal server       │  WS     │  Android app        │
│  /ws/admin          │◄───────►│  ConnectionHub       │◄───────►│  /ws/device         │
│                     │  HTTP   │  signalingSession    │  HTTP   │                     │
│  useWebRtcViewer    │         │  signalingNormalize  │         │  ScreenShareService │
│  RemoteViewer       │         │  hub.relaySignaling  │         │  LocationTracking   │
│  useRemoteVideoCtrl │         │                      │         │  RemoteControlHandler│
└─────────────────────┘         └──────────────────────┘         └─────────────────────┘
```

| Role | WebRTC role | Signaling transport | Video direction |
|------|-------------|---------------------|-----------------|
| **Portal (admin)** | Offerer | `/ws/admin` (+ HTTP replay fallback) | `recvonly` |
| **Android (device)** | Answerer | `/ws/device` (+ HTTP poll fallback) | `sendonly` |
| **Server** | Relay only | Forwards JSON; adds `connection_secret` admin→device | — |

**STUN (both sides):** `stun:stun.l.google.com:19302`  
**Codecs (portal v2.2.15):** VP8 / VP9 preferred; H.264 not requested.  
**TURN:** Not configured. Connectivity relies on STUN + host/srflx candidates. Cellular NAT may fail without TURN.

---

## Device connectivity and authentication

### Endpoints (Android app)

| Purpose | URL |
|---------|-----|
| Base URL (MDM `tracking_server_url`) | `https://remote.tak-solutions.com:8448` |
| Register | `POST /api/v1/register` |
| Ping | `GET` or `POST /api/v1/ping` |
| Telemetry | `POST /api/v1/telemetry` |
| Events (persisted) | `POST /api/v1/event` |
| Command poll | `GET /api/v1/commands` |
| WebRTC signaling (HTTP fallback) | `GET` / `POST /api/v1/signaling` |
| Device WebSocket | `wss://remote.tak-solutions.com:8448/ws/device` |
| Admin portal (humans only) | `https://remote.tak-solutions.com` (port **443**) |

**Port rule:** All Android traffic uses **8448**. Port **443** serves the admin UI only; device API routes on 443 are blocked.

Read `tracking_server_url` from MDM for every call — do not hard-code hostname or port.

### Device identity

- **UID:** `Settings.Secure.ANDROID_ID` (hex string, e.g. `fd72b785310f3536`)
- **Registration:** `POST /api/v1/register` with `{ "uid": "...", "device_name": "...", "app_version": "..." }` → returns `connection_secret` (64-char hex)
- Store secret locally (encrypted) and in MDM managed config

### Authentication (after registration)

Every authenticated REST call:
```
X-Connection-Secret: <connection_secret>
```
Alternative: `Authorization: Bearer <connection_secret>`

WebSocket auth (first message within **10 seconds** or server closes `4001`):
```json
{ "type": "auth", "uid": "<ANDROID_ID>", "connection_secret": "<hex>" }
```
Response: `{ "type": "auth_ok", "uid": "..." }`

### Device WebSocket lifecycle

1. Open `wss://{host}:8448/ws/device` inside a **foreground service**
2. Send auth frame
3. Keepalive: `{ "type": "ping" }` every 30–60 s → `{ "type": "pong" }`
4. **Do not reconnect WebSocket during an active remote session** (`RemoteSessionManager.isSessionActive == true`)
5. Auto-reconnect when idle: backoff 1 s → 2 s → 5 s → 30 s
6. Command poll: `GET /api/v1/commands` every **30 s** even when WS is up

### Incoming WebSocket message types (device)

| `type` | Handler |
|--------|---------|
| `command` | Verify `connection_secret` → dispatch (`START_REMOTE_ADMIN`, etc.) |
| `webrtc` | Forward to `ScreenShareService` — offer/ICE |
| `signaling_hint` | Informational — format reference (may ignore) |
| `control` | `RemoteControlHandler` — touch/keyboard |
| `pong` | Keepalive response |

### Outgoing WebSocket message types (device)

| `type` | When |
|--------|------|
| `webrtc` | SDP answer + ICE candidates |
| `webrtc_ready` | Once per session after first capture frame |
| `device_event` | `WEBRTC_READY`, `REMOTE_SESSION_*`, `ORIENTATION_CHANGED`, etc. |
| `ping` | Keepalive |

### Admin WebSocket (`/ws/admin`)

Auth: `{ "type": "auth", "role": "admin", "uid": "<device-uid>", "token": "<oidc-access-token>" }`

Sends: `webrtc` (offer/ICE), `control`  
Receives: `webrtc` (answer/ICE), `device_event`, `device_status`, `signaling_status`

### `signaling_hint` (server → device after `START_REMOTE_ADMIN`)

```json
{
  "type": "signaling_hint",
  "role": "device_is_answerer",
  "format": {
    "answer": {
      "type": "webrtc",
      "sdp": { "type": "answer", "sdp": "<sdp-string>" }
    },
    "ice": {
      "type": "webrtc",
      "ice": {
        "candidate": "<candidate-string>",
        "sdpMid": "0",
        "sdpMLineIndex": 0
      }
    },
    "http_fallback": {
      "post_answer": "POST /api/v1/signaling",
      "post_ice": "POST /api/v1/signaling",
      "poll_admin_messages": "GET /api/v1/signaling"
    }
  },
  "stun": "stun:stun.l.google.com:19302"
}
```

### START_REMOTE_ADMIN device-side flow

On `{ "type": "command", "command": "START_REMOTE_ADMIN", "connection_secret": "..." }`:

1. Verify `connection_secret` matches stored secret
2. `RemoteSessionManager.isSessionActive = true`; block WS reconnect
3. Wake device (wake lock ~3 s)
4. Start overlay indicators (`OverlayService`)
5. Launch `MainActivity` with `TRIGGER_SCREEN_SHARE` → MediaProjection permission
6. Accessibility service auto-accepts "Start now" on projection dialog
7. Start `ScreenShareService` foreground service with **fresh** MediaProjection `Intent` (single-use — never reuse across sessions)
8. Optional: `POST /api/v1/event` `{ "event": "COMMAND_HANDLED", "payload": { "command": "START_REMOTE_ADMIN" } }`

On `STOP_REMOTE_ADMIN` / `LOCK_DEVICE`: tear down capture, PeerConnection, MediaProjection, overlay, foreground service immediately; send `REMOTE_SESSION_STOPPED`.

---

## Three coordinate spaces (critical for debugging)

Remote control and layout use **different** dimension sources. Mixing them causes offset clicks or black panels.

| Space | What it is | Example (S21 portrait) | Who sets it | Used for |
|-------|------------|------------------------|-------------|----------|
| **Display pixels** | Full physical screen | 1080 × 2400 | Android `RemoteSessionManager.displayWidth/Height` | Touch injection on device |
| **Capture / stream** | Half-res WebRTC buffer | 540 × 1200 | Android `captureWidth/Height`; decoded as `video.videoWidth/Height` on portal | RTP video; `stream_width`/`stream_height` on control packets |
| **Panel layout** | CSS aspect ratio of viewer | Merged from video + hint | Portal `useVideoStreamLayout` | Viewer box shape only — **not** touch math |

### Portal touch mapping (admin → device)

1. Pointer position on `<video>` → `pointOnVideo()` in `web/src/utils/videoCoordinates.ts`
2. Accounts for `object-fit: contain` letterboxing inside the panel
3. Produces `x_percent`, `y_percent` ∈ [0, 1] relative to **decoded video frame**
4. Attaches `stream_width`, `stream_height` from `video.videoWidth/Height` at send time (diagnostic; Android logs but does not use for mapping)

### Android touch mapping (device)

```kotlin
x = (x_percent * displayWidth()).coerceIn(0f, displayWidth - 1)
y = (y_percent * displayHeight()).coerceIn(0f, displayHeight - 1)
```

Source: `RemoteControlHandler.kt` — uses **full display pixels**, not capture size.

**Disconnect symptom:** Clicks land in wrong place when `displayWidth/Height` on device are stale after rotation but portal still sends percents based on old video orientation.

### Portal panel sizing (layout only)

`mergeStreamDimensions()` in `web/src/utils/streamDimensions.ts` (v2.2.15):

```
if no device hint        → use decoded video dimensions
if no video dimensions   → use device hint
else                     → use decoded video dimensions (hint does not flip panel early)
```

**Disconnect symptom (mitigated in v2.2.15):** `ORIENTATION_CHANGED` before landscape RTP decodes used to flip panel to landscape while video was still portrait → black letterboxing. v2.2.15 keeps panel on decoded video until `video.videoWidth/Height` updates; keyframe is requested when hints change.

---

## Session lifecycle

### Phase 1 — Connect command

**Admin action:** Click **Connect** on device detail page.

**Portal → server (HTTP):**
```http
POST /api/admin/devices/:uid/command
{ "command": "START_REMOTE_ADMIN" }
```

**Server → device (WebSocket):**
```json
{
  "type": "command",
  "command": "START_REMOTE_ADMIN",
  "connection_secret": "<64-char-hex>"
}
```

**Server → device (WebSocket, immediately after command):**
```json
{
  "type": "signaling_hint",
  "role": "device_is_answerer",
  "format": { "answer": { ... }, "ice": { ... }, "http_fallback": { ... } },
  "stun": "stun:stun.l.google.com:19302"
}
```

**Android (`LocationTrackingService`):**
1. Verify `connection_secret` matches stored secret
2. `RemoteSessionManager.isSessionActive = true`
3. Wake device, show overlay, launch `MainActivity` with `TRIGGER_SCREEN_SHARE`
4. Accessibility service auto-accepts MediaProjection dialog
5. `ScreenShareService` starts foreground capture

**Portal state:**
- `remoteActive = true`
- `remoteSessionId` incremented
- `webrtcReadySessionId` reset to 0
- `streamLayoutHint` cleared

---

### Phase 2 — Capture ready (`webrtc_ready`)

**Android → server (WebSocket), after first capturer frame:**
```json
{ "type": "webrtc_ready" }
```

**Server → admin (WebSocket), relayed as:**
```json
{
  "type": "device_event",
  "uid": "<device-uid>",
  "event": "WEBRTC_READY",
  "payload": {}
}
```

**Android also sends:**
```json
{
  "type": "device_event",
  "uid": "<ANDROID_ID>",
  "event": "WEBRTC_READY",
  "payload": {}
}
```

**Portal (`DeviceDetail.tsx`):**
- Sets `webrtcReadySessionId = remoteSessionId`
- `deviceStreamReady` becomes true when `lastEvent` is `WEBRTC_READY`, `REMOTE_SESSION_STARTED`, or `REMOTE_READY`

**Portal offer timing (`useWebRtcViewer.ts`):**
| Condition | Offer delay |
|-----------|-------------|
| `deviceStreamReady` false | 20 s initial, retry every 15 s (max 4) |
| `deviceStreamReady` true | 3 s warmup (`CAPTURE_WARMUP_MS`), then offer |

**Wrong (400 on server):** POST `webrtc_ready` or `device_event` to `/api/v1/signaling`.

---

### Phase 3 — WebRTC negotiation

**Portal creates offer** (`useWebRtcViewer.startSession`):
- `RTCPeerConnection` + `addTransceiver("video", { direction: "recvonly" })`
- VP8/VP9 codec preference
- `createOffer()` → `setLocalDescription()`

**Portal → server → device (WebSocket):**
```json
{
  "type": "webrtc",
  "sdp": {
    "type": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

**Server adds `connection_secret` on admin→device relay:**
```json
{
  "type": "webrtc",
  "connection_secret": "<hex>",
  "sdp": { "type": "offer", "sdp": "v=0\r\n..." }
}
```

**Android (`ScreenShareService.handleSignalingMessage`):**
1. Deduplicate offer via `lastProcessedOfferSdp`
2. `setRemoteDescription(offer)`
3. Attach `localVideoTrack` to existing video transceiver (or `addTrack`)
4. `createAnswer()` → `setLocalDescription()`
5. Send answer; call `minimizeApp()` (HOME)

**Device → server → admin (WebSocket):**
```json
{
  "type": "webrtc",
  "sdp": {
    "type": "answer",
    "sdp": "v=0\r\n..."
  }
}
```

**ICE trickle (both directions):**
```json
{
  "type": "webrtc",
  "ice": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

**Portal answer handling (v2.2.14):**
- Queues answer if PC not in `have-local-offer` yet
- **Ignores duplicate answers** when `signalingState === "stable"`
- Does **not** apply a second answer mid-session (rotation must not depend on renegotiation)

**Android ICE connected → device event:**
```json
{
  "type": "device_event",
  "uid": "...",
  "event": "REMOTE_SESSION_STARTED",
  "payload": {}
}
```

**Portal stream status machine:**
`idle` → `waiting` → `negotiating` → `connecting` → `streaming` | `failed`

| Timeout | Value | Failure meaning |
|---------|-------|-----------------|
| Negotiation | 45 s | No SDP answer received |
| ICE after answer | 20 s | Answer OK but ICE never connects |
| Video track | 25 s | ICE OK but no `ontrack` |
| Decoded frames | 30 s | Track exists but `videoWidth` stays 0 |

---

### Phase 4 — Remote control

**Portal → server → device (WebSocket):**
```json
{ "type": "control", "action": "CLICK", "x_percent": 0.63, "y_percent": 0.91, "stream_width": 540, "stream_height": 1200 }
```

**HTTP fallback (if admin WS send fails):**
```http
POST /api/admin/devices/:uid/control
{ "action": "CLICK", "x_percent": 0.63, "y_percent": 0.91, "stream_width": 540, "stream_height": 1200 }
```

Server wraps as `{ "type": "control", ... }` on device WS.

**Android routing:** `LocationTrackingService` → `RemoteAssistAccessibilityService.onControlMessage` → `RemoteControlHandler`

---

### Phase 5 — Rotation (in-session)

**Full specification:** [Rotation runbook (normative)](#rotation-runbook-normative) — ordered steps, exact values, messages, and state updates for portrait ↔ landscape.

**Summary:** Android resizes capture on the **same** `PeerConnection` and **same** `VideoTrack`, sends `ORIENTATION_CHANGED` after the first capturer frame at the new size, then updates touch-mapping state. No WebRTC renegotiation. Portal flips panel aspect from the hint; touch coords stay tied to decoded video until RTP dimensions change.

---

### Phase 6 — Disconnect

**Admin:** Click **Disconnect**

```http
POST /api/admin/devices/:uid/command
{ "command": "STOP_REMOTE_ADMIN" }
```

**Android:** Stops `ScreenShareService`, overlay, clears session flags.

```json
{
  "type": "device_event",
  "event": "REMOTE_SESSION_STOPPED",
  "payload": {}
}
```

Server: `setRemoteSessionActive(uid, false)` — clears signaling session queues.

---

## Complete message catalog

### Admin WebSocket (`/ws/admin`)

#### Auth (first message)
```json
{ "type": "auth", "role": "admin", "uid": "<device-uid>", "token": "<oidc-access-token>" }
```

#### Responses on connect
```json
{ "type": "auth_ok", "uid": "<device-uid>" }
{ "type": "device_status", "uid": "...", "online": true }
{ "type": "signaling_status", "offerSent": 1, "answerReceived": true, ... }
```

#### Sent by portal
| `type` | Payload | Purpose |
|--------|---------|---------|
| `webrtc` | `sdp` or `ice` | Offer + admin ICE candidates |
| `control` | `action` + fields | Touch / keyboard |

#### Received by portal
| `type` | Purpose |
|--------|---------|
| `webrtc` | Device answer + ICE |
| `device_event` | `WEBRTC_READY`, `ORIENTATION_CHANGED`, `REMOTE_SESSION_*`, lock events |
| `device_status` | Device WS up/down (8 s server grace + 6 s client debounce) |
| `signaling_status` | Diagnostics counters |

---

### Device WebSocket (`/ws/device`)

#### Auth (first message)
```json
{ "type": "auth", "uid": "<ANDROID_ID>", "connection_secret": "<hex>" }
```

#### Sent by Android
| Message | When |
|---------|------|
| `{ "type": "ping" }` | Keepalive |
| `{ "type": "webrtc_ready" }` | First capture frame |
| `{ "type": "webrtc", "sdp": { "type": "answer", ... } }` | After processing offer |
| `{ "type": "webrtc", "ice": { ... } }` | Local ICE candidates |
| `{ "type": "device_event", "event": "...", "payload": {} }` | Session / layout events |

#### Received by Android
| `type` | Handler | Notes |
|--------|---------|-------|
| `command` | `LocationTrackingService` | Verify `connection_secret` |
| `signaling_hint` | *(often ignored)* | Format reference + HTTP fallback URLs |
| `webrtc` | → `ScreenShareService` | Offer/ICE; includes `connection_secret` |
| `control` | → `RemoteControlHandler` | Touch / keys |
| `pong` | Log | Ping response |

---

### HTTP signaling (`/api/v1/signaling`)

**Auth:** `X-Connection-Secret: <hex>` (or `Authorization: Bearer <hex>`)

#### `GET` — device polls missed admin messages
```json
{
  "messages": [
    { "type": "webrtc", "connection_secret": "...", "sdp": { "type": "offer", "sdp": "..." } },
    { "type": "webrtc", "connection_secret": "...", "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }
  ],
  "format_hint": { ... }
}
```

Polled by `ScreenShareService` every 2 s **only when device WS disconnected**.

#### `POST` — device posts answer/ICE
```json
{ "type": "webrtc", "sdp": { "type": "answer", "sdp": "..." } }
```
```json
{ "type": "webrtc", "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }
```

**Rejected (400):** `webrtc_ready`, `device_event`, or any non-signaling body.

#### Admin replay (portal fallback)
```http
GET /api/admin/devices/:uid/signaling/replay
```
Returns queued device answer/ICE if admin WS missed them. Portal polls every 2 s while negotiating.

---

## Control packet reference

### `CLICK`
```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.6318,
  "y_percent": 0.9087,
  "stream_width": 540,
  "stream_height": 1200
}
```

| Field | Required | Range | Notes |
|-------|----------|-------|-------|
| `x_percent` | yes | 0–1 | Fraction across decoded video width |
| `y_percent` | yes | 0–1 | Fraction across decoded video height |
| `stream_width` | optional | > 0 | Portal: `video.videoWidth` at send time |
| `stream_height` | optional | > 0 | Portal: `video.videoHeight` at send time |

**Android maps to:** `x = x_percent × displayWidth`, `y = y_percent × displayHeight`  
**Gesture duration:** 50 ms

**Production verification example (Galaxy XCover6 Pro):**

| | Width | Height |
|---|------:|-------:|
| Physical display | 1080 | 2408 |
| WebRTC capture | 540 | 1204 |

Portal packet: `x_percent=0.499`, `y_percent=0.891`

| Mapping | Result | Correct? |
|---------|--------:|:--------:|
| `0.499 × 540`, `0.891 × 1204` → 269, 1072 | Wrong — used capture size | ❌ |
| `0.499 × 1080`, `0.891 × 2408` → 539, 2146 | Correct — display pixels | ✅ |

`stream_width` / `stream_height` on the packet are **diagnostic only**. If `stream_width × 2 ≈ displayWidth`, portal percents are correct and Android injection mapping is wrong.

---

### `LONG_PRESS`
```json
{
  "type": "control",
  "action": "LONG_PRESS",
  "x_percent": 0.52,
  "y_percent": 0.41,
  "stream_width": 540,
  "stream_height": 1200
}
```
**Gesture duration:** 600 ms  
**Portal trigger:** right-click or context menu on video panel

---

### `SWIPE`
```json
{
  "type": "control",
  "action": "SWIPE",
  "x_percent": 0.10,
  "y_percent": 0.50,
  "x2_percent": 0.90,
  "y2_percent": 0.50,
  "duration_ms": 450,
  "stream_width": 540,
  "stream_height": 1200
}
```

| Field | Notes |
|-------|-------|
| `x2_percent`, `y2_percent` | End point |
| `duration_ms` | `clamp(250, 900, max(elapsed, 250 + distance×900))` from portal |

**Android:** `duration_ms` clamped to 100–2000 ms

---

### `KEY`

One WebSocket message **per physical key press** (not a full string). Typing `atak` sends four separate packets.

```json
{
  "type": "control",
  "action": "KEY",
  "key": "KEYCODE_A",
  "input_method": "hardware_keyboard"
}
```

| Field | Required | Values |
|-------|----------|--------|
| `key` | yes | `BACK`, `HOME`, `RECENTS`, `DPAD_*`, `KEYCODE_A`–`KEYCODE_Z`, `KEYCODE_0`–`KEYCODE_9`, `KEYCODE_ENTER`, `KEYCODE_DEL`, `KEYCODE_TAB`, `KEYCODE_SPACE`, `F1`–`F12`, combos `Ctrl+KEYCODE_C` |
| `input_method` | yes (portal always sets) | `"hardware_keyboard"` |

**Portal keyboard (`remoteKeyboard.ts`):**
- Global `document` keydown capture (capture phase)
- **Does not forward** when focus is in `input`, `textarea`, `select`, or `contenteditable`
- Maps browser keys → Android names (`ArrowUp` → `DPAD_UP`, `a` → `KEYCODE_A`)
- Sends via admin WS; HTTP fallback `POST /api/admin/devices/:uid/control` if WS fails

**Android routing:** `LocationTrackingService` → `RemoteAssistAccessibilityService.onControlMessage` → `RemoteControlHandler.injectKey`

**Navigation keys (no KeyEvent):**
| `key` | API |
|-------|-----|
| `BACK` | `performGlobalAction(GLOBAL_ACTION_BACK)` |
| `HOME` | `performGlobalAction(GLOBAL_ACTION_HOME)` |
| `RECENTS` | `performGlobalAction(GLOBAL_ACTION_RECENTS)` |

**All other keys:** `PortalKeyParser.parse(key)` → `KeyEvent` DOWN + UP via injector chain.

**Verified keyCode mapping (production):**

| Portal `key` | Android `keyCode` |
|--------------|-------------------|
| `KEYCODE_A` | 29 |
| `KEYCODE_T` | 48 |
| `KEYCODE_1` | 8 |
| `KEYCODE_ENTER` | 66 |
| `KEYCODE_DEL` | 67 |

**Key injector chain (Samsung / MDM — do not use `Instrumentation.sendKeySync`):**

1. **UiAutomationKeyInjector** — `service.uiAutomation.injectInputEvent(event, true)` on **main thread** (WS callbacks are background; Samsung rejects off-main inject)
2. **ShellKeyInjector** — `input keyevent {keyCode}` via shell (device-owner only); inject DOWN only, do not fake UP success
3. **AccessibilitySetTextInjector** — `ACTION_SET_TEXT` on focused editable node when injectInputEvent blocked

```kotlin
keyInjector = ChainedKeyInjector(
    UiAutomationKeyInjector(service),
    ShellKeyInjector(),
    AccessibilitySetTextInjector(service),
)
```

**Prerequisite for typing:** User or admin must focus a text field on device first (`findFocus(FOCUS_INPUT)`).

**Success logcat:** `KEY KEYCODE_A → keyCode=29 down=true up=true`  
**Failure pattern:** `down=false up=true` — shell UP is no-op false positive; add SetText injector.

**Accessibility service requirements:**
- `canPerformGestures="true"` (touch)
- `canRetrieveWindowContent="true"` (SetText / focus)
- User or MDM must enable the accessibility service before remote assist

---

## Session start runbook (normative)

Establishes the **pre-rotation steady state** referenced in [R0](#r0--preconditions-must-all-be-true-before-rotation-steps-run). Follow before [Rotation runbook](#rotation-runbook-normative).

### Android dependencies and permissions

| Requirement | Detail |
|-------------|--------|
| WebRTC library | Google `org.webrtc` (M114+ recommended), Unified Plan |
| Screen capture | `MediaProjection` + `ScreenCapturerAndroid` → `VideoSource` → `VideoTrack` |
| Foreground service | `FOREGROUND_SERVICE_MEDIA_PROJECTION` for entire session |
| Permissions | `FOREGROUND_SERVICE`, `POST_NOTIFICATIONS` (API 33+), runtime MediaProjection consent |
| Accessibility | Enabled for remote touch + keyboard injection |
| Network | Outbound UDP for STUN/ICE host/srflx (no TURN yet) |

### Healthy session timing budget (target ≤ 15 s to video)

```
t=0.0s  Admin Connect → START_REMOTE_ADMIN + signaling_hint
t≈0.5s  Device first frame → webrtc_ready
t≈3.5s  Portal offer (3 s warmup after WEBRTC_READY)
t≈4.0s  Device answer + ICE trickle both directions
t≈1–6s  ICE CONNECTED, DTLS complete
t≈2–8s  RTP frames → portal status streaming
```

### Negotiation order (both sides)

| Step | Actor | Action |
|------|-------|--------|
| 1 | Admin | `START_REMOTE_ADMIN` |
| 2 | Device | Start capture + PeerConnection |
| 3 | Device | `webrtc_ready` (optional, once) |
| 4 | Admin | `createOffer` → send `{ type:"webrtc", sdp:{ type:"offer" } }` |
| 5 | Device | `setRemoteDescription(offer)` |
| 6 | Device | Attach `VideoTrack` to transceiver **before** `createAnswer()` |
| 7 | Device | `createAnswer` → `setLocalDescription` → send answer |
| 8 | Both | Exchange ICE `{ type:"webrtc", ice:{...} }` |
| 9 | Device | ICE CONNECTED → `REMOTE_SESSION_STARTED` |
| 10 | Admin | `ontrack` → video decoding → `streaming` |

### S0 — Android initial capture dimensions (on `startScreenCapture`)

**When:** After `MediaProjection` permission granted, before first `webrtc` offer arrives.

```
metrics = windowManager.defaultDisplay.getRealMetrics(metrics)   // or currentWindowMetrics on API 30+

displayW = metrics.widthPixels       // e.g. 1080 in portrait
displayH = metrics.heightPixels      // e.g. 2400 in portrait

captureW = displayW / 2                // integer division → 540
captureH = displayH / 2                // integer division → 1200
captureFps = 30

RemoteSessionManager.displayWidth = displayW
RemoteSessionManager.displayHeight = displayH
RemoteSessionManager.captureWidth = captureW
RemoteSessionManager.captureHeight = captureH
lastCaptureW = captureW
lastCaptureH = captureH

videoCapturer.startCapture(captureW, captureH, 30)
localVideoTrack = factory.createVideoTrack("VIDEO_TRACK", videoSource)
localVideoTrack.setEnabled(true)
setupPeerConnection()                  // empty PC, no track until offer
```

### S1 — First frame → `webrtc_ready` (strictly once per session)

**When:** `CapturerObserver.onFrameCaptured` fires for the **first** time ever in this session.

**Order:**
1. Log `FIRST FRAME CAPTURED! ${frame.rotatedWidth}x${frame.rotatedHeight}` (expect `540x1200` portrait)
2. Send WebSocket: `{ "type": "webrtc_ready" }`
3. Send WebSocket `device_event`:
   ```json
   { "type": "device_event", "uid": "<ANDROID_ID>", "event": "WEBRTC_READY", "payload": {} }
   ```

**Do not** send `webrtc_ready` again on rotation.

### S2 — Process portal offer (answerer role)

**When:** First `{ "type": "webrtc", "sdp": { "type": "offer", ... }, "connection_secret": "..." }` received.

**Order (mandatory — see Appendix A):**
1. Optionally verify `connection_secret`
2. `setRemoteDescription(offer)`
3. Find video transceiver from offer → `sender.setTrack(localVideoTrack, true)`; direction `SEND_ONLY` (or `addTrack` if no transceiver)
4. Flush any buffered remote ICE candidates
5. `createAnswer()` → `setLocalDescription(answer)`
6. Send WebSocket:
   ```json
   { "type": "webrtc", "sdp": { "type": "answer", "sdp": "v=0\r\n..." } }
   ```
7. For each `onIceCandidate` → send `{ "type": "webrtc", "ice": { "candidate", "sdpMid", "sdpMLineIndex" } }`
8. `minimizeApp()` (HOME)

**Remote ICE buffering:**
```kotlin
// Before remote description set:
pendingRemoteCandidates.add(IceCandidate(sdpMid, sdpMLineIndex, candidate))
// After setRemoteDescription succeeds:
pendingRemoteCandidates.forEach { peerConnection.addIceCandidate(it) }
pendingRemoteCandidates.clear()
```

**Duplicate offers:** If `sdp` string equals `lastProcessedOfferSdp`, skip (already answered).

### S3 — ICE connected → session started event

**When:** `onIceConnectionChange(CONNECTED)`:

```json
{ "type": "device_event", "uid": "<ANDROID_ID>", "event": "REMOTE_SESSION_STARTED", "payload": {} }
```

### S4 — Portal offer timing after `WEBRTC_READY`

**When:** `deviceStreamReady === true` (portal received `WEBRTC_READY` for current `remoteSessionId`).

**Order:**
1. Wait `CAPTURE_WARMUP_MS` = **3000 ms**
2. `createOffer()` → send `{ "type": "webrtc", "sdp": { "type": "offer", ... } }`
3. Send local ICE candidates as `{ "type": "webrtc", "ice": ... }`
4. Wait for answer + device ICE
5. `ontrack` → attach to `<video>` → status `streaming` when `videoWidth > 0`

If `WEBRTC_READY` never arrives: portal waits **20000 ms** then offers anyway (retry up to 4 times).

### S5 — Steady-state before rotation

All of [R0](#r0--preconditions-must-all-be-true-before-rotation-steps-run) must be true. Example S21 portrait:

| Quantity | Value |
|----------|-------|
| Android display | 1080 × 2400 |
| Android capture / RTP | 540 × 1200 |
| Portal `<video>` | 540 × 1200 |
| `streamLayoutHint` | `null` |

---

## Rotation runbook (normative)

This section is the **authoritative specification** for in-session screen rotation with capture resize. If any other section conflicts with this runbook, **this section wins**.

Rotation means the physical display orientation changed while `RemoteSessionManager.isSessionActive === true` and the WebRTC session remains up (`ICE` connected, `signalingState === stable`). Rotation is **not** a new session and **must not** trigger renegotiation.

---

### R0 — Preconditions (must all be true before rotation steps run)

| # | Condition | How to verify |
|---|-----------|---------------|
| R0.1 | Remote assist session active | Android: `RemoteSessionManager.isSessionActive == true` |
| R0.2 | WebRTC negotiated | Android: `peerConnection.signalingState == STABLE` |
| R0.3 | ICE connected | Android: `onIceConnectionChange` last state was `CONNECTED` |
| R0.4 | Screen capture running | Android: `videoCapturer != null`, `localVideoTrack != null`, `firstFrameCaptured == true` |
| R0.5 | Same objects as initial answer | Android: **do not** recreate `PeerConnection`, `VideoSource`, `VideoTrack`, `MediaProjection`, or `ScreenCapturerAndroid` |
| R0.6 | Portal streaming | Portal: `useWebRtcViewer` status is `streaming` |
| R0.7 | Device WebSocket open | Server: device WS registered for `uid` |

**Steady-state example (Galaxy S21 5G, portrait, before rotation):**

| Variable | Value | Where stored |
|----------|-------|--------------|
| `displayW` | `1080` | `RemoteSessionManager.displayWidth` |
| `displayH` | `2400` | `RemoteSessionManager.displayHeight` |
| `captureW` (`lastCaptureW`) | `540` | `RemoteSessionManager.captureWidth`, `ScreenShareService.captureWidth` |
| `captureH` (`lastCaptureH`) | `1200` | `RemoteSessionManager.captureHeight`, `ScreenShareService.captureHeight` |
| Portal decoded video | `540 × 1200` | `<video>.videoWidth` / `videoHeight` |
| Portal `streamLayoutHint` | `null` or `{540,1200}` | `DeviceDetail` state |
| Portal panel aspect | `540 / 1200` (portrait) | `RemoteViewer` CSS |

---

### R1 — Dimension formulas (apply on every rotation)

Read display size **at rotation time** — never use cached values from session start.

**Android (API 30+):**
```
bounds = windowManager.currentWindowMetrics.bounds
displayW = bounds.width()          // integer pixels, full physical display
displayH = bounds.height()         // integer pixels, full physical display
```

**Android (API < 30):**
```
windowManager.defaultDisplay.getRealMetrics(metrics)
displayW = metrics.widthPixels
displayH = metrics.heightPixels
```

**Capture size (always half display — integer division, truncate toward zero):**
```
captureW = displayW / 2
captureH = displayH / 2
captureFps = 30                      // fixed; do not change
```

**Orientation string (for payload only):**
```
orientation = (captureW > captureH) ? "landscape" : "portrait"
```

**Worked example — portrait → landscape (S21):**

| Step | `displayW` | `displayH` | `captureW` | `captureH` | `orientation` |
|------|------------|------------|------------|------------|---------------|
| Before | 1080 | 2400 | 540 | 1200 | `portrait` |
| After | 2400 | 1080 | 1200 | 540 | `landscape` |

**Worked example — landscape → portrait (reverse):**

| Step | `displayW` | `displayH` | `captureW` | `captureH` | `orientation` |
|------|------------|------------|------------|------------|---------------|
| Before | 2400 | 1080 | 1200 | 540 | `landscape` |
| After | 1080 | 2400 | 540 | 1200 | `portrait` |

**Early exit (no rotation work):**
```
if (captureW == lastCaptureW && captureH == lastCaptureH) → STOP; do not send ORIENTATION_CHANGED
```

---

### R2 — Android runbook (ordered steps)

**Trigger:** `ScreenShareService.onConfigurationChanged()` → calls `onDisplayRotated()`.

**Threading rules:**

| Step | Thread |
|------|--------|
| R2.1–R2.3 | Main thread (configuration callback) |
| R2.4–R2.12 | `serviceExecutor` background thread |
| R2.13–R2.15 | `handler.post { }` → main thread |

#### R2.1 — Guard

```
if (!RemoteSessionManager.isSessionActive) return
```

Do nothing if session is not active.

#### R2.2 — Read display metrics

Execute on main thread. Use formulas from [R1](#r1--dimension-formulas-apply-on-every-rotation).

Store in local variables: `displayW`, `displayH`, `captureW`, `captureH`.

#### R2.3 — Early exit if capture size unchanged

```
if (captureW == lastCaptureW && captureH == lastCaptureH) return
```

`lastCaptureW` / `lastCaptureH` are the **capture** dimensions from the previous successful rotation or initial `startScreenCapture`.

#### R2.4 — Log rotation intent (background thread starts)

```
Log.i("ScreenShare", "Rotation: ${lastCaptureW}x${lastCaptureH} -> ${captureW}x${captureH}")
```

Example: `Rotation: 540x1200 -> 1200x540`

#### R2.5 — Resize capturer (same instance)

```
videoCapturer.changeCaptureFormat(captureW, captureH, 30)
```

| Parameter | Value |
|-----------|-------|
| width | `captureW` (not `displayW`) |
| height | `captureH` (not `displayH`) |
| fps | `30` |

**Do not:** `stopCapture()` / `startCapture()` here unless R2.9 encoder kick fails (see R2.9 fallback).

**Do not:** create a new `ScreenCapturerAndroid`.

#### R2.6 — Wait for first capturer frame at new size

Poll until the frame observer reports the new dimensions:

```
for i in 0 until 20:
    if (lastRotatedWidth == captureW && lastRotatedHeight == captureH):
        gotFrame = true; break
    Thread.sleep(100)
```

| Parameter | Value |
|-----------|-------|
| `lastRotatedWidth` / `lastRotatedHeight` | Updated in `CapturerObserver.onFrameCaptured` from `frame.rotatedWidth` / `frame.rotatedHeight` |
| Timeout | `20 × 100ms = 2000ms` |
| On timeout | Log `Rotation failed: no frames at ${captureW}x${captureH}` → **STOP** (do not send `ORIENTATION_CHANGED`, do not update touch mapping) |

On success:
```
Log.i("ScreenShare", "FIRST FRAME CAPTURED! ${captureW}x${captureH}")
```

#### R2.7 — Kick encoder (same track, same PeerConnection)

Execute immediately after R2.6 success:

```
Log.d("ScreenShare", "Kicking encoder to resume RTP stream")
localVideoTrack.setEnabled(false)
localVideoTrack.setEnabled(true)

sender = peerConnection.transceivers
    .find { mediaType == MEDIA_TYPE_VIDEO }
    .sender

if (sender != null):
    sender.setTrack(null, false)
    sender.setTrack(localVideoTrack, false)
```

**Do not:** call `createAnswer()` or send a new SDP answer for rotation (portal v2.2.14 ignores it when stable).

**If `onRenegotiationNeeded` fires:** log it only; do not create/send answer unless a future portal version explicitly supports mid-session renegotiation.

#### R2.8 — Verify outbound RTP (non-blocking)

Poll WebRTC stats:

```
for i in 0 until 20:
    peerConnection.getStats { report ->
        for stat in report.statsMap.values:
            if stat.type == "outbound-rtp" && stat.members["mediaType"] == "video":
                framesEncoded = stat.members["framesEncoded"] as Long
    Thread.sleep(100)

encoding = (framesEncoded increased since first sample)
```

| Result | Action |
|--------|--------|
| `encoding == true` | Continue to R2.9 |
| `encoding == false` after 2000ms | Log `Rotation warning: framesEncoded not increasing after encoder kick` → **still continue to R2.9** (do not block hint or touch update) |

**R2.8 fallback (only if video remains frozen after full runbook):** optional `videoCapturer.stopCapture()` then `videoCapturer.startCapture(captureW, captureH, 30)` on the **same** `VideoSource` — not documented as required for v2.2.14 compliance but may be needed on some devices.

#### R2.9 — Send `ORIENTATION_CHANGED` (main thread)

**When:** After R2.6 succeeds (first frame at new capture size). Send **regardless** of R2.8 result.

**Transport:** Device WebSocket only. **Never** `POST /api/v1/signaling`.

**Exact message (portrait → landscape example, uid = device ANDROID_ID):**
```json
{
  "type": "device_event",
  "uid": "fd72b785310f3536",
  "event": "ORIENTATION_CHANGED",
  "payload": {
    "width": 1200,
    "height": 540,
    "orientation": "landscape"
  }
}
```

**Field rules (all required in payload):**

| Field | Type | Source | Invalid example |
|-------|------|--------|-----------------|
| `width` | positive integer | `captureW` | `2400` (full display width) |
| `height` | positive integer | `captureH` | `1080` (full display height) |
| `orientation` | string | `"landscape"` if `width > height`, else `"portrait"` | omitting field (portal still parses width/height) |

**Alternative event name:** `CAPTURE_RESIZED` — same payload shape; portal treats identically via `isLayoutEvent()`.

**Send via:**
```kotlin
sendDeviceEvent("ORIENTATION_CHANGED", payload)
// which calls networkManager.sendWebSocketMessage(...)
```

**Log:**
```
Log.d("ScreenShare", "Sent ORIENTATION_CHANGED: $payload")
```

#### R2.10 — Update Android touch-mapping state (same main-thread block as R2.9)

Update **immediately after** sending `ORIENTATION_CHANGED`, in the **same** `handler.post { }` block:

```
ScreenShareService.captureWidth = captureW
ScreenShareService.captureHeight = captureH
RemoteSessionManager.captureWidth = captureW
RemoteSessionManager.captureHeight = captureH
RemoteSessionManager.displayWidth = displayW
RemoteSessionManager.displayHeight = displayH
```

| Variable | After portrait→landscape | Used by |
|----------|--------------------------|---------|
| `displayWidth` | `2400` | `RemoteControlHandler.toX()` → `x = x_percent × 2400` |
| `displayHeight` | `1080` | `RemoteControlHandler.toY()` → `y = y_percent × 1080` |
| `captureWidth` | `1200` | Logging / diagnostics only for touch |
| `captureHeight` | `540` | Logging / diagnostics only for touch |

**Order inside `handler.post`:** (1) build payload → (2) `sendDeviceEvent` → (3) update all four `RemoteSessionManager` fields + local capture fields.

#### R2.11 — Update rotation bookkeeping (background thread, after handler.post scheduled)

```
lastCaptureW = captureW
lastCaptureH = captureH
```

#### R2.12 — Messages Android must NOT send during rotation

| Message | Reason |
|---------|--------|
| `{ "type": "webrtc_ready" }` | Session-start only |
| `{ "type": "device_event", "event": "WEBRTC_READY" }` | Session-start only |
| `{ "type": "webrtc", "sdp": { "type": "answer", ... } }` | Portal ignores second answer when stable |
| `POST /api/v1/signaling` with `device_event` | Returns 400 |
| `START_REMOTE_ADMIN` / `STOP_REMOTE_ADMIN` | Server-initiated commands only |
| New ICE candidates only because of rotation | Not required; continual gathering may emit some — acceptable but not required |

---

### R3 — Server runbook (ordered steps)

Server is **pass-through** for rotation. No transformation of `width`/`height`/`orientation`.

#### R3.1 — Receive device WebSocket message

Inbound from device (either shape accepted by `isDeviceEvent()`):

**Shape A (canonical — use this):**
```json
{
  "type": "device_event",
  "uid": "fd72b785310f3536",
  "event": "ORIENTATION_CHANGED",
  "payload": {
    "width": 1200,
    "height": 540,
    "orientation": "landscape"
  }
}
```

**Shape B (legacy — also accepted):**
```json
{
  "event": "ORIENTATION_CHANGED",
  "uid": "fd72b785310f3536",
  "payload": { "width": 1200, "height": 540, "orientation": "landscape" }
}
```

#### R3.2 — Relay to admin(s)

`hub.relayDeviceEvent(uid, { type, uid, event, payload })` → `broadcastToAdmins`:

**Exact outbound admin WebSocket message:**
```json
{
  "type": "device_event",
  "uid": "fd72b785310f3536",
  "event": "ORIENTATION_CHANGED",
  "payload": {
    "width": 1200,
    "height": 540,
    "orientation": "landscape"
  }
}
```

#### R3.3 — Server must NOT during rotation

| Action | Reason |
|--------|--------|
| Persist `ORIENTATION_CHANGED` to DB | Not implemented — only WS relay |
| Forward any WebRTC signaling | Rotation does not use SDP/ICE |
| Modify `payload.width` / `payload.height` | Pass through unchanged |
| Queue `device_event` for HTTP poll | Events are WS-only live relay |

#### R3.4 — Expected server log line

```
Device WS message: device_event event=ORIENTATION_CHANGED
```

If this line is **absent** after a physical rotation, the defect is on the Android side (R2.6/R2.9), not the server.

---

### R4 — Portal runbook (ordered steps)

#### R4.1 — Receive admin WebSocket `device_event`

`useAdminWebSocket` sets `lastEvent = msg` when `msg.type === "device_event"`.

#### R4.2 — `DeviceDetail.tsx` effect runs (on `lastEvent` change)

```
if (lastEvent.event === "ORIENTATION_CHANGED" || lastEvent.event === "CAPTURE_RESIZED"):
    dimensions = parseStreamDimensions(lastEvent.payload)
    if (dimensions != null):
        setStreamLayoutHint(dimensions)
```

**`parseStreamDimensions` acceptance rules:**
- `payload` must be object
- `payload.width` must be finite number `> 0`
- `payload.height` must be finite number `> 0`
- `payload.orientation` is **ignored** for sizing (only `width`/`height` used)

Example accepted: `{ width: 1200, height: 540 }` → `{ width: 1200, height: 540 }`

Example rejected: `{ width: 2400, height: 1080 }` — parses OK numerically but **wrong semantics** (full display instead of capture); panel will size incorrectly.

#### R4.3 — Pass hint to `RemoteViewer`

```
<RemoteViewer streamLayoutHint={streamLayoutHint} ... />
```

#### R4.4 — `useVideoStreamLayout` merges hint with decoded video

On every render while `streamActive`:

```
videoDimensions = { width: video.videoWidth, height: video.videoHeight }  // when > 0
dimensions = mergeStreamDimensions(videoDimensions, streamLayoutHint)
landscape = dimensions.width > dimensions.height
aspectRatio = "${dimensions.width} / ${dimensions.height}"
```

**`mergeStreamDimensions` (v2.2.15) — exact logic:**

```
if deviceHint is null → return videoDimensions
if videoDimensions is null → return deviceHint
else → return videoDimensions    // panel stays on decoded frame until video resize
```

**Portrait → landscape transition timeline on portal:**

| Time | `video.videoWidth×Height` | `streamLayoutHint` | `mergeStreamDimensions` result | Panel |
|------|---------------------------|--------------------|---------------------------------|-------|
| T+0 (before hint) | 540×1200 | null | 540×1200 | Portrait |
| T+1 (hint arrives) | 540×1200 | 1200×540 | **540×1200** | **Portrait** (stays until RTP resizes) |
| T+2 (RTP catches up) | 1200×540 | 1200×540 | 1200×540 | Landscape, video fills |

Portal calls `requestKeyFrame()` on the inbound video receiver when `streamLayoutHint` changes during an active stream (v2.2.15).

#### R4.5 — Portal must NOT during rotation

| Action | Reason |
|--------|--------|
| Send new WebRTC offer | Rotation is in-band capture resize |
| Apply second SDP answer | `applyAnswer` idempotent discard when stable |
| Clear `streamLayoutHint` | Only cleared when `remoteActive` becomes false |
| Use `streamLayoutHint` for touch coordinates | Touch uses decoded video frame only |

#### R4.6 — Clear hint on disconnect

```
when remoteActive becomes false:
    setStreamLayoutHint(null)
```

---

### R5 — Control input during rotation (both sides)

Control messages **continue** during rotation. There is no pause or ack.

#### R5.1 — Portal sends click (unchanged format)

While rotation in progress, portal still sends:

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.6317648649562249,
  "y_percent": 0.9087110840685528,
  "stream_width": 540,
  "stream_height": 1200
}
```

**`x_percent` / `y_percent` computation (portal):**
```
frame = videoRenderRect(video)   // visible video area inside <video>, object-fit: contain
x_percent = clamp01((clientX - frame.left) / frame.width)
y_percent = clamp01((clientY - frame.top) / frame.height)
```

**`stream_width` / `stream_height`:** `video.videoWidth` / `video.videoHeight` at send time — diagnostic for Android logs only.

#### R5.2 — Android maps click (uses display pixels, not capture)

**After R2.10 completes (landscape example):**
```
x = x_percent × 2400    // RemoteSessionManager.displayWidth
y = y_percent × 1080    // RemoteSessionManager.displayHeight
```

**Before R2.10 completes (stale portrait display dims):**
```
x = x_percent × 1080
y = y_percent × 2400
```

**Android log:**
```
RemoteControlHandler: display=2400x1080 stream=540x1200
RemoteControlHandler: CLICK at 1517.0,980.4 (2400x1080)
```

Note: `stream=` may lag `display=` during transition — touch uses `display=` only.

#### R5.3 — Coordinate space summary during rotation

| Phase | Portal computes % from | Portal `stream_*` | Android maps with |
|-------|------------------------|-------------------|-------------------|
| Pre-rotation | 540×1200 video frame | 540, 1200 | display 1080×2400 |
| Hint received, video not resized | Still 540×1200 frame | 540, 1200 | display 2400×1080 (after R2.10) |
| RTP resized | 1200×540 frame | 1200, 540 | display 2400×1080 |

**Misalignment window:** Between R2.10 (Android display dims updated) and portal video decoding at new size, `x_percent`/`y_percent` are still relative to old video frame but Android applies them to new display aspect → clicks may be wrong until portal `video.videoWidth/Height` update.

---

### R6 — End-to-end ordered timeline (portrait → landscape)

Normative sequence with no gaps:

```
[PRE]  Android: ICE CONNECTED, capture 540×1200, RTP sending
[PRE]  Portal: status=streaming, video 540×1200, streamLayoutHint=null

 1. User rotates device physical orientation to landscape

 2. Android (main): onConfigurationChanged → onDisplayRotated
 3. Android (main): displayW=2400, displayH=1080, captureW=1200, captureH=540
 4. Android (main): capture size changed vs lastCapture 540×1200 → schedule background work

 5. Android (bg): videoCapturer.changeCaptureFormat(1200, 540, 30)

 6. Android (bg): wait ≤2000ms for onFrameCaptured → lastRotated 1200×540
    → FAIL path: log error, STOP (no ORIENTATION_CHANGED)
    → OK: log "FIRST FRAME CAPTURED! 1200x540"

 7. Android (bg): kickEncoderAfterResize() — track toggle, sender setTrack null→track

 8. Android (bg): poll getStats outbound-rtp framesEncoded ≤2000ms (warning only)

 9. Android (main): sendDeviceEvent ORIENTATION_CHANGED {width:1200,height:540,orientation:landscape}
10. Android (main): RemoteSessionManager display=2400×1080, capture=1200×540
11. Android (bg): lastCaptureW=1200, lastCaptureH=540

12. Server: receive device_event → broadcast identical JSON to admin WS
13. Server log: "Device WS message: device_event event=ORIENTATION_CHANGED"

14. Portal: lastEvent updated → parseStreamDimensions → streamLayoutHint={1200,540}
15. Portal: mergeStreamDimensions → panel stays 540×1200 (portrait) until video resize
16. Portal: requestKeyFrame on hint change; touch still computed from 540×1200 video

17. Android: RTP encodes 1200×540 (required for video to fill panel — if stall, panel is black)
18. Portal: video loadedmetadata/resize → videoDimensions 1200×540
19. Portal: mergeStreamDimensions → both agree landscape 1200×540
20. Portal: stream_meta on clicks uses stream_width=1200, stream_height=540

[POST] Steady landscape: capture 1200×540, display 2400×1080, hint {1200,540}, video 1200×540
```

**No steps between 1–20 may send:** `webrtc_ready`, new SDP answer, new offer, `WEBRTC_READY`, or `STOP_REMOTE_ADMIN`.

---

### R7 — Verification checklist (ordered log signatures)

**Android logcat (`ScreenShare` tag) — must appear in order:**

```
Rotation: 540x1200 -> 1200x540
FIRST FRAME CAPTURED! 1200x540
Kicking encoder to resume RTP stream
Sent ORIENTATION_CHANGED: {"width":1200,"height":540,"orientation":"landscape"}
```

Optional warning (non-fatal):
```
Rotation warning: framesEncoded not increasing after encoder kick
```

**Server log — must appear after Android send:**
```
Device WS message: device_event event=ORIENTATION_CHANGED
```

**Must NOT appear on server after rotation:**
```
WebRTC relay admin→device
WebRTC relay device→admin
Device WebRTC ready
```

**Portal — observable:**
- Landscape badge appears when `streamLayoutHint` arrives (step 15)
- Video fills panel without black letterboxing only after step 17–18 succeed

---

### R8 — Failure branches (deterministic)

| Failure at step | Android behavior | Server sees | Portal sees |
|-----------------|------------------|-------------|-------------|
| R2.6 timeout (no frame) | STOP, no `ORIENTATION_CHANGED` | Nothing | Frozen portrait video |
| R2.8 encoder stall | Warning log, **still** R2.9–R2.10 | `ORIENTATION_CHANGED` | Landscape panel, black/frozen video |
| R2.9 not sent (bug) | No WS message | No log line | Portrait panel, frozen video |
| R2.10 skipped | Wrong `displayWidth/Height` on clicks | `ORIENTATION_CHANGED` OK | Panel may flip, clicks wrong |
| RTP never resizes | — | `ORIENTATION_CHANGED` OK | Panel landscape, video portrait/black |

---

### R9 — Reverse rotation (landscape → portrait)

Run **identical** steps R2–R8 with values from the landscape→portrait row in [R1](#r1--dimension-formulas-apply-on-every-rotation):

- `changeCaptureFormat(540, 1200, 30)`
- `ORIENTATION_CHANGED` payload: `{ "width": 540, "height": 1200, "orientation": "portrait" }`
- `RemoteSessionManager.displayWidth = 1080`, `displayHeight = 2400`

No special-case code path — same runbook, different numbers.

---

## Appendix A — Negotiation rules (mandatory)

| # | Rule | Violation symptom |
|---|------|-------------------|
| A1 | Add screen `VideoTrack` to `PeerConnection` **before** `createAnswer()` | `onRenegotiationNeeded`; portal stuck "establishing video stream" |
| A2 | Process **one offer per session** — ignore duplicate offer SDP | Duplicate answer ignored; confusion in logs |
| A3 | Send **every** local ICE candidate via `{ type:"webrtc", ice:{...} }` | Portal: Answer OK, Device ICE: 0 |
| A4 | **Apply every** remote ICE candidate via `addIceCandidate` | ICE never reaches CONNECTED |
| A5 | Buffer remote ICE until `setRemoteDescription(offer)` completes, then flush | Early ICE dropped |
| A6 | Do **not** drop `webrtc` messages because `connection_secret` field is present | Offer/ICE never reach PeerConnection |
| A7 | Verify `connection_secret` on inbound offers (recommended) but **do not drop** on mismatch without logging | Security / debugging |
| A8 | One `PeerConnection` per session — do not recreate on each message | Session instability |
| A9 | Answer DTLS role: `setup:active` in SDP (device is DTLS client) | Handshake failure |
| A10 | Keep VP8 and/or VP9 in answer (portal v2.2.14 requests VP8/VP9 only) | No common codec |
| A11 | Fresh MediaProjection `Intent` per `START_REMOTE_ADMIN` (token is single-use) | ICE+DTLS connected but 0 RTP frames |
| A12 | `videoSource = factory.createVideoSource(isScreencast = true)` | Wrong content hints / encoder issues |
| A13 | `videoTrack.setEnabled(true)` before answer | Muted track |
| A14 | Portal v2.2.14 **ignores** second SDP answer when `signalingState === stable` | Mid-session renegotiation does not fix rotation |

### PeerConnection configuration (Android)

```kotlin
val rtcConfig = PeerConnection.RTCConfiguration(
    listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
).apply {
    sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
    continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
}
```

Continual ICE gathering after `CONNECTED` is **normal** — not a bug.

### Legacy signaling formats (server accepts, prefer canonical)

| Legacy | Canonical |
|--------|-----------|
| `{ "candidate": "...", "sdpMid": "0" }` | `{ "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }` |
| `{ "sdp": "v=0...", "type": "offer" }` (flat string) | `{ "sdp": { "type": "offer", "sdp": "v=0..." } }` |
| `{ "signal": "answer", "sdp": ... }` | `{ "type": "webrtc", "sdp": { "type": "answer", ... } }` |

---

## Appendix B — Endpoint routing (what goes where)

| Payload | Correct transport | Wrong transport (result) |
|---------|-------------------|--------------------------|
| SDP answer / ICE | WS `{ type:"webrtc" }` or `POST /api/v1/signaling` | — |
| `webrtc_ready` | WS `{ type:"webrtc_ready" }` | `POST /api/v1/signaling` → **400** |
| `device_event` / `ORIENTATION_CHANGED` | WS `{ type:"device_event" }` | `POST /api/v1/signaling` → **400** |
| `REMOTE_SESSION_STOPPED` (persisted) | WS `device_event` or `POST /api/v1/event` | `POST /api/v1/signaling` → **400** |
| Admin offer / ICE | WS admin → server relays to device WS | Queued in `GET /api/v1/signaling` if device WS down |
| Control CLICK/KEY | WS admin `type:control` or `POST /api/admin/.../control` | No queue if device WS down |

---

## Appendix C — Media production troubleshooting

**Symptom:** ICE + DTLS `connected` but portal shows black / "establishing video stream" / no `inbound-rtp`.

**Confirmed via `chrome://webrtc-internals` (device fd72b785310f3536):**
```
ICE: connected | DTLS: connected | signaling: stable
candidate-pair: succeeded (host↔host same Wi-Fi)
inbound-rtp video: NOT PRESENT — 0 packets, 0 frames
```

Transport is correct. **Device is not sending RTP.**

**Investigate on device (ranked):**

1. **MediaProjection token reused** — request fresh permission each `START_REMOTE_ADMIN`
2. **`startCapture(w,h,30)` not called** or zero dimensions
3. **VideoTrack not wired to same VideoSource** as capturer observer
4. **`videoTrack.setEnabled(false)`** or sender not carrying track
5. **Encoder init failure** — check logcat for `Failed to initialize encoder`; try VP8; ensure even dimensions

**Correct wiring reference:**
```kotlin
val videoSource = factory.createVideoSource(true)  // isScreencast
val capturer = ScreenCapturerAndroid(freshProjectionIntent, callback)
capturer.initialize(surfaceHelper, context, videoSource.capturerObserver)
capturer.startCapture(captureW, captureH, 30)
val videoTrack = factory.createVideoTrack("VIDEO_TRACK", videoSource).apply { setEnabled(true) }
// addTrack or setTrack on transceiver BEFORE createAnswer()
```

**Instrumentation:**
| Check | Pass criterion |
|-------|----------------|
| `onFrameCaptured` / `onFrame` count | Increases continuously |
| `getStats()` → `outbound-rtp` `framesEncoded` | Increases |
| Browser `inbound-rtp` `framesDecoded` | Increases after device encodes |

---

## Appendix D — Production evidence (rotation sessions)

### Session 2026-06-16 17:03 UTC (10:03 PDT) — encoder stall

```
17:03:08  START_REMOTE_ADMIN
17:03:10  WEBRTC_READY
17:03:13  offer → answer + 6 ICE — SUCCESS
17:03:13  REMOTE_SESSION_STARTED
17:03:40  STOP_REMOTE_ADMIN
NO ORIENTATION_CHANGED
```

**Logcat:** `Rotation: 540x1200 -> 1200x540` → `FIRST FRAME CAPTURED! 1200x540` → `framesEncoded not increasing` → no `ORIENTATION_CHANGED`

**Root cause:** Capturer OK; VP8 encoder/RtpSender stalled after `changeCaptureFormat`.

### Session 2026-06-16 16:45 UTC — hint too early

```
16:45:41  ORIENTATION_CHANGED received
NO post-rotation WebRTC (expected)
```

Portal flipped panel to landscape; video stayed portrait → black letterboxing.

### Layer status (10:03 retest)

| Layer | Status |
|-------|--------|
| Portal / server | Healthy |
| Screen capture | Fixed — landscape frames arrive |
| VP8 encoder / RTP | Broken — `framesEncoded` stalls |
| `ORIENTATION_CHANGED` | Must send after first frame; must not gate on `framesEncoded` alone |
| Touch mapping | Must update `displayWidth/Height` with hint regardless of encoder |

---

## Appendix E — Rotation anti-patterns

Do **not**:

- Send `WEBRTC_READY` or `webrtc_ready` on rotation
- Stop `MediaProjection` or recreate `PeerConnection` on rotation
- Send `ORIENTATION_CHANGED` **before** first capturer frame at new size
- Block `ORIENTATION_CHANGED` on `framesEncoded` alone (causes silent server gap)
- Skip touch-mapping update when encoder check fails
- Put **display** pixels in hint (`width:2400`) while capture is half-res (`1200`)
- `POST` device events to `/api/v1/signaling`
- Run rotation work on main thread (causes Choreographer frame skips)
- Map touch Y using capture width instead of `displayHeight`
- Depend on second SDP answer for rotation (portal v2.2.14 ignores when stable)
- Use `Instrumentation.sendKeySync` for keyboard (requires `INJECT_EVENTS`)

---

## Appendix F — Android implementation checklist

### Session start
- [ ] Foreground service + `FOREGROUND_SERVICE_MEDIA_PROJECTION`
- [ ] Fresh MediaProjection `Intent` per session
- [ ] `PeerConnection` UNIFIED_PLAN + STUN
- [ ] Half-res capture: `captureW = displayW/2`, fps 30
- [ ] `webrtc_ready` + `device_event WEBRTC_READY` once after first frame
- [ ] On offer: `setRemoteDescription` → attach track → `createAnswer` → send answer
- [ ] Send all local ICE; apply all remote ICE (buffer until remote desc set)
- [ ] `REMOTE_SESSION_STARTED` on ICE CONNECTED
- [ ] Do not reconnect WS during session

### Rotation
- [ ] Follow [Rotation runbook](#rotation-runbook-normative) R2.1–R2.12
- [ ] `changeCaptureFormat(captureW, captureH, 30)` on same capturer
- [ ] `kickEncoderAfterResize()` after first new frame
- [ ] `ORIENTATION_CHANGED` with capture (half-res) width/height
- [ ] Update `RemoteSessionManager` display + capture dims in same `handler.post` as hint

### Control
- [ ] Route WS `type:control` to `RemoteControlHandler`
- [ ] Touch: `x = x_percent × displayWidth`, `y = y_percent × displayHeight`
- [ ] Refresh display dims on every rotation
- [ ] Keyboard: UiAutomation on main thread + SetText fallback
- [ ] `BACK`/`HOME`/`RECENTS` via `performGlobalAction`

### Teardown
- [ ] On `STOP_REMOTE_ADMIN`: stop capture, close PC, release projection, `REMOTE_SESSION_STOPPED`

---

## Appendix G — Portal status ↔ device symptoms

| Portal shows | Likely device cause |
|--------------|---------------------|
| "Waiting for device stream" | No `webrtc_ready`; capture not started |
| "Negotiating WebRTC" | No SDP answer |
| "Answer received — establishing video stream…" (stuck) | ICE OK but no RTP — capture/encoder |
| "Stream failed" (ICE) | No device ICE candidates after answer |
| "Stream failed" (no track) | Answer missing sendonly video m-line |
| Black while "streaming" | Encoder stall or 0×0 capture |
| Landscape panel, black video | `ORIENTATION_CHANGED` before RTP resizes |
| Clicks ~half offset | Touch uses capture size not display size |
| Keys in server log, nothing on device | WS handler ignores `control` |
| `down=false up=true` on keys | Injectors failed; need SetText + focused field |
| `Signaling POST rejected` | `device_event` posted to `/api/v1/signaling` |

---

## Disconnect matrix — where to look

Use this table when a symptom appears. Check the column that failed first.

| Symptom | Likely layer | Check |
|---------|--------------|-------|
| Stuck on "establishing video stream" | Negotiation | Server: offer relayed? answer received? Device log: `Processing new WebRTC Offer`, `Answer Created` |
| Video never starts, answer OK | ICE | Server: device ICE count ≥ 1? Device log: `ICE CONNECTED`? |
| Video starts then black on rotate | Android encoder | Device log: `FIRST FRAME` at new size but `framesEncoded not increasing` |
| Black panel, server has `ORIENTATION_CHANGED` | Portal layout timing | Hint arrived before landscape RTP; encoder still sending portrait or nothing |
| Black panel, server has **no** `ORIENTATION_CHANGED` | Android gating | App blocked hint because encoder check failed (10:03 session) |
| Clicks wrong position | Coordinate mismatch | Compare portal `stream_width/height` in packet vs device `display=` log |
| Clicks work, video black | Encoder only | ICE up, control path OK, RTP stalled |
| Keys don't work | Accessibility | `RemoteAssistAccessibilityService` enabled? Focused input node? |
| `Signaling POST rejected 400` | Wrong endpoint | `webrtc_ready` / `device_event` posted to `/api/v1/signaling` |
| Offer retries, device ready | `WEBRTC_READY` timing | Portal waits 20 s without `deviceStreamReady`; device must send `webrtc_ready` on WS |
| Second session fails | Session cleanup | `STOP_REMOTE_ADMIN` sent? `remoteSessionId` / PC closed on portal? |

---

## Server relay rules (summary)

Source: `server/src/ws/hub.ts`, `server/src/services/signalingSession.ts`

| Direction | `connection_secret` | If device WS down |
|-----------|---------------------|---------------------|
| Admin → device (offer/ICE) | **Added** by server | Queued in `pendingToDevice`; drained by `GET /api/v1/signaling` |
| Device → admin (answer/ICE) | Not included | Queued in `pendingToAdmin`; replay on admin connect + `GET .../replay` |
| `device_event` | N/A | Broadcast to admins watching uid; **not** persisted to DB |
| `control` | N/A | Dropped if device WS closed (no queue) |

On answer received: `pendingToDevice` cleared (prevents stale offer redelivery).

---

## Timing constants reference

### Portal (`useWebRtcViewer.ts`)

| Constant | ms | Purpose |
|----------|-----|---------|
| `OFFER_DELAY_MS` | 20,000 | Max wait without `deviceStreamReady` |
| `CAPTURE_WARMUP_MS` | 3,000 | Delay after `WEBRTC_READY` before offer |
| `OFFER_RETRY_MS` | 15,000 | Retry interval |
| `MAX_OFFER_ATTEMPTS` | 4 | Max offer retries |
| `NEGOTIATION_TIMEOUT_MS` | 45,000 | No answer timeout |
| `ICE_WAIT_MS` | 20,000 | Post-answer ICE timeout |
| `STREAM_WAIT_MS` | 25,000 | No video track timeout |
| `FRAME_WAIT_MS` | 30,000 | Zero-size frames timeout |

### Android

| Interval | Purpose |
|----------|---------|
| 2 s | HTTP signaling poll (WS down only) |
| 30 s | HTTP command poll |
| 45 s | WS reconnect attempt (when not in session) |

---

## Source file index

### Portal (this repo)

| Topic | File |
|-------|------|
| WebRTC peer connection | `web/src/hooks/useWebRtcViewer.ts` |
| Admin WebSocket | `web/src/hooks/useAdminWebSocket.ts` |
| Video panel + input | `web/src/components/RemoteViewer.tsx` |
| Touch / keyboard | `web/src/hooks/useRemoteVideoControl.ts` |
| Pointer → percent | `web/src/utils/videoCoordinates.ts` |
| Panel aspect ratio | `web/src/utils/streamDimensions.ts`, `web/src/hooks/useVideoStreamLayout.ts` |
| Session orchestration | `web/src/pages/DeviceDetail.tsx` |
| Signaling parse (client) | `web/src/utils/webrtcSignaling.ts` |
| Keyboard mapping | `web/src/utils/remoteKeyboard.ts` |
| Control types | `web/src/types.ts` |
| WS relay | `server/src/ws/hub.ts`, `server/src/ws/handlers.ts` |
| Signaling normalize | `server/src/services/signalingNormalize.ts` |
| Session queues | `server/src/services/signalingSession.ts` |
| Device HTTP API | `server/src/routes/deviceApi.ts` |
| Admin HTTP API | `server/src/routes/adminApi.ts` |

### Android (`/Users/michaelleckliter/AndroidStudioProjects/CFDRemoteAssist`)

| Topic | File |
|-------|------|
| WebSocket + HTTP | `app/.../utils/NetworkManager.kt` |
| WebRTC + rotation | `app/.../services/ScreenShareService.kt` |
| Command dispatch | `app/.../services/LocationTrackingService.kt` |
| Touch / keys | `app/.../remote/RemoteControlHandler.kt` |
| Key parsing | `app/.../remote/PortalKeyParser.kt` |
| Session dimensions | `app/.../remote/RemoteSessionManager.kt` |
| Accessibility bridge | `app/.../services/RemoteAssistAccessibilityService.kt` |

---

## Debugging checklist

### For a failed session, collect in order:

1. **Server docker logs** (filter `uid=<device>`):
   - `START_REMOTE_ADMIN` / `STOP_REMOTE_ADMIN` timestamps
   - `WebRTC relay admin→device kind=offer`
   - `WebRTC relay device→admin kind=answer`
   - ICE relay counts (device→admin should be ≥ 1)
   - `device_event event=WEBRTC_READY`
   - `device_event event=ORIENTATION_CHANGED` (if rotated)
   - `Signaling POST rejected` (wrong endpoint)

2. **Android logcat** (tags: `ScreenShare`, `NetworkManager`, `RemoteControlHandler`):
   - `FIRST FRAME CAPTURED! WxH` before and after rotation
   - `ICE Connection State: CONNECTED`
   - `Rotation: WxH -> WxH`
   - `Rotation failed: outbound-rtp framesEncoded not increasing`
   - `Sent ORIENTATION_CHANGED`
   - `CLICK at X,Y (displayWxH)` + `stream=WxH`

3. **Portal browser console:**
   - WebRTC status transitions in `RemoteViewer`
   - `signaling_status` from diagnostics panel

### Healthy session signatures

See [R6](#r6--end-to-end-ordered-timeline-portrait--landscape) and [R7](#r7--verification-checklist-ordered-log-signatures) for normative rotation ordering.

**Session start (before any rotation):**
```
Server:  offer → answer → ICE×N → WEBRTC_READY → REMOTE_SESSION_STARTED
Android: FIRST FRAME 540x1200 → ICE CONNECTED
Portal:  negotiating → connecting → streaming (video 540×1200)
```

**After rotation (portrait → landscape):**
```
Android: Rotation 540x1200->1200x540 → FIRST FRAME 1200x540 → ORIENTATION_CHANGED
Server:  device_event event=ORIENTATION_CHANGED (no WebRTC relay)
Portal:  streamLayoutHint {1200,540} → video eventually 1200×540
```

---

## Version notes — portal v2.2.15

| Behavior | v2.2.15 (current) |
|----------|-------------------|
| Codec preference | VP8/VP9 only |
| Rotation panel | Stays on decoded video until `video.videoWidth/Height` updates — see [R4.4](#r4--portal-runbook-ordered-steps) |
| Keyframe on rotation | Requested when layout hint changes during active stream |
| Mid-session 2nd answer | Ignored when PC stable — see [R2.12](#r2--android-runbook-ordered-steps) |
| `connection_secret` on admin→device | Present |
| `WEBRTC_READY` | Session start only; 3 s offer warmup |

**Rotation implementation:** Follow [Rotation runbook (normative)](#rotation-runbook-normative) in full. Android encoder must resume RTP on the same track (R2.7–R2.8); portal v2.2.15 reduces black letterboxing but cannot fix black video if RTP stalls indefinitely.
