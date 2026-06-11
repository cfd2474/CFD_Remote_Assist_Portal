import { useEffect, useRef, useState, useCallback } from "react";
import type { User } from "oidc-client-ts";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "";

export function useAdminWebSocket(uid: string | undefined, user: User | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [lastEvent, setLastEvent] = useState<Record<string, unknown> | null>(
    null
  );
  const onWebRtcRef = useRef<((msg: Record<string, unknown>) => void) | null>(
    null
  );

  const sendWebRtc = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "webrtc", ...message }));
    }
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
        setDeviceOnline(!!msg.online);
        return;
      }

      if (msg.type === "webrtc") {
        onWebRtcRef.current?.(msg);
        return;
      }

      if (msg.type === "device_event") {
        setLastEvent(msg);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setDeviceOnline(false);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [uid, user?.access_token]);

  return {
    connected,
    deviceOnline,
    lastEvent,
    sendWebRtc,
    setWebRtcHandler,
  };
}
