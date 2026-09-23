"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { parsePeso } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

export async function saveSettings(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const reserve = parsePeso(s(fd, "maintenance_reserve") ?? "0");
  if (reserve == null) return { error: "Invalid maintenance reserve", at: Date.now() };
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      business_name: s(fd, "business_name") ?? "Soft-Serve Partners",
      remit_gcash_name: s(fd, "remit_gcash_name"),
      remit_gcash_number: s(fd, "remit_gcash_number"),
      remit_bank_name: s(fd, "remit_bank_name"),
      remit_bank_account_name: s(fd, "remit_bank_account_name"),
      remit_bank_account_number: s(fd, "remit_bank_account_number"),
      gcash_fee_bps: Math.round(Number(s(fd, "gcash_fee_pct") ?? 0) * 100),
      other_fee_bps: Math.round(Number(s(fd, "other_fee_pct") ?? 0) * 100),
      maintenance_reserve_per_week_centavos: reserve,
      default_tolerance_servings: Number(s(fd, "default_tolerance_servings") ?? 3),
      default_major_threshold_servings: Number(s(fd, "default_major_threshold_servings") ?? 10),
    })
    .eq("id", 1);
  if (error) return { error: error.message, at: Date.now() };
  revalidatePath("/admin/settings");
  return { ok: "Settings saved", at: Date.now() };
}

export async function saveItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const cost = parsePeso(s(fd, "unit_cost") ?? "0");
  if (cost == null) return { error: "Invalid unit cost", at: Date.now() };
  const row = {
    name: s(fd, "name") ?? "",
    unit: s(fd, "unit") ?? "pc",
    yield_servings: Number(s(fd, "yield_servings") ?? 1),
    unit_cost_centavos: cost,
    container_type: s(fd, "container_type") ?? "none",
    is_premix: s(fd, "is_premix") === "true",
    default_reorder_point: Number(s(fd, "default_reorder_point") ?? 0),
    sort_order: Number(s(fd, "sort_order") ?? 0),
    is_active: s(fd, "is_active") !== "false",
  };
  if (!row.name) return { error: "Name is required", at: Date.now() };
  const supabase = await createClient();
  const id = s(fd, "id");
  const { error } = id ? await supabase.from("inventory_items").update(row).eq("id", id) : await supabase.from("inventory_items").insert(row);
  if (error) {
    const msg = error.message.includes("inventory_items_one_cone") ? "Only one active cone item and one active cup item are allowed" : error.message;
    return { error: msg, at: Date.now() };
  }
  revalidatePath("/admin/settings");
  return { ok: id ? "Item updated" : "Item added", at: Date.now() };
}
