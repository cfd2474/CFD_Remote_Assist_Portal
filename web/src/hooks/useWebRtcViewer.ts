import { useEffect, useRef, useState, useCallback } from "react";
import {
  outboundIce,
  outboundOffer,
  parseInboundSignaling,
  isAnswer,
} from "../utils/webrtcSignaling";

type StreamStatus = "idle" | "negotiating" | "streaming" | "failed";

interface WebRtcOptions {
  sendSignaling: (msg: Record<string, unknown>) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  enabled: boolean;
}

const NEGOTIATION_TIMEOUT_MS = 25_000;

export function useWebRtcViewer({
  sendSignaling,
  onSignaling,
  enabled,
}: WebRtcOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const clearNegotiationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearNegotiationTimeout();
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
    setStatus("idle");
  }, [clearNegotiationTimeout]);

  const startSession = useCallback(async () => {
    cleanup();
    setError(null);
    setStatus("negotiating");

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    timeoutRef.current = setTimeout(() => {
      if (pcRef.current !== pc) return;
      setError(
        "No video stream from the device. Ensure the Android app received START_REMOTE_ADMIN, is connected via WebSocket, and implements screen-capture WebRTC."
      );
      setStatus("failed");
      setStreamActive(false);
    }, NEGOTIATION_TIMEOUT_MS);

    pc.ontrack = (event) => {
      clearNegotiationTimeout();
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        void videoRef.current.play().catch(() => undefined);
        setStreamActive(true);
        setStatus("streaming");
        setError(null);
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
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Failed to start WebRTC session");
    }
  }, [cleanup, clearNegotiationTimeout, sendSignaling]);

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
        try {
          await pc.setRemoteDescription(sdp);
        } catch (err) {
          setStatus("failed");
          setError(
            err instanceof Error ? err.message : "Invalid WebRTC answer from device"
          );
        }
        return;
      }

      if (ice) {
        try {
          await pc.addIceCandidate(ice);
        } catch (err) {
          console.warn("ICE candidate error:", err);
        }
      }
    };

    onSignaling(handleSignaling);
  }, [enabled, cleanup, onSignaling]);

  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      autoStartedRef.current = false;
      return;
    }

    if (!autoStartedRef.current) {
      autoStartedRef.current = true;
      void startSession();
    }
  }, [enabled, startSession]);

  useEffect(() => cleanup, [cleanup]);

  return { videoRef, streamActive, status, error, setError, startSession, cleanup };
}
