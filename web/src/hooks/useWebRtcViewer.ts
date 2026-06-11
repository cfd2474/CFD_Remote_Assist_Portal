import { useEffect, useRef, useState, useCallback } from "react";

interface WebRtcOptions {
  sendSignaling: (msg: Record<string, unknown>) => void;
  onSignaling: (handler: (msg: Record<string, unknown>) => void) => void;
  enabled: boolean;
}

export function useWebRtcViewer({
  sendSignaling,
  onSignaling,
  enabled,
}: WebRtcOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  }, []);

  const startSession = useCallback(async () => {
    cleanup();
    setError(null);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setStreamActive(true);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling({
          signal: "ice",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        setStreamActive(false);
      }
    };

    const offer = await pc.createOffer({ offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    sendSignaling({ signal: "offer", sdp: offer });
  }, [cleanup, sendSignaling]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    const handleSignaling = async (msg: Record<string, unknown>) => {
      const pc = pcRef.current;
      if (!pc) return;

      const signal = msg.signal as string;

      if (signal === "answer" && msg.sdp) {
        await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
        return;
      }

      if (signal === "ice" && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit);
        } catch (err) {
          console.warn("ICE candidate error:", err);
        }
      }
    };

    onSignaling(handleSignaling);
  }, [enabled, cleanup, onSignaling]);

  useEffect(() => cleanup, [cleanup]);

  return { videoRef, streamActive, error, setError, startSession, cleanup };
}
