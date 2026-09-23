import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, num } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/status";
import { DeliveryConfirm } from "./confirm";

export default async function PartnerDeliveries() {
  const profile = await requireRole("partner");
  const supabase = await createClient();
  const { data } = await supabase
    .from("deliveries")
    .select("id, business_date, delivered_at, status, notes, partner_note, confirmed_at, delivery_lines(qty, inventory_items(name, unit))")
    .eq("location_id", profile.location_id!)
    .order("business_date", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Deliveries</h1>
      {(data ?? []).map((d) => (
        <Card key={d.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {fmtDate(d.business_date)}
              {d.status === "recorded" ? (
                <Pill t="amber">Please confirm</Pill>
              ) : d.status === "confirmed" ? (
                <Pill t="green">Received ✓</Pill>
              ) : d.status === "disputed" ? (
                <Pill t="red">Problem reported</Pill>
              ) : (
                <Pill>Cancelled</Pill>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y text-sm">
              {(d.delivery_lines as unknown as { qty: number; inventory_items: { name: string; unit: string } }[]).map((l, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span>{l.inventory_items.name}</span>
                  <b className="tabular-nums">
                    {num(l.qty, 3)} {l.inventory_items.unit}
                  </b>
                </li>
              ))}
            </ul>
            {d.partner_note && <p className="text-sm text-muted-foreground">Your note: {d.partner_note}</p>}
            {d.confirmed_at && <p className="text-xs text-muted-foreground">Confirmed {fmtDateTime(d.confirmed_at)}</p>}
            {d.status === "recorded" && <DeliveryConfirm id={d.id} />}
          </CardContent>
        </Card>
      ))}
      {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No deliveries yet.</p>}
    </div>
  );
}
