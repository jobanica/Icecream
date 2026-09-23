import { addDays, todayPH } from "@/lib/format";

export const PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
] as const;

/** Resolve ?range=7d|… or ?from=&to= into an inclusive date range (Manila dates). */
export function resolveRange(sp: { range?: string; from?: string; to?: string }, fallback = "7d") {
  const today = todayPH();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (sp.from && sp.to && iso.test(sp.from) && iso.test(sp.to) && sp.from <= sp.to) {
    return { from: sp.from, to: sp.to, key: "custom" };
  }
  const key = sp.range ?? fallback;
  switch (key) {
    case "14d":
      return { from: addDays(today, -13), to: today, key };
    case "30d":
      return { from: addDays(today, -29), to: today, key };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today, key };
    case "lastmonth": {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev, key };
    }
    default:
      return { from: addDays(today, -6), to: today, key: "7d" };
  }
}
