import type { NormalizedSignaling } from "./signalingNormalize.js";

export type SignalingDirection = "admin→device" | "device→admin" | "system";
export type SignalingKind = "offer" | "answer" | "ice" | "event" | "hint";
export type SignalingChannel = "websocket" | "http";

export interface SignalingTraceEntry {
  at: string;
  direction: SignalingDirection;
  kind: SignalingKind;
  channel: SignalingChannel;
  detail: string;
}

export interface SignalingStatus {
  uid: string;
  remoteActive: boolean;
  offerSent: boolean;
  answerReceived: boolean;
  adminIceCount: number;
  deviceIceCount: number;
  deviceHttpPosts: number;
  lastActivityAt: string | null;
  trace: SignalingTraceEntry[];
  issues: string[];
}

const MAX_TRACE = 40;
const MAX_PENDING = 20;

interface SessionState {
  remoteActive: boolean;
  offerSent: boolean;
  answerReceived: boolean;
  adminIceCount: number;
  deviceIceCount: number;
  deviceHttpPosts: number;
  lastActivityAt: Date;
  trace: SignalingTraceEntry[];
  pendingToDevice: NormalizedSignaling[];
  pendingToAdmin: NormalizedSignaling[];
}

const sessions = new Map<string, SessionState>();

function getOrCreate(uid: string): SessionState {
  let session = sessions.get(uid);
  if (!session) {
    session = {
      remoteActive: false,
      offerSent: false,
      answerReceived: false,
      adminIceCount: 0,
      deviceIceCount: 0,
      deviceHttpPosts: 0,
      lastActivityAt: new Date(),
      trace: [],
      pendingToDevice: [],
      pendingToAdmin: [],
    };
    sessions.set(uid, session);
  }
  return session;
}

function kindFromMessage(msg: NormalizedSignaling): SignalingKind {
  if (msg.sdp?.type === "offer") return "offer";
  if (msg.sdp?.type === "answer") return "answer";
  return "ice";
}

function pushTrace(
  uid: string,
  direction: SignalingDirection,
  kind: SignalingKind,
  channel: SignalingChannel,
  detail: string
): void {
  const session = getOrCreate(uid);
  session.lastActivityAt = new Date();
  session.trace.unshift({
    at: new Date().toISOString(),
    direction,
    kind,
    channel,
    detail,
  });
  if (session.trace.length > MAX_TRACE) {
    session.trace.length = MAX_TRACE;
  }
}

function queuePending(
  list: NormalizedSignaling[],
  message: NormalizedSignaling
): void {
  list.push(message);
  if (list.length > MAX_PENDING) {
    list.splice(0, list.length - MAX_PENDING);
  }
}

export function setRemoteSessionActive(uid: string, active: boolean): void {
  const session = getOrCreate(uid);
  session.remoteActive = active;
  session.lastActivityAt = new Date();
  if (active) {
    session.offerSent = false;
    session.answerReceived = false;
    session.adminIceCount = 0;
    session.deviceIceCount = 0;
    session.pendingToDevice = [];
    session.pendingToAdmin = [];
    pushTrace(uid, "system", "event", "websocket", "Remote session started");
  } else {
    pushTrace(uid, "system", "event", "websocket", "Remote session stopped");
  }
}

export function recordAdminToDevice(
  uid: string,
  message: NormalizedSignaling,
  channel: SignalingChannel
): void {
  const session = getOrCreate(uid);
  const kind = kindFromMessage(message);
  if (kind === "offer") session.offerSent = true;
  if (kind === "ice") session.adminIceCount += 1;
  queuePending(session.pendingToDevice, message);
  pushTrace(
    uid,
    "admin→device",
    kind,
    channel,
    kind === "ice" ? `ice #${session.adminIceCount}` : kind
  );
}

export function recordDeviceToAdmin(
  uid: string,
  message: NormalizedSignaling,
  channel: SignalingChannel
): void {
  const session = getOrCreate(uid);
  const kind = kindFromMessage(message);
  if (kind === "answer") session.answerReceived = true;
  if (kind === "ice") session.deviceIceCount += 1;
  if (channel === "http") session.deviceHttpPosts += 1;
  queuePending(session.pendingToAdmin, message);
  pushTrace(
    uid,
    "device→admin",
    kind,
    channel,
    kind === "ice" ? `ice #${session.deviceIceCount}` : kind
  );
}

export function recordSystemEvent(
  uid: string,
  detail: string,
  channel: SignalingChannel = "websocket"
): void {
  pushTrace(uid, "system", "event", channel, detail);
}

export function recordHintSent(uid: string): void {
  pushTrace(uid, "system", "hint", "websocket", "signaling_hint sent to device");
}

export function recordUnrecognizedDeviceMessage(uid: string, preview: string): void {
  pushTrace(uid, "device→admin", "event", "websocket", `unrecognized: ${preview}`);
}

export function drainPendingToDevice(uid: string): NormalizedSignaling[] {
  const session = getOrCreate(uid);
  const pending = [...session.pendingToDevice];
  session.pendingToDevice = [];
  return pending;
}

export function drainPendingToAdmin(uid: string): NormalizedSignaling[] {
  const session = getOrCreate(uid);
  const pending = [...session.pendingToAdmin];
  session.pendingToAdmin = [];
  return pending;
}

export function getSignalingStatus(uid: string): SignalingStatus {
  const session = getOrCreate(uid);
  const issues: string[] = [];

  if (session.remoteActive && session.offerSent && !session.answerReceived) {
    issues.push(
      "Offer reached the server but no SDP answer has been received from the device (WebSocket or HTTP)."
    );
  }
  if (session.remoteActive && !session.offerSent) {
    issues.push("Remote session active but no WebRTC offer has been sent yet.");
  }
  if (session.remoteActive && session.answerReceived && session.deviceIceCount === 0) {
    issues.push("SDP answer received but no device ICE candidates yet.");
  }
  if (
    session.remoteActive &&
    session.offerSent &&
    !session.answerReceived &&
    session.deviceHttpPosts === 0
  ) {
    issues.push(
      "Device has not posted to POST /api/v1/signaling — if WebSocket signaling fails, use the HTTP fallback."
    );
  }

  return {
    uid,
    remoteActive: session.remoteActive,
    offerSent: session.offerSent,
    answerReceived: session.answerReceived,
    adminIceCount: session.adminIceCount,
    deviceIceCount: session.deviceIceCount,
    deviceHttpPosts: session.deviceHttpPosts,
    lastActivityAt: session.lastActivityAt.toISOString(),
    trace: [...session.trace],
    issues,
  };
}
