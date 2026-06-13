import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "oidc-client-ts";
import { sendControl } from "../api/client";
import type { ControlPacket } from "../types";
import {
  isKeyboardExitCombo,
  normalizeControlKey,
} from "../utils/remoteKeyboard";

const MOVE_THRESHOLD_PX = 8;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointPercent(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  return {
    x_percent: clamp01((clientX - rect.left) / rect.width),
    y_percent: clamp01((clientY - rect.top) / rect.height),
  };
}

interface ActivePointer {
  id: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface UseRemoteVideoControlOptions {
  uid: string;
  user: User;
  enabled: boolean;
}

export function useRemoteVideoControl({ uid, user, enabled }: UseRemoteVideoControlOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<ActivePointer | null>(null);
  const [locked, setLocked] = useState(false);

  const send = useCallback(
    async (packet: ControlPacket) => {
      if (!enabled) return;
      try {
        await sendControl(user, uid, packet);
      } catch (err) {
        console.warn("Control send failed:", err);
      }
    },
    [enabled, uid, user]
  );

  const lockPanel = useCallback(() => {
    if (!enabled) return;
    setLocked(true);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }, [enabled]);

  const unlockPanel = useCallback(() => {
    setLocked(false);
    panelRef.current?.blur();
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLocked(false);
    }
  }, [enabled]);

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

  const finishPointer = useCallback(
    (el: HTMLElement, pointer: ActivePointer, clientX: number, clientY: number) => {
      const start = pointPercent(el, pointer.startX, pointer.startY);
      const end = pointPercent(el, clientX, clientY);

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
    [send]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      lockPanel();

      if (e.button === 2) {
        e.preventDefault();
        const point = pointPercent(e.currentTarget, e.clientX, e.clientY);
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
      };
    },
    [enabled, lockPanel, send]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pointer = activePointer.current;
    if (!pointer || pointer.id !== e.pointerId) return;

    const dx = e.clientX - pointer.startX;
    const dy = e.clientY - pointer.startY;
    if (Math.hypot(dx, dy) >= MOVE_THRESHOLD_PX) {
      pointer.moved = true;
    }
  }, []);

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pointer = activePointer.current;
      if (!pointer || pointer.id !== e.pointerId) return;

      activePointer.current = null;
      finishPointer(e.currentTarget, pointer, e.clientX, e.clientY);

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
      const point = pointPercent(e.currentTarget, e.clientX, e.clientY);
      void send({ action: "LONG_PRESS", ...point });
    },
    [enabled, lockPanel, send]
  );

  const handleFocus = useCallback(() => {
    if (enabled) setLocked(true);
  }, [enabled]);

  return {
    panelRef,
    locked,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onContextMenu: handleContextMenu,
    onFocus: handleFocus,
  };
}
