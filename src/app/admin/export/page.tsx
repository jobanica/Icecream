import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DATASETS } from "@/lib/export";
import { resolveRange } from "@/lib/range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; location?: string }> }) {
  await requireRole("admin");
  const sp = await searchParams;
  const range = resolveRange(sp, "30d");
  const supabase = await createClient();
  const { data: locs } = await supabase.from("locations").select("id, code, store_name").order("code");
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...(sp.location ? { location: sp.location } : {}) }).toString();

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Export CSV</h1>
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-2 text-sm">
            <label className="space-y-1">
              <span className="block text-xs">From</span>
              <input type="date" name="from" defaultValue={range.from} className="h-8 rounded-md border bg-background px-2" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs">To</span>
              <input type="date" name="to" defaultValue={range.to} className="h-8 rounded-md border bg-background px-2" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs">Location</span>
              <select name="location" defaultValue={sp.location ?? ""} className="h-8 rounded-md border bg-background px-2">
                <option value="">All locations</option>
                {(locs ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.store_name}
                  </option>
                ))}
              </select>
            </label>
            <button className={buttonVariants({ variant: "outline", size: "sm" })}>Apply</button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Dated records are filtered by business date (or by when they happened, Manila time). Master data (locations, machines, products, items, stock on hand) is always exported in full.
            Every money column also has a <code>_php</code> column in pesos.
          </p>
        </CardContent>
      </Card>

      <a href={`/admin/export/all?${qs}`} className={buttonVariants({ className: "h-11" })}>
        Download everything (ZIP of {DATASETS.length} CSV files)
      </a>

      <Card>
        <CardContent>
          <ul className="divide-y text-sm">
            {DATASETS.map((d) => (
              <li key={d.key} className="flex items-center justify-between gap-2 py-2">
                <span>{d.label}</span>
                <a href={`/admin/export/${d.key}?${qs}`} className="text-sm underline">
                  {d.key}.csv
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
