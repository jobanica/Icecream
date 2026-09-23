import { cn } from "@/lib/utils";
import type { CheckStatus, RemittanceStatus } from "@/lib/types";

const tone = {
  green: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-100 text-amber-900 ring-amber-200",
  red: "bg-red-100 text-red-800 ring-red-200",
  blue: "bg-sky-100 text-sky-800 ring-sky-200",
  gray: "bg-muted text-muted-foreground ring-border",
} as const;

export type Tone = keyof typeof tone;

export function Pill({ t = "gray", children, className }: { t?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tone[t], className)}>
      {children}
    </span>
  );
}

export function CheckPill({ status, resolved }: { status: CheckStatus | null | undefined; resolved?: boolean | null }) {
  if (!status || status === "incomplete") return <Pill>Incomplete</Pill>;
  if (status === "matched") return <Pill t="green">✅ Matched</Pill>;
  if (resolved) return <Pill t="blue">Resolved ({status})</Pill>;
  return status === "major" ? <Pill t="red">⚠️ Major</Pill> : <Pill t="amber">⚠️ Minor</Pill>;
}

export function RemitPill({ status }: { status: RemittanceStatus | null | undefined }) {
  switch (status) {
    case "verified":
      return <Pill t="green">✅ Verified</Pill>;
    case "submitted":
      return <Pill t="blue">⏳ Checking</Pill>;
    case "rejected":
      return <Pill t="red">❌ Rejected</Pill>;
    case "pending":
      return <Pill t="amber">Not sent</Pill>;
    default:
      return <Pill>—</Pill>;
  }
}

export function StockPill({ status }: { status: "ok" | "low" | "out" }) {
  if (status === "out") return <Pill t="red">🔴 Out</Pill>;
  if (status === "low") return <Pill t="amber">🟡 Low</Pill>;
  return <Pill t="green">🟢 OK</Pill>;
}
