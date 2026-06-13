import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { User } from "oidc-client-ts";
import { sendControl as sendControlHttp } from "../api/client";
import type { ControlPacket } from "../types";
import {
  normalizeControlKey,
  shouldForwardKeyboardToDevice,
} from "../utils/remoteKeyboard";
import { moveThresholdPx, pointOnVideo, swipeDurationMs } from "../utils/videoCoordinates";

interface ActivePointer {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  moved: boolean;
  threshold: number;
}

interface UseRemoteVideoControlOptions {
  uid: string;
  user: User;
  /** Enable touch/pointer gestures on the video panel */
  pointerEnabled: boolean;
  /** Forward keyboard events to the device */
  keyboardEnabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  sendControlWs?: (packet: ControlPacket) => boolean;
}

export function useRemoteVideoControl({
  uid,
  user,
  pointerEnabled,
  keyboardEnabled,
  videoRef,
  sendControlWs,
}: UseRemoteVideoControlOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<ActivePointer | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [pointerOverPanel, setPointerOverPanel] = useState(false);

  const send = useCallback(
    async (packet: ControlPacket) => {
      const channelOpen = pointerEnabled || keyboardEnabled;
      if (!channelOpen) return;

      const withKeyboardMeta =
        packet.action === "KEY"
          ? { ...packet, input_method: "hardware_keyboard" as const }
          : packet;

      const wsSent = sendControlWs?.(withKeyboardMeta) ?? false;
      if (wsSent) return;

      try {
        await sendControlHttp(user, uid, withKeyboardMeta);
      } catch (err) {
        console.warn("Control send failed:", err);
      }
    },
    [keyboardEnabled, pointerEnabled, sendControlWs, uid, user]
  );

  useEffect(() => {
    if (!keyboardEnabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      const focusTarget =
        e.target instanceof Element ? e.target : document.activeElement;
      if (!shouldForwardKeyboardToDevice(focusTarget)) return;

      const key = normalizeControlKey(e);
      if (!key) return;

      e.preventDefault();
      e.stopPropagation();
      void send({ action: "KEY", key });
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [keyboardEnabled, send]);

  useEffect(() => {
    if (!pointerEnabled) return;

    const blockScroll = (e: Event) => {
      if (!activePointer.current) return;
      e.preventDefault();
    };

    document.addEventListener("touchmove", blockScroll, { passive: false });
    document.addEventListener("wheel", blockScroll, { passive: false });
    return () => {
      document.removeEventListener("touchmove", blockScroll);
      document.removeEventListener("wheel", blockScroll);
    };
  }, [pointerEnabled]);

  const updateCursorPosition = useCallback((clientX: number, clientY: number) => {
    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    setCursorPosition({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }, []);

  const finishPointer = useCallback(
    (pointer: ActivePointer, clientX: number, clientY: number) => {
      const video = videoRef.current;
      if (!video) return;

      const endX = pointer.lastX ?? clientX;
      const endY = pointer.lastY ?? clientY;

      const start = pointOnVideo(video, pointer.startX, pointer.startY);
      const end = pointOnVideo(video, endX, endY);

      if (!pointer.moved) {
        void send({ action: "CLICK", ...start });
        return;
      }

      void send({
        action: "SWIPE",
        ...start,
        x2_percent: end.x_percent,
        y2_percent: end.y_percent,
        duration_ms: swipeDurationMs(start, end, Date.now() - pointer.startedAt),
      });
    },
    [send, videoRef]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerEnabled) return;
      updateCursorPosition(e.clientX, e.clientY);

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
        lastX: e.clientX,
        lastY: e.clientY,
        startedAt: Date.now(),
        moved: false,
        threshold: moveThresholdPx(video),
      };
    },
    [pointerEnabled, send, updateCursorPosition, videoRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerOverPanel) {
        updateCursorPosition(e.clientX, e.clientY);
      }

      const pointer = activePointer.current;
      if (!pointer || pointer.id !== e.pointerId) return;

      e.preventDefault();
      pointer.lastX = e.clientX;
      pointer.lastY = e.clientY;

      const dx = e.clientX - pointer.startX;
      const dy = e.clientY - pointer.startY;
      if (
        Math.abs(dx) >= pointer.threshold ||
        Math.abs(dy) >= pointer.threshold
      ) {
        pointer.moved = true;
      }
    },
    [pointerOverPanel, updateCursorPosition]
  );

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setPointerOverPanel(true);
      updateCursorPosition(e.clientX, e.clientY);
    },
    [updateCursorPosition]
  );

  const handlePointerLeave = useCallback(() => {
    setPointerOverPanel(false);
    setCursorPosition(null);
  }, []);

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
      if (!pointerEnabled) return;
      e.preventDefault();
      const video = videoRef.current;
      if (!video) return;
      const point = pointOnVideo(video, e.clientX, e.clientY);
      void send({ action: "LONG_PRESS", ...point });
    },
    [pointerEnabled, send, videoRef]
  );

  return {
    panelRef,
    cursorPosition,
    showCursor: pointerOverPanel,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onContextMenu: handleContextMenu,
  };
}
