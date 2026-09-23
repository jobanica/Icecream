"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { uploadEvidence, type EvidenceKind } from "@/lib/upload";
import { cn } from "@/lib/utils";

/**
 * Big tap-target that opens the phone camera, compresses and uploads the
 * photo, and reports the storage path via onUploaded.
 */
export function PhotoCapture({
  locationId,
  kind,
  date,
  label,
  value,
  onUploaded,
  allowPdf = false,
  source = "camera",
  className,
}: {
  locationId: string;
  kind: EvidenceKind;
  date: string;
  label: string;
  value: string | null;
  onUploaded: (path: string | null) => void;
  allowPdf?: boolean;
  /** "camera" opens the camera directly; "any" also allows gallery screenshots */
  source?: "camera" | "any";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onUploaded(null);
    try {
      if (file.type.startsWith("image/")) setPreview(URL.createObjectURL(file));
      else setPreview(null);
      const path = await uploadEvidence(file, locationId, kind, date);
      onUploaded(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setPreview(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={allowPdf ? "image/*,application/pdf" : "image/*"}
        capture={source === "camera" ? "environment" : undefined}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(
          "relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed p-4 text-sm font-medium",
          value ? "border-emerald-500 bg-emerald-50" : "border-muted-foreground/30 bg-background",
          preview ? "h-48" : "h-28",
        )}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        )}
        <span className="relative flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 shadow-sm">
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin" /> Uploading…
            </>
          ) : value ? (
            <>
              <RotateCcw className="size-5" /> Photo saved ✓ — tap to retake
            </>
          ) : (
            <>
              <Camera className="size-5" /> {label}
            </>
          )}
        </span>
      </button>
      {value && !preview && <p className="text-xs text-emerald-700">File uploaded ✓</p>}
    </div>
  );
}
