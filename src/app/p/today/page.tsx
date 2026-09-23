import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, todayPH } from "@/lib/format";
import type { DailyCheck, Location, Product, Remittance } from "@/lib/types";
import { DailyWizard, type WizardData } from "./wizard";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const profile = await requireRole("partner");
  const sp = await searchParams;
  const today = todayPH();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  if (date > today) notFound();
  const locationId = profile.location_id!;
  const supabase = await createClient();

  const [loc, settings, ctx, products, readings, count, report, check, remittance] = await Promise.all([
    supabase.from("locations").select("*").eq("id", locationId).single(),
    supabase.from("app_settings").select("*").eq("id", 1).single(),
    supabase.rpc("daily_flow_context", { p_location_id: locationId, p_business_date: date }),
    supabase.from("products").select("*").eq("location_id", locationId).eq("is_active", true).order("sort_order"),
    supabase.from("counter_readings").select("machine_id, reading, delta, flags").eq("location_id", locationId).eq("business_date", date),
    supabase.from("daily_container_counts").select("*").eq("location_id", locationId).eq("business_date", date).maybeSingle(),
    supabase.from("daily_sales_reports").select("*, daily_sales_lines(*)").eq("location_id", locationId).eq("business_date", date).maybeSingle(),
    supabase.from("daily_checks").select("*").eq("location_id", locationId).eq("business_date", date).maybeSingle(),
    supabase.from("daily_remittances").select("*").eq("location_id", locationId).eq("business_date", date).maybeSingle(),
  ]);

  const l = loc.data as Location;
  const s = settings.data ?? {};
  const remitTo = {
    gcashName: l.remit_gcash_name ?? s.remit_gcash_name,
    gcashNumber: l.remit_gcash_number ?? s.remit_gcash_number,
    bankName: l.remit_bank_name ?? s.remit_bank_name,
    bankAccountName: l.remit_bank_account_name ?? s.remit_bank_account_name,
    bankAccountNumber: l.remit_bank_account_number ?? s.remit_bank_account_number,
  };

  const data: WizardData = {
    date,
    today,
    canEnter: date >= addDays(today, -1),
    location: { id: l.id, code: l.code, status: l.status, tolerance: l.tolerance_servings },
    context: ctx.data ?? { machines: [], previous_count: { cones: 0, cups: 0, date: null }, delivered: { cones: 0, cups: 0 } },
    contextError: ctx.error?.message ?? null,
    products: (products.data ?? []) as Product[],
    readings: readings.data ?? [],
    count: count.data ?? null,
    report: report.data ?? null,
    check: (check.data as DailyCheck) ?? null,
    remittance: (remittance.data as Remittance) ?? null,
    remitTo,
  };

  return <DailyWizard data={data} />;
}
