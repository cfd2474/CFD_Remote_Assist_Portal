# Android App — Remote Assist (WebRTC) Requirements

Remote screen viewing requires the Android client to implement **screen capture + WebRTC** in addition to REST registration and WebSocket commands.

## Prerequisites

1. Device connected to `wss://remote.tak-solutions.com/ws/device` (authenticated)
2. Admin clicked **Connect** → device receives:

```json
{
  "type": "command",
  "command": "START_REMOTE_ADMIN",
  "connection_secret": "<hex>"
}
```

3. On `START_REMOTE_ADMIN`, the app must:
   - Request `MediaProjection` / screen-capture permission (if not already granted)
   - Create `PeerConnection` with local video track from screen capture (30fps half-resolution is fine)
   - Listen for WebRTC signaling on the **same device WebSocket**

## WebRTC signaling (via WebSocket)

The Linux portal **relays** JSON messages with `"type": "webrtc"` between admin (`/ws/admin`) and device (`/ws/device`) for the same `uid`. Messages are **not modified** — only forwarded.

### Canonical message format (both directions)

Use standard WebRTC object field names:

**Session description (offer or answer):**

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
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

> The portal also accepts legacy `candidate` instead of `ice` for compatibility.

### Negotiation flow

1. Admin portal creates offer → relayed to device as `{ type: "webrtc", sdp: { type: "offer", ... } }`
2. Device sets remote description, creates answer, sends `{ type: "webrtc", sdp: { type: "answer", ... } }`
3. Both sides exchange `{ type: "webrtc", ice: { ... } }` as candidates are gathered
4. Video stream begins after answer + ICE complete (30fps half-res from device is expected)

### STUN

Both sides use: `stun:stun.l.google.com:19302`

## Android implementation checklist

| Step | Action |
|------|--------|
| 1 | On `START_REMOTE_ADMIN`, start foreground service + MediaProjection |
| 2 | `PeerConnectionFactory` + `PeerConnection` with STUN above |
| 3 | Add screen-capture `VideoTrack` (30fps, half resolution OK) |
| 4 | On `webrtc` + `sdp.type === "offer"`: `setRemoteDescription` → `createAnswer` → send `sdp` answer |
| 5 | On `webrtc` + `ice`: `addIceCandidate` |
| 6 | Send local ICE as `{ type: "webrtc", ice: { ... } }` |
| 7 | On `STOP_REMOTE_ADMIN`, tear down capture and peer connection |

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

## Common failure modes

| Symptom | Cause |
|---------|--------|
| Black screen / “Waiting for stream” | No `sdp` answer from device, or wrong field names |
| “Device offline” | Not connected to `/ws/device` during session |
| WebRTC connection failed | NAT — may need TURN later |

## STOP

On `STOP_REMOTE_ADMIN`, tear down WebRTC and screen capture immediately.
