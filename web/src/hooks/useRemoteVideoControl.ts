import { useCallback, useRef } from "react";
import type { User } from "oidc-client-ts";
import { sendControl } from "../api/client";
import type { ControlPacket } from "../types";

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
  const activePointer = useRef<ActivePointer | null>(null);

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
    [enabled, send]
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
      const point = pointPercent(e.currentTarget, e.clientX, e.clientY);
      void send({ action: "LONG_PRESS", ...point });
    },
    [enabled, send]
  );

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onContextMenu: handleContextMenu,
  };
}
