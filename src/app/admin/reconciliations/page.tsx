import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, peso } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/status";
import { SimpleActionButton } from "@/app/admin/locations/[id]/forms";
import { createReconciliation } from "@/app/admin/audits/actions";

export default async function ReconciliationsPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [recons, audits] = await Promise.all([
    supabase.from("reconciliations").select("id, period_start, period_end, status, net_profit_centavos, partner_payable_centavos, locations(code, store_name)").order("period_end", { ascending: false }),
    supabase.from("weekly_audits").select("id, period_start, period_end, locations(code)").eq("status", "completed").order("period_end", { ascending: false }),
  ]);
  const reconAudits = new Set((await supabase.from("reconciliations").select("audit_id")).data?.map((r) => r.audit_id));
  const ready = (audits.data ?? []).filter((a) => !reconAudits.has(a.id));
  const code = (x: unknown) => (x as { code: string } | null)?.code;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Reconciliations & payouts</h1>
      {ready.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Audited, not yet reconciled</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {ready.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{code(a.locations)}</b> · {fmtDate(a.period_start)} – {fmtDate(a.period_end)}
                  </span>
                  <SimpleActionButton action={createReconciliation.bind(null, a.id)}>Create reconciliation</SimpleActionButton>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <ul className="divide-y text-sm">
            {(recons.data ?? []).map((r) => (
              <li key={r.id}>
                <Link href={`/admin/reconciliations/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <b>{code(r.locations)}</b> · {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">Profit {peso(r.net_profit_centavos)}</span>
                    <b>Partner {peso(r.partner_payable_centavos)}</b>
                    <Pill t={r.status === "paid" ? "green" : r.status === "confirmed" ? "blue" : "amber"}>{r.status}</Pill>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {(recons.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
