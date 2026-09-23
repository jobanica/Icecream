import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDate, todayPH } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/status";
import { ScheduleAuditForm } from "./schedule-form";

export default async function AuditsPage() {
  await requireRole("admin", "staff");
  const supabase = await createClient();
  const today = todayPH();
  const [locs, audits, recons] = await Promise.all([
    supabase.from("locations").select("id, code, store_name, partnership_start_date").eq("status", "active").order("code"),
    supabase.from("weekly_audits").select("id, location_id, period_start, period_end, status, scheduled_for, score_passed, score_total, completed_at, locations(code, store_name)").order("period_end", { ascending: false }).limit(60),
    supabase.from("reconciliations").select("audit_id, id, status"),
  ]);
  const reconBy = new Map((recons.data ?? []).map((r) => [r.audit_id, r]));
  const nextStart: Record<string, string> = {};
  for (const l of locs.data ?? []) {
    const last = (audits.data ?? []).find((a) => a.location_id === l.id);
    nextStart[l.id] = last ? addDays(last.period_end, 1) : (l.partnership_start_date ?? addDays(today, -7));
  }
  const open = (audits.data ?? []).filter((a) => a.status !== "completed");
  const done = (audits.data ?? []).filter((a) => a.status === "completed");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Weekly audits</h1>
      <Card>
        <CardHeader>
          <CardTitle>Schedule an audit</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleAuditForm locations={locs.data ?? []} nextStart={nextStart} today={today} />
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">To do</h2>
        {open.length === 0 && <p className="text-sm text-muted-foreground">No open audits.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {open.map((a) => (
            <Link key={a.id} href={`/admin/audits/${a.id}`} className="block rounded-xl border bg-card p-4 hover:bg-muted/40">
              <div className="flex items-center justify-between">
                <b>{(a.locations as unknown as { code: string })?.code}</b>
                <Pill t={a.status === "in_progress" ? "blue" : "amber"}>{a.status === "in_progress" ? "In progress" : "Scheduled"}</Pill>
              </div>
              <div className="text-sm">
                {fmtDate(a.period_start)} – {fmtDate(a.period_end)}
              </div>
              <div className="text-xs text-muted-foreground">Visit {fmtDate(a.scheduled_for)}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Completed</h2>
        <Card>
          <CardContent>
            <ul className="divide-y text-sm">
              {done.map((a) => {
                const r = reconBy.get(a.id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/audits/${a.id}`} className="font-medium underline">
                      {(a.locations as unknown as { code: string })?.code} · {fmtDate(a.period_start)} – {fmtDate(a.period_end)}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Pill t={a.score_passed === a.score_total ? "green" : "amber"}>
                        {a.score_passed}/{a.score_total}
                      </Pill>
                      {r ? (
                        <Pill t={r.status === "paid" ? "green" : r.status === "confirmed" ? "blue" : "gray"}>Reconciliation: {r.status}</Pill>
                      ) : (
                        <Pill t="amber">No reconciliation yet</Pill>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {done.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
