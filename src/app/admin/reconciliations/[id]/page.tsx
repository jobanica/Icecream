import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signEvidence } from "@/lib/evidence";
import { fmtDate, fmtDateTime, num, peso } from "@/lib/format";
import { METHOD_LABELS, type PaymentMethod } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/status";
import { RpcButton } from "@/components/rpc-button";
import { EvidenceImage } from "@/components/evidence-image";
import { addAdjustment, discardDraft, recordPayout, updateDeductions } from "../actions";
import { SimpleActionButton } from "@/app/admin/locations/[id]/forms";
import { AdjustmentForm, DeductionsForm, PayoutForm } from "./forms";

function Line({ label, value, strong, neg, className }: { label: React.ReactNode; value: number; strong?: boolean; neg?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${strong ? "border-t font-bold" : ""} ${className ?? ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{neg && value ? `−${peso(value)}` : peso(value)}</span>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createClient();
  const { data: r } = await supabase.from("reconciliations").select("*, locations(id, code, store_name, partner_name, payout_method, payout_account_name, payout_account_number, payout_bank_name)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const loc = r.locations as any;
  const [adjs, stmt, payout, unverified] = await Promise.all([
    supabase.from("reconciliation_adjustments").select("*").eq("reconciliation_id", id).order("created_at"),
    supabase.from("partner_statements").select("id, statement_no, acknowledged_at, acknowledgment_note").eq("reconciliation_id", id).maybeSingle(),
    supabase.from("payouts").select("*").eq("reconciliation_id", id).maybeSingle(),
    supabase
      .from("daily_remittances")
      .select("business_date")
      .eq("location_id", r.location_id)
      .eq("status", "submitted")
      .gte("business_date", r.period_start)
      .lte("business_date", r.period_end),
  ]);
  const urls = await signEvidence(supabase, [payout.data?.proof_path]);
  const draft = r.status === "draft";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/admin/reconciliations" className="text-xs text-muted-foreground underline">
          ← Reconciliations
        </Link>
        <h1 className="text-2xl font-bold">
          {loc.code} · {loc.store_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fmtDate(r.period_start)} – {fmtDate(r.period_end, { year: true })} ·{" "}
          <Link href={`/admin/audits/${r.audit_id}`} className="underline">
            audit
          </Link>{" "}
          · <Pill t={r.status === "paid" ? "green" : r.status === "confirmed" ? "blue" : "amber"}>{r.status}</Pill>
        </p>
      </div>

      {draft && (unverified.data ?? []).length > 0 && (
        <Card className="border-amber-400 bg-amber-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-amber-900">
            <span>
              {(unverified.data ?? []).length} remittance(s) in this period are sent but not yet verified (
              {(unverified.data ?? []).map((x) => fmtDate(x.business_date)).join(", ")}), so they count as unremitted below. Verify them in the{" "}
              <Link href="/admin" className="underline">
                inbox
              </Link>
              , then discard this draft and create it again.
            </span>
            <SimpleActionButton action={discardDraft.bind(null, id)} variant="outline">
              Discard draft
            </SimpleActionButton>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sales & remittances</CardTitle>
        </CardHeader>
        <CardContent>
          <Line label="Total sales (net)" value={r.total_sales_centavos} />
          <Line label="Verified remittances" value={r.verified_remittances_centavos} />
          <Line label="Outstanding (store still holds)" value={r.outstanding_centavos} strong />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profit & split</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Line label="Total sales" value={r.total_sales_centavos} />
            <Line label="Product cost" value={r.product_cost_centavos} neg />
            <Line label="Payment fees" value={r.payment_fees_centavos} neg />
            <Line label="Maintenance reserve" value={r.maintenance_reserve_centavos} neg />
            <Line label="Wastage / stock loss" value={r.wastage_centavos} neg />
            <Line label="Delivery cost" value={r.delivery_cost_centavos} neg />
            {r.other_deductions_centavos > 0 && <Line label="Other deductions" value={r.other_deductions_centavos} neg />}
            <Line label="Net profit" value={r.net_profit_centavos} strong />
            <Line label={`Partner share (${num(r.partner_share_pct, 2)}%)`} value={r.partner_share_centavos} />
            <Line label="Owner share" value={r.owner_share_centavos} />
          </div>
          {draft && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Review / adjust deductions</summary>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-muted p-3 text-xs">
                  <div className="mb-1 font-semibold">Product cost detail (auto)</div>
                  {(r.cost_breakdown as any[]).map((c) => (
                    <div key={c.item} className="flex justify-between">
                      <span>
                        {c.item}: {num(c.qty, 2)} {c.unit} × {peso(c.unit_cost_centavos)}
                      </span>
                      <span>{peso(c.cost_centavos)}</span>
                    </div>
                  ))}
                </div>
                <DeductionsForm action={updateDeductions.bind(null, id)} r={r} />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adjustments</CardTitle>
          <p className="text-xs text-muted-foreground">Negative = deducted from the partner&apos;s payable. Reasons are shown on the partner statement.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {(adjs.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          <ul className="space-y-2">
            {(adjs.data ?? []).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {a.auto_generated && <Pill t="blue">auto</Pill>} {a.reason}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
                  <b className={a.amount_centavos < 0 ? "text-red-600" : "text-emerald-700"}>
                    {a.amount_centavos < 0 ? `−${peso(-a.amount_centavos)}` : `+${peso(a.amount_centavos)}`}
                  </b>
                  {draft && (
                    <RpcButton fn="remove_reconciliation_adjustment" args={{ p_adjustment_id: a.id }} variant="ghost" className="h-7 px-2 text-xs" confirm="Remove this adjustment?" success="Removed">
                      Remove
                    </RpcButton>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {draft && <AdjustmentForm action={addAdjustment.bind(null, id)} />}
          <Line label="Partner share" value={r.partner_share_centavos} />
          <Line label="Adjustments" value={r.adjustments_centavos} />
          <div className="flex justify-between rounded-lg bg-emerald-600 p-3 text-white">
            <span className="font-semibold">Partner payable</span>
            <span className="text-xl font-bold tabular-nums">{peso(r.partner_payable_centavos)}</span>
          </div>
          {r.partner_payable_centavos <= 0 && (
            <p className="text-sm text-amber-700">
              Nothing to pay for this period{r.partner_payable_centavos < 0 ? ` — the partner owes ${peso(-r.partner_payable_centavos)}. Carry it as an adjustment next period.` : "."}
            </p>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card className="border-primary">
          <CardContent className="space-y-2">
            <p className="text-sm">Confirming locks every number and issues the partner statement.</p>
            <RpcButton fn="confirm_reconciliation" args={{ p_id: id }} className="h-11 w-full" confirm="Confirm this reconciliation? It cannot be changed afterwards." success="Confirmed — statement issued">
              Confirm reconciliation
            </RpcButton>
          </CardContent>
        </Card>
      )}

      {stmt.data && (
        <Card>
          <CardHeader>
            <CardTitle>Partner statement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {stmt.data.statement_no} ·{" "}
              {stmt.data.acknowledged_at ? (
                <Pill t="green">Acknowledged {fmtDateTime(stmt.data.acknowledged_at)}</Pill>
              ) : (
                <Pill t="amber">Not yet acknowledged</Pill>
              )}
              {stmt.data.acknowledgment_note && <span className="block text-xs text-muted-foreground">“{stmt.data.acknowledgment_note}”</span>}
            </span>
            <span className="flex gap-2">
              <Link href={`/admin/statements/${stmt.data.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                View
              </Link>
              <a href={`/statements/${stmt.data.id}/pdf`} className={buttonVariants({ size: "sm" })}>
                PDF
              </a>
            </span>
          </CardContent>
        </Card>
      )}

      {r.status === "confirmed" && r.partner_payable_centavos > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Record payout</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pay to: {loc.payout_method ? METHOD_LABELS[loc.payout_method as PaymentMethod] : "—"} · {loc.payout_account_name} · {loc.payout_account_number}
              {loc.payout_bank_name ? ` (${loc.payout_bank_name})` : ""}
            </p>
          </CardHeader>
          <CardContent>
            <PayoutForm action={recordPayout.bind(null, id)} locationId={loc.id} amountCentavos={r.partner_payable_centavos} defaultMethod={loc.payout_method} />
          </CardContent>
        </Card>
      )}

      {payout.data && (
        <Card>
          <CardHeader>
            <CardTitle>Payout</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-[1fr_120px] gap-3 text-sm">
            <div className="space-y-1">
              <div className="text-lg font-bold">{peso(payout.data.amount_centavos)}</div>
              <div>
                {METHOD_LABELS[payout.data.method as PaymentMethod]} · Ref {payout.data.reference_no} · paid {fmtDate(payout.data.paid_on)}
              </div>
              {payout.data.partner_confirmed_at ? (
                <Pill t="green">Partner confirmed receipt {fmtDateTime(payout.data.partner_confirmed_at)}</Pill>
              ) : (
                <Pill t="amber">Waiting for partner to confirm receipt</Pill>
              )}
            </div>
            <EvidenceImage url={urls[payout.data.proof_path]} alt="Proof of payment" className="h-28 w-full" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
