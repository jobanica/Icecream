/** All money is stored as integer centavos. */
const pesoFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function peso(centavos: number | string | null | undefined): string {
  const n = Number(centavos ?? 0);
  return pesoFmt.format(n / 100);
}

/** "1,234.50" or "1234.5" -> 123450. Returns null for invalid input. */
export function parsePeso(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** centavos -> "1234.50" for input fields */
export function centavosToInput(centavos: number | null | undefined): string {
  if (!centavos) return "";
  const s = (centavos / 100).toFixed(2);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

export function num(n: number | string | null | undefined, digits = 0): string {
  return Number(n ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export const TZ = "Asia/Manila";

/** Today's business date in Manila as YYYY-MM-DD */
export function todayPH(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-09-23" -> "Wed, Sep 23" */
export function fmtDate(date: string | null | undefined, opts?: { year?: boolean }): string {
  if (!date) return "—";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-PH", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(opts?.year ? { year: "numeric" } : {}),
  });
}

export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-PH", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Supabase/PostgREST errors carry the message raised in SQL. */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
