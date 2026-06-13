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
   - Create `PeerConnection` with local video track from screen capture
   - Listen for WebRTC signaling on the **same device WebSocket**

## WebRTC signaling (via WebSocket)

All messages use envelope `{ "type": "webrtc", ... }` on `/ws/device`.

### Admin → device (incoming on device)

**SDP offer** (admin wants to receive video):

```json
{
  "type": "webrtc",
  "signal": "offer",
  "sdp": { "type": "offer", "sdp": "v=0\r\n..." }
}
```

**ICE candidate:**

```json
{
  "type": "webrtc",
  "signal": "ice",
  "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
```

### Device → admin (outgoing from device)

**SDP answer** (after setting remote offer):

```json
{
  "type": "webrtc",
  "signal": "answer",
  "sdp": { "type": "answer", "sdp": "v=0\r\n..." }
}
```

**ICE candidates** (same format as above, `signal: "ice"`).

Server relays these between admin `/ws/admin` and device `/ws/device` for the same `uid`.

## Android implementation checklist

| Step | Action |
|------|--------|
| 1 | On `START_REMOTE_ADMIN`, start foreground service + MediaProjection |
| 2 | `PeerConnectionFactory` + `PeerConnection` with STUN `stun:stun.l.google.com:19302` |
| 3 | Add screen-capture `VideoTrack` to peer connection (`addTrack`) |
| 4 | On `webrtc` + `offer`: `setRemoteDescription(offer)` → `createAnswer()` → `setLocalDescription()` → send `answer` |
| 5 | On `webrtc` + `ice`: `addIceCandidate()` |
| 6 | Send local ICE candidates to server as they are gathered |
| 7 | On `STOP_REMOTE_ADMIN`, stop capture, close peer connection, stop foreground service |

## Remote control (touch)

After stream is active, admin sends touch via REST (not WebSocket):

`POST /api/v1/control` is admin-only. Device receives **control** messages on WebSocket:

```json
{
  "type": "control",
  "action": "CLICK",
  "x_percent": 0.52,
  "y_percent": 0.41
}
```

Device must inject touch at normalized screen coordinates.

## Common failure modes

| Symptom | Cause |
|---------|--------|
| Portal shows “Waiting for stream” / black video | App did not send WebRTC `answer` or screen track |
| “Device offline (WebSocket)” | App not connected to `/ws/device` |
| WebRTC connection failed | NAT traversal — may need TURN server later |
| Connect works but no video | MediaProjection not started or video track not added |

## STOP

On `STOP_REMOTE_ADMIN` command, tear down WebRTC and screen capture immediately.
