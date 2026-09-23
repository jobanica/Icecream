import type { StockRow } from "@/lib/types";

/** Suggested replenishment: up to par level, or 2× reorder point when no par level is set. */
export function suggestQty(s: StockRow): number {
  if (s.stock_status === "ok") return 0;
  const target = Number(s.par_level) > 0 ? Number(s.par_level) : Number(s.reorder_point) * 2;
  const q = target - Number(s.on_hand);
  if (q <= 0) return 0;
  return Math.ceil(q);
}
