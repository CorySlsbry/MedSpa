"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Lightweight canvas-based signature pad. Captures pen/touch input and
 * exports a PNG data URL. Zero deps.
 */
export default function SignaturePad({
  onChange,
  height = 180,
  accent,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  accent?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const stroke = accent || "#1b2636";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, height);
    }
  }, [height, stroke]);

  function pos(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cur = pos(e);
    if (last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
    }
    last.current = cur;
    setIsEmpty(false);
  }
  function end(e: React.PointerEvent) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }
  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    setIsEmpty(true);
    onChange(null);
  }

  return (
    <div>
      <div
        className="relative rounded-lg border border-gray-300 bg-white"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none"
          style={{ height }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            Sign here with your finger or mouse
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 text-xs font-semibold text-gray-500 hover:underline"
      >
        Clear signature
      </button>
    </div>
  );
}
