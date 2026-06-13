import { useEffect, useRef, useState, useCallback } from "react";
import {
  outboundIce,
  outboundOffer,
  parseInboundSignaling,
  isAnswer,
} from "../utils/webrtcSignaling";

type StreamStatus = "idle" | "waiting" | "negotiating" | "streaming" | "failed";

interface WebRtcOptions {
  sendSignaling: (msg: Record<string, unknown>) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  enabled: boolean;
  signalingReady: boolean;
  /** Set when device posts WEBRTC_READY / REMOTE_SESSION_STARTED */
  deviceStreamReady: boolean;
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
}: WebRtcOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerAttemptRef = useRef(0);
  const receivedAnswerRef = useRef(false);
  const pendingAnswerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const startingSessionRef = useRef(false);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

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

  const cleanup = useCallback(() => {
    clearNegotiationTimeout();
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    offerAttemptRef.current = 0;
    receivedAnswerRef.current = false;
    pendingAnswerRef.current = null;
    startingSessionRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setStatus("idle");
  }, [clearNegotiationTimeout, clearScheduleDelay, clearOfferRetry, clearIceWait]);

  const applyAnswer = useCallback(
    async (sdp: RTCSessionDescriptionInit): Promise<boolean> => {
      for (let attempt = 0; attempt < 60; attempt++) {
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
            return true;
          }
          if (pc.localDescription?.type !== "offer") {
            pendingAnswerRef.current = sdp;
            return false;
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
          iceWaitRef.current = setTimeout(() => {
            if (pcRef.current !== pc) return;
            if (
              pc.connectionState !== "connected" &&
              pc.iceConnectionState !== "connected" &&
              pc.iceConnectionState !== "completed"
            ) {
              setError(NO_ICE_ERROR);
              setStatus("failed");
            }
          }, ICE_WAIT_MS);
          return true;
        } catch (err) {
          if (pc.remoteDescription?.type === "answer") {
            receivedAnswerRef.current = true;
            pendingAnswerRef.current = null;
            setError(null);
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
    [clearScheduleDelay, clearOfferRetry, clearIceWait]
  );

  const startSession = useCallback(async () => {
    if (startingSessionRef.current) return;
    if (receivedAnswerRef.current && pcRef.current) {
      return;
    }

    startingSessionRef.current = true;
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    receivedAnswerRef.current = false;
    pendingAnswerRef.current = null;
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
      clearNegotiationTimeout();
      clearOfferRetry();
      clearIceWait();
      if (videoRef.current && event.streams[0]) {
        const video = videoRef.current;
        video.srcObject = event.streams[0];
        void video.play().catch(() => undefined);
        setStreamActive(true);
        setStatus("streaming");
        setError(null);

        window.setTimeout(() => {
          if (pcRef.current !== pc || !videoRef.current) return;
          if (videoRef.current.videoWidth === 0 && videoRef.current.videoHeight === 0) {
            setStreamActive(false);
            setStatus("failed");
            setError(
              "WebRTC track received but no video frames (0×0). The Android app PeerConnection is up but screen capture is not feeding the video track."
            );
          }
        }, 12_000);
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
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearIceWait();
        setError(null);
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
      pc.addTransceiver("video", { direction: "recvonly" });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignaling(outboundOffer(offer) as Record<string, unknown>);

      const pending = pendingAnswerRef.current;
      if (pending) {
        await applyAnswer(pending);
      }
    } catch (err) {
      clearNegotiationTimeout();
      clearOfferRetry();
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Failed to start WebRTC session");
    } finally {
      startingSessionRef.current = false;
    }
  }, [applyAnswer, clearNegotiationTimeout, clearOfferRetry, clearScheduleDelay, clearIceWait, sendSignaling]);

  startSessionRef.current = startSession;

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    const handleSignaling = async (msg: Record<string, unknown>) => {
      const { sdp, ice } = parseInboundSignaling(msg);

      if (sdp && isAnswer(sdp)) {
        await applyAnswer(sdp);
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (ice) {
        clearIceWait();
        try {
          await pc.addIceCandidate(ice);
        } catch (err) {
          console.warn("ICE candidate error:", err);
        }
      }
    };

    onSignaling(handleSignaling);
  }, [enabled, cleanup, onSignaling, applyAnswer]);

  const scheduleOffer = useCallback(() => {
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    offerAttemptRef.current = 0;
    setStatus("waiting");

    // Wait for webrtc_ready — deviceStreamReady effect sends the offer after warmup.
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
      // Ignore brief device WebSocket reconnects during an active negotiation.
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

  return { videoRef, streamActive, status, error, setError, startSession, cleanup };
}
