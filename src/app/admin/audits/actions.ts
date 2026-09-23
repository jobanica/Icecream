"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { ActionResult } from "@/components/action-form";

export async function scheduleAudit(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin", "staff");
  const supabase = await createClient();
  const start = String(fd.get("period_start") ?? "");
  const end = String(fd.get("period_end") ?? "");
  if (!start || !end || end < start) return { error: "Choose a valid period", at: Date.now() };
  const { data, error } = await supabase.rpc("create_audit", {
    p_location_id: String(fd.get("location_id") ?? ""),
    p_period_start: start,
    p_period_end: end,
    p_scheduled_for: String(fd.get("scheduled_for") ?? "") || null,
  });
  if (error) return { error: error.message, at: Date.now() };
  revalidatePath("/admin/audits");
  redirect(`/admin/audits/${data.id}`);
}

export async function createReconciliation(auditId: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_reconciliation", { p_audit_id: auditId });
  if (error) return { error: error.message, at: Date.now() };
  redirect(`/admin/reconciliations/${data.id}`);
}
