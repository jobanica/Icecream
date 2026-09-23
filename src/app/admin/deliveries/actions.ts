"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { parsePeso } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

export async function recordDelivery(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin", "staff");
  const locationId = String(fd.get("location_id") ?? "");
  if (!locationId) return { error: "Choose a location", at: Date.now() };
  const lines: { item_id: string; qty: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("qty_") && Number(v) > 0) lines.push({ item_id: k.slice(4), qty: Number(v) });
  }
  const fee = parsePeso(String(fd.get("fee") ?? ""));
  if (fee == null) return { error: "Invalid delivery fee", at: Date.now() };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_delivery", {
    p_location_id: locationId,
    p_business_date: String(fd.get("date")),
    p_lines: lines,
    p_delivery_fee_centavos: fee,
    p_notes: String(fd.get("notes") ?? "") || null,
  });
  if (error) return { error: error.message, at: Date.now() };
  revalidatePath("/admin/deliveries");
  revalidatePath("/admin/stock");
  return { ok: "Delivery recorded — stock updated. Store will confirm in the app.", at: Date.now() };
}
