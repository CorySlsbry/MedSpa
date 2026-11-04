"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "starting" | "live" | "captured" | "uploading" | "error";

/**
 * Live camera capture — getUserMedia preview + click-to-snap, retake, keep.
 * Hits the same two-step upload pipeline (/api/photos/upload-url → PUT to
 * GCS → /api/photos finalize) as the file-picker flow, so the photo lands
 * on the chart with a real PhotoDoc and is deletable from the gallery
 * exactly like any uploaded photo.
 *
 * Flow (mirrors a dental X-ray sensor):
 *   1. User clicks "Start camera" — browser prompts for permission.
 *   2. Live video preview renders. User clicks "Capture" to freeze a frame.
 *   3. Frozen frame shows side-by-side controls: "Retake" or "Keep".
 *   4. Keep → uploads JPEG → PhotoDoc created → onSaved() fires so the
 *      gallery reloads.
 *
 * Why not Web Bluetooth: there's no standard BLE GATT for camera capture,
 * each manufacturer has proprietary protocols, and Chrome/Edge are the
 * only browsers that ship Web Bluetooth at all. getUserMedia works on
 * every modern browser including iOS Safari (14.3+), and accepts any
 * camera the OS sees — built-in webcams, USB webcams, iPad/iPhone cams,
 * and even some Bluetooth/WiFi cameras that present themselves as
 * system cameras.
 */
export default function LiveCaptureCamera({
  clientId,
  appointmentId,
  chartId,
  kind,
  onSaved,
}: {
  clientId: string;
  appointmentId: string | null;
  chartId: string | null;
  /** Default photo kind for captured frames. */
  kind?: "before" | "after" | "during" | "other";
  /** Called after a successful keep+upload so the parent can reload the gallery. */
  onSaved?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Tear down on unmount so the camera light goes off.
  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  async function listCameras() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
    } catch {
      // Pre-permission, labels are blank — we'll re-list after start
    }
  }

  async function startCamera() {
    setError(null);
    setPhase("starting");
    setCapturedBlob(null);
    setCapturedPreview(null);
    try {
      // Prefer high resolution; fall back gracefully if unsupported.
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
      // Refresh device list — labels populate after permission is granted.
      void listCameras();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied|NotAllowed/i.test(msg)) {
        setError(
          "We need camera permission to capture photos. Click the camera icon in your browser's address bar and allow access, then click Start camera again.",
        );
      } else if (/NotFound/i.test(msg)) {
        setError(
          "No camera found on this device. Plug in a USB webcam, or use the phone-handoff option below.",
        );
      } else {
        setError(`Couldn't start the camera: ${msg}`);
      }
      setPhase("error");
    }
  }

  function capture() {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) {
          setError("The browser couldn't encode that frame. Retake.");
          return;
        }
        setCapturedBlob(blob);
        setCapturedPreview(URL.createObjectURL(blob));
        setPhase("captured");
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake() {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedBlob(null);
    setCapturedPreview(null);
    setError(null);
    setPhase("live");
  }

  async function keepAndUpload() {
    if (!capturedBlob) return;
    setPhase("uploading");
    setError(null);
    try {
      // Step 1: signed PUT URL
      const initRes = await fetch("/api/photos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          content_type: "image/jpeg",
          byte_size: capturedBlob.size,
        }),
      });
      const init = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        setError(init?.error ?? "Couldn't request an upload URL.");
        setPhase("captured");
        return;
      }

      // Step 2: PUT the JPEG
      const headers = (init.required_headers ?? {}) as Record<string, string>;
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers,
        body: capturedBlob,
      });
      if (!put.ok) {
        setError(`Upload failed (HTTP ${put.status}). Retake and try again.`);
        setPhase("captured");
        return;
      }

      // Step 3: finalize
      const finRes = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: init.photo_id,
          client_id: clientId,
          appointment_id: appointmentId,
          chart_id: chartId,
          storage_path: init.storage_path,
          content_type: "image/jpeg",
          kind: kind ?? "during",
          taken_at: new Date().toISOString(),
        }),
      });
      const fin = await finRes.json().catch(() => ({}));
      if (!finRes.ok) {
        setError(fin?.error ?? "Upload landed in storage but the chart record failed.");
        setPhase("captured");
        return;
      }

      // Success — clear capture state and notify parent
      if (capturedPreview) URL.revokeObjectURL(capturedPreview);
      setCapturedBlob(null);
      setCapturedPreview(null);
      setPhase("live");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setPhase("captured");
    }
  }

  function stopCamera() {
    stopStream();
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedBlob(null);
    setCapturedPreview(null);
    setError(null);
    setPhase("idle");
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
            Live capture
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Built-in webcam, USB cam, iPad, or phone — anything your browser sees as a camera.
          </p>
        </div>
        {phase !== "idle" && (
          <button
            type="button"
            onClick={stopCamera}
            className="text-[11px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-navy)]"
          >
            Stop camera
          </button>
        )}
      </div>

      {phase === "idle" && (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-md bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)]"
          >
            Start camera
          </button>
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            Your browser will ask for camera permission. The photo never leaves
            your tenant — uploads go straight to your encrypted Cloud Storage.
          </p>
        </div>
      )}

      {(phase === "starting" || phase === "live" || phase === "captured" || phase === "uploading") && (
        <div className="mt-4 space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {/* Live preview */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`block w-full ${phase === "captured" ? "hidden" : ""}`}
            />
            {/* Captured snapshot */}
            {phase === "captured" && capturedPreview && (
              <img
                src={capturedPreview}
                alt="Captured snapshot"
                className="block w-full"
              />
            )}
            <canvas ref={canvasRef} className="hidden" />
            {phase === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Starting camera…
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {phase === "live" && (
              <>
                <button
                  type="button"
                  onClick={capture}
                  className="rounded-md bg-[var(--color-gold)] px-4 py-2 text-sm font-bold text-[var(--color-navy-deep)]"
                >
                  ⚪ Capture
                </button>
                {devices.length > 1 && (
                  <select
                    value={selectedDeviceId ?? ""}
                    onChange={async (e) => {
                      setSelectedDeviceId(e.target.value || null);
                      stopStream();
                      await startCamera();
                    }}
                    className="rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs"
                  >
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                )}
                {devices.length === 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setFacing(facing === "user" ? "environment" : "user");
                      stopStream();
                      await startCamera();
                    }}
                    className="rounded-md border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-semibold"
                  >
                    Flip camera
                  </button>
                )}
              </>
            )}
            {phase === "captured" && (
              <>
                <button
                  type="button"
                  onClick={() => void keepAndUpload()}
                  className="rounded-md bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)]"
                >
                  ✓ Keep + save to chart
                </button>
                <button
                  type="button"
                  onClick={retake}
                  className="rounded-md border border-[var(--color-line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-navy)]"
                >
                  ↻ Retake
                </button>
              </>
            )}
            {phase === "uploading" && (
              <span className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-teal)]" />
                Uploading + saving to chart…
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {error}
        </div>
      )}
    </div>
  );
}
