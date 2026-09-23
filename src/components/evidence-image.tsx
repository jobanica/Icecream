"use client";

import { useState } from "react";
import { ImageOff, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Thumbnail of an evidence photo; tap to view full screen. */
export function EvidenceImage({ url, alt, className }: { url?: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (!url || failed) {
    return (
      <div className={cn("flex items-center justify-center gap-1 rounded-lg bg-muted text-xs text-muted-foreground", className ?? "h-24 w-full")}>
        <ImageOff className="size-4" /> No photo
      </div>
    );
  }
  const isPdf = url.split("?")[0].endsWith(".pdf");
  if (isPdf) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={cn("flex items-center justify-center rounded-lg bg-muted text-sm underline", className ?? "h-24 w-full")}>
        Open PDF
      </a>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("overflow-hidden rounded-lg bg-muted", className ?? "h-24 w-full")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2" onClick={() => setOpen(false)}>
          <button type="button" className="absolute right-3 top-3 rounded-full bg-white/20 p-2 text-white" aria-label="Close">
            <X className="size-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </>
  );
}
