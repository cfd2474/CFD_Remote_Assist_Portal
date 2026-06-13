import { useEffect, useRef, useState, useCallback } from "react";
import type { User } from "oidc-client-ts";
import type { SignalingStatus, ControlPacket } from "../types";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "";
const DEVICE_OFFLINE_DEBOUNCE_MS = 6_000;

export function useAdminWebSocket(uid: string | undefined, user: User | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [deviceReconnecting, setDeviceReconnecting] = useState(false);
  const [lastEvent, setLastEvent] = useState<Record<string, unknown> | null>(
    null
  );
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus | null>(
    null
  );
  const onWebRtcRef = useRef<((msg: Record<string, unknown>) => void) | null>(
    null
  );

  const clearOfflineTimer = useCallback(() => {
    if (offlineTimerRef.current) {
      clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }
  }, []);

  const markDeviceOnline = useCallback(() => {
    clearOfflineTimer();
    setDeviceReconnecting(false);
    setDeviceOnline(true);
  }, [clearOfflineTimer]);

  const markDeviceOfflineSoon = useCallback(() => {
    clearOfflineTimer();
    setDeviceReconnecting(true);
    offlineTimerRef.current = setTimeout(() => {
      offlineTimerRef.current = null;
      setDeviceReconnecting(false);
      setDeviceOnline(false);
    }, DEVICE_OFFLINE_DEBOUNCE_MS);
  }, [clearOfflineTimer]);

  const sendWebRtc = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "webrtc", ...message }));
    }
  }, []);

  const sendControl = useCallback((packet: ControlPacket): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "control", ...packet }));
      return true;
    }
    return false;
  }, []);

  const setWebRtcHandler = useCallback(
    (handler: (msg: Record<string, unknown>) => void) => {
      onWebRtcRef.current = handler;
    },
    []
  );

  useEffect(() => {
    if (!uid || !user?.access_token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = WS_BASE || `${protocol}//${window.location.host}`;
    const ws = new WebSocket(`${host}/ws/admin`);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "auth",
          role: "admin",
          uid,
          token: user.access_token,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as Record<string, unknown>;

      if (msg.type === "auth_ok") {
        setConnected(true);
        return;
      }

      if (msg.type === "device_status") {
        if (msg.online) {
          markDeviceOnline();
        } else {
          markDeviceOfflineSoon();
        }
        return;
      }

      if (msg.type === "webrtc") {
        onWebRtcRef.current?.(msg);
        return;
      }

      if (msg.type === "device_event") {
        setLastEvent(msg);
        return;
      }

      if (msg.type === "signaling_status") {
        const status = msg as unknown as SignalingStatus;
        setSignalingStatus(status);
        if (status.deviceWsConnected) {
          markDeviceOnline();
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      clearOfflineTimer();
      setDeviceReconnecting(false);
      setDeviceOnline(false);
    };

    wsRef.current = ws;

    return () => {
      clearOfflineTimer();
      ws.close();
      wsRef.current = null;
    };
  }, [uid, user?.access_token, markDeviceOnline, markDeviceOfflineSoon, clearOfflineTimer]);

  return {
    connected,
    deviceOnline,
    deviceReconnecting,
    lastEvent,
    signalingStatus,
    sendWebRtc,
    sendControl,
    setWebRtcHandler,
  };
}
