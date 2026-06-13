import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { User } from "oidc-client-ts";
import { sendControl as sendControlHttp } from "../api/client";
import type { ControlPacket } from "../types";
import {
  isKeyboardExitCombo,
  normalizeControlKey,
} from "../utils/remoteKeyboard";
import { moveThresholdPx, pointOnVideo } from "../utils/videoCoordinates";

interface ActivePointer {
  id: number;
  startX: number;
  startY: number;
  moved: boolean;
  threshold: number;
}

interface UseRemoteVideoControlOptions {
  uid: string;
  user: User;
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  sendControlWs?: (packet: ControlPacket) => void;
}

export function useRemoteVideoControl({
  uid,
  user,
  enabled,
  videoRef,
  sendControlWs,
}: UseRemoteVideoControlOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<ActivePointer | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const send = useCallback(
    async (packet: ControlPacket) => {
      if (!enabled) return;

      const withKeyboardMeta =
        packet.action === "KEY"
          ? { ...packet, input_method: "hardware_keyboard" as const }
          : packet;

      if (sendControlWs) {
        sendControlWs(withKeyboardMeta);
        return;
      }

      try {
        await sendControlHttp(user, uid, withKeyboardMeta);
      } catch (err) {
        console.warn("Control send failed:", err);
      }
    },
    [enabled, sendControlWs, uid, user]
  );

  const unlockPanel = useCallback(() => {
    setLocked(false);
    if (document.pointerLockElement === panelRef.current) {
      document.exitPointerLock();
    }
    panelRef.current?.blur();
  }, []);

  const lockPanel = useCallback(() => {
    if (!enabled) return;
    setLocked(true);
    requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
      panelRef.current?.requestPointerLock?.();
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLocked(false);
      if (document.pointerLockElement === panelRef.current) {
        document.exitPointerLock();
      }
      return;
    }

    lockPanel();
  }, [enabled, lockPanel]);

  useEffect(() => {
    if (!enabled || !locked) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardExitCombo(e)) {
        e.preventDefault();
        e.stopPropagation();
        unlockPanel();
        return;
      }

      const key = normalizeControlKey(e);
      if (!key) return;

      e.preventDefault();
      e.stopPropagation();
      void send({ action: "KEY", key });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, locked, send, unlockPanel]);

  useEffect(() => {
    if (!enabled || !locked) return;

    const panel = panelRef.current;
    if (!panel) return;

    const keepFocus = () => {
      if (lockedRef.current && document.activeElement !== panel) {
        panel.focus({ preventScroll: true });
      }
    };

    panel.addEventListener("blur", keepFocus);
    return () => panel.removeEventListener("blur", keepFocus);
  }, [enabled, locked]);

  const finishPointer = useCallback(
    (pointer: ActivePointer, clientX: number, clientY: number) => {
      const video = videoRef.current;
      if (!video) return;

      const start = pointOnVideo(video, pointer.startX, pointer.startY);
      const end = pointOnVideo(video, clientX, clientY);

      if (!pointer.moved) {
        void send({ action: "CLICK", ...start });
        return;
      }

      void send({
        action: "SWIPE",
        ...start,
        x2_percent: end.x_percent,
        y2_percent: end.y_percent,
      });
    },
    [send, videoRef]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      lockPanel();

      const video = videoRef.current;
      if (!video) return;

      if (e.button === 2) {
        e.preventDefault();
        const point = pointOnVideo(video, e.clientX, e.clientY);
        void send({ action: "LONG_PRESS", ...point });
        return;
      }
      if (e.button !== 0) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointer.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        threshold: moveThresholdPx(video),
      };
    },
    [enabled, lockPanel, send, videoRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pointer = activePointer.current;
      if (!pointer || pointer.id !== e.pointerId) return;

      const dx = e.clientX - pointer.startX;
      const dy = e.clientY - pointer.startY;
      if (Math.hypot(dx, dy) >= pointer.threshold) {
        pointer.moved = true;
      }
    },
    []
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pointer = activePointer.current;
      if (!pointer || pointer.id !== e.pointerId) return;

      activePointer.current = null;
      finishPointer(pointer, e.clientX, e.clientY);

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [finishPointer]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      endPointer(e);
    },
    [endPointer]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endPointer(e);
    },
    [endPointer]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      e.preventDefault();
      lockPanel();
      const video = videoRef.current;
      if (!video) return;
      const point = pointOnVideo(video, e.clientX, e.clientY);
      void send({ action: "LONG_PRESS", ...point });
    },
    [enabled, lockPanel, send, videoRef]
  );

  const handleFocus = useCallback(() => {
    if (enabled) setLocked(true);
  }, [enabled]);

  return {
    panelRef,
    locked,
    unlockPanel,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onContextMenu: handleContextMenu,
    onFocus: handleFocus,
  };
}
