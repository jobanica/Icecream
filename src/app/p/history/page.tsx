import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDate, fmtDateTime, peso, todayPH } from "@/lib/format";
import { CheckPill, Pill, RemitPill } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";
import { RpcButton } from "@/components/rpc-button";
import { cn } from "@/lib/utils";
import { METHOD_LABELS, type PaymentMethod } from "@/lib/types";

const TABS = [
  { key: "days", label: "Daily" },
  { key: "payouts", label: "Payouts" },
  { key: "audits", label: "Audits" },
] as const;

export default async function PartnerHistory({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const profile = await requireRole("partner");
  const tab = (await searchParams).tab ?? "days";
  const supabase = await createClient();
  const loc = profile.location_id!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
        {TABS.map((t) => (
          <Link key={t.key} href={`/p/history?tab=${t.key}`} className={cn("rounded-md py-2 text-center", tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "days" && <Days loc={loc} supabase={supabase} />}
      {tab === "payouts" && <Payouts loc={loc} supabase={supabase} />}
      {tab === "audits" && <Audits loc={loc} supabase={supabase} />}
    </div>
  );
}

type SB = Awaited<ReturnType<typeof createClient>>;

async function Days({ loc, supabase }: { loc: string; supabase: SB }) {
  const since = addDays(todayPH(), -30);
  const [{ data: rems }, { data: checks }] = await Promise.all([
    supabase.from("daily_remittances").select("business_date, amount_due_centavos, amount_sent_centavos, status, reference_no, rejection_reason").eq("location_id", loc).gte("business_date", since).order("business_date", { ascending: false }),
    supabase.from("daily_checks").select("business_date, status, resolved_at, max_abs_diff").eq("location_id", loc).gte("business_date", since),
  ]);
  const checkBy = new Map((checks ?? []).map((c) => [c.business_date, c]));
  return (
    <Card>
      <CardContent>
        <ul className="divide-y">
          {(rems ?? []).map((r) => {
            const c = checkBy.get(r.business_date);
            return (
              <li key={r.business_date} className="space-y-1 py-3">
                <Link href={`/p/today?date=${r.business_date}`} className="flex items-center justify-between">
                  <span className="font-medium">{fmtDate(r.business_date)}</span>
                  <span className="font-bold tabular-nums">{peso(r.amount_due_centavos)}</span>
                </Link>
                <div className="flex flex-wrap items-center gap-1.5">
                  <CheckPill status={c?.status} resolved={!!c?.resolved_at} />
                  <RemitPill status={r.status} />
                  {r.reference_no && <span className="text-xs text-muted-foreground">Ref {r.reference_no}</span>}
                </div>
                {r.status === "rejected" && <p className="text-xs text-red-700">{r.rejection_reason}</p>}
              </li>
            );
          })}
        </ul>
        {(rems ?? []).length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
      </CardContent>
    </Card>
  );
}

async function Payouts({ loc, supabase }: { loc: string; supabase: SB }) {
  const [{ data: statements }, { data: payouts }] = await Promise.all([
    supabase.from("partner_statements").select("id, statement_no, period_start, period_end, partner_payable_centavos, acknowledged_at").eq("location_id", loc).order("period_end", { ascending: false }),
    supabase.from("payouts").select("*").eq("location_id", loc),
  ]);
  const payoutBy = new Map((payouts ?? []).map((p) => [p.statement_id, p]));
  if ((statements ?? []).length === 0) return <p className="text-sm text-muted-foreground">No statements yet. They appear after each weekly audit.</p>;
  return (
    <div className="space-y-3">
      {statements!.map((s) => {
        const p = payoutBy.get(s.id);
        return (
          <Card key={s.id}>
            <CardContent className="space-y-2">
              <Link href={`/p/statements/${s.id}`} className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.statement_no}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{peso(s.partner_payable_centavos)}</div>
                  <div className="text-xs underline">View details</div>
                </div>
              </Link>
              <div className="flex flex-wrap gap-1.5">
                {s.acknowledged_at ? <Pill t="green">Acknowledged</Pill> : <Pill t="amber">Please review</Pill>}
                {p ? <Pill t="green">Paid {fmtDate(p.paid_on)}</Pill> : <Pill>Not paid yet</Pill>}
              </div>
              {p && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  {peso(p.amount_centavos)} via {METHOD_LABELS[p.method as PaymentMethod]} · Ref {p.reference_no}
                  {p.partner_confirmed_at ? (
                    <div className="text-xs text-emerald-700">You confirmed receipt {fmtDateTime(p.partner_confirmed_at)}</div>
                  ) : (
                    <RpcButton fn="confirm_payout_received" args={{ p_payout_id: p.id }} success="Thank you! Receipt confirmed." className="mt-2 h-11 w-full">
                      I received this payment
                    </RpcButton>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

async function Audits({ loc, supabase }: { loc: string; supabase: SB }) {
  const { data } = await supabase.from("audit_partner_summaries").select("id, period_start, period_end, summary").eq("location_id", loc).order("period_end", { ascending: false });
  if ((data ?? []).length === 0) return <p className="text-sm text-muted-foreground">No audits yet.</p>;
  return (
    <div className="space-y-3">
      {data!.map((a) => (
        <Link key={a.id} href={`/p/audits/${a.id}`} className="block">
          <Card>
            <CardContent className="flex items-center justify-between">
              <div>
                <div className="font-semibold">
                  {fmtDate(a.period_start)} – {fmtDate(a.period_end)}
                </div>
                <div className="text-xs text-muted-foreground">Auditor: {a.summary?.auditor ?? "—"}</div>
              </div>
              <Pill t="blue">
                {a.summary?.score?.passed}/{a.summary?.score?.total} passed
              </Pill>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
