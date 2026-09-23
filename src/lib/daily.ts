import type { DailyStatusRow } from "@/lib/types";

/** Which end-of-day steps are still missing for a day */
export function missingSteps(r: DailyStatusRow): string[] {
  const m: string[] = [];
  if (!r.has_counter) m.push("Counter");
  if (!r.has_count) m.push("Count");
  if (!r.has_sales) m.push("Sales");
  if (r.remittance_status !== "verified" && r.remittance_status !== "submitted") m.push("Remit");
  return m;
}
