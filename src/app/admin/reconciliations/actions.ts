"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { parsePeso } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

const fail = (error: string): ActionResult => ({ error, at: Date.now() });

export async function updateDeductions(id: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const keys = ["product_cost", "payment_fees", "maintenance_reserve", "wastage", "delivery_cost", "other_deductions"] as const;
  const vals: Record<string, number> = {};
  for (const k of keys) {
    const v = parsePeso(String(fd.get(k) ?? "0"));
    if (v == null) return fail(`Invalid amount for ${k.replace("_", " ")}`);
    vals[`p_${k}`] = v;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_reconciliation_deductions", { p_id: id, ...vals, p_notes: String(fd.get("notes") ?? "") || null });
  if (error) return fail(error.message);
  revalidatePath(`/admin/reconciliations/${id}`);
  return { ok: "Deductions updated", at: Date.now() };
}

export async function addAdjustment(id: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const amt = parsePeso(String(fd.get("amount") ?? ""));
  if (amt == null || amt === 0) return fail("Enter an amount");
  const sign = fd.get("direction") === "add" ? 1 : -1;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_reconciliation_adjustment", {
    p_id: id,
    p_amount_centavos: sign * amt,
    p_reason: String(fd.get("reason") ?? ""),
  });
  if (error) return fail(error.message);
  revalidatePath(`/admin/reconciliations/${id}`);
  return { ok: "Adjustment added", at: Date.now() };
}

export async function recordPayout(id: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const amount = parsePeso(String(fd.get("amount") ?? ""));
  if (amount == null) return fail("Invalid amount");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payout", {
    p_reconciliation_id: id,
    p_amount_centavos: amount,
    p_method: String(fd.get("method") ?? "gcash"),
    p_reference_no: String(fd.get("reference_no") ?? ""),
    p_proof_path: String(fd.get("proof_path") ?? "") || null,
    p_paid_on: String(fd.get("paid_on") ?? ""),
  });
  if (error) return fail(error.message);
  revalidatePath(`/admin/reconciliations/${id}`);
  return { ok: "Payout recorded — partner can now see it", at: Date.now() };
}

export async function discardDraft(id: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_draft_reconciliation", { p_id: id });
  if (error) return fail(error.message);
  redirect(`/admin/audits/${data}`);
}
