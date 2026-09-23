import Link from "next/link";
import { PRESETS } from "@/lib/range";
import { cn } from "@/lib/utils";

/** Presets + custom from/to (plain GET form, works without JS). */
export function RangeFilter({ base, range }: { base: string; range: { from: string; to: string; key: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {PRESETS.map((p) => (
        <Link
          key={p.key}
          href={`${base}?range=${p.key}`}
          className={cn("rounded-full border px-3 py-1", range.key === p.key ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
        >
          {p.label}
        </Link>
      ))}
      <form action={base} className="flex items-center gap-1">
        <input type="date" name="from" defaultValue={range.from} className="h-8 rounded-md border bg-background px-2" aria-label="From" />
        <span>–</span>
        <input type="date" name="to" defaultValue={range.to} className="h-8 rounded-md border bg-background px-2" aria-label="To" />
        <button className={cn("h-8 rounded-md border px-2", range.key === "custom" && "border-primary")}>Apply</button>
      </form>
    </div>
  );
}
