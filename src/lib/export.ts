import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Export datasets. `date` is the column used for the from/to filter:
 * a plain date column, a timestamp ("ts:"), or a column on an embedded
 * parent ("parent.column", fetched with !inner so the filter applies).
 */
export type Dataset = {
  key: string;
  label: string;
  table: string;
  select?: string;
  date?: string;
  location?: string | null; // column (or parent.column) for the location filter; null = not filterable
  order?: string;
};

const withLoc = "*, locations(code)";

export const DATASETS: Dataset[] = [
  { key: "locations", label: "Locations (partner files)", table: "locations", location: "id", order: "code" },
  { key: "machines", label: "Machines", table: "machines", select: withLoc, order: "serial_number" },
  { key: "machine_events", label: "Machine events (resets, maintenance…)", table: "machine_events", select: withLoc, date: "ts:occurred_at", order: "occurred_at" },
  { key: "products", label: "Products & prices", table: "products", select: withLoc, order: "location_id" },
  { key: "inventory_items", label: "Supply items", table: "inventory_items", location: null, order: "sort_order" },
  { key: "counter_readings", label: "Counter readings", table: "counter_readings", select: withLoc, date: "business_date", order: "business_date" },
  { key: "container_counts", label: "Daily cone/cup counts", table: "daily_container_counts", select: withLoc, date: "business_date", order: "business_date" },
  { key: "sales_reports", label: "Daily sales reports", table: "daily_sales_reports", select: withLoc, date: "business_date", order: "business_date" },
  { key: "sales_lines", label: "Sales line items", table: "daily_sales_lines", select: "*, locations(code), daily_sales_reports!inner(business_date)", date: "daily_sales_reports.business_date", order: "report_id" },
  { key: "sales_corrections", label: "Sales corrections", table: "sales_report_corrections", select: withLoc, date: "business_date", order: "business_date" },
  { key: "daily_checks", label: "Three-way daily checks", table: "daily_checks", select: withLoc, date: "business_date", order: "business_date" },
  { key: "remittances", label: "Remittances", table: "daily_remittances", select: withLoc, date: "business_date", order: "business_date" },
  { key: "remittance_submissions", label: "Remittance submissions (every attempt)", table: "remittance_submissions", select: withLoc, date: "ts:submitted_at", order: "submitted_at" },
  { key: "deliveries", label: "Deliveries", table: "deliveries", select: withLoc, date: "business_date", order: "business_date" },
  { key: "delivery_lines", label: "Delivery line items", table: "delivery_lines", select: "*, inventory_items(name), deliveries!inner(business_date, location_id, status)", date: "deliveries.business_date", location: "deliveries.location_id", order: "delivery_id" },
  { key: "stock_movements", label: "Stock movements (ledger)", table: "stock_movements", select: "*, locations(code), inventory_items(name)", date: "business_date", order: "business_date" },
  { key: "stock_on_hand", label: "Stock on hand (now)", table: "v_stock_on_hand", select: "*", order: "location_code" },
  { key: "audits", label: "Weekly audits", table: "weekly_audits", select: withLoc, date: "period_end", order: "period_end" },
  { key: "audit_items", label: "Audit checklist answers", table: "audit_items", select: "*, locations(code), weekly_audits!inner(period_end)", date: "weekly_audits.period_end", order: "audit_id" },
  { key: "audit_findings", label: "Audit findings", table: "audit_findings", select: withLoc, date: "ts:created_at", order: "created_at" },
  { key: "inventory_counts", label: "Full inventory count lines", table: "inventory_count_lines", select: "*, locations(code), inventory_items(name), inventory_counts!inner(business_date, audit_id)", date: "inventory_counts.business_date", order: "count_id" },
  { key: "reconciliations", label: "Reconciliations", table: "reconciliations", select: withLoc, date: "period_end", order: "period_end" },
  { key: "reconciliation_adjustments", label: "Reconciliation adjustments", table: "reconciliation_adjustments", select: withLoc, date: "ts:created_at", order: "created_at" },
  { key: "statements", label: "Partner statements", table: "partner_statements", select: withLoc, date: "period_end", order: "period_end" },
  { key: "payouts", label: "Payouts", table: "payouts", select: withLoc, date: "paid_on", order: "paid_on" },
  { key: "activity_log", label: "Activity log (every change)", table: "activity_log", date: "ts:occurred_at", order: "id" },
];

export type ExportFilter = { from?: string; to?: string; location?: string };

function flatten(row: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k;
    // embedded parent rows (locations(code) etc.) become columns
    if (v && typeof v === "object" && !Array.isArray(v) && !prefix && /^(locations|inventory_items|daily_sales_reports|deliveries|weekly_audits|inventory_counts)$/.test(k)) {
      flatten(v as Record<string, unknown>, k, out);
    } else out[key] = v;
  }
  return out;
}

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildCsv(supabase: SupabaseClient, ds: Dataset, f: ExportFilter): Promise<{ csv: string; rows: number }> {
  const rows: Record<string, unknown>[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    let q = supabase.from(ds.table).select(ds.select ?? "*");
    if (ds.date && f.from && f.to) {
      if (ds.date.startsWith("ts:")) {
        const col = ds.date.slice(3);
        q = q.gte(col, `${f.from}T00:00:00+08:00`).lt(col, `${nextDay(f.to)}T00:00:00+08:00`);
      } else {
        q = q.gte(ds.date, f.from).lte(ds.date, f.to);
      }
    }
    if (f.location && ds.location !== null) q = q.eq(ds.location ?? "location_id", f.location);
    if (ds.order) q = q.order(ds.order);
    const { data, error } = await q.range(offset, offset + page - 1);
    if (error) throw new Error(`${ds.key}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]).map((r) => flatten(r)));
    if (!data || data.length < page) break;
  }
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // money columns get a pesos twin so the sheet is readable without dividing
  const money = cols.filter((c) => c.endsWith("_centavos"));
  const header = [...cols, ...money.map((c) => c.replace(/_centavos$/, "_php"))];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([...cols.map((c) => cell(r[c])), ...money.map((c) => (r[c] == null ? "" : (Number(r[c]) / 100).toFixed(2)))].join(","));
  }
  // BOM so Excel opens UTF-8 (₱, ñ) correctly
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", rows: rows.length };
}

function nextDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
