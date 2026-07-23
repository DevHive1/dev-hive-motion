import React, { useEffect, useRef, useState } from "react";
import type { Composition } from "../schema/scene";

type DragMode = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Same math as CSS object-fit: contain, computed in JS so the overlay
 * lines up with the actual rendered video frame regardless of how the
 * surrounding layout resolves (letterboxing, flex rounding, etc). */
function computeContainRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): Rect {
  if (containerW <= 0 || containerH <= 0 || contentW <= 0 || contentH <= 0) {
    return { left: 0, top: 0, width: containerW, height: containerH };
  }
  const containerRatio = containerW / containerH;
  const contentRatio = contentW / contentH;
  if (containerRatio > contentRatio) {
    const height = containerH;
    const width = height * contentRatio;
    return { left: (containerW - width) / 2, top: 0, width, height };
  }
  const width = containerW;
  const height = width / contentRatio;
  return { left: 0, top: (containerH - height) / 2, width, height };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const CanvasOverlay: React.FC<{
  composition: Composition;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  onPatchElement: (elementId: string, patch: Record<string, unknown>) => void;
}> = ({ composition, selectedSceneId, selectedElementId, onPatchElement }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameRect, setFrameRect] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });
  const dragState = useRef<{
    mode: DragMode;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setFrameRect(computeContainRect(rect.width, rect.height, composition.width, composition.height));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [composition.width, composition.height]);

  const scene = composition.scenes.find((s) => s.id === selectedSceneId);
  const element = scene?.elements.find((e) => e.id === selectedElementId && !e.hidden);

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (!element) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: element.x,
      startY: element.y,
      startWidth: element.width,
      startHeight: element.height,
    };
  };

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag || !element || frameRect.width === 0 || frameRect.height === 0) return;

    const dxPct = ((e.clientX - drag.startClientX) / frameRect.width) * 100;
    const dyPct = ((e.clientY - drag.startClientY) / frameRect.height) * 100;
    const { mode, startX, startY, startWidth, startHeight } = drag;
    let patch: Record<string, number> = {};

    if (mode === "move") {
      patch = { x: round1(startX + dxPct), y: round1(startY + dyPct) };
    } else if (mode === "resize-se") {
      patch = {
        width: round1(Math.max(2, startWidth + dxPct)),
        height: round1(Math.max(2, startHeight + dyPct)),
      };
    } else if (mode === "resize-sw") {
      const newWidth = Math.max(2, startWidth - dxPct);
      patch = {
        x: round1(startX + (startWidth - newWidth)),
        width: round1(newWidth),
        height: round1(Math.max(2, startHeight + dyPct)),
      };
    } else if (mode === "resize-ne") {
      const newHeight = Math.max(2, startHeight - dyPct);
      patch = {
        y: round1(startY + (startHeight - newHeight)),
        height: round1(newHeight),
        width: round1(Math.max(2, startWidth + dxPct)),
      };
    } else if (mode === "resize-nw") {
      const newWidth = Math.max(2, startWidth - dxPct);
      const newHeight = Math.max(2, startHeight - dyPct);
      patch = {
        x: round1(startX + (startWidth - newWidth)),
        y: round1(startY + (startHeight - newHeight)),
        width: round1(newWidth),
        height: round1(newHeight),
      };
    }

    onPatchElement(element.id, patch);
  };

  const endDrag = () => {
    dragState.current = null;
  };

  return (
    <div ref={containerRef} className="canvas-overlay" onPointerMove={onDragMove} onPointerUp={endDrag}>
      {element && (
        <div
          className="canvas-overlay-box"
          style={{
            left: frameRect.left + (element.x / 100) * frameRect.width,
            top: frameRect.top + (element.y / 100) * frameRect.height,
            width: (element.width / 100) * frameRect.width,
            height: (element.height / 100) * frameRect.height,
          }}
          onPointerDown={beginDrag("move")}
        >
          <div className="resize-handle nw" onPointerDown={beginDrag("resize-nw")} />
          <div className="resize-handle ne" onPointerDown={beginDrag("resize-ne")} />
          <div className="resize-handle sw" onPointerDown={beginDrag("resize-sw")} />
          <div className="resize-handle se" onPointerDown={beginDrag("resize-se")} />
        </div>
      )}
    </div>
  );
};
