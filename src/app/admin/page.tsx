import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signEvidence } from "@/lib/evidence";
import { addDays, fmtDate, fmtDateTime, peso, todayPH } from "@/lib/format";
import { missingSteps } from "@/lib/daily";
import type { DailyCheck, DailyStatusRow, PaymentMethod } from "@/lib/types";
import { METHOD_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceImage } from "@/components/evidence-image";
import { CheckPill, Pill } from "@/components/status";
import { RemittanceActions, ResolveCheck, CorrectionActions } from "./inbox-actions";

export default async function AdminInbox() {
  await requireRole("admin");
  const supabase = await createClient();
  const today = todayPH();

  const [remits, checks, status, corrections, disputes, locs] = await Promise.all([
    supabase.from("daily_remittances").select("*").eq("status", "submitted").order("business_date"),
    supabase.from("daily_checks").select("*").in("status", ["minor", "major"]).is("resolved_at", null).order("business_date"),
    supabase.from("v_daily_status").select("*").gte("business_date", addDays(today, -14)).order("business_date", { ascending: false }),
    supabase.from("sales_report_corrections").select("*, daily_sales_reports(net_sales_centavos, report_type)").eq("status", "pending"),
    supabase.from("deliveries").select("id, location_id, business_date, partner_note").eq("status", "disputed"),
    supabase.from("locations").select("id, code, store_name"),
  ]);
  const locBy = new Map((locs.data ?? []).map((l) => [l.id, l]));
  const checkRows = (checks.data ?? []) as DailyCheck[];

  // counter readings for discrepancy days (photos)
  const readingsRes = checkRows.length
    ? await supabase
        .from("counter_readings")
        .select("location_id, business_date, reading, submitted_reading, previous_reading, delta, photo_path, flags")
        .in("location_id", [...new Set(checkRows.map((c) => c.location_id))])
        .in("business_date", [...new Set(checkRows.map((c) => c.business_date))])
    : { data: [] };
  const readings = readingsRes.data ?? [];
  const urls = await signEvidence(supabase, [
    ...(remits.data ?? []).map((r) => r.receipt_path),
    ...readings.map((r) => r.photo_path),
  ]);

  const statusRows = (status.data ?? []) as DailyStatusRow[];
  const todayRows = statusRows.filter((r) => r.business_date === today);
  const missed = statusRows.filter((r) => r.business_date < today && missingSteps(r).length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">Daily inbox</h1>
        <p className="text-sm text-muted-foreground">{fmtDate(today, { year: true })} · Asia/Manila</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {todayRows.map((r) => (
              <Link key={r.location_id} href={`/admin/locations/${r.location_id}`} className="rounded-lg border p-3 hover:bg-muted/50">
                <div className="flex justify-between text-sm font-semibold">
                  <span>
                    {r.location_code} · {r.store_name}
                  </span>
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <span>{r.has_counter ? "✅" : "⬜"} Counter</span>
                  <span>{r.has_count ? "✅" : "⬜"} Count</span>
                  <span>{r.has_sales ? "✅" : "⬜"} Sales</span>
                  <span>{r.remittance_status === "verified" ? "✅" : r.remittance_status === "submitted" ? "⏳" : "⬜"} Remit</span>
                </div>
              </Link>
            ))}
            {todayRows.length === 0 && <p className="text-sm text-muted-foreground">No active locations.</p>}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Remittances to verify <Pill t={(remits.data ?? []).length ? "blue" : "gray"}>{(remits.data ?? []).length}</Pill>
        </h2>
        {(remits.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">All caught up.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {(remits.data ?? []).map((r) => {
            const l = locBy.get(r.location_id);
            const mismatch = r.amount_sent_centavos !== r.amount_due_centavos;
            return (
              <Card key={r.id}>
                <CardContent className="grid grid-cols-[1fr_120px] gap-3">
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">
                      {l?.code} · {fmtDate(r.business_date)}
                    </div>
                    <div>
                      Due <b>{peso(r.amount_due_centavos)}</b>
                    </div>
                    <div className={mismatch ? "font-semibold text-red-600" : ""}>
                      Sent {peso(r.amount_sent_centavos)} {mismatch && "⚠️"}
                    </div>
                    <div className="text-muted-foreground">
                      {METHOD_LABELS[r.method as PaymentMethod]} · Ref <span className="font-mono">{r.reference_no}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Sent {fmtDateTime(r.submitted_at)}
                      {r.attempts > 1 && ` · attempt #${r.attempts}`}
                    </div>
                  </div>
                  <EvidenceImage url={urls[r.receipt_path]} alt="Receipt" className="h-36 w-full" />
                  <div className="col-span-2">
                    <RemittanceActions id={r.id} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Discrepancy queue <Pill t={checkRows.length ? "amber" : "gray"}>{checkRows.length}</Pill>
        </h2>
        {checkRows.length === 0 && <p className="text-sm text-muted-foreground">No open discrepancies.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {checkRows.map((c) => {
            const l = locBy.get(c.location_id);
            const rs = readings.filter((r) => r.location_id === c.location_id && r.business_date === c.business_date);
            return (
              <Card key={c.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">
                      {l?.code} · {fmtDate(c.business_date)}
                    </div>
                    <CheckPill status={c.status} />
                  </div>
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <Big label="Counter" v={c.counter_delta} />
                      <Big label="Sales" v={c.reported_servings} />
                      <Big label="Cones+cups" v={c.container_servings} />
                      <div className="col-span-3 text-left text-xs text-muted-foreground">
                        Counter−Sales {sign(c.diff_counter_sales)} · Counter−Containers {sign(c.diff_counter_containers)} · Sales−Containers{" "}
                        {sign(c.diff_sales_containers)}
                        <br />
                        Cones {c.cones_used} (expected {c.expected_cones}) · Cups {c.cups_used} (expected {c.expected_cups}) · tolerance ±{c.tolerance_servings}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {rs.map((r) => (
                        <div key={r.photo_path}>
                          <EvidenceImage url={urls[r.photo_path]} alt="Counter photo" className="h-24 w-full" />
                          <div className="text-center text-xs tabular-nums">
                            {r.previous_reading} → {r.reading}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted p-2 text-sm">
                    <span className="text-xs text-muted-foreground">Store says: </span>
                    {c.partner_explanation ?? <i className="text-muted-foreground">no explanation</i>}
                  </div>
                  <ResolveCheck id={c.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Missed / incomplete days (last 14) <Pill t={missed.length ? "red" : "gray"}>{missed.length}</Pill>
        </h2>
        {missed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every store completed every day.</p>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y text-sm">
                {missed.map((r) => (
                  <li key={r.location_id + r.business_date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/locations/${r.location_id}`} className="font-medium">
                      {r.location_code} · {fmtDate(r.business_date)}
                    </Link>
                    <span className="flex flex-wrap gap-1">
                      {missingSteps(r).map((m) => (
                        <Pill key={m} t="red">
                          {m === "Remit" && r.remittance_status === "rejected" ? "Remit (rejected)" : m}
                        </Pill>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {((corrections.data ?? []).length > 0 || (disputes.data ?? []).length > 0) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Other requests</h2>
          {(corrections.data ?? []).map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 text-sm">
                <div className="font-semibold">
                  Sales correction · {locBy.get(c.location_id)?.code} · {fmtDate(c.business_date)}
                </div>
                <p>Reason: {c.reason}</p>
                <p className="text-muted-foreground">
                  Current net {peso(c.daily_sales_reports?.net_sales_centavos)} → proposed cash {peso(c.proposed.cash)} + GCash {peso(c.proposed.gcash)} + other{" "}
                  {peso(c.proposed.other)}
                </p>
                <CorrectionActions id={c.id} />
              </CardContent>
            </Card>
          ))}
          {(disputes.data ?? []).map((d) => (
            <Card key={d.id}>
              <CardContent className="text-sm">
                <b>Delivery problem</b> · {locBy.get(d.location_id)?.code} · {fmtDate(d.business_date)} — {d.partner_note}{" "}
                <Link href="/admin/deliveries" className="underline">
                  Review
                </Link>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

function sign(n: number | null) {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : String(n);
}

function Big({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="rounded-md bg-muted p-1.5">
      <div className="text-xl font-bold tabular-nums">{v ?? "—"}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
