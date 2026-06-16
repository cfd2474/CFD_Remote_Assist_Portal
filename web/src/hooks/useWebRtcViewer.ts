import { useEffect, useRef, useState, useCallback } from "react";
import type { User } from "oidc-client-ts";
import { fetchSignalingReplay } from "../api/client";
import {
  outboundIce,
  outboundOffer,
  parseInboundSignaling,
  isAnswer,
  isOffer,
} from "../utils/webrtcSignaling";
import type { StreamDimensions } from "../utils/streamDimensions";

type StreamStatus =
  | "idle"
  | "waiting"
  | "negotiating"
  | "connecting"
  | "streaming"
  | "failed";

interface WebRtcOptions {
  sendSignaling: (msg: Record<string, unknown>) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  enabled: boolean;
  signalingReady: boolean;
  /** Set when device posts WEBRTC_READY / REMOTE_SESSION_STARTED */
  deviceStreamReady: boolean;
  deviceUid?: string;
  user?: User | null;
  /** Server-side flag from signaling diagnostics — answer relayed but WS may have missed it */
  serverAnswerReceived?: boolean;
  /** Device-reported capture/orientation size — triggers keyframe when it changes */
  layoutHint?: StreamDimensions | null;
  /** Increments on every ORIENTATION_CHANGED — triggers keyframe even when capture size is unchanged */
  layoutRevision?: number;
}

const OFFER_DELAY_MS = 20_000;
const CAPTURE_WARMUP_MS = 3_000;
const OFFER_RETRY_MS = 15_000;
const MAX_OFFER_ATTEMPTS = 4;
const NEGOTIATION_TIMEOUT_MS = 45_000;

const NO_ICE_ERROR =
  "SDP answer received but no video stream. The Android app must send ICE candidates " +
  '(onIceCandidate → { "type": "webrtc", "ice": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } }) ' +
  "on the same WebSocket after the answer, or via POST /api/v1/signaling.";

const ICE_WAIT_MS = 20_000;
const STREAM_WAIT_MS = 25_000;
const FRAME_WAIT_MS = 30_000;

const NO_RTP_ERROR =
  "WebRTC connected but the device sent no video packets. The Android app likely fired " +
  '"Renegotiation Needed" after the SDP answer — add the screen track after setRemoteDescription(offer), ' +
  "then createAnswer(), or complete the pending renegotiation with a new answer.";

const NO_STREAM_ERROR =
  "WebRTC connected but no video track arrived. The Android app must attach screen capture " +
  "to the PeerConnection before createAnswer() and include a sendonly video m-line in the SDP answer.";

const NO_ANSWER_ERROR =
  "The server delivered a WebRTC offer to the device, but no SDP answer came back. " +
  "The Android app must start screen capture after START_REMOTE_ADMIN and send " +
  '{ "type": "webrtc", "sdp": { "type": "answer", "sdp": "..." } } on the same WebSocket.';

export function useWebRtcViewer({
  sendSignaling,
  onSignaling,
  enabled,
  signalingReady,
  deviceStreamReady,
  deviceUid,
  user,
  serverAnswerReceived = false,
  layoutHint = null,
  layoutRevision = 0,
}: WebRtcOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerAttemptRef = useRef(0);
  const receivedAnswerRef = useRef(false);
  const pendingAnswerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const startingSessionRef = useRef(false);
  const sessionGenRef = useRef(0);
  const signalingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const streamActiveRef = useRef(false);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    streamActiveRef.current = streamActive;
  }, [streamActive]);

  const clearNegotiationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearScheduleDelay = useCallback(() => {
    if (scheduleDelayRef.current) {
      clearTimeout(scheduleDelayRef.current);
      scheduleDelayRef.current = null;
    }
  }, []);

  const clearOfferRetry = useCallback(() => {
    if (retryRef.current) {
      clearInterval(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  const clearIceWait = useCallback(() => {
    if (iceWaitRef.current) {
      clearTimeout(iceWaitRef.current);
      iceWaitRef.current = null;
    }
  }, []);

  const clearStreamWait = useCallback(() => {
    if (streamWaitRef.current) {
      clearTimeout(streamWaitRef.current);
      streamWaitRef.current = null;
    }
  }, []);

  const clearFrameWait = useCallback(() => {
    if (frameWaitRef.current) {
      clearTimeout(frameWaitRef.current);
      frameWaitRef.current = null;
    }
  }, []);

  const enqueueSignaling = useCallback((fn: () => Promise<void>) => {
    signalingQueueRef.current = signalingQueueRef.current
      .then(fn)
      .catch((err) => console.warn("Signaling handler error:", err));
  }, []);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const pending = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const ice of pending) {
      try {
        await pc.addIceCandidate(ice);
      } catch (err) {
        console.warn("ICE candidate error:", err);
      }
    }
  }, []);

  const requestInboundKeyFrame = useCallback(async (pc: RTCPeerConnection) => {
    for (const receiver of pc.getReceivers()) {
      if (receiver.track?.kind !== "video") continue;
      const requestKeyFrame = (
        receiver as RTCRtpReceiver & { requestKeyFrame?: () => Promise<void> }
      ).requestKeyFrame;
      if (requestKeyFrame) {
        try {
          await requestKeyFrame.call(receiver);
        } catch (err) {
          console.warn("requestKeyFrame failed:", err);
        }
      }
    }
  }, []);

  const getInboundVideoStats = useCallback(async (pc: RTCPeerConnection) => {
    let bytesReceived = 0;
    let framesDecoded = 0;
    const stats = await pc.getStats();
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        bytesReceived += Number(report.bytesReceived ?? 0);
        framesDecoded += Number(report.framesDecoded ?? 0);
      }
    });
    return { bytesReceived, framesDecoded };
  }, []);

  const markStreaming = useCallback(() => {
      setStreamActive(true);
      setStatus("streaming");
      setError(null);
      clearNegotiationTimeout();
      clearOfferRetry();
      clearIceWait();
      clearStreamWait();
      clearFrameWait();
    },
    [clearNegotiationTimeout, clearOfferRetry, clearIceWait, clearStreamWait, clearFrameWait]
  );

  const scheduleFrameWait = useCallback(
    (pc: RTCPeerConnection, video: HTMLVideoElement) => {
      clearFrameWait();
      frameWaitRef.current = setTimeout(() => {
        void (async () => {
          if (pcRef.current !== pc || !videoRef.current) return;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            markStreaming();
            return;
          }

          const { bytesReceived, framesDecoded } = await getInboundVideoStats(pc);
          if (framesDecoded > 0 || (video.videoWidth > 0 && video.videoHeight > 0)) {
            markStreaming();
            return;
          }

          setStreamActive(false);
          setStatus("failed");
          setError(
            bytesReceived === 0
              ? NO_RTP_ERROR
              : "WebRTC track received but no video frames (0×0). The Android app PeerConnection is up but screen capture is not feeding the video track."
          );
        })();
      }, FRAME_WAIT_MS);
    },
    [clearFrameWait, getInboundVideoStats, markStreaming]
  );

  const attachRemoteVideo = useCallback(
    (pc: RTCPeerConnection, track: MediaStreamTrack) => {
      if (!videoRef.current || track.kind !== "video") return false;

      const video = videoRef.current;
      if (video.srcObject) {
        const existing = (video.srcObject as MediaStream).getVideoTracks()[0];
        if (existing?.id === track.id && video.videoWidth > 0) {
          markStreaming();
          return true;
        }
      }

      const stream = new MediaStream([track]);
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      setStatus("connecting");
      setError(null);

      const onFrameReady = () => {
        if (pcRef.current !== pc || !videoRef.current) return;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          markStreaming();
        }
      };

      video.onloadedmetadata = onFrameReady;
      video.onresize = onFrameReady;
      track.onunmute = () => {
        onFrameReady();
        void requestInboundKeyFrame(pc);
      };

      void requestInboundKeyFrame(pc);
      scheduleFrameWait(pc, video);
      return true;
    },
    [markStreaming, requestInboundKeyFrame, scheduleFrameWait]
  );

  const tryAttachFromReceivers = useCallback(
    (pc: RTCPeerConnection): boolean => {
      for (const receiver of pc.getReceivers()) {
        const track = receiver.track;
        if (track?.kind === "video") {
          return attachRemoteVideo(pc, track);
        }
      }
      for (const transceiver of pc.getTransceivers()) {
        const track = transceiver.receiver.track;
        if (track?.kind === "video") {
          return attachRemoteVideo(pc, track);
        }
      }
      return false;
    },
    [attachRemoteVideo]
  );

  const scheduleStreamWait = useCallback(
    (pc: RTCPeerConnection) => {
      clearStreamWait();
      streamWaitRef.current = setTimeout(() => {
        if (pcRef.current !== pc) return;
        if (tryAttachFromReceivers(pc)) return;
        setError(NO_STREAM_ERROR);
        setStatus("failed");
      }, STREAM_WAIT_MS);
    },
    [clearStreamWait, tryAttachFromReceivers]
  );

  const cleanup = useCallback(() => {
    clearNegotiationTimeout();
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    clearStreamWait();
    clearFrameWait();
    offerAttemptRef.current = 0;
    receivedAnswerRef.current = false;
    pendingAnswerRef.current = null;
    pendingIceRef.current = [];
    startingSessionRef.current = false;
    sessionGenRef.current += 1;
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setStatus("idle");
  }, [clearNegotiationTimeout, clearScheduleDelay, clearOfferRetry, clearIceWait, clearStreamWait, clearFrameWait]);

  const addRemoteIce = useCallback(
    async (ice: RTCIceCandidateInit) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (!pc.remoteDescription) {
        pendingIceRef.current.push(ice);
        return;
      }

      clearIceWait();
      try {
        await pc.addIceCandidate(ice);
      } catch (err) {
        console.warn("ICE candidate error:", err);
      }
    },
    [clearIceWait]
  );

  const applyAnswer = useCallback(
    async (sdp: RTCSessionDescriptionInit): Promise<boolean> => {
      const genAtStart = sessionGenRef.current;

      for (let attempt = 0; attempt < 120; attempt++) {
        if (sessionGenRef.current !== genAtStart) {
          return false;
        }

        const pc = pcRef.current;
        if (!pc) {
          await new Promise((r) => window.setTimeout(r, 50));
          continue;
        }

        if (pc.signalingState === "stable") {
          if (pc.remoteDescription?.type === "answer") {
            receivedAnswerRef.current = true;
            clearScheduleDelay();
            clearOfferRetry();
            clearIceWait();
            setError(null);
            setStatus("connecting");
            scheduleStreamWait(pc);
            tryAttachFromReceivers(pc);
            return true;
          }
          if (pc.localDescription?.type !== "offer") {
            // Offer not applied yet — wait for startSession instead of dropping the answer.
            await new Promise((r) => window.setTimeout(r, 50));
            continue;
          }
        }

        if (pc.signalingState !== "have-local-offer") {
          await new Promise((r) => window.setTimeout(r, 50));
          continue;
        }

        clearScheduleDelay();
        clearOfferRetry();
        try {
          await pc.setRemoteDescription(sdp);
          receivedAnswerRef.current = true;
          pendingAnswerRef.current = null;
          clearIceWait();
          setError(null);
          setStatus("connecting");
          await flushPendingIce(pc);
          tryAttachFromReceivers(pc);
          scheduleStreamWait(pc);
          iceWaitRef.current = setTimeout(() => {
            if (pcRef.current !== pc) return;
            if (
              pc.connectionState !== "connected" &&
              pc.iceConnectionState !== "connected" &&
              pc.iceConnectionState !== "completed"
            ) {
              if (!tryAttachFromReceivers(pc)) {
                setError(NO_ICE_ERROR);
                setStatus("failed");
              }
            }
          }, ICE_WAIT_MS);
          return true;
        } catch (err) {
          if (pc.remoteDescription?.type === "answer") {
            receivedAnswerRef.current = true;
            pendingAnswerRef.current = null;
            setError(null);
            setStatus("connecting");
            await flushPendingIce(pc);
            tryAttachFromReceivers(pc);
            scheduleStreamWait(pc);
            return true;
          }
          setStatus("failed");
          setError(
            err instanceof Error ? err.message : "Invalid WebRTC answer from device"
          );
          return false;
        }
      }

      pendingAnswerRef.current = sdp;
      return false;
    },
    [
      clearScheduleDelay,
      clearOfferRetry,
      clearIceWait,
      flushPendingIce,
      scheduleStreamWait,
      tryAttachFromReceivers,
    ]
  );

  /** Device-initiated renegotiation (e.g. after screen rotation) while stream is active. */
  const applyRenegotiationOffer = useCallback(
    async (sdp: RTCSessionDescriptionInit): Promise<boolean> => {
      const pc = pcRef.current;
      if (!pc || !streamActiveRef.current) {
        return false;
      }
      if (pc.signalingState !== "stable") {
        console.warn(
          "[WebRTC] Ignoring device renegotiation offer: signalingState=",
          pc.signalingState
        );
        return false;
      }
      try {
        console.log("[WebRTC] Applying device renegotiation offer (rotation recovery)");
        await pc.setRemoteDescription(sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignaling(outboundOffer(answer));
        void requestInboundKeyFrame(pc);
        tryAttachFromReceivers(pc);
        scheduleStreamWait(pc);
        return true;
      } catch (err) {
        console.warn("[WebRTC] Renegotiation failed:", err);
        return false;
      }
    },
    [sendSignaling, requestInboundKeyFrame, tryAttachFromReceivers, scheduleStreamWait]
  );

  const startSession = useCallback(async () => {
    if (startingSessionRef.current) return;
    if (receivedAnswerRef.current && pcRef.current) {
      return;
    }

    startingSessionRef.current = true;
    sessionGenRef.current += 1;
    const gen = sessionGenRef.current;
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    receivedAnswerRef.current = false;
    pendingAnswerRef.current = null;
    pendingIceRef.current = [];
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setError(null);
    setStatus("negotiating");
    offerAttemptRef.current += 1;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    timeoutRef.current = setTimeout(() => {
      if (pcRef.current !== pc || receivedAnswerRef.current) return;
      setError(receivedAnswerRef.current ? null : NO_ANSWER_ERROR);
      setStatus("failed");
      setStreamActive(false);
    }, NEGOTIATION_TIMEOUT_MS);

    pc.ontrack = (event) => {
      const track = event.track;
      if (track?.kind === "video") {
        attachRemoteVideo(pc, track);
        track.onunmute = () => {
          attachRemoteVideo(pc, track);
        };
        return;
      }
      const stream = event.streams[0];
      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) attachRemoteVideo(pc, videoTrack);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling(outboundIce(event.candidate.toJSON()) as Record<string, unknown>);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        clearIceWait();
        setError(null);
        tryAttachFromReceivers(pc);
        void requestInboundKeyFrame(pc);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearIceWait();
        setError(null);
        tryAttachFromReceivers(pc);
        void requestInboundKeyFrame(pc);
      } else if (pc.connectionState === "failed") {
        clearNegotiationTimeout();
        clearOfferRetry();
        setStreamActive(false);
        setStatus("failed");
        setError("WebRTC connection failed. NAT or firewall may be blocking the stream.");
      } else if (pc.connectionState === "closed") {
        setStreamActive(false);
        setStatus("idle");
      }
    };

    try {
      const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
      if (typeof RTCRtpReceiver !== "undefined" && "getCapabilities" in RTCRtpReceiver) {
        const caps = RTCRtpReceiver.getCapabilities("video");
        const preferred = caps?.codecs.filter((codec) => {
          const mime = codec.mimeType.toLowerCase();
          return mime === "video/vp8" || mime === "video/vp9";
        });
        if (preferred?.length && "setCodecPreferences" in transceiver) {
          transceiver.setCodecPreferences(preferred);
        }
      }
      const offer = await pc.createOffer();
      if (sessionGenRef.current !== gen) return;
      await pc.setLocalDescription(offer);
      if (sessionGenRef.current !== gen) return;
      sendSignaling(outboundOffer(offer) as Record<string, unknown>);

      const pending = pendingAnswerRef.current;
      if (pending) {
        await applyAnswer(pending);
      }
    } catch (err) {
      if (sessionGenRef.current === gen) {
        clearNegotiationTimeout();
        clearOfferRetry();
        setStatus("failed");
        setError(err instanceof Error ? err.message : "Failed to start WebRTC session");
      }
    } finally {
      if (sessionGenRef.current === gen) {
        startingSessionRef.current = false;
      }
    }
  }, [
    applyAnswer,
    attachRemoteVideo,
    tryAttachFromReceivers,
    requestInboundKeyFrame,
    clearNegotiationTimeout,
    clearOfferRetry,
    clearScheduleDelay,
    clearIceWait,
    sendSignaling,
  ]);

  startSessionRef.current = startSession;

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    const handleSignaling = (msg: Record<string, unknown>) => {
      enqueueSignaling(async () => {
        const { sdp, ice } = parseInboundSignaling(msg);

        if (sdp && isAnswer(sdp)) {
          await applyAnswer(sdp);
          return;
        }

        if (sdp && isOffer(sdp)) {
          await applyRenegotiationOffer(sdp);
          return;
        }

        if (ice) {
          await addRemoteIce(ice);
        }
      });
    };

    onSignaling(handleSignaling);
  }, [enabled, cleanup, onSignaling, applyAnswer, applyRenegotiationOffer, addRemoteIce, enqueueSignaling]);

  useEffect(() => {
    if (!enabled || !deviceUid || !user) return;
    if (streamActive) return;
    if (status !== "negotiating" && status !== "connecting" && !serverAnswerReceived) return;

    const pollReplay = () => {
      void fetchSignalingReplay(user, deviceUid)
        .then(({ messages }) => {
          for (const msg of messages) {
            enqueueSignaling(async () => {
              const { sdp, ice } = parseInboundSignaling(msg);
              if (sdp && isOffer(sdp) && streamActiveRef.current) {
                await applyRenegotiationOffer(sdp);
              } else if (sdp && isAnswer(sdp) && !receivedAnswerRef.current) {
                await applyAnswer(sdp);
              } else if (ice) {
                await addRemoteIce(ice);
              }
            });
          }
        })
        .catch((err) => console.warn("Signaling replay poll failed:", err));
    };

    if (serverAnswerReceived) {
      pollReplay();
    }

    const interval = window.setInterval(pollReplay, 2_000);
    return () => window.clearInterval(interval);
  }, [
    enabled,
    deviceUid,
    user,
    serverAnswerReceived,
    status,
    streamActive,
    applyAnswer,
    applyRenegotiationOffer,
    addRemoteIce,
    enqueueSignaling,
  ]);

  const scheduleOffer = useCallback(() => {
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    offerAttemptRef.current = 0;
    setStatus("waiting");

    if (deviceStreamReady) return;

    scheduleDelayRef.current = setTimeout(() => {
      scheduleDelayRef.current = null;
      if (receivedAnswerRef.current || deviceStreamReady) return;
      void startSessionRef.current?.();

      retryRef.current = setInterval(() => {
        if (receivedAnswerRef.current || deviceStreamReady) {
          clearOfferRetry();
          return;
        }
        if (offerAttemptRef.current >= MAX_OFFER_ATTEMPTS) {
          clearOfferRetry();
          return;
        }
        void startSessionRef.current?.();
      }, OFFER_RETRY_MS);
    }, OFFER_DELAY_MS);
  }, [deviceStreamReady, clearOfferRetry, clearScheduleDelay, clearIceWait]);

  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      autoStartedRef.current = false;
      return;
    }

    if (!signalingReady) {
      if (receivedAnswerRef.current || streamActive) return;
      autoStartedRef.current = false;
      return;
    }

    if (!autoStartedRef.current && !receivedAnswerRef.current) {
      autoStartedRef.current = true;
      scheduleOffer();
    }
  }, [enabled, signalingReady, scheduleOffer, cleanup, streamActive]);

  useEffect(() => {
    if (!enabled || !signalingReady || !deviceStreamReady || streamActive) return;
    if (receivedAnswerRef.current) return;
    clearScheduleDelay();
    clearOfferRetry();
    setStatus("waiting");
    const warmup = window.setTimeout(() => {
      if (!receivedAnswerRef.current) void startSessionRef.current?.();
    }, CAPTURE_WARMUP_MS);
    return () => window.clearTimeout(warmup);
  }, [deviceStreamReady, enabled, signalingReady, streamActive, clearScheduleDelay, clearOfferRetry]);

  useEffect(() => cleanup, [cleanup]);

  const layoutHintRef = useRef<StreamDimensions | null>(null);
  useEffect(() => {
    if (!layoutHint || !streamActive) {
      if (!streamActive) layoutHintRef.current = null;
      return;
    }
    const prev = layoutHintRef.current;
    layoutHintRef.current = layoutHint;
    if (prev?.width === layoutHint.width && prev?.height === layoutHint.height) return;
    const pc = pcRef.current;
    if (pc) void requestInboundKeyFrame(pc);
  }, [layoutHint, streamActive, requestInboundKeyFrame]);

  const layoutRevisionRef = useRef(0);
  useEffect(() => {
    if (!streamActive || layoutRevision <= 0) {
      if (!streamActive) layoutRevisionRef.current = 0;
      return;
    }
    if (layoutRevisionRef.current === layoutRevision) return;
    layoutRevisionRef.current = layoutRevision;
    const pc = pcRef.current;
    if (pc) {
      console.log("[WebRTC] ORIENTATION_CHANGED — requesting inbound keyframe");
      void requestInboundKeyFrame(pc);
    }
  }, [layoutRevision, streamActive, requestInboundKeyFrame]);

  return { videoRef, streamActive, status, error, setError, startSession, cleanup };
}
