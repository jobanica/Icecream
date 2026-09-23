import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type { StockRow } from "@/lib/types";
import { suggestQty } from "@/lib/stock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockPill } from "@/components/status";
import { buttonVariants } from "@/components/ui/button";

export default async function StockPage() {
  await requireRole("admin", "staff");
  const supabase = await createClient();
  const { data } = await supabase.from("v_stock_on_hand").select("*").order("location_code").order("sort_order");
  const rows = (data ?? []) as StockRow[];
  const queue = rows.filter((r) => r.stock_status !== "ok");
  const byLoc = new Map<string, StockRow[]>();
  for (const r of rows) byLoc.set(r.location_code, [...(byLoc.get(r.location_code) ?? []), r]);
  const items = [...new Map(rows.map((r) => [r.item_id, r.item_name])).entries()];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Stock & reorder</h1>
      <Card>
        <CardHeader>
          <CardTitle>Replenishment queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything is above its reorder point. 🟢</p>
          ) : (
            <ul className="divide-y text-sm">
              {queue.map((r) => (
                <li key={r.location_id + r.item_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <b>{r.location_code}</b> · {r.item_name}
                  </span>
                  <span className="flex items-center gap-2">
                    {num(r.on_hand, 2)} {r.unit} (reorder at {num(r.reorder_point, 2)}) → send ~{suggestQty(r)} <StockPill status={r.stock_status} />
                    <Link href={`/admin/deliveries?location=${r.location_id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      Deliver
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>On hand by location</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">Item</th>
                {[...byLoc.keys()].map((code) => (
                  <th key={code} className="py-1.5 text-right font-medium">
                    {code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(([itemId, name]) => (
                <tr key={itemId} className="border-t">
                  <td className="py-1.5">{name}</td>
                  {[...byLoc.entries()].map(([code, list]) => {
                    const r = list.find((x) => x.item_id === itemId);
                    return (
                      <td key={code} className="py-1.5 text-right tabular-nums">
                        {r ? (
                          <>
                            {num(r.on_hand, r.is_premix ? 1 : 0)} {r.stock_status === "ok" ? "🟢" : r.stock_status === "low" ? "🟡" : "🔴"}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Cones/cups follow the stores&apos; daily counts. Premix is estimated from the counter (servings ÷ yield) and toppings from sales; weekly audit counts correct any drift.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
