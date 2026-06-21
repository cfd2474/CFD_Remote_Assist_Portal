# Android App — Server Integration Requirements

This document is the **primary integration spec** for the CFD Assist Android app working with the **EUD Remote Assist Portal** at `https://remote.tak-solutions.com`.

It is written to be handed directly to the app developer/agent. It contains exact commands, message formats, designed flows, timing expectations, dependencies, and a focused diagnosis of the **current remote-assist stall** (see **§8.10 — START HERE for the current bug**).

Related docs:

- [android-eud-app-build-handoff.md](android-eud-app-build-handoff.md) — **step-by-step guide to building the Android app from scratch** (reference impl v2.0.0)
- [android-webrtc-requirements.md](android-webrtc-requirements.md) — condensed WebRTC quick reference
- [android-device-api-port-handoff.md](android-device-api-port-handoff.md) — port 8448 cutover
- [mdm-config.md](mdm-config.md) — EMM managed configuration keys
- [android-control-handler-handoff.md](android-control-handler-handoff.md) — Kotlin touch + keyboard control handler

---

## 0. Current status summary (read first)

Confirmed from server logs, relayed SDP, **and the operator browser's `chrome://webrtc-internals`** (2026-06-15):

| Layer | State |
|-------|-------|
| Registration / WebSocket auth | ✅ Working |
| `START_REMOTE_ADMIN` delivery | ✅ Working |
| `webrtc_ready` / `signaling_hint` | ✅ Working |
| **SDP offer (admin → device)** | ✅ Healthy — `recvonly` video, `setup:actpass`, codecs VP8/VP9/H264, fingerprint + ice-ufrag present |
| **SDP answer (device → admin)** | ✅ Healthy — `sendonly` video, `setup:active`, codecs VP8/VP9/H264, fingerprint + ice-ufrag present, real `a=ssrc` |
| ICE connectivity | ✅ **Connected** — `iceConnectionState: connected`, candidate-pair **succeeded** (host↔host on the same LAN, `192.168.86.x`). Browser applies the device's candidates correctly. |
| DTLS handshake | ✅ **Connected** — `transport: dtlsState=connected` |
| **Media (RTP video to browser)** | ❌ **No `inbound-rtp` video; zero frames decoded** — portal stuck on **“Answer received — establishing video stream…”** |

**Conclusion (corrected):** Signaling, SDP, ICE, **and DTLS all succeed** — the peer connection transport is fully established within ~1 second on the same Wi‑Fi. The device then **sends no RTP video packets** into the connected transport. This is a **device-side media-production bug**: the screen-capture / encoder pipeline is not feeding the negotiated `sendonly` video track.

> The continuous ICE candidate trickle from the device is just `GATHER_CONTINUALLY` and is **harmless** — ICE is already connected. It is **not** the bug. (An earlier hypothesis blamed unapplied ICE candidates; `webrtc-internals` disproves it — ICE/DTLS are connected.)

This regressed after recent app-side rework. The full diagnosis and fix are in **§8.10**.

---

## 1. Server URLs

| Purpose | URL |
|---------|-----|
| **Base URL (MDM `tracking_server_url`)** | `https://remote.tak-solutions.com:8448` |
| Register | `POST /api/v1/register` |
| Ping | `GET` or `POST /api/v1/ping` |
| Telemetry | `POST /api/v1/telemetry` |
| Events | `POST /api/v1/event` |
| Command poll | `GET /api/v1/commands` |
| **WebRTC signaling (HTTP fallback)** | `GET` / `POST /api/v1/signaling` |
| Health check | `GET /health` |
| Version | `GET /version` |
| Device WebSocket | `wss://remote.tak-solutions.com:8448/ws/device` |
| Admin portal (humans only — not used by app) | `https://remote.tak-solutions.com` (443) |

**Port 8448** is the dedicated device API port. Read `tracking_server_url` from MDM for every HTTP and WebSocket call — do not hard-code the hostname or port.

> **443 vs 8448:** Port **443** serves the web admin portal and OIDC login. All Android device traffic (register, telemetry, commands, WebSocket, signaling) uses **8448**. Device routes are blocked on 443.

All requests must use **HTTPS/WSS** with valid TLS (Let's Encrypt on production).

---

## 2. MDM managed configuration

Push these restriction keys via your EMM/MDM:

| Key | Type | Description |
|-----|------|-------------|
| `tracking_server_url` | string | `https://remote.tak-solutions.com:8448` |
| `connection_secret` | string | Hex secret from registration (see §3) |
| `tracking_interval` | integer | Minutes between location telemetry (e.g. `15`) |
| `settings_password` | string | Org-defined PIN to lock local app settings |

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

`POST {tracking_server_url}/api/v1/register` — **Auth: none**

Request body (only `uid` strictly required; include others when available):

```json
{
  "uid": "568b166b3dd461eb",
  "serial": "R58M123456X",
  "imei": "352637001234567",
  "device_name": "Galaxy XCover6 Pro",
  "model": "Samsung SM-G736U",
  "agency": "City Fire Department",
  "phone_number": "+15551234567",
  "app_version": "1.2.0"
}
```

camelCase aliases accepted: `androidId`, `deviceName`, `phoneNumber`, `appVersion`.

Response (201 new / 200 re-register):

```json
{
  "uid": "568b166b3dd461eb",
  "connection_secret": "a1b2c3d4e5f6...",
  "tracking_server_url": "https://remote.tak-solutions.com:8448",
  "message": "Device registered. Store connection_secret in MDM managed config."
}
```

**App responsibilities:**

1. Register on first launch if no `connection_secret` is available.
2. Persist `connection_secret` locally (encrypted) and report it to MDM for managed config push.
3. Re-register on upgrade if device metadata changed (optional but recommended).

---

## 4. Authentication (all requests after registration)

Send the device secret on every authenticated REST call:

```
X-Connection-Secret: <connection_secret>
```

Alternative: `Authorization: Bearer <connection_secret>`.

For `GET /api/v1/commands` and `GET/POST /api/v1/signaling`, the secret alone identifies the device — `uid` is not required in the request. Invalid/missing secret → `401`.

---

## 5. REST endpoints

### 5.1 Ping
`GET {base}/api/v1/ping?uid=<uid>` (or `POST` with `uid`). Auth: none.
```json
{ "ok": true, "uid": "568b166b3dd461eb", "device_name": "Galaxy XCover6 Pro" }
```
`404` → not registered.

### 5.2 Telemetry
`POST {base}/api/v1/telemetry` — headers `X-Connection-Secret`, `Content-Type: application/json`.
```json
{ "uid": "568b166b3dd461eb", "lat": 39.7392, "lon": -104.9903, "accuracy_m": 12.5, "battery": 87, "is_charging": false, "timestamp": 1718294400000 }
```
Response includes any queued commands — **process every entry in `commands[]`** (same format as §7):
```json
{ "ok": true, "commands": [ { "type": "command", "command": "TRIGGER_PING", "connection_secret": "a1b2c3..." } ] }
```
Send on MDM `tracking_interval` and on significant location/battery change.

### 5.3 Events
`POST {base}/api/v1/event` — headers `X-Connection-Secret`, `Content-Type: application/json`.
```json
{ "uid": "568b166b3dd461eb", "event": "PING_COMPLETED", "payload": { "latency_ms": 42 } }
```
Response `{ "ok": true }`.

> ⚠️ **Do not POST device events to `/api/v1/signaling`.** Server logs show the app posting `REMOTE_SESSION_STOPPED` to the signaling endpoint, which is rejected (`Signaling POST rejected`). Device events go to `/api/v1/event` (REST) or as `{ "type": "device_event", ... }` on the WebSocket. The signaling endpoint accepts **only** SDP/ICE (`type: "webrtc"`).

### 5.4 Command poll (fallback delivery)
`GET {base}/api/v1/commands` — header `X-Connection-Secret`.
```json
{ "commands": [ { "type": "command", "command": "REQUEST_LOCATION", "connection_secret": "a1b2c3..." } ] }
```
Poll every **30s** while running, even with WebSocket connected.

---

## 6. WebSocket (required)

Persistent WebSocket to `{tracking_server_url}/ws/device`. Required for instant commands, **WebRTC signaling**, and remote touch.

### 6.1 Lifecycle
1. Open `wss://…/ws/device`.
2. Send auth frame within **10s** (else server closes `4001`).
3. On `auth_ok`, process any immediately-pushed commands.
4. **Auto-reconnect** on disconnect/network change/app restart/server restart (backoff 1s→2s→5s→30s).
5. Run inside a **foreground service**.
6. **Do not reconnect the WebSocket during an active remote session** — it breaks signaling.

### 6.2 Auth frame (first message)
```json
{ "type": "auth", "uid": "568b166b3dd461eb", "connection_secret": "a1b2c3d4e5f6..." }
```
Response `{ "type": "auth_ok", "uid": "…" }`. Failure → close `4003`.

### 6.3 Keepalive
Send `{ "type": "ping" }` every 30–60s; receive `{ "type": "pong" }`.

### 6.4 Incoming message types
| `type` | Action |
|--------|--------|
| `command` | Handle admin command (§7) |
| `webrtc` | WebRTC signaling — SDP offer or ICE candidate (§8) |
| `signaling_hint` | Server hint describing expected answer/ICE format (§8.7) |
| `control` | Remote touch/key input (§9) |
| `pong` | Keepalive response |
| `error` | Log and continue |

### 6.5 Outgoing message types
| `type` | Purpose |
|--------|---------|
| `webrtc` | SDP **answer** and **ICE candidates** (§8) — required for remote view |
| `webrtc_ready` | Screen capture started; portal sends the offer immediately |
| `device_event` | Real-time events to portal (`REMOTE_SESSION_STARTED`, `ORIENTATION_CHANGED`, …) |
| `ping` | Keepalive |

---

## 7. Admin commands

Arrive via **WebSocket** (instant) or **telemetry/commands poll** (queued). Format:
```json
{ "type": "command", "command": "TRIGGER_PING", "connection_secret": "a1b2c3d4e5f6..." }
```
Verify `connection_secret` before acting.

| Command | App action |
|---------|------------|
| `TRIGGER_PING` | Connectivity check; POST event/telemetry with result |
| `REQUEST_LOCATION` | GPS fix; POST telemetry |
| `START_REMOTE_ADMIN` | Start screen capture + WebRTC session (§8) |
| `STOP_REMOTE_ADMIN` | Tear down WebRTC + capture immediately |
| `LOCK_DEVICE` | Tear down remote assist if active, then lock screen |
| `RESYNC_DEVICE_INFO` | Re-POST `/api/v1/register` with current metadata (§7.1) |

### 7.1 `RESYNC_DEVICE_INFO`
On receipt: verify secret → collect current metadata → `POST /api/v1/register` with full body using the **existing** `uid` (server returns 200, same secret). Optionally POST `DEVICE_INFO_RESYNCED` event. Does not start remote assist or lock. Delivery: WebSocket when live, else queued.

---

## 8. Remote assist (WebRTC) — full specification

> **The remainder of §8 is the core of this document.** The current stall is a WebRTC transport problem, not a signaling/SDP problem.

### 8.0 Dependencies & permissions

| Dependency | Requirement |
|------------|-------------|
| WebRTC library | Google `libwebrtc` (org.webrtc) — recent build (M114+ recommended). Use **Unified Plan** (default in modern builds). |
| Screen capture | `MediaProjection` via `MediaProjectionManager`; `ScreenCapturerAndroid` feeding a `VideoSource`/`VideoTrack` |
| Foreground service | `mediaProjection` foreground service type, running for the entire session |
| Permissions | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `POST_NOTIFICATIONS` (Android 13+), runtime MediaProjection consent |
| Network | Outbound UDP to arbitrary high ports for STUN/ICE (cellular + Wi-Fi). No TURN server is configured yet — connectivity relies on STUN + NAT traversal. |
| STUN | `stun:stun.l.google.com:19302` (both peers) |

> **No TURN yet.** Until a TURN server is added, both peers must reach each other via host/srflx candidates. On cellular (carrier-grade NAT) this **only works if the device actively sends outbound connectivity checks** — which requires applying the browser's ICE candidates (see §8.5). This is the most likely cause of the current failure.

### 8.1 Designed end-to-end flow (with timing budget)

A healthy session reaches video in **≤ 15 seconds**. Target timeline:

```
t=0.0s  Admin clicks Connect → server sends START_REMOTE_ADMIN (+ connection_secret)
t≈0.1s  Server sends signaling_hint to device
        Device: start foreground service + MediaProjection + screen capture
t≈0.5s  Device: first captured frame → send { "type": "webrtc_ready" }
t≈0.6s  Admin browser builds OFFER (recvonly video) → relayed to device (+ connection_secret)
        Browser begins trickling its ICE candidates (host + srflx), ~2 candidates
t≈0.7s  Device: setRemoteDescription(offer)
        Device: ensure screen VideoTrack is on the PeerConnection (added before answer)
        Device: createAnswer() → setLocalDescription(answer) → send answer
t≈0.8s  Device: onIceCandidate fires → send EACH candidate to browser
        Device: APPLY each browser ICE candidate via addIceCandidate (THE critical step)
t≈1–6s  ICE connectivity checks succeed → iceConnectionState = CONNECTED
        DTLS handshake completes → SRTP keys established
t≈2–8s  Device encodes screen frames → RTP flows to browser
        Browser decodes first frame → portal switches to "streaming"  ✅
```

**Observed failure:** everything through `createAnswer` + ICE emission works, but ICE never reaches CONNECTED, so steps after t≈6s never happen and the device keeps emitting candidates indefinitely.

### 8.2 Message catalog

All signaling uses `type: "webrtc"`. The server relays device→admin **verbatim**, and **adds `connection_secret`** to admin→device messages.

**Inbound to device — SDP offer (admin → device):**
```json
{
  "type": "webrtc",
  "connection_secret": "a1b2c3d4e5f6...",
  "sdp": { "type": "offer", "sdp": "v=0\r\n..." }
}
```

**Inbound to device — ICE candidate (admin → device):**
```json
{
  "type": "webrtc",
  "connection_secret": "a1b2c3d4e5f6...",
  "ice": { "candidate": "candidate:...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
```

> ⚠️ **The `connection_secret` field is new.** If the app's inbound `webrtc` parser was reworked to reject/ignore messages based on shape, or only routes on specific keys, make sure messages carrying `connection_secret` **and** `ice` are still routed to `addIceCandidate`. Validate the secret if you wish, but **do not drop the message**.

**Outbound from device — SDP answer:**
```json
{ "type": "webrtc", "sdp": { "type": "answer", "sdp": "v=0\r\n..." } }
```

**Outbound from device — ICE candidate:**
```json
{ "type": "webrtc", "ice": { "candidate": "candidate:...", "sdpMid": "0", "sdpMLineIndex": 0 } }
```

Legacy shapes (`candidate` instead of `ice`; flat string `sdp`) are accepted by the server but the canonical shapes above are preferred. Field names must match exactly (`sdpMid`, `sdpMLineIndex`).

### 8.3 PeerConnection setup

```kotlin
val rtcConfig = PeerConnection.RTCConfiguration(
    listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
).apply {
    sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
    // bundlePolicy / rtcpMuxPolicy defaults are fine; do NOT force a non-default that drops bundle
    continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
}
val pc = factory.createPeerConnection(rtcConfig, observer)!!
```

Create **one** PeerConnection per session and reuse it. Do **not** recreate it on each inbound message.

### 8.4 Offer / answer handling (ordering rule)

The browser offers **recvonly** video. The device must answer **sendonly** with the screen track present **before** `createAnswer()`:

```kotlin
// On inbound { type:"webrtc", sdp:{ type:"offer" } }
pc.setRemoteDescription(observer, SessionDescription(OFFER, offerSdp))

// Ensure the screen capture VideoTrack is already added to pc BEFORE creating the answer.
// addTrack(screenVideoTrack, listOf(streamId))  // do this once, before createAnswer

pc.createAnswer(object : SdpObserver {
    override fun onCreateSuccess(answer: SessionDescription) {
        pc.setLocalDescription(localObserver, answer)
        sendWebSocket(mapOf("type" to "webrtc", "sdp" to mapOf("type" to "answer", "sdp" to answer.description)))
    }
    // ...
}, MediaConstraints())
```

Rules:
- **Add the screen track before `createAnswer()`.** Adding it after triggers `onRenegotiationNeeded` and produces a 0×0 / no-RTP stream on the portal. (Current SDP shows the track IS present — good — keep it that way.)
- **Process only one offer per session.** Ignore duplicate offers unless the admin explicitly retries (which starts a fresh session).
- Keep `mid` alignment from the offer (current answer correctly uses `mid=0`).

### 8.5 ICE handling (confirmed working — keep it this way)

> `webrtc-internals` confirms ICE + DTLS reach **connected** and the device's candidates are applied by the browser. This section is **not** the current bug; it is retained as the correctness baseline. The current bug is media production — see **§8.10**.

ICE is bidirectional. The device must do **both** of the following:

**(A) Send every local candidate** as it is gathered:
```kotlin
override fun onIceCandidate(c: IceCandidate) {
    sendWebSocket(mapOf(
        "type" to "webrtc",
        "ice" to mapOf(
            "candidate" to c.sdp,
            "sdpMid" to c.sdpMid,
            "sdpMLineIndex" to c.sdpMLineIndex
        )
    ))
}
```
(The device is already doing this — many candidates are reaching the portal.)

**(B) Apply every remote (browser) candidate** (already working — keep it):
```kotlin
// On inbound { type:"webrtc", ice:{ candidate, sdpMid, sdpMLineIndex } }
val ice = IceCandidate(msg.sdpMid, msg.sdpMLineIndex, msg.candidate)
if (pc.remoteDescription != null) {
    pc.addIceCandidate(ice)
} else {
    pendingRemoteCandidates.add(ice)   // BUFFER until setRemoteDescription completes
}

// After setRemoteDescription(offer) succeeds, flush the buffer:
pendingRemoteCandidates.forEach { pc.addIceCandidate(it) }
pendingRemoteCandidates.clear()
```

**Mandatory ICE rules (already satisfied — do not regress):**
1. **Apply ALL browser candidates** received as `{ type:"webrtc", ice:{...} }`.
2. **Buffer remote candidates** that arrive before `setRemoteDescription(offer)` completes, then flush them.
3. **Do not gate ICE messages on `connection_secret` shape.** The relayed offer/ICE include `connection_secret`; route them to the PeerConnection regardless.
4. **Do not restart ICE or recreate the PeerConnection** while gathering.
5. Continual gathering keeps emitting candidates after `connected` — that is normal and harmless.

### 8.6 DTLS, codecs, SRTP expectations

The relayed SDP is already correct; preserve this:
- DTLS: offer `setup:actpass` → answer **`setup:active`** ✅ (device is DTLS client). Do not send `actpass` in the answer.
- Fingerprint + `ice-ufrag`/`ice-pwd` present in answer ✅.
- Codecs: keep at least one of **VP8 / VP9 / H264** in the answer ✅ (all three currently offered/answered).
- A real `a=ssrc` for the outbound video ✅.

DTLS completes **after** ICE connects — and `webrtc-internals` confirms both are **connected**. The negotiation and transport are correct. The remaining failure is purely that **no RTP is produced** — see **§8.10**.

### 8.7 `webrtc_ready`, `signaling_hint`, session events

- After the **first captured frame**, send `{ "type": "webrtc_ready" }` so the portal offers immediately. Send it **once** per session (logs show it being sent multiple times — harmless but avoid).
- The server sends a `signaling_hint` after `START_REMOTE_ADMIN` describing the exact answer/ICE format and HTTP fallback. You may use it or ignore it, but do not treat it as an error.
- Send `{ "type": "device_event", "uid": "...", "event": "REMOTE_SESSION_STARTED", "payload": {} }` when the session begins, and `REMOTE_SESSION_STOPPED` on teardown — **on the WebSocket**, or via `POST /api/v1/event`, **not** `POST /api/v1/signaling`.

### 8.8 HTTP signaling fallback

If WebSocket signaling is unreliable, mirror it over REST (same `X-Connection-Secret`):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/signaling` | Poll pending admin offers + ICE |
| `POST /api/v1/signaling` | Post SDP answer + device ICE candidates (**SDP/ICE only**) |

`GET` response:
```json
{ "messages": [
  { "type": "webrtc", "sdp": { "type": "offer", "sdp": "v=0\r\n..." } },
  { "type": "webrtc", "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }
] }
```
Apply offers/candidates from the poll **the same way** as WebSocket messages — including **applying the browser ICE candidates** (§8.5). Using HTTP for signaling does not change the ICE requirement.

### 8.9 Teardown

On `STOP_REMOTE_ADMIN` / `LOCK_DEVICE`: close the PeerConnection, stop the capturer, release MediaProjection, stop the foreground service, and send `REMOTE_SESSION_STOPPED`. Be idempotent — the admin may click stop/connect repeatedly (logs show start/stop churn).

### 8.10 START HERE — diagnosis of the current stall

**Symptom:** Portal stuck on “Answer received — establishing video stream…”; the device emits ICE candidates continuously; no video ever appears.

**Confirmed evidence (operator `chrome://webrtc-internals`, device fd72b785310f3536):**

```
ICE connection state: new => checking => connected
Connection state:     new => connecting => connected
Signaling state:      new => have-local-offer => stable
transport:            iceState=connected, dtlsState=connected
candidate-pair:       state=succeeded  (selected: browser <=> 192.168.86.28:40212, host↔host on same Wi-Fi)
inbound-rtp (video):  NOT PRESENT  → 0 packets, 0 frames decoded
```

This proves the **entire transport is established** (signaling → SDP → ICE → DTLS) in ~1 second, peer-to-peer on the same LAN. The **only** thing missing is RTP media from the device.

**Root cause: the device is not producing/sending video media into the connected track.** The `sendonly` video track is negotiated (real `a=ssrc` in the answer) and the transport is up, but **no encoded frames are being fed to it**. The earlier "unapplied ICE" theory is disproven — ICE/DTLS are connected and the device's candidates are applied by the browser.

**Where to look on the device (ranked):**

1. **MediaProjection capture not actually running / single-use token reused.** The `MediaProjection` consent `Intent` (result from `createScreenCaptureIntent()`) is **single-use**: a token from a previous session, or one reused across `STOP`/`START`, yields a projection that **captures nothing** (no frames, no error). If the rework changed how/when the projection token is obtained or cached, capture silently produces zero frames. **Fix:** request a fresh MediaProjection permission result for **each** new `START_REMOTE_ADMIN` session and pass that exact `Intent` data into `ScreenCapturerAndroid`.

2. **Capturer created but `startCapture()` never called (or called with bad size).** `ScreenCapturerAndroid` must be `initialize(surfaceTextureHelper, context, videoSource.capturerObserver)` **and** `startCapture(width, height, fps)` with non-zero, encoder-valid dimensions. **Fix:** verify `startCapture` runs and dimensions match the display.

3. **Track not wired to the running capturer.** The `VideoTrack` added to the PeerConnection must be built from the **same** `VideoSource` whose `capturerObserver` the capturer feeds. A rework that creates the source/track separately from the capturer wiring produces an ssrc but no frames. Also ensure `videoSource = factory.createVideoSource(isScreencast = true)`.

4. **Track disabled/muted.** `videoTrack.setEnabled(true)` and the `RtpSender` actually carries that track.

5. **Encoder init failure.** Hardware encoder fails to initialize for the chosen codec/resolution (e.g., width/height not aligned). libwebrtc logs `Failed to initialize encoder` / `EncoderQueue`. **Fix:** check capture dimensions; try VP8 first.

**Correct capture → track wiring (reference):**

```kotlin
val egl = EglBase.create()
val surfaceHelper = SurfaceTextureHelper.create("ScreenCapture", egl.eglBaseContext)

// isScreencast = true is important for screen content
val videoSource = factory.createVideoSource(/* isScreencast = */ true)

// Fresh MediaProjection result Intent for THIS session (single-use!)
val capturer = ScreenCapturerAndroid(mediaProjectionResultIntent, object : MediaProjection.Callback() {
    override fun onStop() { /* projection ended */ }
})
capturer.initialize(surfaceHelper, appContext, videoSource.capturerObserver)
capturer.startCapture(displayWidth, displayHeight, 30)   // must be called; non-zero size

val videoTrack = factory.createVideoTrack("screen0", videoSource).apply { setEnabled(true) }
pc.addTrack(videoTrack, listOf("stream0"))               // BEFORE createAnswer()
```

**App-side instrumentation to confirm the fix:**
- Log frame delivery: wrap `videoSource.capturerObserver` (or add a `VideoSink` to the track) and count `onFrame` calls. **Zero `onFrame` = capture problem (#1–#3).**
- Log `RtpSender` outbound stats: `pc.getStats()` → `outbound-rtp` video `framesEncoded` / `packetsSent`. **`framesEncoded` stuck at 0 with frames arriving = encoder problem (#5).**
- A correct run: `onFrame` fires continuously → `outbound-rtp.framesEncoded` climbs → browser `inbound-rtp.framesDecoded` climbs → portal switches to streaming within a few seconds.

**Portal-side note:** nothing more is required from the portal — it correctly built the offer, applied the answer, and reached ICE+DTLS connected. The portal (v2.2.12+) will now fail the session with an explicit "ICE connected but no frames" message at ~90s instead of hanging, but the fix is on the device.

### 8.11 Screen rotation (portrait ↔ landscape)

The portal sizes the panel from the **intrinsic WebRTC video track dimensions** (`videoWidth`/`videoHeight`), with optional `ORIENTATION_CHANGED` / `CAPTURE_RESIZED` events as hints. Landscape = `width > height`.

On each rotation during a session:
1. Read **current** display metrics (not cached):
   ```kotlin
   val bounds = windowManager.currentWindowMetrics.bounds
   val w = bounds.width(); val h = bounds.height()
   ```
2. Resize capture: `screenCapturer.changeCaptureFormat(w, h, 30)` (or recreate VirtualDisplay).
3. Map touches with **display** pixels (see §9), refreshed every rotation.
4. If `onRenegotiationNeeded` fires, create a new answer and send it (the portal applies a mid-session answer).
5. Send:
   ```json
   { "type": "device_event", "uid": "568b166b3dd461eb", "event": "ORIENTATION_CHANGED",
     "payload": { "width": 2340, "height": 1080, "orientation": "landscape" } }
   ```

Rotation pitfalls: portal stays portrait (capture not resized); ~2× click offset (touch mapped to capture size, not display); vertical swipes fail (using width for Y).

---

## 9. Remote control (touch input)

During an active session the admin sends control packets on the device WebSocket.

**Click:** `{ "type":"control", "action":"CLICK", "x_percent":0.52, "y_percent":0.41, "stream_width":540, "stream_height":1204 }`
**Swipe:** `{ "type":"control", "action":"SWIPE", "x_percent":0.10, "y_percent":0.50, "x2_percent":0.90, "y2_percent":0.50, "duration_ms":350 }`
**Long-press:** `{ "type":"control", "action":"LONG_PRESS", "x_percent":0.52, "y_percent":0.41 }`
**Key:** `{ "type":"control", "action":"KEY", "key":"KEYCODE_A", "input_method":"hardware_keyboard" }`

Coordinates are **0.0–1.0 fractions of the device screen**. Convert with **physical display size**:
```kotlin
val bounds = windowManager.currentWindowMetrics.bounds
val x = (x_percent * bounds.width()).toFloat()
val y = (y_percent * bounds.height()).toFloat()   // use height for Y, not width
```

| Action | API |
|--------|-----|
| `CLICK` | `dispatchGesture()` short stroke (~50ms) |
| `SWIPE` | `dispatchGesture()` start→end; honor `duration_ms` (250–900, default 350) |
| `LONG_PRESS` | `dispatchGesture()` ~600ms hold |
| `KEY` | `BACK`/`HOME`/`RECENTS` via `performGlobalAction`; else `KeyEvent` with `SOURCE_KEYBOARD` |

`key` uses Android `KeyEvent` names (`BACK`, `HOME`, `RECENTS`, `DPAD_*`, `KEYCODE_A`…`KEYCODE_Z`, `KEYCODE_0`…`KEYCODE_9`, `KEYCODE_ENTER/DEL/SPACE/TAB`, combos like `Ctrl+c`). Keyboard input is forwarded as `KEY` packets except when the admin has focused an editable portal field.

Common bugs: using capture (half-res) size instead of display size (touches at ~half position); using width for both X and Y (breaks vertical swipes). Full Kotlin handler: [android-control-handler-handoff.md](android-control-handler-handoff.md).

---

## 10. Background behavior requirements

| Requirement | Detail |
|-------------|--------|
| WebSocket | Persistent foreground service; auto-reconnect with backoff |
| Command poll | `GET /api/v1/commands` every 30s while active |
| Telemetry | On MDM `tracking_interval` |
| Server restart | Reconnect WebSocket; poll delivers queued commands |
| Network change | Reconnect WebSocket on Wi-Fi ↔ cellular switch (but **not** mid remote session if avoidable) |
| Boot | Start tracking service on `BOOT_COMPLETED` if MDM policy requires |

---

## 11. Implementation checklist

### Registration / auth / REST / WebSocket
- [ ] Read `tracking_server_url` from MDM; register if no secret; store `connection_secret`
- [ ] `X-Connection-Secret` on all authenticated calls
- [ ] Telemetry + events + 30s command poll; process all `commands[]`
- [ ] Persistent `/ws/device` with auth within 10s; auto-reconnect; keepalive ping/pong
- [ ] Route inbound `command`, `webrtc`, `signaling_hint`, `control`

### Remote assist (WebRTC) — priority
- [ ] Foreground service + MediaProjection; send `webrtc_ready` once after first frame
- [ ] One PeerConnection per session with Google STUN, Unified Plan
- [ ] On offer: `setRemoteDescription(offer)` → screen track already added → `createAnswer` → send answer
- [ ] **Send every local ICE candidate** (working)
- [ ] **Apply every browser ICE candidate via `addIceCandidate`** ← current gap
- [ ] **Buffer remote candidates** until `setRemoteDescription` completes, then flush ← current gap
- [ ] Do **not** drop `webrtc` messages that carry `connection_secret`
- [ ] Do **not** recreate the PeerConnection or restart ICE mid-session
- [ ] Log `iceConnectionState` transitions; confirm `CHECKING → CONNECTED`
- [ ] Device events to `/api/v1/event` or WS `device_event` — **never** `/api/v1/signaling`
- [ ] Teardown idempotent on STOP/LOCK
- [ ] Rotation: resize capture, fix touch mapping, renegotiate, send `ORIENTATION_CHANGED`

---

## 12. Testing

```bash
# Register
curl -sS -X POST https://remote.tak-solutions.com:8448/api/v1/register \
  -H 'Content-Type: application/json' -d '{"uid":"test-device-001","device_name":"Test Device"}'

# Ping
curl -sS 'https://remote.tak-solutions.com:8448/api/v1/ping?uid=<uid>'

# Telemetry
curl -sS -X POST https://remote.tak-solutions.com:8448/api/v1/telemetry \
  -H 'Content-Type: application/json' -H 'X-Connection-Secret: <secret>' \
  -d '{"uid":"<uid>","battery":100,"lat":39.7,"lon":-104.9}'

# Command poll
curl -sS https://remote.tak-solutions.com:8448/api/v1/commands -H 'X-Connection-Secret: <secret>'

# Signaling poll (during a remote session)
curl -sS https://remote.tak-solutions.com:8448/api/v1/signaling -H 'X-Connection-Secret: <secret>'

# WebSocket
wscat -c wss://remote.tak-solutions.com:8448/ws/device
# {"type":"auth","uid":"<uid>","connection_secret":"<secret>"}
```

**Portal verification:** device appears Live → Ping returns "Command sent" → **Connect** shows video within a few seconds → WebRTC signaling diagnostics panel shows Answer + non-zero device ICE and the session reaches streaming.

---

## 13. Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| **Stuck "establishing video stream"; ICE+DTLS connected; device trickles ICE forever; no `inbound-rtp`** | **Device sends no RTP — screen capture/encoder not feeding the track (current bug)** | **§8.10 — fresh MediaProjection token per session, call `startCapture()`, wire capturer→VideoSource→track, confirm `onFrame`** |
| ICE connected but black/no frames | Encoder not feeding the track | Wire `ScreenCapturerAndroid` → `VideoSource` of answered track; non-zero capture size; check `outbound-rtp.framesEncoded` |
| Stuck in CHECKING, never CONNECTED | Remote candidates not applied, or no reachable pair (no TURN) | §8.5 apply+buffer candidates; confirm UDP egress; plan TURN |
| Answer received, Device ICE: 0 | Local candidates not sent | Send every `onIceCandidate` |
| `Signaling POST rejected` | Device event posted to `/api/v1/signaling` | Use `/api/v1/event` or WS `device_event` |
| Black screen / no answer | No SDP answer | Send `{ type:"webrtc", sdp:{ type:"answer", ... } }` |
| Device not on dashboard | No register/telemetry on 8448 | Use port 8448 |
| Commands always "queued" | No live WebSocket | Persistent WS + auto-reconnect |
| WS closes immediately | Auth not sent within 10s | Send auth first |

---

## 14. Production reference

| Item | Value |
|------|-------|
| Admin portal | `https://remote.tak-solutions.com` |
| Device API base | `https://remote.tak-solutions.com:8448` |
| Device WebSocket | `wss://remote.tak-solutions.com:8448/ws/device` |
| WebRTC signaling (HTTP) | `GET/POST https://remote.tak-solutions.com:8448/api/v1/signaling` |
| Auth header | `X-Connection-Secret` |
| STUN server | `stun:stun.l.google.com:19302` |
| TURN server | none configured (NAT traversal via STUN only) |
| Command poll interval | 30 seconds |
| WebSocket auth timeout | 10 seconds |
| Target time-to-video | ≤ 15 seconds |
