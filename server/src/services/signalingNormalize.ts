/** Normalize WebRTC signaling from admin portal, Android app, and legacy formats. */

export interface NormalizedSignaling {
  type: "webrtc";
  sdp?: { type: string; sdp: string };
  ice?: { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
}

function parseSdpType(value: unknown): string | undefined {
  if (value === "offer" || value === "answer" || value === "pranswer" || value === "rollback") {
    return value;
  }
  return undefined;
}

function buildSdp(type: string, sdpBody: string): { type: string; sdp: string } {
  return { type, sdp: sdpBody };
}

function extractSdp(message: Record<string, unknown>): { type: string; sdp: string } | undefined {
  const nested = asRecord(message.sdp);
  if (nested?.sdp && typeof nested.sdp === "string") {
    const type = parseSdpType(nested.type) ?? parseSdpType(message.type);
    if (type) return buildSdp(type, nested.sdp);
  }

  if (typeof message.sdp === "string") {
    const type =
      parseSdpType(message.type) ??
      parseSdpType(message.signal) ??
      (message.type === "sdp" ? parseSdpType(asRecord(message.payload)?.type) : undefined);
    if (type) return buildSdp(type, message.sdp);
  }

  const payload = asRecord(message.payload) ?? asRecord(message.data);
  if (payload) return extractSdp(payload);

  const signal = message.signal as string | undefined;
  if ((signal === "offer" || signal === "answer") && message.sdp) {
    return extractSdp({ type: signal, sdp: message.sdp });
  }

  return undefined;
}

function extractIce(message: Record<string, unknown>): {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
} | undefined {
  const ice = asRecord(message.ice) ?? asRecord(message.candidate);
  if (ice?.candidate && typeof ice.candidate === "string") {
    return {
      candidate: ice.candidate,
      sdpMid: typeof ice.sdpMid === "string" ? ice.sdpMid : undefined,
      sdpMLineIndex:
        typeof ice.sdpMLineIndex === "number" ? ice.sdpMLineIndex : undefined,
    };
  }

  if (typeof message.candidate === "string") {
    return {
      candidate: message.candidate,
      sdpMid: typeof message.sdpMid === "string" ? message.sdpMid : undefined,
      sdpMLineIndex:
        typeof message.sdpMLineIndex === "number" ? message.sdpMLineIndex : undefined,
    };
  }

  const payload = asRecord(message.payload) ?? asRecord(message.data);
  if (payload) return extractIce(payload);

  if (message.type === "ice_candidate" || message.type === "candidate") {
    return extractIce({ ...message, type: "webrtc" });
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isSignalingMessage(message: Record<string, unknown>): boolean {
  if (message.type === "webrtc") return true;
  if (extractSdp(message) || extractIce(message)) return true;
  const signal = message.signal as string | undefined;
  return signal === "offer" || signal === "answer" || signal === "ice";
}

export function normalizeSignaling(
  message: Record<string, unknown>
): NormalizedSignaling | null {
  const sdp = extractSdp(message);
  const ice = extractIce(message);

  if (!sdp && !ice) return null;

  const normalized: NormalizedSignaling = { type: "webrtc" };
  if (sdp) normalized.sdp = sdp;
  if (ice) normalized.ice = ice;
  return normalized;
}

export function describeSignaling(message: Record<string, unknown>): string {
  if (message.type === "webrtc_ready") return "webrtc_ready";
  if (message.type === "ping") return "ping";
  if (message.type === "pong") return "pong";
  if (message.type === "device_event" || (message.event && message.uid)) {
    return `device_event event=${String(message.event ?? "?")}`;
  }

  const normalized = normalizeSignaling(message);
  if (!normalized) {
    return `unrecognized keys=${Object.keys(message).join(",")}`;
  }
  if (normalized.sdp?.type) return `webrtc sdp=${normalized.sdp.type}`;
  if (normalized.ice) return "webrtc ice";
  return "webrtc";
}

export function toWebRtcPayload(
  message: NormalizedSignaling
): Record<string, unknown> {
  const payload: Record<string, unknown> = { type: "webrtc" };
  if (message.sdp) payload.sdp = message.sdp;
  if (message.ice) payload.ice = message.ice;
  return payload;
}

export const SIGNALING_HINT_PAYLOAD = {
  type: "signaling_hint",
  role: "device_is_answerer",
  format: {
    answer: {
      type: "webrtc",
      sdp: { type: "answer", sdp: "<sdp-string>" },
    },
    ice: {
      type: "webrtc",
      ice: {
        candidate: "<candidate-string>",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    },
    http_fallback: {
      post_answer: "POST /api/v1/signaling",
      post_ice: "POST /api/v1/signaling",
      poll_admin_messages: "GET /api/v1/signaling",
    },
  },
  stun: "stun:stun.l.google.com:19302",
};
