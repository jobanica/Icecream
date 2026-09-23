import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDate, peso, todayPH } from "@/lib/format";
import type { DailyStatusRow } from "@/lib/types";
import { missingSteps } from "@/lib/daily";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/status";

function stepState(ok: boolean, waiting = false) {
  if (ok) return { icon: "✅", cls: "border-emerald-200 bg-emerald-50 text-emerald-900" };
  if (waiting) return { icon: "⏳", cls: "border-sky-200 bg-sky-50 text-sky-900" };
  return { icon: "⬜", cls: "border-border bg-background text-muted-foreground" };
}

export default async function PartnerHome() {
  const profile = await requireRole("partner");
  const supabase = await createClient();
  const today = todayPH();
  const locationId = profile.location_id!;

  const [{ data: statusRows }, { data: deliveries }, { data: statements }, { data: payouts }] = await Promise.all([
    supabase.from("v_daily_status").select("*").eq("location_id", locationId).gte("business_date", addDays(today, -30)).order("business_date", { ascending: false }),
    supabase.from("deliveries").select("id, business_date, status").eq("location_id", locationId).eq("status", "recorded"),
    supabase.from("partner_statements").select("id, statement_no, period_start, period_end, partner_payable_centavos, acknowledged_at").eq("location_id", locationId).is("acknowledged_at", null),
    supabase.from("payouts").select("id, amount_centavos, paid_on, partner_confirmed_at").eq("location_id", locationId).is("partner_confirmed_at", null),
  ]);

  const rows = (statusRows ?? []) as DailyStatusRow[];
  const t = rows.find((r) => r.business_date === today);
  const past = rows.filter((r) => r.business_date < today);
  const missed = past.filter((r) => missingSteps(r).length > 0);
  const rejected = past.filter((r) => r.remittance_status === "rejected");
  const done = t && missingSteps(t).length === 0;

  const steps = [
    { label: "Counter", ...stepState(!!t?.has_counter) },
    { label: "Count", ...stepState(!!t?.has_count) },
    { label: "Sales", ...stepState(!!t?.has_sales) },
    {
      label: "Remit",
      ...stepState(t?.remittance_status === "verified", t?.remittance_status === "submitted"),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Today · {fmtDate(today)}</span>
            {done ? <Pill t="green">Done</Pill> : <Pill t="amber">To do</Pill>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {steps.map((s) => (
              <div key={s.label} className={cn("flex flex-col items-center rounded-lg border py-2 text-xs font-medium", s.cls)}>
                <span className="text-xl">{s.icon}</span>
                {s.label}
              </div>
            ))}
          </div>
          {t?.amount_due_centavos != null && t.remittance_status !== "verified" && (
            <p className="text-center text-sm">
              Remit today: <b className="text-base">{peso(t.amount_due_centavos)}</b>
            </p>
          )}
          <Link href="/p/today" className={cn(buttonVariants(), "h-14 w-full text-lg")}>
            {done ? "View today" : t?.has_counter ? "Continue end of day" : "Start end of day"}
          </Link>
        </CardContent>
      </Card>

      {rejected.map((r) => (
        <Link key={r.business_date} href={`/p/today?date=${r.business_date}`} className="block rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <b>❌ Remittance for {fmtDate(r.business_date)} was rejected.</b> Tap to fix and send again.
        </Link>
      ))}

      {(deliveries ?? []).length > 0 && (
        <Link href="/p/deliveries" className="block rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
          <b>📦 {deliveries!.length} delivery to confirm.</b> Tap to check the items.
        </Link>
      )}

      {(statements ?? []).map((s) => (
        <Link key={s.id} href={`/p/statements/${s.id}`} className="block rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>💰 New profit-share statement</b> ({fmtDate(s.period_start)} – {fmtDate(s.period_end)}): {peso(s.partner_payable_centavos)}. Tap to review.
        </Link>
      ))}
      {(payouts ?? []).map((p) => (
        <Link key={p.id} href="/p/history?tab=payouts" className="block rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>✅ Payout sent: {peso(p.amount_centavos)}</b> on {fmtDate(p.paid_on)}. Tap to confirm you received it.
        </Link>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Missed days</CardTitle>
        </CardHeader>
        <CardContent>
          {missed.length === 0 ? (
            <p className="text-sm text-muted-foreground">None — great job! 🎉</p>
          ) : (
            <ul className="divide-y">
              {missed.map((r) => {
                const canFix = r.business_date >= addDays(today, -1);
                const inner = (
                  <div className="flex items-center justify-between py-2.5">
                    <span className="font-medium text-red-700">{fmtDate(r.business_date)}</span>
                    <span className="text-xs text-red-700">Missing: {missingSteps(r).join(", ")}</span>
                  </div>
                );
                return (
                  <li key={r.business_date}>
                    {canFix || r.has_sales ? <Link href={`/p/today?date=${r.business_date}`}>{inner}</Link> : inner}
                  </li>
                );
              })}
            </ul>
          )}
          {missed.some((r) => r.business_date < addDays(today, -1) && !r.has_sales) && (
            <p className="mt-2 text-xs text-muted-foreground">Days older than yesterday can only be entered by the owner. Please message them.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
