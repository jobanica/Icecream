import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, fmtDate, todayPH } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pill } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LocationStatus } from "@/lib/types";

const statusTone: Record<LocationStatus, "green" | "amber" | "gray" | "red"> = {
  active: "green",
  pending: "amber",
  paused: "gray",
  terminated: "red",
};

export default async function LocationsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const since = addDays(todayPH(), -6);
  const [{ data: locs }, { data: checks }] = await Promise.all([
    supabase.from("locations").select("*").order("code"),
    supabase.from("daily_checks").select("location_id, status").gte("business_date", since),
  ]);
  const stats = new Map<string, { matched: number; total: number }>();
  for (const c of checks ?? []) {
    const s = stats.get(c.location_id) ?? { matched: 0, total: 0 };
    if (c.status !== "incomplete") s.total++;
    if (c.status === "matched") s.matched++;
    stats.set(c.location_id, s);
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Locations</h1>
        {profile?.role === "admin" && (
          <Link href="/admin/locations/new" className={buttonVariants()}>
            + New location
          </Link>
        )}
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Store</TableHead>
                <TableHead className="hidden sm:table-cell">Partner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Matched days (7d)</TableHead>
                <TableHead className="hidden md:table-cell">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(locs ?? []).map((l) => {
                const s = stats.get(l.id);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">
                      <Link href={`/admin/locations/${l.id}`} className="underline">
                        {l.code}
                      </Link>
                    </TableCell>
                    <TableCell>{l.store_name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{l.partner_name}</TableCell>
                    <TableCell>
                      <Pill t={statusTone[l.status as LocationStatus]}>{l.status}</Pill>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{s ? `${s.matched}/${s.total}` : "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{fmtDate(l.partnership_start_date)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
