"use client";

import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

export type EvidenceKind = "counter" | "receipt" | "machine" | "installation" | "audit" | "payout" | "delivery" | "condition";

/**
 * Compresses a photo on the phone (≈300 KB, max 1600px) and uploads it to
 * evidence/<locationId>/<kind>/<date>/<uuid>.jpg. Returns the storage path.
 */
export async function uploadEvidence(file: File, locationId: string, kind: EvidenceKind, date: string): Promise<string> {
  let body: Blob = file;
  if (file.type.startsWith("image/")) {
    body = await imageCompression(file, {
      maxSizeMB: 0.3,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.8,
    });
  }
  const ext = file.type === "application/pdf" ? "pdf" : "jpg";
  const path = `${locationId}/${kind}/${date}/${crypto.randomUUID()}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("evidence").upload(path, body, {
    contentType: ext === "pdf" ? "application/pdf" : "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}. Check your internet and try again.`);
  return path;
}
