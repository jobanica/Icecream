"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, num, peso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhotoCapture } from "@/components/photo-capture";
import { RpcButton } from "@/components/rpc-button";

type Result = "pass" | "fail" | "na" | null;

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) {
    toast.error(errorMessage(error), { duration: 8000 });
    return null;
  }
  return data ?? true;
}

export function ChecklistItem({
  item,
  locationId,
  date,
  editable,
}: {
  item: { id: string; label: string; result: Result; notes: string | null; photo_path: string | null };
  locationId: string;
  date: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<Result>(item.result);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [showPhoto, setShowPhoto] = useState(false);
  const [photo, setPhoto] = useState<string | null>(item.photo_path);
  const [busy, setBusy] = useState(false);

  async function save(next: Result, nextNotes = notes, nextPhoto: string | null = null) {
    setBusy(true);
    const ok = await rpc("set_audit_item", { p_item_id: item.id, p_result: next, p_notes: nextNotes || null, p_photo_path: nextPhoto });
    setBusy(false);
    if (ok) {
      setResult(next);
      router.refresh();
    }
  }

  const opts: { v: Exclude<Result, null>; label: string; cls: string }[] = [
    { v: "pass", label: "Pass", cls: "bg-emerald-600 text-white border-emerald-600" },
    { v: "fail", label: "Fail", cls: "bg-red-600 text-white border-red-600" },
    { v: "na", label: "N/A", cls: "bg-muted-foreground text-white border-muted-foreground" },
  ];

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm">{item.label}</span>
        {busy && <Loader2 className="size-4 shrink-0 animate-spin" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={!editable || busy}
            onClick={() => save(o.v)}
            className={cn("h-10 min-w-16 rounded-lg border px-3 text-sm font-medium", result === o.v ? o.cls : "bg-background")}
          >
            {o.label}
          </button>
        ))}
        {editable && (
          <button type="button" onClick={() => setShowPhoto(!showPhoto)} className="flex h-10 items-center gap-1 rounded-lg border px-3 text-sm" aria-label="Add photo">
            <Camera className="size-4" /> {photo ? "✓" : ""}
          </button>
        )}
      </div>
      {editable ? (
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (item.notes ?? "") && result && save(result, notes)}
          placeholder={result === "fail" ? "What's wrong? (required for fail)" : "Notes (optional)"}
          className={cn("h-9", result === "fail" && !notes && "border-red-400")}
        />
      ) : (
        item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>
      )}
      {showPhoto && editable && (
        <PhotoCapture
          locationId={locationId}
          kind="audit"
          date={date}
          label="Evidence photo"
          value={photo}
          onUploaded={(p) => {
            setPhoto(p);
            if (p) save(result, notes, p);
          }}
        />
      )}
    </li>
  );
}

type SheetRow = {
  item_id: string;
  item_name: string;
  unit: string;
  container_type: string;
  is_premix: boolean;
  yield_servings: number;
  unit_cost_centavos: number;
  system_qty: number;
  expected_usage: number;
};

export function InventoryCountForm({
  auditId,
  locationId,
  date,
  sheet,
  alreadyCounted,
}: {
  auditId: string;
  locationId: string;
  date: string;
  sheet: SheetRow[];
  alreadyCounted: boolean;
}) {
  const router = useRouter();
  const [actual, setActual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const filled = sheet.every((r) => (actual[r.item_id] ?? "") !== "");

  const rows = sheet.map((r) => {
    const a = actual[r.item_id];
    const v = a === undefined || a === "" ? null : Number(a) - Number(r.system_qty);
    const value = v == null ? 0 : Math.round(v * r.unit_cost_centavos);
    return { r, a, v, value };
  });
  const totalValue = rows.reduce((sum, x) => sum + x.value, 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Count everything at the store (sealed + opened). System stock is as of the end of {date}; count before the store starts selling on the visit day.
        Premix: count partly used bags in tenths (e.g. 3.5).
      </p>
      <ul className="divide-y">
        {rows.map(({ r, a, v, value }) => (
          <li key={r.item_id} className="grid grid-cols-[1fr_96px] items-center gap-2 py-2.5">
            <div className="min-w-0 text-sm">
              <div className="font-medium">{r.item_name}</div>
              <div className="text-xs text-muted-foreground">
                System {num(r.system_qty, 2)} {r.unit}
                {r.is_premix && ` · expected used ${num(r.expected_usage, 2)} (${num(Number(r.expected_usage) * Number(r.yield_servings))} servings)`}
              </div>
              {v != null && (
                <div className={cn("text-xs font-semibold", v < 0 ? "text-red-600" : v > 0 ? "text-sky-700" : "text-emerald-700")}>
                  {v === 0 ? "✓ matches" : `${v > 0 ? "+" : ""}${num(v, 2)} ${r.unit} (${peso(value)})`}
                </div>
              )}
            </div>
            <Input
              inputMode="decimal"
              value={a ?? ""}
              onChange={(e) => setActual({ ...actual, [r.item_id]: e.target.value.replace(/[^\d.]/g, "") })}
              placeholder="Actual"
              className="h-11 text-right text-lg tabular-nums"
              aria-label={`Actual ${r.item_name}`}
            />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
        <span>Total variance value</span>
        <b className={totalValue < 0 ? "text-red-600" : ""}>{peso(totalValue)}</b>
      </div>
      <Button
        className="h-11 w-full"
        disabled={!filled || busy}
        onClick={async () => {
          if (alreadyCounted && !window.confirm("A count was already saved for this audit. Save a new count? (Both stay on record; the latest is used.)")) return;
          setBusy(true);
          const ok = await rpc("submit_inventory_count", {
            p_location_id: locationId,
            p_business_date: date,
            p_audit_id: auditId,
            p_lines: sheet.map((r) => ({ item_id: r.item_id, actual_qty: Number(actual[r.item_id]) })),
          });
          setBusy(false);
          if (ok) {
            toast.success("Count saved — stock adjusted to actual");
            setActual({});
            router.refresh();
          }
        }}
      >
        {busy && <Loader2 className="animate-spin" />}
        {filled ? "Save full count" : "Enter every item to save"}
      </Button>
    </div>
  );
}

export function FindingForm({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [severity, setSeverity] = useState<"info" | "minor" | "major">("minor");
  const [desc, setDesc] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid grid-cols-3 gap-1.5">
        {(["info", "minor", "major"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            className={cn(
              "h-9 rounded-md border text-sm capitalize",
              severity === s && (s === "major" ? "border-red-600 bg-red-50" : s === "minor" ? "border-amber-500 bg-amber-50" : "border-sky-500 bg-sky-50"),
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Finding" rows={2} />
      <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action item (optional)" />
      <Button
        variant="outline"
        className="w-full"
        disabled={!desc.trim() || busy}
        onClick={async () => {
          setBusy(true);
          const ok = await rpc("add_audit_finding", { p_audit_id: auditId, p_severity: severity, p_description: desc, p_action_item: action || null });
          setBusy(false);
          if (ok) {
            setDesc("");
            setAction("");
            router.refresh();
          }
        }}
      >
        Add finding
      </Button>
    </div>
  );
}

export function AuditNotes({ auditId, initial }: { auditId: string; initial: string | null }) {
  const [v, setV] = useState(initial ?? "");
  return (
    <Textarea
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (initial ?? "") && rpc("set_audit_notes", { p_audit_id: auditId, p_notes: v }).then((ok) => ok && toast.success("Notes saved"))}
      rows={3}
      placeholder="Internal notes (not shown to the partner)"
    />
  );
}

export function RemoveFinding({ id }: { id: string }) {
  return (
    <RpcButton fn="remove_audit_finding" args={{ p_finding_id: id }} variant="ghost" className="h-7 px-2 text-xs" success="Removed">
      Remove
    </RpcButton>
  );
}
