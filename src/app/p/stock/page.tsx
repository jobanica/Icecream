import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type { StockRow } from "@/lib/types";
import { StockPill } from "@/components/status";
import { Card, CardContent } from "@/components/ui/card";

export default async function PartnerStock() {
  const profile = await requireRole("partner");
  const supabase = await createClient();
  const { data } = await supabase.from("v_stock_on_hand").select("*").eq("location_id", profile.location_id!).order("sort_order");
  const rows = (data ?? []) as StockRow[];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Stock at your store</h1>
      <Card>
        <CardContent>
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.item_id} className="flex items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.item_name}</div>
                  <div className="text-xs text-muted-foreground">Reorder at {num(r.reorder_point, 1)} {r.unit}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">
                    {num(r.on_hand, r.is_premix ? 1 : 0)} {r.unit}
                  </div>
                  <StockPill status={r.stock_status} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Cones and cups follow your daily count. Premix and toppings are estimated from the counter and sales, and corrected during weekly audits.
      </p>
    </div>
  );
}
