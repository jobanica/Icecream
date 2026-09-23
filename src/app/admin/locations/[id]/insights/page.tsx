import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, num, peso } from "@/lib/format";
import { resolveRange } from "@/lib/range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeFilter } from "@/components/range-filter";
import { TrendChart } from "@/components/trend-chart";
import { Pill } from "@/components/status";

type Trend = {
  business_date: string;
  sales_centavos: number | null;
  counter_delta: number | null;
  reported_servings: number | null;
  container_servings: number | null;
  check_status: string | null;
  remittance_status: string | null;
};
type Hist = {
  audit_id: string;
  period_start: string;
  period_end: string;
  score_passed: number;
  score_total: number;
  findings_major: number;
  findings_minor: number;
  findings_info: number;
  checked_days: number;
  discrepancy_days: number;
  reconciliation_status: string | null;
  partner_payable_centavos: number | null;
};

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const profile = await requireRole("admin", "staff");
  const { id } = await params;
  const range = resolveRange(await searchParams, "30d");
  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("id, code, store_name, partner_name").eq("id", id).maybeSingle();
  if (!loc) notFound();
  const [trend, hist, recurring] = await Promise.all([
    supabase.rpc("location_trend", { p_location_id: id, p_from: range.from, p_to: range.to }),
    supabase.rpc("audit_history", { p_location_id: id }),
    supabase.rpc("recurring_audit_failures", { p_location_id: id }),
  ]);
  const t = (trend.data ?? []) as Trend[];
  const h = (hist.data ?? []) as Hist[];
  const dates = t.map((r) => r.business_date);
  const sales = t.reduce((s, r) => s + Number(r.sales_centavos ?? 0), 0);
  const checked = t.filter((r) => r.check_status && r.check_status !== "incomplete");
  const mismatched = checked.filter((r) => r.check_status !== "matched").length;
  const counter = t.reduce((s, r) => s + Number(r.counter_delta ?? 0), 0);
  const reported = t.reduce((s, r) => s + Number(r.reported_servings ?? 0), 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/locations/${id}`} className="text-xs text-muted-foreground underline">
          ← {loc.code}
        </Link>
        <h1 className="text-2xl font-bold">
          {loc.code} · {loc.store_name} — insights
        </h1>
      </div>
      <RangeFilter base={`/admin/locations/${id}/insights`} range={range} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sales" value={peso(sales)} />
        <Stat label="Avg per trading day" value={peso(Math.round(sales / Math.max(1, t.filter((r) => r.sales_centavos != null).length)))} />
        <Stat label="Counter vs reported servings" value={`${num(counter)} / ${num(reported)}`} sub={counter - reported ? `${counter - reported > 0 ? "+" : ""}${counter - reported} unreported` : "exact"} />
        <Stat label="Discrepancy rate" value={checked.length ? `${Math.round((mismatched / checked.length) * 100)}%` : "—"} sub={`${mismatched} of ${checked.length} checked days`} />
      </div>

      <Card>
        <CardContent className="space-y-6">
          <TrendChart title="Daily sales" dates={dates} kind="bar" unit="peso" series={[{ key: "sales", label: "Sales", values: t.map((r) => r.sales_centavos) }]} />
          <TrendChart
            title="Servings per day: counter vs sales vs cones + cups"
            dates={dates}
            series={[
              { key: "counter", label: "Counter", values: t.map((r) => r.counter_delta) },
              { key: "sales", label: "Sales report", values: t.map((r) => r.reported_servings) },
              { key: "containers", label: "Cones+cups", values: t.map((r) => r.container_servings) },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            When all three lines sit on top of each other the day matched. A gap between Counter and the others means servings left the machine without being reported.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {h.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed audits yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Period</th>
                  <th className="py-1.5 font-medium">Score</th>
                  <th className="py-1.5 font-medium">Discrepancy days</th>
                  <th className="py-1.5 text-right font-medium">Findings</th>
                  <th className="py-1.5 text-right font-medium">Payout</th>
                </tr>
              </thead>
              <tbody>
                {h.map((a) => {
                  const score = a.score_total ? a.score_passed / a.score_total : 0;
                  const rate = a.checked_days ? a.discrepancy_days / a.checked_days : 0;
                  return (
                    <tr key={a.audit_id} className="border-t">
                      <td className="py-2">
                        <Link href={`/admin/audits/${a.audit_id}`} className="underline">
                          {fmtDate(a.period_start)} – {fmtDate(a.period_end)}
                        </Link>
                      </td>
                      <td className="py-2">
                        <Bar value={score} label={`${a.score_passed}/${a.score_total}`} color="#2a78d6" />
                      </td>
                      <td className="py-2">
                        <Bar value={rate} label={`${a.discrepancy_days}/${a.checked_days}`} color="#eb6834" />
                      </td>
                      <td className="py-2 text-right text-xs">
                        {a.findings_major > 0 && <Pill t="red">{a.findings_major} major</Pill>} {a.findings_minor > 0 && <Pill t="amber">{a.findings_minor} minor</Pill>}{" "}
                        {a.findings_info > 0 && <Pill t="blue">{a.findings_info} info</Pill>}
                      </td>
                      <td className="py-2 text-right text-xs">
                        {a.reconciliation_status ? (
                          <>
                            {peso(a.partner_payable_centavos)} <Pill t={a.reconciliation_status === "paid" ? "green" : "gray"}>{a.reconciliation_status}</Pill>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recurring checklist failures</CardTitle>
        </CardHeader>
        <CardContent>
          {(recurring.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed checklist items.</p>
          ) : (
            <ul className="divide-y text-sm">
              {(recurring.data as { item_key: string; label: string; section: string; fail_count: number; audits: number; last_failed: string; last_notes: string | null }[]).map((r) => (
                <li key={r.item_key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <span>
                    <span className="text-xs uppercase text-muted-foreground">{r.section}</span> {r.label}
                    {r.last_notes && <span className="block text-xs text-muted-foreground">Last: {r.last_notes}</span>}
                  </span>
                  <Pill t={r.fail_count > 1 ? "red" : "amber"}>
                    failed {r.fail_count} of {r.audits} audit{r.audits > 1 ? "s" : ""}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {profile.role === "admin" && (
        <p className="text-xs text-muted-foreground">
          <Link href={`/admin/export?location=${id}&from=${range.from}&to=${range.to}`} className="underline">
            Export this location&apos;s data (CSV)
          </Link>
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Bar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums">{label}</span>
    </div>
  );
}
