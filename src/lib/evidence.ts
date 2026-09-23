import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EVIDENCE_BUCKET = "evidence";

/** Signed URLs (1 hour) for evidence photos the caller is allowed to read (RLS on storage). */
export async function signEvidence(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(unique, 3600);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) map[row.path] = row.signedUrl;
  }
  return map;
}
