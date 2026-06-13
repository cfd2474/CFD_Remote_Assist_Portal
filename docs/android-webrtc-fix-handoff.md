# Android App — WebRTC Remote View Fix Handoff

**Date:** 2026-06-13  
**Server:** `https://remote.tak-solutions.com`  
**Test device UID:** `568b166b3dd461eb` (Galaxy XCover6 Pro)  
**Portal diagnostics reference:** Remote assist → WebRTC signaling diagnostics panel

This document is for the **Android/EUD app agent**. It summarizes the **latest failed connection attempt**, server-side evidence, and **exact fixes required on the app**.

Full integration spec: [android-app-requirements.md](android-app-requirements.md)

---

## Executive summary (updated 2026-06-13 19:53 UTC)

| Layer | Status |
|-------|--------|
| Device registration / REST | Working |
| Command delivery (`START_REMOTE_ADMIN`) | Working |
| MediaProjection wait before `webrtc_ready` | **Improved** (~3s after START) |
| SDP answer (device → server → admin) | **Working** |
| **Device ICE (trickle)** | **Still not observed** in server logs |
| **Screen capture → video frames** | **Still not working** (black / 0×0) |
| **WebSocket stability** | **Still reconnecting ~1.5s after answer** |

**Latest failure mode:** App waits for permission then sends `webrtc_ready` + answer quickly (~150ms), but **no video frames** reach the browser. Likely answering **before** `startCapture()` produces frames, then **WebSocket reconnect** disrupts the session.

---

## Latest attempt timeline (2026-06-13 19:53 UTC)

| Time (UTC) | Δ from START | Event |
|------------|--------------|-------|
| 19:53:41.190 | 0s | `START_REMOTE_ADMIN` |
| 19:53:44.088 | **+2.9s** | `webrtc_ready` (after system screen-share permission) |
| 19:53:44.172 | +2.98s | Admin **offer** + ICE |
| 19:53:44.243 | +3.05s | Device **SDP answer** (only **155ms** after webrtc_ready) |
| 19:53:45.635 | +4.4s | **New WebSocket connection** |
| 19:54:30+ | — | Keepalive pings only; no STOP logged in window |

**Still absent:** any `device→admin kind=ice` trickle messages.

### Timing interpretation (MediaProjection)

The **2.9s gap** between START and `webrtc_ready` matches the system screen-share permission dialog — good progress.

The problem is the app sends `webrtc_ready` and the SDP **answer 155ms later**. That is too fast to:

1. Create VirtualDisplay + wire to WebRTC `VideoSource`
2. Call `startCapture(width, height, fps)`
3. Receive the first encoded frame

**`webrtc_ready` must mean "first frame captured", not "permission granted" or "PeerConnection created".**

---

## Latest attempt timeline (2026-06-13 19:43 UTC)

| Time (UTC) | Event | Direction |
|------------|-------|-----------|
| 19:43:49 | `START_REMOTE_ADMIN` | server → device |
| 19:43:50 | `webrtc_ready` + `WEBRTC_READY` event | device → server |
| 19:43:50 | WebRTC **offer** + **ICE** ×2 | admin → device |
| 19:43:50 | WebRTC **SDP answer** | device → admin |
| 19:43:51 | **New WebSocket connection** (1s after answer) | device |
| 19:44:20 | `STOP_REMOTE_ADMIN` | admin → device |

**Still absent:** `WebRTC relay device→admin kind=ice` (no trickle ICE messages).

**User-visible result:** Portal status showed **Streaming** but video was **black**. Diagnostics likely showed Device ICE: **0** and Device WS disconnect/reconnect.

---

## Previous attempt timeline (2026-06-13 19:33 UTC)

Server logs for the most recent Connect attempt:

| Time (UTC) | Event | Direction |
|------------|-------|-----------|
| 19:33:20 | `START_REMOTE_ADMIN` sent via WebSocket | server → device |
| 19:33:20 | `signaling_hint` sent | server → device |
| 19:33:21 | `webrtc_ready` | device → server |
| 19:33:21 | `device_event WEBRTC_READY` | device → server |
| 19:33:21 | WebRTC **offer** | admin → device |
| 19:33:21 | WebRTC **ICE** ×2 | admin → device |
| 19:33:21 | WebRTC **SDP answer** | device → admin |
| 19:33:23 | **New WebSocket connection** (2s after answer) | device |
| 19:34:07 | `STOP_REMOTE_ADMIN` (user gave up) | admin → device |

**Not present in logs:** any `WebRTC relay device→admin kind=ice` — zero device ICE candidates.

Portal diagnostics for this session would show:

- Offer sent: **Yes**
- Answer received: **Yes**
- Admin ICE: **2**
- Device ICE: **0** ← failure
- HTTP posts: **0**

---

## Required fix #1B — Screen capture must feed the video track (CURRENT BLOCKER)

### Correct sequence (respect MediaProjection delay)

```
START_REMOTE_ADMIN received
    ↓
Show system screen-share permission dialog (user may take 2–10+ seconds)
    ↓
onActivityResult / MediaProjection granted
    ↓
Create VideoSource + ScreenCapturer + VirtualDisplay
    ↓
addTrack(videoTrack) on PeerConnection  ← BEFORE createAnswer
    ↓
startCapture(width, height, 30)
    ↓
Wait for FIRST FRAME (capturerObserver.onFirstFrameAvailable or frame callback)
    ↓
Send { type: "webrtc_ready" }   ← NOT before this point
    ↓
Receive offer → setRemoteDescription → createAnswer → send answer
    ↓
Send trickle ICE candidates as they are gathered
    ↓
Keep same WebSocket open — do NOT reconnect
```

**Wrong today:** `webrtc_ready` at +2.9s, answer at +3.05s → permission just granted, capture not running yet.

Portal now waits **3 seconds after `webrtc_ready`** before sending the offer, and allows **12 seconds** for frames to appear — but the app must still send `webrtc_ready` only after capture is producing frames.

### Checklist

1. **Start MediaProjection** and obtain `VirtualDisplay` + `Surface` **before** `createAnswer()`
2. Connect surface to WebRTC `VideoSource` / `SurfaceTextureHelper`:

```kotlin
val videoSource = factory.createVideoSource(capturer.isScreencast)
capturer.initialize(surfaceTextureHelper, appContext, videoSource.capturerObserver)
capturer.startCapture(width, height, 30)

val videoTrack = factory.createVideoTrack("screen", videoSource)
peerConnection.addTrack(videoTrack, listOf("stream0"))  // MUST be before createAnswer
```

3. Verify locally: track `state() == LIVE` and frames are being captured (log frame timestamps)
4. Do **not** call `webrtc_ready` until capturer has actually started
5. SDP answer must describe the **send** video m-line (not recvonly/inactive on device side)

### Common mistakes causing black screen

| Mistake | Symptom |
|---------|---------|
| `addTrack` after `createAnswer` | Empty track in SDP |
| MediaProjection permission granted but capturer never `startCapture()` | 0×0 video |
| VirtualDisplay created but not wired to WebRTC surface | Black frames |
| Separate WS reconnect tears down capturer | Brief stream then black |
| `addTrack` before offer leaves pending renegotiation after answer | Track on admin, 0×0 / no RTP (see **Fix #1C**) |
| VideoTrack created but not added to PeerConnection | No media |

---

## Required fix #1C — Post-answer `Renegotiation Needed` (CURRENT BLOCKER for 0×0)

Recent logcat (14:13 UTC) shows capture is working (`FIRST FRAME CAPTURED! 540×1204`), ICE is **CONNECTED**, and the SDP answer is sent — but the app logs **`Renegotiation Needed` immediately after the answer**. The portal then receives a video track with **no RTP packets** (0×0).

This happens when the screen track is added **before** the admin offer arrives. Unified Plan leaves a pending renegotiation that the answer does not fully resolve, so the negotiated sender never pumps frames to the browser.

### Fix (recommended order)

```kotlin
// 1. Start capture and wait for first frame (keep this)
capturer.startCapture(w, h, 30)
waitForFirstFrame()
sendWebrtcReady()

// 2. When offer arrives — add track HERE, not at step 1
peerConnection.setRemoteDescription(offer) {
    peerConnection.addTrack(videoTrack, listOf("stream0"))  // or setDirection(SEND_ONLY) on transceiver
    peerConnection.createAnswer { answer ->
        peerConnection.setLocalDescription(answer)
        sendAnswer(answer)
        // onIceCandidate → send each candidate
    }
}
```

**Do not** call `addTrack` / `addTransceiver(SEND)` until **after** `setRemoteDescription(offer)`.

### Verify in logcat

After fix, you should **not** see `Renegotiation Needed` after sending the answer. You should see RTP stats increasing on the device sender (if logging enabled).

### Alternative (if track must exist before offer)

If you must create the track early for capture, **remove** it from the PeerConnection until the offer arrives, or use a **recv-only placeholder** transceiver and `replaceTrack()` after `setRemoteDescription(offer)`.

---

## Required fix #1 — Send ICE candidates (still recommended)

After `createAnswer()` and sending the SDP answer, the app **must** register an ICE candidate callback and forward **every** candidate to the server.

### WebSocket (preferred)

For each local ICE candidate:

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

Send on the **same open WebSocket** used for the answer. Do not wait for gathering to complete unless you embed all `a=candidate:` lines in the SDP string (uncommon on Android WebRTC).

### HTTP fallback (if WS handler is separate)

```
POST https://remote.tak-solutions.com/api/v1/signaling
X-Connection-Secret: <secret>
Content-Type: application/json
```

Same JSON body as above. Send **one POST per candidate**.

### Android WebRTC (org.webrtc) pseudocode

```kotlin
peerConnection.addTrack(localVideoTrack, listOf("stream0"))

peerConnection.setRemoteDescription(object : SdpObserver { ... },
    SessionDescription(SessionDescription.Type.OFFER, offerSdp))

peerConnection.createAnswer(object : SdpObserver {
    override fun onCreateSuccess(answer: SessionDescription?) {
        peerConnection.setLocalDescription(...)
        // 1. Send answer (already implemented)
        ws.send(json { type="webrtc"; sdp={ type="answer"; sdp=answer.description } })

        // 2. REQUIRED — send ICE candidates (MISSING TODAY)
    }
    ...
})

peerConnection.addObserver(object : PeerConnection.Observer {
    override fun onIceCandidate(candidate: IceCandidate) {
        ws.send(json {
            type = "webrtc"
            ice = mapOf(
                "candidate" to candidate.sdp,
                "sdpMid" to candidate.sdpMid,
                "sdpMLineIndex" to candidate.sdpMLineIndex
            )
        })
    }
    // Also handle onIceCandidatesRemoved if using trickle ICE
})
```

### Verification on server

After fix, server logs must include lines like:

```
WebRTC relay device→admin uid=568b166b3dd461eb kind=ice
WebRTC relay device→admin uid=568b166b3dd461eb kind=ice
```

Portal diagnostics: **Device ICE ≥ 1**.

---

## Required fix #2 — Do not reconnect WebSocket during remote session

At **19:33:23** (2 seconds after the SDP answer), the app opened a **new** WebSocket. This pattern appears on every recent attempt and also every ~60 seconds in idle logs:

```
Device WebSocket connected: uid=568b166b3dd461eb
Device WebSocket replaced: uid=568b166b3dd461eb (keeping remote session)
```

During `START_REMOTE_ADMIN` → screen capture → WebRTC teardown, the app must:

1. Use **one** WebSocket instance for commands, signaling, and keepalive
2. **Not** close and reopen WS when starting MediaProjection / foreground service
3. Run WS in the **same foreground service** as screen capture
4. Only reconnect after `STOP_REMOTE_ADMIN` or on genuine network loss (with backoff)

Reconnecting mid-session drops in-flight ICE and invalidates the PeerConnection state on the admin side.

---

## Required fix #3 — Stable persistent WebSocket (background)

Broader log pattern (19:20–19:30 UTC): WebSocket connects then goes offline after ~8 seconds grace, repeatedly. Some connections show `ip=undefined` (auth frame never sent within 10s).

| Symptom | Likely app cause |
|---------|------------------|
| WS reconnect every 60s | Timer-based reconnect instead of persistent connection |
| `ip=undefined` connects | WS opened but auth JSON not sent immediately |
| Offline after 8s | Connection closed; no keepalive |

**Requirements:**

- Send auth as **first message** within 10s of connect:

```json
{
  "type": "auth",
  "uid": "568b166b3dd461eb",
  "connection_secret": "<secret>"
}
```

- Send `{ "type": "ping" }` every 30–60s on open WS
- Foreground service with `START_STICKY`; do not let Android kill WS when starting screen capture

---

## What already works (do not regress)

These were verified on the latest attempt — **keep them**:

| Feature | Status |
|---------|--------|
| `START_REMOTE_ADMIN` handling | OK |
| `{ "type": "webrtc_ready" }` | OK |
| `{ "type": "webrtc", "sdp": { "type": "answer", ... } }` | OK |
| `{ uid, event: "WEBRTC_READY", payload }` events | OK (optional) |
| Command delivery over WS | OK |

---

## End-to-end flow (correct implementation)

```
Admin clicks Connect
    ↓
Device receives: { type: "command", command: "START_REMOTE_ADMIN", ... }
    ↓
App: start foreground service + MediaProjection (do NOT reopen WebSocket)
    ↓
App: create PeerConnection + add screen VideoTrack
    ↓
App → server: { type: "webrtc_ready" }
    ↓
App ← server: { type: "webrtc", sdp: { type: "offer", ... } }
App ← server: { type: "webrtc", ice: { ... } }  (multiple)
    ↓
App: setRemoteDescription(offer) → createAnswer → setLocalDescription
    ↓
App → server: { type: "webrtc", sdp: { type: "answer", ... } }     ← working
App → server: { type: "webrtc", ice: { ... } }                   ← MISSING
App → server: { type: "webrtc", ice: { ... } }                   ← for each candidate
    ↓
Video streams to admin browser
    ↓
Admin clicks Disconnect → STOP_REMOTE_ADMIN → tear down PC + capture + (then WS may reconnect)
```

---

## STUN / media configuration

Both sides use:

```
stun:stun.l.google.com:19302
```

Device must add a **sendonly or sendrecv video track** from screen capture to PeerConnection. Admin uses recvonly video. Half resolution @ 30fps is acceptable.

If ICE completes but video still fails behind strict NAT, TURN may be needed later — but **device ICE must reach the server first** before that can be diagnosed.

---

## Screen rotation during remote assist

If the device rotates but the portal panel stays portrait-sized and the badge still says **Portrait**, the WebRTC video track is still sending portrait frame dimensions. The portal cannot infer rotation from the physical device — only from **video track size** or an optional **`ORIENTATION_CHANGED` device event**.

**Full spec:** [android-app-requirements.md §8.1](android-app-requirements.md#81-screen-rotation-portrait--landscape)

**Minimum fixes on the app:**

1. On rotation, call `ScreenCapturer.changeCaptureFormat(newWidth, newHeight, fps)` (or recreate VirtualDisplay).
2. Update touch-injection capture width/height (`y = y_percent * captureHeight`).
3. Send `{ "event": "ORIENTATION_CHANGED", "payload": { "width", "height", "orientation" } }` on the device WebSocket.
4. If WebRTC fires `onRenegotiationNeeded`, send a new SDP **answer** on the WebSocket.

Until the app implements this, rotating the EUD will not resize the admin panel.

---

## Keyboard control not working on device

Production server logs show KEY packets **are delivered** to the device WebSocket (e.g. `Control KEY uid=568b166b3dd461eb key=KEYCODE_T`). If typing does nothing on the phone, implement the control handler:

**[android-control-handler-handoff.md](android-control-handler-handoff.md)** — full Kotlin `RemoteControlHandler`, key mapping, and injection options.

---

## Acceptance checklist (app QA)

Before marking remote view fixed, confirm **all** of the following on a real device against production:

- [ ] Click Connect on portal → device shows remote session locally
- [ ] Server log: `WebRTC relay device→admin kind=answer`
- [ ] Server log: **at least one** `WebRTC relay device→admin kind=ice`
- [ ] Portal diagnostics: Answer received **Yes**, Device ICE **≥ 1**
- [ ] **No** `Device WebSocket connected` line within 30s after answer during same session
- [ ] Video visible in portal within ~10s of Connect
- [ ] Disconnect cleanly on `STOP_REMOTE_ADMIN`

---

## Server endpoints reference

| Endpoint | Use |
|----------|-----|
| `wss://remote.tak-solutions.com/ws/device` | Auth, commands, WebRTC signaling |
| `GET /api/v1/signaling` | Poll offers/ICE if WS receive path broken |
| `POST /api/v1/signaling` | Post answer + ICE if WS send path broken |
| `GET /api/v1/commands` | Command poll (30s) — not for WebRTC |

Auth header for REST: `X-Connection-Secret: <secret>`

On `START_REMOTE_ADMIN`, server also sends `{ type: "signaling_hint", format: { ... } }` with exact JSON shapes.

---

## Contact / debug

If the app team believes ICE is being sent, capture:

1. Portal diagnostics screenshot (Offer/Answer/ICE counts + trace table)
2. Timestamp of Connect attempt
3. App-side log of every WebSocket message sent after answer

Server logs can be correlated by UID `568b166b3dd461eb` and UTC time.

**Current verdict:** Problem is **on the app** — missing ICE candidate transmission and WebSocket reconnect during active session. Server relay and portal negotiation are functioning correctly through SDP answer.
