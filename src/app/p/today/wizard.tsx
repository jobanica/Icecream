"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, fmtDate, num, parsePeso, peso, centavosToInput } from "@/lib/format";
import type { DailyCheck, PaymentMethod, Product, Remittance } from "@/lib/types";
import { METHOD_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoCapture } from "@/components/photo-capture";
import { Stepper } from "@/components/stepper";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

type MachineCtx = {
  id: string;
  serial_number: string;
  model: string;
  last_reading: number;
  last_date: string | null;
  today_reading: number | null;
  today_delta: number | null;
};

type SalesLine = {
  product_id: string;
  product_name: string;
  qty: number;
  free_qty: number;
  unit_price_centavos: number;
  subtotal_centavos: number;
};

export type WizardData = {
  date: string;
  today: string;
  canEnter: boolean;
  location: { id: string; code: string; status: string; tolerance: number };
  context: {
    machines: MachineCtx[];
    previous_count: { date: string | null; cones: number; cups: number };
    delivered: { cones: number; cups: number };
  };
  contextError: string | null;
  products: Product[];
  readings: { machine_id: string; reading: number; delta: number; flags: string[] }[];
  count: { cones_remaining: number; cups_remaining: number; cones_used: number; cups_used: number; cones_delivered: number; cups_delivered: number } | null;
  report: {
    id: string;
    report_type: "sales" | "closed";
    net_sales_centavos: number;
    cash_centavos: number;
    gcash_centavos: number;
    other_centavos: number;
    discounts_centavos: number;
    refunds_centavos: number;
    total_servings: number;
    daily_sales_lines: SalesLine[];
  } | null;
  check: DailyCheck | null;
  remittance: Remittance | null;
  remitTo: {
    gcashName?: string | null;
    gcashNumber?: string | null;
    bankName?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
  };
};

const STEPS = ["Counter", "Count", "Sales", "Check", "Remit"] as const;

export function DailyWizard({ data }: { data: WizardData }) {
  const counterDone = data.context.machines.length > 0 && data.context.machines.every((m) => m.today_reading != null);
  const countDone = !!data.count;
  const salesDone = !!data.report;
  const remitDone = data.remittance?.status === "submitted" || data.remittance?.status === "verified";

  const computed = !counterDone ? 1 : !countDone ? 2 : !salesDone ? 3 : !remitDone ? 4 : 6;
  const [override, setOverride] = useState<number | null>(null);
  const step = override ?? computed;
  const doneFlags = [counterDone, countDone, salesDone, salesDone, remitDone];

  const isToday = data.date === data.today;

  if (data.location.status !== "active") {
    return <Notice>This store is not active yet. Please wait for the owner to activate it.</Notice>;
  }

  return (
    <div className="space-y-4">
      <div className={cn("rounded-lg px-3 py-2 text-sm", isToday ? "bg-muted" : "bg-amber-100 text-amber-900")}>
        {isToday ? "End of day for " : "Entering for "} <b>{fmtDate(data.date)}</b>
        {!isToday && " (not today)"}
      </div>

      <ol className="grid grid-cols-5 gap-1">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const reachable = n <= computed || doneFlags[i];
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => setOverride(n === computed ? null : n)}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-md py-1.5 text-[11px] font-medium",
                  step === n ? "bg-primary text-primary-foreground" : doneFlags[i] ? "text-emerald-700" : "text-muted-foreground",
                )}
              >
                <span className="text-base leading-none">{doneFlags[i] ? "✓" : n}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {data.contextError && <Notice tone="red">{data.contextError}</Notice>}

      {step === 1 && <CounterStep data={data} done={counterDone} onNext={() => setOverride(null)} />}
      {step === 2 && <CountStep data={data} done={countDone} onNext={() => setOverride(null)} />}
      {step === 3 && <SalesStep data={data} done={salesDone} onNext={() => setOverride(null)} />}
      {step === 4 && <CheckStep data={data} onNext={() => setOverride(5)} />}
      {step === 5 && <RemitStep data={data} />}
      {step === 6 && (
        <div className="space-y-4 text-center">
          <div className="text-6xl">🎉</div>
          <h2 className="text-xl font-bold">All done for {isToday ? "today" : fmtDate(data.date)}!</h2>
          <p className="text-sm text-muted-foreground">
            {data.remittance?.status === "verified" ? "Your remittance is verified." : "The owner will check your remittance soon."}
          </p>
          <Link href="/p" className="inline-block text-sm underline">
            Back to home
          </Link>
        </div>
      )}
    </div>
  );
}

function Notice({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "red" | "green" }) {
  const cls = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    red: "border-red-300 bg-red-50 text-red-900",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={cn("rounded-xl border p-4 text-sm", cls)}>{children}</div>;
}

function StepCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function run(fn: () => PromiseLike<{ data: any; error: unknown }>, success?: (d: any) => string | void) {
    setBusy(true);
    try {
      const { data, error } = await fn();
      if (error) {
        toast.error(errorMessage(error), { duration: 8000 });
        return false;
      }
      const msg = success?.(data);
      if (msg) toast.success(msg, { duration: 6000 });
      router.refresh();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

function ReadOnlyBlocked({ data }: { data: WizardData }) {
  return data.canEnter ? null : (
    <Notice>This day is too old to enter from the store app. Please message the owner.</Notice>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — machine counter
// ---------------------------------------------------------------------------
function CounterStep({ data, done, onNext }: { data: WizardData; done: boolean; onNext: () => void }) {
  if (data.context.machines.length === 0) {
    return <Notice tone="red">No active machine is set up for this store. Please contact the owner.</Notice>;
  }
  return (
    <StepCard title="1. Machine counter" hint="Read the number on the machine's counter display and take a clear photo of it.">
      {data.context.machines.map((m) => (
        <MachineReading key={m.id} data={data} machine={m} />
      ))}
      {done && (
        <Button className="h-12 w-full text-base" onClick={onNext}>
          Next: count cones & cups →
        </Button>
      )}
    </StepCard>
  );
}

function MachineReading({ data, machine }: { data: WizardData; machine: MachineCtx }) {
  const [reading, setReading] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const { busy, run } = useSubmit();
  const value = reading === "" ? null : Number(reading);
  const preview = value == null ? null : value - machine.last_reading;

  if (machine.today_reading != null) {
    return (
      <div className="rounded-lg bg-emerald-50 p-4 text-emerald-900">
        <div className="text-sm">
          {data.context.machines.length > 1 && <b>{machine.serial_number}: </b>}
          Counter {num(machine.today_reading)}
        </div>
        <div className="text-2xl font-bold">Dispensed: {num(machine.today_delta)} servings ✅</div>
      </div>
    );
  }
  if (!data.canEnter) return <ReadOnlyBlocked data={data} />;

  return (
    <div className="space-y-3">
      {data.context.machines.length > 1 && <div className="text-sm font-semibold">Machine {machine.serial_number}</div>}
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">
        Last reading: <b className="tabular-nums">{num(machine.last_reading)}</b>
        {machine.last_date ? ` (${fmtDate(machine.last_date)})` : " (installation)"}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`r-${machine.id}`}>Counter now</Label>
        <Input
          id={`r-${machine.id}`}
          inputMode="numeric"
          pattern="[0-9]*"
          value={reading}
          onChange={(e) => setReading(e.target.value.replace(/\D/g, ""))}
          placeholder="e.g. 12345"
          className="h-14 text-center text-3xl font-bold tabular-nums"
        />
        {preview != null && (
          <p className={cn("text-center text-sm font-medium", preview < 0 ? "text-red-600" : "text-foreground")}>
            {preview < 0
              ? "⚠️ Lower than the last reading. Check the number again."
              : `Dispensed today: ${num(preview)} servings`}
          </p>
        )}
      </div>
      <PhotoCapture
        locationId={data.location.id}
        kind="counter"
        date={data.date}
        label="Take photo of counter"
        value={photo}
        onUploaded={setPhoto}
      />
      <Button
        className="h-12 w-full text-base"
        disabled={busy || value == null || !photo}
        onClick={() =>
          run(
            () =>
              createClient().rpc("submit_counter_reading", {
                p_location_id: data.location.id,
                p_business_date: data.date,
                p_machine_id: machine.id,
                p_reading: value,
                p_photo_path: photo,
              }),
            (r: { delta: number }) => `Dispensed today: ${r.delta} servings`,
          )
        }
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        {!photo ? "Photo required" : "Save counter reading"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — cones & cups left
// ---------------------------------------------------------------------------
function CountStep({ data, done, onNext }: { data: WizardData; done: boolean; onNext: () => void }) {
  const prev = data.context.previous_count;
  const delivered = data.context.delivered;
  const [cones, setCones] = useState<number | null>(null);
  const [cups, setCups] = useState<number | null>(null);
  const { busy, run } = useSubmit();

  if (done && data.count) {
    return (
      <StepCard title="2. Cones & cups left">
        <div className="grid grid-cols-2 gap-3 text-center">
          <UsedBox label="Cones" left={data.count.cones_remaining} used={data.count.cones_used} />
          <UsedBox label="Cups" left={data.count.cups_remaining} used={data.count.cups_used} />
        </div>
        <Button className="h-12 w-full text-base" onClick={onNext}>
          Next: sales →
        </Button>
      </StepCard>
    );
  }
  if (!data.canEnter) return <ReadOnlyBlocked data={data} />;

  const usedCones = cones == null ? null : prev.cones + delivered.cones - cones;
  const usedCups = cups == null ? null : prev.cups + delivered.cups - cups;

  return (
    <StepCard title="2. Count cones & cups left" hint="Count what is left in the store right now (unopened + opened).">
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">
        Last count{prev.date ? ` (${fmtDate(prev.date)})` : ""}: <b>{prev.cones}</b> cones, <b>{prev.cups}</b> cups
        {(delivered.cones > 0 || delivered.cups > 0) && (
          <>
            <br />
            Delivered since: <b>{delivered.cones}</b> cones, <b>{delivered.cups}</b> cups
          </>
        )}
      </div>
      {(
        [
          ["Cones left", cones, setCones, usedCones, "cones"],
          ["Cups left", cups, setCups, usedCups, "cups"],
        ] as const
      ).map(([label, v, set, used, word]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{label}</div>
            {used != null && (
              <div className={cn("text-sm", used < 0 ? "text-red-600" : "text-muted-foreground")}>
                {used < 0 ? `⚠️ ${-used} more than expected` : `Used today: ${used} ${word}`}
              </div>
            )}
          </div>
          <Stepper value={v ?? 0} onChange={(n) => set(n)} ariaLabel={label} />
        </div>
      ))}
      <Button
        className="h-12 w-full text-base"
        disabled={busy || cones == null || cups == null}
        onClick={() =>
          run(
            () =>
              createClient().rpc("submit_container_count", {
                p_location_id: data.location.id,
                p_business_date: data.date,
                p_cones_remaining: cones,
                p_cups_remaining: cups,
              }),
            (r: { cones_used: number; cups_used: number }) => `Used today: ${r.cones_used} cones, ${r.cups_used} cups`,
          )
        }
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        Save count
      </Button>
      <p className="text-center text-xs text-muted-foreground">Tip: if it&apos;s really 0, tap − once so it shows 0.</p>
    </StepCard>
  );
}

function UsedBox({ label, left, used }: { label: string; left: number; used: number }) {
  return (
    <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900">
      <div className="text-sm">{label} left: {left}</div>
      <div className="text-xl font-bold">Used {used}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — sales report
// ---------------------------------------------------------------------------
function SalesStep({ data, done, onNext }: { data: WizardData; done: boolean; onNext: () => void }) {
  const [closed, setClosed] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [free, setFree] = useState<Record<string, number>>({});
  const [showFree, setShowFree] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  const [gcash, setGcash] = useState("");
  const [other, setOther] = useState("");
  const [discount, setDiscount] = useState("");
  const [refund, setRefund] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useSubmit();

  const gross = useMemo(
    () => data.products.reduce((s, p) => s + (qty[p.id] ?? 0) * p.price_centavos, 0),
    [qty, data.products],
  );
  const servings = data.products.reduce((s, p) => s + ((qty[p.id] ?? 0) + (free[p.id] ?? 0)) * p.servings_per_unit, 0);
  const disc = parsePeso(discount);
  const ref = parsePeso(refund);
  const g = parsePeso(gcash);
  const o = parsePeso(other);
  const net = gross - (disc ?? 0) - (ref ?? 0);
  const cash = net - (g ?? 0) - (o ?? 0);
  const invalid = disc == null || ref == null || g == null || o == null || net < 0 || cash < 0;

  if (done && data.report) {
    const r = data.report;
    return (
      <StepCard title="3. Sales report">
        {r.report_type === "closed" ? (
          <p className="text-sm">Closed / no sales today.</p>
        ) : (
          <ul className="divide-y text-sm">
            {r.daily_sales_lines.map((l) => (
              <li key={l.product_id} className="flex justify-between py-1.5">
                <span>
                  {l.product_name} × {l.qty}
                  {l.free_qty > 0 && <span className="text-muted-foreground"> (+{l.free_qty} free)</span>}
                </span>
                <span className="tabular-nums">{peso(l.subtotal_centavos)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t pt-2 font-bold">
          <span>Total sales</span>
          <span>{peso(r.net_sales_centavos)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Cash {peso(r.cash_centavos)} · GCash {peso(r.gcash_centavos)}
          {r.other_centavos > 0 && ` · Other ${peso(r.other_centavos)}`}
        </p>
        <p className="text-xs text-muted-foreground">Made a mistake? Ask the owner to correct it — sales can&apos;t be edited after sending.</p>
        <Button className="h-12 w-full text-base" onClick={onNext}>
          Next: check →
        </Button>
      </StepCard>
    );
  }
  if (!data.canEnter) return <ReadOnlyBlocked data={data} />;

  const lines = data.products.map((p) => ({ product_id: p.id, qty: qty[p.id] ?? 0, free_qty: free[p.id] ?? 0 }));

  return (
    <StepCard title="3. Sales today" hint="Enter how many of each item you sold.">
      <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" className="size-5" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        We were closed / no sales today
      </label>

      {!closed && (
        <>
          <ul className="space-y-3">
            {data.products.map((p) => (
              <li key={p.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{peso(p.price_centavos)}</div>
                  </div>
                  <Stepper value={qty[p.id] ?? 0} onChange={(n) => setQty({ ...qty, [p.id]: n })} ariaLabel={p.name} />
                </div>
                {showFree && (
                  <div className="flex items-center justify-between gap-2 pl-3 text-sm text-muted-foreground">
                    <span>Free {p.name}</span>
                    <Stepper size="sm" value={free[p.id] ?? 0} onChange={(n) => setFree({ ...free, [p.id]: n })} ariaLabel={`free ${p.name}`} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3 text-sm">
            <button type="button" className="underline" onClick={() => setShowFree(!showFree)}>
              {showFree ? "Hide freebies" : "+ Freebies (free items)"}
            </button>
            <button type="button" className="underline" onClick={() => setShowExtras(!showExtras)}>
              {showExtras ? "Hide discount / refund" : "+ Discount / refund"}
            </button>
          </div>
          {showExtras && (
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput label="Discounts" value={discount} onChange={setDiscount} />
              <MoneyInput label="Refunds" value={refund} onChange={setRefund} />
            </div>
          )}

          <div className="rounded-lg bg-muted p-3">
            <div className="flex justify-between text-sm">
              <span>{servings} servings</span>
              <span>Sales {peso(gross)}</span>
            </div>
            {(disc ?? 0) + (ref ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Less discount / refund</span>
                <span>−{peso((disc ?? 0) + (ref ?? 0))}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{peso(net)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold">How customers paid</div>
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput label="GCash" value={gcash} onChange={setGcash} />
              <MoneyInput label="Other (card, etc.)" value={other} onChange={setOther} />
            </div>
            <div className={cn("flex justify-between rounded-lg border p-3", cash < 0 && "border-red-400 text-red-700")}>
              <span>Cash</span>
              <b className="tabular-nums">{cash < 0 ? "Too much in GCash/other" : peso(cash)}</b>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={closed ? "Why closed?" : ""} />
      </div>

      {!confirming ? (
        <Button
          className="h-12 w-full text-base"
          disabled={(!closed && (servings === 0 || invalid)) || busy}
          onClick={() => setConfirming(true)}
        >
          {closed ? "Send: closed today" : `Review ${peso(net)}`}
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border-2 border-primary p-3">
          <p className="text-sm">
            {closed ? (
              "Send a “closed / no sales” report? The counter and cup/cone count must show no movement."
            ) : (
              <>
                Send sales of <b>{peso(net)}</b> ({servings} servings)? You can&apos;t edit it after sending.
              </>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button
              className="h-12"
              disabled={busy}
              onClick={async () => {
                const ok = await run(
                  () =>
                    createClient().rpc("submit_sales_report", {
                      p_location_id: data.location.id,
                      p_business_date: data.date,
                      p_report_type: closed ? "closed" : "sales",
                      p_lines: closed ? [] : lines,
                      p_cash_centavos: closed ? 0 : cash,
                      p_gcash_centavos: closed ? 0 : g,
                      p_other_centavos: closed ? 0 : o,
                      p_discounts_centavos: closed ? 0 : disc,
                      p_refunds_centavos: closed ? 0 : ref,
                      p_notes: notes || null,
                    }),
                  () => "Sales report sent",
                );
                if (!ok) setConfirming(false);
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              Send
            </Button>
          </div>
        </div>
      )}
    </StepCard>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const invalid = parsePeso(value) == null;
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₱</span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          aria-invalid={invalid}
          className="h-12 pl-7 text-lg tabular-nums"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — three-way check
// ---------------------------------------------------------------------------
function CheckStep({ data, onNext }: { data: WizardData; onNext: () => void }) {
  const c = data.check;
  const [text, setText] = useState(c?.partner_explanation ?? "");
  const { busy, run } = useSubmit();
  if (!c || c.status === "incomplete") {
    return (
      <StepCard title="4. Check">
        <p className="text-sm text-muted-foreground">The check runs after counter, count and sales are all sent.</p>
        <Button className="h-12 w-full" onClick={onNext}>
          Next: remit →
        </Button>
      </StepCard>
    );
  }
  const off = c.max_abs_diff ?? 0;
  const matched = c.status === "matched";
  return (
    <StepCard title="4. Do the numbers match?">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Num label="Machine counter" value={c.counter_delta} />
        <Num label="Sales report" value={c.reported_servings} />
        <Num label="Cones + cups used" value={c.container_servings} />
      </div>
      {matched ? (
        <Notice tone="green">
          <div className="text-lg font-bold">✅ Matched</div>
          {off > 0 ? `Small difference of ${off} — within the allowed ${c.tolerance_servings}.` : "All three numbers agree. Salamat!"}
        </Notice>
      ) : (
        <>
          <Notice tone={c.status === "major" ? "red" : "amber"}>
            <div className="text-lg font-bold">⚠️ Off by {off} servings</div>
            This is OK to send — the owner will review it. Please explain what happened (e.g. &quot;2 spilled&quot;, &quot;test pour after cleaning&quot;).
          </Notice>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What happened?" />
          <Button
            variant="outline"
            className="h-11 w-full"
            disabled={busy || !text.trim() || text === (c.partner_explanation ?? "")}
            onClick={() =>
              run(
                () => createClient().rpc("explain_daily_check", { p_location_id: data.location.id, p_business_date: data.date, p_explanation: text }),
                () => "Explanation saved",
              )
            }
          >
            {c.partner_explanation ? "Update explanation" : "Save explanation"}
          </Button>
        </>
      )}
      <Button className="h-12 w-full text-base" onClick={onNext}>
        Next: remit →
      </Button>
    </StepCard>
  );
}

function Num({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-muted p-2">
      <div className="text-2xl font-bold tabular-nums">{value ?? "—"}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — remit
// ---------------------------------------------------------------------------
function RemitStep({ data }: { data: WizardData }) {
  const rem = data.remittance;
  const [method, setMethod] = useState<PaymentMethod>("gcash");
  const [amount, setAmount] = useState(centavosToInput(rem?.amount_due_centavos));
  const [refNo, setRefNo] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const { busy, run } = useSubmit();

  if (!rem) {
    return <Notice>Send the sales report first.</Notice>;
  }
  if (rem.amount_due_centavos === 0) {
    return <Notice tone="green">No sales today — nothing to remit ✅</Notice>;
  }

  const header = (
    <div className="rounded-xl bg-primary p-4 text-center text-primary-foreground">
      <div className="text-sm opacity-90">Remit {data.date === data.today ? "today" : `for ${fmtDate(data.date)}`}</div>
      <div className="text-4xl font-bold tabular-nums">{peso(rem.amount_due_centavos)}</div>
      <div className="text-xs opacity-90">100% of sales</div>
    </div>
  );

  if (rem.status === "submitted" || rem.status === "verified") {
    return (
      <StepCard title="5. Remit">
        {header}
        <Notice tone={rem.status === "verified" ? "green" : "amber"}>
          <b>{rem.status === "verified" ? "✅ Verified by owner" : "⏳ Sent — waiting for owner to verify"}</b>
          <br />
          {peso(rem.amount_sent_centavos)} via {rem.method ? METHOD_LABELS[rem.method] : "—"} · Ref {rem.reference_no}
        </Notice>
      </StepCard>
    );
  }

  const amt = parsePeso(amount);
  const t = data.remitTo;
  return (
    <StepCard title="5. Remit" hint="Send the full amount, then upload the receipt.">
      {header}
      {rem.status === "rejected" && (
        <Notice tone="red">
          <b>❌ Your last remittance was rejected:</b> {rem.rejection_reason}
          <br />
          Please send again with the correct details.
        </Notice>
      )}

      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <div className="font-semibold">Send to</div>
        {t.gcashNumber && (
          <div className="flex items-center justify-between gap-2">
            <div>
              GCash · {t.gcashName}
              <div className="text-base font-bold tabular-nums">{t.gcashNumber}</div>
            </div>
            <CopyButton text={t.gcashNumber} />
          </div>
        )}
        {t.bankAccountNumber && (
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <div>
              {t.bankName} · {t.bankAccountName}
              <div className="text-base font-bold tabular-nums">{t.bankAccountNumber}</div>
            </div>
            <CopyButton text={t.bankAccountNumber} />
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-2">
          <span>Amount</span>
          <CopyButton text={(rem.amount_due_centavos / 100).toFixed(2)} label="Copy amount" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>How did you send it?</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["gcash", "bank"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn("h-12 rounded-lg border text-sm font-medium", method === m && "border-primary bg-primary/10")}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <MoneyInput label="Amount sent" value={amount} onChange={setAmount} />
      {amt != null && amt !== rem.amount_due_centavos && amt > 0 && (
        <p className="text-sm text-amber-700">⚠️ Different from the amount due ({peso(rem.amount_due_centavos)}).</p>
      )}
      <div className="space-y-1">
        <Label htmlFor="ref">Reference number</Label>
        <Input id="ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} className="h-12 text-lg" placeholder="From your receipt" />
      </div>
      <PhotoCapture
        locationId={data.location.id}
        kind="receipt"
        date={data.date}
        label="Upload receipt (photo or screenshot)"
        value={receipt}
        onUploaded={setReceipt}
        source="any"
      />
      <Button
        className="h-12 w-full text-base"
        disabled={busy || !receipt || !refNo.trim() || amt == null || amt <= 0}
        onClick={() =>
          run(
            () =>
              createClient().rpc("submit_remittance", {
                p_remittance_id: rem.id,
                p_amount_sent_centavos: amt,
                p_method: method,
                p_reference_no: refNo,
                p_receipt_path: receipt,
              }),
            () => "Remittance sent. Salamat!",
          )
        }
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        {!receipt ? "Receipt required" : "Send remittance"}
      </Button>
    </StepCard>
  );
}
