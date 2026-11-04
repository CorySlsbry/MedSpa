"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "starting" | "live" | "captured" | "uploading" | "done" | "expired";

/**
 * Phone-side photo capture page. Loaded via QR scan from the desktop
 * chart. Token is in the URL — every API call to /api/photos/pair-upload
 * uses it for auth (no session cookie). Captures via getUserMedia and
 * streams to the SAME PhotoDoc the desktop is watching, so newly-saved
 * photos appear there on the next gallery refresh.
 */
export default function PhotoCaptureClient({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  async function startCamera() {
    setError(null);
    setPhase("starting");
    setCapturedBlob(null);
    setCapturedPreview(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied|NotAllowed/i.test(msg)) {
        setError("Camera permission denied. Tap the camera icon in the URL bar and allow access, then refresh.");
      } else {
        setError(`Couldn't start the camera: ${msg}`);
      }
      setPhase("idle");
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
        if (!blob) return setError("Couldn't encode that frame. Retake.");
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
      const initRes = await fetch("/api/photos/pair-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "init",
          token,
          content_type: "image/jpeg",
          byte_size: capturedBlob.size,
        }),
      });
      const init = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        if (initRes.status === 410) {
          setError(init?.error ?? "This pairing link has expired.");
          setPhase("expired");
          return;
        }
        setError(init?.error ?? "Couldn't request an upload URL.");
        setPhase("captured");
        return;
      }

      const headers = (init.required_headers ?? {}) as Record<string, string>;
      const put = await fetch(init.upload_url, { method: "PUT", headers, body: capturedBlob });
      if (!put.ok) {
        setError(`Upload failed (HTTP ${put.status}). Retake and try again.`);
        setPhase("captured");
        return;
      }

      const finRes = await fetch("/api/photos/pair-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "finalize",
          token,
          photo_id: init.photo_id,
          storage_path: init.storage_path,
          content_type: "image/jpeg",
          kind: "during",
        }),
      });
      const fin = await finRes.json().catch(() => ({}));
      if (!finRes.ok) {
        setError(fin?.error ?? "Saved to storage but the chart record failed.");
        setPhase("captured");
        return;
      }

      if (capturedPreview) URL.revokeObjectURL(capturedPreview);
      setCapturedBlob(null);
      setCapturedPreview(null);
      setSavedCount((n) => n + 1);
      setPhase("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setPhase("captured");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-cream)] px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
          Aesthera · Photo capture
        </div>
        <h1 className="mt-1 font-display text-xl font-bold text-[var(--color-navy)]">
          Capture photos for this chart
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Photos save directly to the patient chart on the provider&apos;s screen.
          Pairing expires 30 minutes after the QR was generated.
        </p>

        {savedCount > 0 && (
          <div className="mt-3 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Saved {savedCount} {savedCount === 1 ? "photo" : "photos"} to the chart.
          </div>
        )}

        {phase === "idle" && (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="mt-5 w-full rounded-md bg-[var(--color-navy)] px-4 py-3 text-sm font-semibold text-[var(--color-cream)]"
          >
            Start camera
          </button>
        )}

        {(phase === "starting" || phase === "live" || phase === "captured" || phase === "uploading") && (
          <div className="mt-4">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`block w-full ${phase === "captured" ? "hidden" : ""}`}
              />
              {phase === "captured" && capturedPreview && (
                <img src={capturedPreview} alt="Captured" className="block w-full" />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {phase === "live" && (
                <button
                  type="button"
                  onClick={capture}
                  className="flex-1 rounded-md bg-[var(--color-gold)] px-4 py-3 text-sm font-bold text-[var(--color-navy-deep)]"
                >
                  ⚪ Capture
                </button>
              )}
              {phase === "captured" && (
                <>
                  <button
                    type="button"
                    onClick={() => void keepAndUpload()}
                    className="flex-1 rounded-md bg-[var(--color-navy)] px-4 py-3 text-sm font-semibold text-[var(--color-cream)]"
                  >
                    ✓ Save to chart
                  </button>
                  <button
                    type="button"
                    onClick={retake}
                    className="rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-navy)]"
                  >
                    ↻ Retake
                  </button>
                </>
              )}
              {phase === "uploading" && (
                <span className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-teal)]" />
                  Saving…
                </span>
              )}
            </div>
          </div>
        )}

        {phase === "expired" && (
          <div className="mt-5 rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-3 text-sm text-rose-900">
            <strong className="block font-semibold">This pairing link has expired</strong>
            <span>Ask the provider to generate a new QR — pairings last 30 minutes.</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {error}
          </div>
        )}

        <p className="mt-6 text-center text-[10px] text-[var(--color-ink-muted)]">
          Photos upload over TLS to your clinic&apos;s encrypted Cloud Storage. Token expires 30 minutes after creation.
        </p>
      </div>
    </div>
  );
}
