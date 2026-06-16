# Android App — Remote Assist (WebRTC) Requirements

Remote screen viewing requires the Android client to implement **screen capture + WebRTC** in addition to REST registration and WebSocket commands.

Broader device API context: [android-app-requirements.md](android-app-requirements.md) §8.

---

## Prerequisites

1. Device connected to `wss://<server>/ws/device` (authenticated with `connection_secret`; use MDM `tracking_server_url`)
2. Admin clicks **Connect** → device receives:

```json
{
  "type": "command",
  "command": "START_REMOTE_ADMIN",
  "connection_secret": "<hex>"
}
```

3. Verify `connection_secret` matches the locally stored secret before acting (same as all other commands).
4. On `START_REMOTE_ADMIN`, the app must:
   - Start a **foreground service** while streaming
   - Request `MediaProjection` / screen-capture permission (if not already granted)
   - Create `PeerConnection` with STUN: `stun:stun.l.google.com:19302`
   - Listen for WebRTC signaling on the **same device WebSocket** (do not reconnect during the session)

---

## Server relay behavior

The portal relays JSON messages with `"type": "webrtc"` between admin (`/ws/admin`) and device (`/ws/device`) for the same `uid`.

**Admin → device:** The server **adds** `connection_secret` to each relayed offer/ICE message so the device can authenticate inbound signaling (same secret as commands). Example:

```json
{
  "type": "webrtc",
  "connection_secret": "<hex>",
  "sdp": { "type": "offer", "sdp": "v=0\r\n..." }
}
```

**Device → admin:** Messages are forwarded **unchanged** (no `connection_secret` required on outbound).

After `START_REMOTE_ADMIN`, the server may send a **`signaling_hint`** WebSocket message describing the exact answer/ICE format and HTTP fallback endpoints.

---

## Optional: `webrtc_ready`

After screen capture starts and the first frame is available, the device may send:

```json
{ "type": "webrtc_ready" }
```

The portal uses this to send the WebRTC offer immediately (~3 s sooner) instead of waiting for a capture warmup timer.

---

## Canonical message format

Use standard WebRTC object field names. Legacy formats (`candidate` instead of `ice`, flat `sdp` string) are accepted by the server but the canonical format below is preferred.

### Session description (offer or answer)

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

### ICE candidate

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

**ICE candidates are required.** Sending only the SDP answer is not enough. Portal diagnostics will show **Answer received: Yes** but **Device ICE: 0** and video will not start.

After `createAnswer()`, register `onIceCandidate` and **send every candidate** on the same WebSocket (or via HTTP fallback below). Trickle ICE is expected — candidates often arrive after the answer.

---

## Negotiation flow (critical ordering)

| Step | Actor | Action |
|------|-------|--------|
| 1 | Admin | Clicks Connect → `START_REMOTE_ADMIN` sent to device |
| 2 | Device | Start screen capture; create `PeerConnection` + STUN |
| 3 | Device | (Optional) Send `webrtc_ready` |
| 4 | Admin | Creates offer → relayed to device as `{ type: "webrtc", sdp: { type: "offer", ... }, connection_secret }` |
| 5 | Device | `setRemoteDescription(offer)` |
| 6 | Device | **Add screen-capture `VideoTrack` to `PeerConnection` before `createAnswer()`** |
| 7 | Device | `createAnswer()` → `setLocalDescription(answer)` → send SDP answer |
| 8 | Both | Exchange ICE candidates (`{ type: "webrtc", ice: { ... } }`) |
| 9 | — | Video streams to admin browser |
| 10 | Admin | `STOP_REMOTE_ADMIN` → tear down immediately |

### Rules that prevent common failures

1. **Add the screen track before `createAnswer()`** — not after. If the track is added later, WebRTC fires `onRenegotiationNeeded`. The portal sends **only one offer per session**; a pending renegotiation leaves the portal stuck on “establishing video stream” even when device ICE shows `CONNECTED`.

2. **Process only one offer per session** — after sending the SDP answer, ignore duplicate offers unless the admin explicitly retries (new session).

3. **Verify inbound offers** — check `connection_secret` on admin-originated `webrtc` messages matches the stored secret.

4. **Keep one WebSocket open** for the entire remote session. Reconnecting disrupts signaling and may briefly show the device as offline.

5. **Codec** — Portal prefers VP8/VP9/H.264. Ensure at least one of these is negotiated in the answer.

---

## HTTP signaling fallback (recommended)

If WebSocket signaling is unreliable, use REST in parallel with the same `X-Connection-Secret` header:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/signaling` | Poll pending admin offers and ICE |
| `POST /api/v1/signaling` | Post SDP answer and device ICE candidates |

**Poll admin messages** (after `START_REMOTE_ADMIN`):

```
GET {base}/api/v1/signaling
X-Connection-Secret: <secret>
```

**Post SDP answer**:

```
POST {base}/api/v1/signaling
X-Connection-Secret: <secret>
Content-Type: application/json

{ "type": "webrtc", "sdp": { "type": "answer", "sdp": "v=0\r\n..." } }
```

Post each ICE candidate the same way. The server normalizes many legacy payload shapes.

---

## Android implementation checklist

| Step | Action |
|------|--------|
| 1 | On `START_REMOTE_ADMIN`, start foreground service + MediaProjection |
| 2 | `PeerConnectionFactory` + `PeerConnection` with STUN above |
| 3 | Start screen capture (30 fps, half resolution OK) |
| 4 | (Optional) Send `{ "type": "webrtc_ready" }` after first frame |
| 5 | On `webrtc` + `sdp.type === "offer"`: verify `connection_secret`, `setRemoteDescription` |
| 6 | **Add screen `VideoTrack` to PeerConnection** |
| 7 | `createAnswer()` → `setLocalDescription` → send `{ type: "webrtc", sdp: { type: "answer", ... } }` |
| 8 | On each `onIceCandidate`, send `{ type: "webrtc", ice: { ... } }` (or POST to signaling API) |
| 9 | On `webrtc` + `ice`: `addIceCandidate` |
| 10 | On `STOP_REMOTE_ADMIN` / `LOCK_DEVICE`, tear down capture and peer connection immediately |
| 11 | Do **not** reconnect WebSocket during an active session |

---

## Remote control (touch)

Device receives on WebSocket:

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.52,
  "y_percent": 0.41
}
```

Coordinates are **0.0–1.0** fractions of the **physical display** (not the scaled capture buffer). See [android-app-requirements.md](android-app-requirements.md) §8.1 for orientation/resize handling.

---

## Portal status ↔ device symptoms

| Portal shows | Likely device cause |
|--------------|---------------------|
| “Waiting for device stream” | No `webrtc_ready`, capture not started, or offer not received |
| “Negotiating WebRTC” | No SDP answer received |
| “Answer received — establishing video stream…” (stuck) | **ICE+DTLS connected but device sends no RTP** — MediaProjection token reused/single-use, `startCapture()` not called, or track not wired to the running capturer (see note below) |
| “Stream failed” (ICE error) | Answer received but **no ICE candidates** from device |
| “Stream failed” (no track) | SDP answer missing sendonly video m-line |
| “Stream failed” (no RTP) | ICE connected locally but screen capture not feeding the video track |
| Black screen while “streaming” | Encoder/codec issue or 0×0 capture |
| “Device offline” | WebSocket disconnected during session |

**Confirmed current bug (2026-06-15, via `chrome://webrtc-internals`):** ICE **and** DTLS reach `connected` (host↔host on the same LAN), `candidate-pair: succeeded`, but there is **no `inbound-rtp` video — zero frames**. Signaling/SDP/ICE/DTLS are all correct; the **device is not sending RTP video**. This is a device-side media-production problem, not signaling.

Look on the device for: (1) **single-use MediaProjection token reused** across sessions (capture silently yields no frames) — request a fresh permission result per `START_REMOTE_ADMIN`; (2) `ScreenCapturerAndroid.startCapture(w,h,fps)` not called or bad size; (3) the negotiated `VideoTrack` not wired to the running capturer's `VideoSource` (`createVideoSource(isScreencast=true)`); (4) `videoTrack.setEnabled(true)`; (5) encoder init failure. Confirm by counting `onFrame` on the source and `outbound-rtp.framesEncoded` via `getStats()` — both must climb.

---

## Common failure modes

| Symptom | Cause |
|---------|--------|
| Black screen / “Waiting for stream” | No SDP answer, wrong field names, or capture not started |
| Answer received, Device ICE: 0 | ICE candidates not sent after answer |
| Stuck “establishing video stream” | Track added after `createAnswer()`; duplicate offer processed; missing inbound ICE on portal |
| “Secret mismatch” on offer | Not validating `connection_secret` on inbound `webrtc` messages |
| “Device offline” mid-session | WebSocket reconnect during remote assist |
| WebRTC connection failed | NAT — may need TURN later |
| Clicks land in wrong place | Touch mapping uses capture size instead of display size |

---

## STOP

On `STOP_REMOTE_ADMIN` or `LOCK_DEVICE`, tear down WebRTC and screen capture immediately and release MediaProjection resources.

---

## STUN

Both sides use: `stun:stun.l.google.com:19302`
