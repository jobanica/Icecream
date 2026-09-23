import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, num, peso } from "@/lib/format";
import type { InventoryItem, StockRow } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/status";
import { RpcButton } from "@/components/rpc-button";
import { DeliveryForm } from "./delivery-form";
import { suggestQty } from "@/lib/stock";

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const profile = await requireRole("admin", "staff");
  const { location } = await searchParams;
  const supabase = await createClient();
  const [locs, items, deliveries, stock] = await Promise.all([
    supabase.from("locations").select("id, code, store_name").eq("status", "active").order("code"),
    supabase.from("inventory_items").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("deliveries")
      .select("*, locations(code), delivery_lines(qty, inventory_items(name, unit))")
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("v_stock_on_hand").select("*"),
  ]);

  const suggested: Record<string, Record<string, number>> = {};
  for (const s of (stock.data ?? []) as StockRow[]) {
    const q = suggestQty(s);
    if (q > 0) (suggested[s.location_id] ??= {})[s.item_id] = q;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Deliveries</h1>
      <Card>
        <CardHeader>
          <CardTitle>Record a delivery</CardTitle>
          <div className="flex flex-wrap gap-1 text-xs">
            Prefill from reorder suggestions:
            {(locs.data ?? []).map((l) => (
              <Link key={l.id} href={`/admin/deliveries?location=${l.id}`} className="underline">
                {l.code}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <DeliveryForm locations={locs.data ?? []} items={(items.data ?? []) as InventoryItem[]} suggested={suggested} defaultLocation={location} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(deliveries.data ?? []).map((d) => (
              <li key={d.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {d.locations?.code} · {fmtDate(d.business_date)}
                  </span>
                  <span className="flex items-center gap-2">
                    {d.delivery_fee_centavos > 0 && <span className="text-xs text-muted-foreground">fee {peso(d.delivery_fee_centavos)}</span>}
                    {d.status === "confirmed" ? (
                      <Pill t="green">Confirmed {fmtDateTime(d.confirmed_at)}</Pill>
                    ) : d.status === "disputed" ? (
                      <Pill t="red">Disputed</Pill>
                    ) : d.status === "cancelled" ? (
                      <Pill>Cancelled</Pill>
                    ) : (
                      <Pill t="amber">Awaiting store</Pill>
                    )}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {(d.delivery_lines as { qty: number; inventory_items: { name: string; unit: string } }[])
                    .map((l) => `${l.inventory_items.name} ${num(l.qty, 3)} ${l.inventory_items.unit}`)
                    .join(" · ")}
                </div>
                {d.partner_note && <div className="text-red-700">Store: {d.partner_note}</div>}
                {profile.role === "admin" && (d.status === "recorded" || d.status === "disputed") && (
                  <RpcButton
                    fn="cancel_delivery"
                    args={{ p_delivery_id: d.id, p_reason: d.status === "disputed" ? `Disputed: ${d.partner_note}` : "Recorded in error" }}
                    variant="outline"
                    className="h-7 text-xs"
                    confirm="Cancel this delivery? Stock will be reversed. Record a corrected delivery afterwards."
                    success="Delivery cancelled"
                  >
                    Cancel delivery
                  </RpcButton>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
