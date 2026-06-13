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

const OFFER_DELAY_MS = 3_000;
const OFFER_RETRY_MS = 10_000;
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
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setStatus("idle");
  }, [clearNegotiationTimeout, clearScheduleDelay, clearOfferRetry, clearIceWait]);

  const startSession = useCallback(async () => {
    if (receivedAnswerRef.current && pcRef.current) {
      return;
    }

    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    receivedAnswerRef.current = false;
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
      setError(
        receivedAnswerRef.current ? null : NO_ANSWER_ERROR
      );
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

        // Detect empty/black tracks (signaling OK but no frames from screen capture)
        window.setTimeout(() => {
          if (pcRef.current !== pc || !videoRef.current) return;
          if (videoRef.current.videoWidth === 0 && videoRef.current.videoHeight === 0) {
            setStreamActive(false);
            setStatus("failed");
            setError(
              "WebRTC track received but no video frames (0×0). The Android app PeerConnection is up but screen capture is not feeding the video track."
            );
          }
        }, 4000);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling(outboundIce(event.candidate.toJSON()) as Record<string, unknown>);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
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
    } catch (err) {
      clearNegotiationTimeout();
      clearOfferRetry();
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Failed to start WebRTC session");
    }
  }, [cleanup, clearNegotiationTimeout, clearOfferRetry, sendSignaling]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    const handleSignaling = async (msg: Record<string, unknown>) => {
      const pc = pcRef.current;
      if (!pc) return;

      const { sdp, ice } = parseInboundSignaling(msg);

      if (sdp && isAnswer(sdp)) {
        receivedAnswerRef.current = true;
        clearScheduleDelay();
        clearOfferRetry();
        try {
          await pc.setRemoteDescription(sdp);
          clearIceWait();
          iceWaitRef.current = setTimeout(() => {
            if (pcRef.current !== pc) return;
            if (pc.connectionState !== "connected") {
              setError(NO_ICE_ERROR);
              setStatus("failed");
            }
          }, ICE_WAIT_MS);
        } catch (err) {
          setStatus("failed");
          setError(
            err instanceof Error ? err.message : "Invalid WebRTC answer from device"
          );
        }
        return;
      }

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
  }, [enabled, cleanup, onSignaling]);

  const scheduleOffer = useCallback(() => {
    clearScheduleDelay();
    clearOfferRetry();
    clearIceWait();
    offerAttemptRef.current = 0;

    const delay = deviceStreamReady ? 0 : OFFER_DELAY_MS;
    setStatus("waiting");

    scheduleDelayRef.current = setTimeout(() => {
      scheduleDelayRef.current = null;
      if (receivedAnswerRef.current) return;
      void startSession();

      retryRef.current = setInterval(() => {
        if (receivedAnswerRef.current) {
          clearOfferRetry();
          return;
        }
        if (offerAttemptRef.current >= MAX_OFFER_ATTEMPTS) {
          clearOfferRetry();
          return;
        }
        void startSession();
      }, OFFER_RETRY_MS);
    }, delay);
  }, [deviceStreamReady, startSession, clearOfferRetry, clearScheduleDelay]);

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
    void startSession();
  }, [deviceStreamReady, enabled, signalingReady, startSession, streamActive, clearScheduleDelay]);

  useEffect(() => cleanup, [cleanup]);

  return { videoRef, streamActive, status, error, setError, startSession, cleanup };
}
