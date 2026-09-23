import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, peso } from "@/lib/format";
import { resolveRange } from "@/lib/range";
import { Card, CardContent } from "@/components/ui/card";
import { RangeFilter } from "@/components/range-filter";
import { Pill } from "@/components/status";
import { cn } from "@/lib/utils";

type Row = {
  location_id: string;
  code: string;
  store_name: string;
  status: string;
  days: number;
  complete_days: number;
  sales_centavos: number;
  verified_centavos: number;
  sales_days: number;
  remit_verified_days: number;
  remit_sent_days: number;
  matched_days: number;
  minor_days: number;
  major_days: number;
  open_discrepancies: number;
  last_audit_score: string | null;
  last_audit_date: string | null;
  net_profit_centavos: number;
  partner_share_paid_centavos: number;
  partner_share_pending_centavos: number;
  outstanding_all_time_centavos: number;
  stock_low: number;
  stock_out: number;
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", tone === "red" && "text-red-600", tone === "amber" && "text-amber-700", tone === "green" && "text-emerald-700")}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireRole("admin");
  const range = resolveRange(await searchParams);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary", { p_from: range.from, p_to: range.to });
  const rows = (data ?? []) as Row[];
  const sum = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const checked = sum("matched_days") + sum("minor_days") + sum("major_days");
  const q = range.key === "custom" ? `from=${range.from}&to=${range.to}` : `range=${range.key}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {fmtDate(range.from)} – {fmtDate(range.to, { year: true })}
          </p>
        </div>
        <Link href={`/admin/export?${q}`} className="text-sm underline">
          Export CSV
        </Link>
      </div>
      <RangeFilter base="/admin/dashboard" range={range} />
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Sales" value={peso(sum("sales_centavos"))} sub={`${rows.length} locations`} />
        <Tile label="Remitted & verified" value={peso(sum("verified_centavos"))} sub={`${pct(sum("remit_verified_days"), sum("sales_days")) ?? "—"}% of sales days`} />
        <Tile
          label="Outstanding (all time)"
          value={peso(sum("outstanding_all_time_centavos"))}
          tone={sum("outstanding_all_time_centavos") > 0 ? "amber" : "green"}
          sub="sales not yet verified"
        />
        <Tile label="Matched days" value={`${pct(sum("matched_days"), checked) ?? "—"}%`} sub={`${sum("matched_days")} of ${checked} checked days`} />
        <Tile label="Open discrepancies" value={String(sum("open_discrepancies"))} tone={sum("open_discrepancies") ? "amber" : "green"} sub="unresolved, all time" />
        <Tile label="Partner shares" value={peso(sum("partner_share_paid_centavos"))} sub={`paid · ${peso(sum("partner_share_pending_centavos"))} pending`} />
      </div>

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Location</th>
                <th className="py-2 text-right font-medium">Sales</th>
                <th className="py-2 text-right font-medium">Remittance</th>
                <th className="py-2 text-right font-medium">Days complete</th>
                <th className="py-2 text-right font-medium">Daily checks</th>
                <th className="py-2 text-right font-medium">Open flags</th>
                <th className="py-2 text-right font-medium">Last audit</th>
                <th className="py-2 text-right font-medium">Net profit</th>
                <th className="py-2 text-right font-medium">Shares paid / pending</th>
                <th className="py-2 text-center font-medium">Stock</th>
                <th className="py-2 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const comp = pct(r.remit_verified_days, r.sales_days);
                const missed = r.days - r.complete_days;
                const chk = r.matched_days + r.minor_days + r.major_days;
                return (
                  <tr key={r.location_id} className="border-t align-top">
                    <td className="py-2">
                      <Link href={`/admin/locations/${r.location_id}/insights?${q}`} className="font-medium underline">
                        {r.code}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.store_name}</div>
                      {r.status !== "active" && <Pill>{r.status}</Pill>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{peso(r.sales_centavos)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {peso(r.verified_centavos)}
                      <div className={cn("text-xs", comp != null && comp < 100 ? "text-amber-700" : "text-muted-foreground")}>
                        {comp ?? "—"}% verified · {r.remit_sent_days - r.remit_verified_days} waiting
                      </div>
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", missed > 0 && "text-red-600")}>
                      {r.complete_days}/{r.days}
                      {missed > 0 && <div className="text-xs">{missed} missed</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      ✅ {r.matched_days}/{chk}
                      <div className="text-xs text-muted-foreground">
                        {r.minor_days} minor · {r.major_days} major
                      </div>
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", r.open_discrepancies > 0 && "font-semibold text-amber-700")}>{r.open_discrepancies}</td>
                    <td className="py-2 text-right">
                      {r.last_audit_score ?? "—"}
                      <div className="text-xs text-muted-foreground">{r.last_audit_date ? fmtDate(r.last_audit_date) : "never"}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.net_profit_centavos ? peso(r.net_profit_centavos) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {peso(r.partner_share_paid_centavos)}
                      <div className="text-xs text-muted-foreground">{peso(r.partner_share_pending_centavos)} pending</div>
                    </td>
                    <td className="py-2 text-center" title={`${r.stock_out} out, ${r.stock_low} low`}>
                      {r.stock_out > 0 ? "🔴" : r.stock_low > 0 ? "🟡" : "🟢"}
                      <div className="text-xs text-muted-foreground">{r.stock_out + r.stock_low > 0 ? `${r.stock_out} out · ${r.stock_low} low` : "ok"}</div>
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", r.outstanding_all_time_centavos > 0 && "text-amber-700")}>{peso(r.outstanding_all_time_centavos)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">No active locations.</p>}
          <p className="pt-2 text-xs text-muted-foreground">
            Net profit and shares come from reconciliations whose period ends in the selected range. &quot;Days complete&quot; = counter, count, sales and a sent remittance.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
