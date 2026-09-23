import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signEvidence } from "@/lib/evidence";
import { addDays, fmtDate, fmtDateTime, num, peso, todayPH } from "@/lib/format";
import type { DailyCheck, InventoryItem, Location, Machine, Product, StockRow } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckPill, Pill, RemitPill, StockPill } from "@/components/status";
import { EvidenceImage } from "@/components/evidence-image";
import { LocationForm } from "../location-form";
import {
  activateLocation,
  addDefaultProducts,
  addMachine,
  logMachineEvent,
  recordReset,
  saveChecklist,
  saveOpeningInventory,
  saveProduct,
  setLocationStatus,
  setPartnerPin,
  updateLocation,
} from "../actions";
import {
  AddMachineForm,
  ChecklistForm,
  CorrectReading,
  EventForm,
  NewProductForm,
  OpeningInventoryForm,
  PinForm,
  ProductRow,
  ResetForm,
  SimpleActionButton,
  StatusForm,
} from "./forms";

export default async function LocationDetail({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("admin", "staff");
  const isAdmin = profile.role === "admin";
  const { id } = await params;
  const supabase = await createClient();
  const today = todayPH();
  const since = addDays(today, -13);

  const { data: loc } = await supabase.from("locations").select("*").eq("id", id).maybeSingle();
  if (!loc) notFound();
  const l = loc as Location;

  const [partner, machines, events, products, items, checks, reports, remits, readings, stock, readiness] = await Promise.all([
    supabase.from("profiles").select("id, full_name, is_active").eq("location_id", id).eq("role", "partner").maybeSingle(),
    supabase.from("machines").select("*").eq("location_id", id).order("installed_at"),
    supabase.from("machine_events").select("*").eq("location_id", id).order("occurred_at", { ascending: false }).limit(15),
    supabase.from("products").select("*").eq("location_id", id).order("sort_order"),
    supabase.from("inventory_items").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("daily_checks").select("*").eq("location_id", id).gte("business_date", since),
    supabase.from("daily_sales_reports").select("business_date, net_sales_centavos, report_type").eq("location_id", id).gte("business_date", since),
    supabase.from("daily_remittances").select("business_date, status").eq("location_id", id).gte("business_date", since),
    supabase.from("counter_readings").select("id, machine_id, business_date, reading, submitted_reading, delta, photo_path, flags").eq("location_id", id).gte("business_date", since).order("business_date", { ascending: false }),
    supabase.from("v_stock_on_hand").select("*").eq("location_id", id).order("sort_order"),
    l.status === "pending" ? supabase.rpc("location_readiness", { p_location_id: id }) : Promise.resolve({ data: [] as string[] }),
  ]);

  const machineRows = (machines.data ?? []) as Machine[];
  const urls = await signEvidence(supabase, [...machineRows.map((m) => m.baseline_photo_path), ...(readings.data ?? []).map((r) => r.photo_path)]);

  const checkBy = new Map(((checks.data ?? []) as DailyCheck[]).map((c) => [c.business_date, c]));
  const reportBy = new Map((reports.data ?? []).map((r) => [r.business_date, r]));
  const remitBy = new Map((remits.data ?? []).map((r) => [r.business_date, r]));
  const readingBy = new Map<string, { photo_path: string; reading: number; flags: string[] }[]>();
  for (const r of readings.data ?? []) readingBy.set(r.business_date, [...(readingBy.get(r.business_date) ?? []), r]);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i)).filter((d) => !l.opening_count_date || d >= l.opening_count_date);
  const missing = (readiness.data ?? []) as string[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-muted-foreground">{l.code}</div>
          <h1 className="text-2xl font-bold">{l.store_name}</h1>
          <p className="text-sm text-muted-foreground">
            {l.partner_name} · {l.address} · split {num(100 - l.partner_share_pct, 2)}/{num(l.partner_share_pct, 2)} (owner/partner) · tolerance ±{l.tolerance_servings}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill t={l.status === "active" ? "green" : l.status === "pending" ? "amber" : "gray"} className="text-sm">
            {l.status.toUpperCase()}
          </Pill>
          {isAdmin && l.status !== "pending" && <StatusForm action={setLocationStatus.bind(null, id)} current={l.status} />}
        </div>
      </div>

      {l.status === "pending" && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {missing.length === 0 ? (
              <p className="text-sm text-emerald-700">Everything is ready.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm text-amber-900">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <SimpleActionButton action={activateLocation.bind(null, id)} variant={missing.length ? "outline" : "default"}>
                Activate location
              </SimpleActionButton>
            )}
          </CardContent>
        </Card>
      )}

      {l.status !== "pending" && (
        <Card>
          <CardHeader>
            <CardTitle>Last 14 days</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 text-right font-medium">Counter</th>
                  <th className="py-1.5 text-right font-medium">Sales srv</th>
                  <th className="py-1.5 text-right font-medium">Cones+cups</th>
                  <th className="py-1.5 font-medium">Check</th>
                  <th className="py-1.5 text-right font-medium">Sales</th>
                  <th className="py-1.5 font-medium">Remit</th>
                  <th className="py-1.5 font-medium">Photo</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const c = checkBy.get(d);
                  const r = reportBy.get(d);
                  const rs = readingBy.get(d) ?? [];
                  return (
                    <tr key={d} className="border-t align-middle">
                      <td className="py-1.5">{fmtDate(d)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {c?.counter_delta ?? "—"}
                        {rs.some((x) => x.flags.length) && <span className="ml-1 text-xs text-amber-700">{rs.flatMap((x) => x.flags).join(",")}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{c?.reported_servings ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{c?.container_servings ?? "—"}</td>
                      <td className="py-1.5">
                        <CheckPill status={c?.status} resolved={!!c?.resolved_at} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{r ? (r.report_type === "closed" ? "Closed" : peso(r.net_sales_centavos)) : "—"}</td>
                      <td className="py-1.5">
                        <RemitPill status={remitBy.get(d)?.status} />
                      </td>
                      <td className="py-1">
                        {rs[0] ? <EvidenceImage url={urls[rs[0].photo_path]} alt="Counter" className="h-8 w-12" /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Partner login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {partner.data ? (
              <p>
                ✅ {partner.data.full_name || l.partner_name} signs in with store code <b className="font-mono">{l.code}</b> + PIN.
              </p>
            ) : (
              <p className="text-amber-800">No login yet.</p>
            )}
            {isAdmin && <PinForm action={setPartnerPin.bind(null, id)} hasLogin={!!partner.data} code={l.code} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {((stock.data ?? []) as StockRow[]).map((s) => (
                <li key={s.item_id} className="flex items-center justify-between py-1.5">
                  <span>{s.item_name}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {num(s.on_hand, 2)} {s.unit} <StockPill status={s.stock_status} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Machines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {machineRows.map((m) => (
            <div key={m.id} className="space-y-3 rounded-lg border p-3">
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div className="text-sm">
                  <div className="font-semibold">
                    {m.serial_number} <span className="font-normal text-muted-foreground">· {m.model}</span> <Pill t={m.status === "active" ? "green" : "gray"}>{m.status}</Pill>
                  </div>
                  <div>
                    Baseline {num(m.baseline_reading)} · installed {fmtDateTime(m.installed_at)} · rollover at {m.counter_max ? num(m.counter_max) : "—"}
                  </div>
                  <div>Last reading: {num((readings.data ?? []).find((r) => r.machine_id === m.id)?.reading ?? m.baseline_reading)}</div>
                  <div className="text-muted-foreground">Value {peso(m.purchase_value_centavos)}</div>
                </div>
                <EvidenceImage url={m.baseline_photo_path ? urls[m.baseline_photo_path] : null} alt="Baseline counter" className="h-20 w-24" />
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Record counter reset / log maintenance / correct a reading</summary>
                <div className="mt-3 space-y-3">
                  <ResetForm action={recordReset.bind(null, id, m.id)} />
                  <EventForm action={logMachineEvent.bind(null, id, m.id)} />
                  {isAdmin && <CorrectReading readings={(readings.data ?? []).filter((r) => r.machine_id === m.id)} />}
                </div>
              </details>
            </div>
          ))}
          {(events.data ?? []).length > 0 && (
            <div>
              <div className="mb-1 text-sm font-semibold">Machine log</div>
              <ul className="space-y-1 text-xs">
                {(events.data ?? []).map((e) => (
                  <li key={e.id}>
                    <span className="text-muted-foreground">{fmtDateTime(e.occurred_at)}</span> · <b>{e.event_type}</b> {e.description}
                    {e.reading_before != null && ` (${e.reading_before} → ${e.reading_after})`}
                    {e.cost_centavos > 0 && ` · ${peso(e.cost_centavos)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isAdmin && (
            <details open={machineRows.length === 0}>
              <summary className="cursor-pointer text-sm font-medium">+ Add machine</summary>
              <div className="mt-3">
                <AddMachineForm action={addMachine.bind(null, id)} locationId={id} />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products & prices</CardTitle>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <>
              {((products.data ?? []) as Product[]).map((p) => (
                <ProductRow key={p.id} action={saveProduct.bind(null, id)} product={p} />
              ))}
              <NewProductForm action={saveProduct.bind(null, id)} />
              {(products.data ?? []).length === 0 && (
                <div className="pt-3">
                  <SimpleActionButton action={addDefaultProducts.bind(null, id)} variant="outline">
                    Add standard menu (Cone ₱25, Cup ₱59, Float ₱69, KitKat ₱79)
                  </SimpleActionButton>
                </div>
              )}
              <p className="pt-2 text-xs text-muted-foreground">Price changes apply to new sales only — past reports keep their price snapshot.</p>
            </>
          ) : (
            <ul className="text-sm">
              {((products.data ?? []) as Product[]).map((p) => (
                <li key={p.id}>
                  {p.name} · {peso(p.price_centavos)} · {p.container_type}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Opening inventory</CardTitle>
            </CardHeader>
            <CardContent>
              {l.status === "pending" ? (
                <>
                  {l.opening_count_date && (
                    <p className="mb-3 text-sm text-emerald-700">
                      Saved for {fmtDate(l.opening_count_date)}: {l.opening_cones} cones, {l.opening_cups} cups. Saving again replaces it.
                    </p>
                  )}
                  <OpeningInventoryForm action={saveOpeningInventory.bind(null, id)} items={(items.data ?? []) as InventoryItem[]} />
                </>
              ) : (
                <p className="text-sm">
                  Opened {fmtDate(l.opening_count_date)} with {l.opening_cones} cones and {l.opening_cups} cups.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Installation checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <ChecklistForm action={saveChecklist.bind(null, id)} value={l.installation_checklist ?? {}} />
            </CardContent>
          </Card>
        </div>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Partner file</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationForm action={updateLocation.bind(null, id)} location={l} submitLabel="Save partner file" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
