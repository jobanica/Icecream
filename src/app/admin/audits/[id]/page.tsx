import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signEvidence } from "@/lib/evidence";
import { fmtDate, fmtDateTime, num, peso, todayPH } from "@/lib/format";
import type { DailyCheck } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CheckPill, Pill } from "@/components/status";
import { EvidenceImage } from "@/components/evidence-image";
import { RpcButton } from "@/components/rpc-button";
import { AuditSummaryView } from "@/components/audit-summary";
import { ResolveCheck } from "@/app/admin/inbox-actions";
import { SimpleActionButton } from "@/app/admin/locations/[id]/forms";
import { createReconciliation } from "../actions";
import { AuditNotes, ChecklistItem, FindingForm, InventoryCountForm, RemoveFinding } from "./audit-client";

const SECTIONS = [
  { key: "sales", label: "Sales" },
  { key: "remittances", label: "Remittances" },
  { key: "counter", label: "Counter" },
  { key: "inventory", label: "Inventory" },
  { key: "machine", label: "Machine" },
  { key: "finance", label: "Finance" },
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("admin", "staff");
  const { id } = await params;
  const supabase = await createClient();

  const { data: audit } = await supabase.from("weekly_audits").select("*, locations(id, code, store_name, partner_name)").eq("id", id).maybeSingle();
  if (!audit) notFound();
  const loc = audit.locations as { id: string; code: string; store_name: string; partner_name: string };
  const completed = audit.status === "completed";
  const inProgress = audit.status === "in_progress";

  if (completed) {
    const { data: recon } = await supabase.from("reconciliations").select("id, status").eq("audit_id", id).maybeSingle();
    return (
      <div className="space-y-5">
        <Header audit={audit} loc={loc} />
        {profile.role === "admin" && (
          <Card className="border-emerald-300">
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              {recon ? (
                <>
                  <span className="text-sm">
                    Reconciliation <Pill t={recon.status === "paid" ? "green" : "blue"}>{recon.status}</Pill>
                  </span>
                  <Link href={`/admin/reconciliations/${recon.id}`} className={buttonVariants()}>
                    Open reconciliation
                  </Link>
                </>
              ) : (
                <>
                  <span className="text-sm">Audit complete. Next: compute the profit split for this period.</span>
                  <SimpleActionButton action={createReconciliation.bind(null, id)}>Create reconciliation →</SimpleActionButton>
                </>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Audit summary (full)</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditSummaryView summary={audit.summary} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [items, findings, checks, readings, sheet, counts, totalsRes] = await Promise.all([
    supabase.from("audit_items").select("*").eq("audit_id", id).order("sort_order"),
    supabase.from("audit_findings").select("*").eq("audit_id", id).order("created_at"),
    supabase.from("daily_checks").select("*").eq("location_id", loc.id).gte("business_date", audit.period_start).lte("business_date", audit.period_end).order("business_date"),
    supabase.from("counter_readings").select("id, business_date, reading, submitted_reading, previous_reading, delta, photo_path, flags").eq("location_id", loc.id).gte("business_date", audit.period_start).lte("business_date", audit.period_end).order("business_date"),
    inProgress ? supabase.rpc("inventory_count_sheet", { p_location_id: loc.id, p_business_date: audit.period_end }) : Promise.resolve({ data: [] }),
    supabase.from("inventory_counts").select("id, business_date, created_at, inventory_count_lines(variance, expected_usage, actual_usage, unit_cost_centavos, inventory_items(name, unit, is_premix, yield_servings))").eq("audit_id", id).order("created_at", { ascending: false }).limit(1),
    supabase.rpc("audit_period_totals", { p_audit_id: id }),
  ]);
  const t = (totalsRes.data ?? {}) as any;
  const urls = await signEvidence(supabase, (readings.data ?? []).map((r) => r.photo_path));
  const checkRows = (checks.data ?? []) as DailyCheck[];
  const open = checkRows.filter((c) => (c.status === "minor" || c.status === "major") && !c.resolved_at);
  const lastCount = counts.data?.[0];
  const unanswered = (items.data ?? []).filter((i) => !i.result).length;

  const facts: Record<string, React.ReactNode> = {
    sales: (
      <>
        {t.sales?.reports} of {t.days} days reported ({t.sales?.closed_days} closed, {t.sales?.missing_days} missing) · net {peso(t.sales?.net_centavos)} · cash{" "}
        {peso(t.sales?.cash_centavos)} · GCash {peso(t.sales?.gcash_centavos)}
      </>
    ),
    remittances: (
      <>
        Verified {peso(t.remittances?.verified_centavos)} · outstanding{" "}
        <b className={t.remittances?.outstanding_centavos > 0 ? "text-red-600" : ""}>{peso(t.remittances?.outstanding_centavos)}</b> · {t.remittances?.verified_days} verified,{" "}
        {t.remittances?.submitted_days} waiting, {t.remittances?.pending_days} not sent, {t.remittances?.rejected_days} rejected
      </>
    ),
    counter: (
      <>
        {t.counter?.readings} readings ({t.counter?.missing_days} days missing), {t.counter?.photos} with photo · counter total <b>{num(t.three_way?.counter_delta)}</b> vs
        reported <b>{num(t.three_way?.reported_servings)}</b> vs cones+cups <b>{num(t.three_way?.container_servings)}</b>
      </>
    ),
    inventory: lastCount ? (
      <>
        Count saved {fmtDateTime(lastCount.created_at)}.{" "}
        {(lastCount.inventory_count_lines as any[])
          .filter((l) => l.inventory_items.is_premix)
          .map((l) => `Premix used ${num(l.actual_usage, 2)} vs expected ${num(l.expected_usage, 2)} from counter`)
          .join("; ")}
      </>
    ) : (
      <span className="text-amber-700">Full count not done yet (see below).</span>
    ),
    machine: <>Take condition photos with the camera button on each item.</>,
    finance: (
      <>
        Sales {peso(t.sales?.net_centavos)} · remitted {peso(t.remittances?.sent_centavos)} · over/short {peso(t.remittances?.over_short_centavos)}
      </>
    ),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header audit={audit} loc={loc} />

      {audit.status === "scheduled" && (
        <Card className="border-amber-300">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">Start when you are at the store.</span>
            <div className="flex gap-2">
              {profile.role === "admin" && (
                <RpcButton fn="delete_scheduled_audit" args={{ p_audit_id: id }} variant="outline" confirm="Delete this scheduled audit?" success="Deleted">
                  Delete
                </RpcButton>
              )}
              <RpcButton fn="start_audit" args={{ p_audit_id: id }} success="Audit started">
                Start audit
              </RpcButton>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Daily checks this period{" "}
            <Pill t={open.length ? "amber" : "green"}>{open.length ? `${open.length} unresolved` : "all resolved"}</Pill>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {checkRows.map((c) => (
              <span key={c.id} className="text-xs">
                {fmtDate(c.business_date).split(",")[0]} <CheckPill status={c.status} resolved={!!c.resolved_at} />
              </span>
            ))}
          </div>
          {open.map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <b>{fmtDate(c.business_date)}</b>
                <CheckPill status={c.status} />
              </div>
              <div>
                Counter {c.counter_delta} · sales {c.reported_servings} · cones+cups {c.container_servings} (off by {c.max_abs_diff})
              </div>
              <div className="text-muted-foreground">Store says: {c.partner_explanation ?? "—"}</div>
              <ResolveCheck id={c.id} />
            </div>
          ))}
        </CardContent>
      </Card>

      {SECTIONS.map((s) => (
        <Card key={s.key}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              {s.label}
              <span className="text-xs font-normal text-muted-foreground">
                {(items.data ?? []).filter((i) => i.section === s.key && i.result === "pass").length}/
                {(items.data ?? []).filter((i) => i.section === s.key).length} passed
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{facts[s.key]}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.key === "counter" && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Spot-check counter photos ({(readings.data ?? []).length})</summary>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(readings.data ?? []).map((r) => (
                    <div key={r.id} className="text-xs">
                      <EvidenceImage url={urls[r.photo_path]} alt={`Counter ${r.business_date}`} className="h-24 w-full" />
                      <div className="mt-0.5 tabular-nums">
                        {fmtDate(r.business_date)}: <b>{num(r.reading)}</b> (+{r.delta})
                        {r.submitted_reading !== r.reading && <span className="text-amber-700"> corrected from {num(r.submitted_reading)}</span>}
                        {r.flags.length > 0 && <span className="text-amber-700"> {r.flags.join(", ")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <ul className="divide-y">
              {(items.data ?? [])
                .filter((i) => i.section === s.key)
                .map((i) => (
                  <ChecklistItem key={i.id} item={i} locationId={loc.id} date={todayPH()} editable={inProgress} />
                ))}
            </ul>
            {s.key === "inventory" && inProgress && (
              <details open={!lastCount}>
                <summary className="cursor-pointer text-sm font-medium">{lastCount ? "Recount inventory" : "Full inventory count"}</summary>
                <div className="mt-2">
                  <InventoryCountForm auditId={id} locationId={loc.id} date={audit.period_end} sheet={(sheet.data ?? []) as any[]} alreadyCounted={!!lastCount} />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Findings & action items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {(findings.data ?? []).map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <Pill t={f.severity === "major" ? "red" : f.severity === "minor" ? "amber" : "blue"}>{f.severity}</Pill> {f.description}
                  {f.action_item && <span className="block text-xs text-muted-foreground">→ {f.action_item}</span>}
                </span>
                {inProgress && <RemoveFinding id={f.id} />}
              </li>
            ))}
          </ul>
          {inProgress && <FindingForm auditId={id} />}
          {inProgress && <AuditNotes auditId={id} initial={audit.notes} />}
        </CardContent>
      </Card>

      {inProgress && (
        <Card className="border-primary">
          <CardContent className="space-y-2">
            {unanswered > 0 && <p className="text-sm text-amber-700">{unanswered} checklist item(s) still unanswered.</p>}
            {open.length > 0 && <p className="text-sm text-amber-700">{open.length} discrepancy day(s) unresolved — they will be listed as unresolved in the summary.</p>}
            {!lastCount && <p className="text-sm text-amber-700">No full inventory count saved yet.</p>}
            <RpcButton
              fn="complete_audit"
              args={{ p_audit_id: id }}
              className="h-12 w-full text-base"
              disabled={unanswered > 0}
              confirm="Complete the audit? It becomes permanent and the partner will see the summary."
              success="Audit completed — summary generated"
            >
              Complete audit
            </RpcButton>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header({ audit, loc }: { audit: any; loc: { id: string; code: string; store_name: string } }) {
  return (
    <div>
      <Link href="/admin/audits" className="text-xs text-muted-foreground underline">
        ← Audits
      </Link>
      <h1 className="text-2xl font-bold">
        {loc.code} · {loc.store_name}
      </h1>
      <p className="text-sm text-muted-foreground">
        Audit period {fmtDate(audit.period_start)} – {fmtDate(audit.period_end, { year: true })} ·{" "}
        {audit.status === "completed" ? `completed ${fmtDateTime(audit.completed_at)} · score ${audit.score_passed}/${audit.score_total}` : audit.status.replace("_", " ")}
      </p>
    </div>
  );
}
