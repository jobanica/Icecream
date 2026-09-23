"use client";

import { useState } from "react";
import { ActionForm, type ActionResult } from "@/components/action-form";
import { Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoCapture } from "@/components/photo-capture";
import { RpcButton } from "@/components/rpc-button";
import { centavosToInput, todayPH } from "@/lib/format";
import type { InventoryItem, Product } from "@/lib/types";
import { INSTALL_CHECKLIST } from "@/lib/types";

type Act = (p: ActionResult, fd: FormData) => Promise<ActionResult>;

export function PinForm({ action, hasLogin, code }: { action: Act; hasLogin: boolean; code: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" resetOnSuccess>
      {!hasLogin && <Field label="Partner full name" name="full_name" className="w-48" />}
      <Field label={hasLogin ? "New 6-digit PIN" : "6-digit PIN"} name="pin" inputMode="numeric" pattern="\d{6}" maxLength={6} required className="w-36" />
      <Button type="submit">{hasLogin ? "Reset PIN" : `Create login for ${code}`}</Button>
    </ActionForm>
  );
}

export function AddMachineForm({ action, locationId }: { action: Act; locationId: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="Serial number *" name="serial_number" required />
      <Field label="Model" name="model" />
      <Field label="Purchase value (₱)" name="purchase_value" inputMode="decimal" />
      <Field label="Counter max (rollover)" name="counter_max" inputMode="numeric" placeholder="999999" defaultValue="999999" />
      <Field label="Counter reading at installation *" name="baseline_reading" inputMode="numeric" required />
      <input type="hidden" name="baseline_photo_path" value={photo ?? ""} />
      <PhotoCapture locationId={locationId} kind="machine" date={todayPH()} label="Photo of counter (required)" value={photo} onUploaded={setPhoto} className="sm:col-span-2" />
      <Button type="submit" disabled={!photo} className="sm:col-span-2">
        Add machine
      </Button>
    </ActionForm>
  );
}

export function ResetForm({ action }: { action: Act }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" resetOnSuccess>
      <Field label="Counter before reset" name="reading_before" inputMode="numeric" required className="w-36" />
      <Field label="Counter after reset" name="reading_after" inputMode="numeric" required defaultValue="0" className="w-36" />
      <Field label="What happened" name="description" required className="min-w-48 flex-1" />
      <Button type="submit" variant="outline">
        Record reset
      </Button>
    </ActionForm>
  );
}

export function EventForm({ action }: { action: Act }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" resetOnSuccess>
      <SelectField
        label="Type"
        name="event_type"
        className="w-36"
        options={[
          { value: "maintenance", label: "Maintenance" },
          { value: "condition", label: "Condition note" },
        ]}
      />
      <Field label="Notes" name="description" required className="min-w-48 flex-1" />
      <Field label="Cost (₱)" name="cost" inputMode="decimal" className="w-28" />
      <Button type="submit" variant="outline">
        Log
      </Button>
    </ActionForm>
  );
}

export function CorrectReading({ readings }: { readings: { id: string; business_date: string; reading: number }[] }) {
  const [id, setId] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  if (readings.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <select value={id} onChange={(e) => setId(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm" aria-label="Reading">
        <option value="">Reading to correct…</option>
        {readings.map((r) => (
          <option key={r.id} value={r.id}>
            {r.business_date}: {r.reading}
          </option>
        ))}
      </select>
      <Input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} placeholder="Correct value" className="w-32" inputMode="numeric" />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. photo shows 12050)" className="min-w-48 flex-1" />
      <RpcButton
        fn="correct_counter_reading"
        args={{ p_reading_id: id, p_correct_reading: Number(value), p_reason: reason }}
        disabled={!id || !value || !reason.trim()}
        variant="outline"
        confirm="Correct this reading? The original entry stays on record."
        success="Reading corrected; deltas recomputed"
      >
        Correct
      </RpcButton>
    </div>
  );
}

export function ProductRow({ action, product }: { action: Act; product: Product }) {
  return (
    <ActionForm action={action} className="grid grid-cols-2 items-end gap-2 border-b py-2 sm:grid-cols-[1fr_100px_80px_100px_60px_90px_auto]">
      <input type="hidden" name="id" value={product.id} />
      <Field label="Name" name="name" defaultValue={product.name} />
      <Field label="Price ₱" name="price" defaultValue={centavosToInput(product.price_centavos)} inputMode="decimal" />
      <Field label="Servings" name="servings_per_unit" type="number" min={0} defaultValue={product.servings_per_unit} />
      <SelectField
        label="Container"
        name="container_type"
        defaultValue={product.container_type}
        options={[
          { value: "cone", label: "Cone" },
          { value: "cup", label: "Cup" },
          { value: "none", label: "None" },
        ]}
      />
      <Field label="Order" name="sort_order" type="number" defaultValue={product.sort_order} />
      <SelectField
        label="Active"
        name="is_active"
        defaultValue={String(product.is_active)}
        options={[
          { value: "true", label: "Active" },
          { value: "false", label: "Hidden" },
        ]}
      />
      <Button type="submit" variant="outline" size="sm">
        Save
      </Button>
    </ActionForm>
  );
}

export function NewProductForm({ action }: { action: Act }) {
  return (
    <ActionForm action={action} className="grid grid-cols-2 items-end gap-2 pt-2 sm:grid-cols-[1fr_100px_80px_100px_auto]" resetOnSuccess>
      <Field label="New product" name="name" required />
      <Field label="Price ₱" name="price" inputMode="decimal" required />
      <Field label="Servings" name="servings_per_unit" type="number" min={0} defaultValue={1} />
      <SelectField
        label="Container"
        name="container_type"
        defaultValue="cup"
        options={[
          { value: "cone", label: "Cone" },
          { value: "cup", label: "Cup" },
          { value: "none", label: "None" },
        ]}
      />
      <Button type="submit" size="sm">
        Add
      </Button>
    </ActionForm>
  );
}

export function OpeningInventoryForm({ action, items }: { action: Act; items: InventoryItem[] }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <Field label="Count date" name="date" type="date" defaultValue={todayPH()} className="w-44" />
      <div className="grid gap-2">
        {items.map((i) => (
          <div key={i.id} className="grid grid-cols-[1fr_100px_100px] items-end gap-2">
            <div className="text-sm">
              {i.name}
              {i.container_type !== "none" && <span className="ml-1 text-xs text-primary">(daily count)</span>}
            </div>
            <Field label={`Qty (${i.unit})`} name={`qty_${i.id}`} type="number" step="any" min={0} defaultValue={0} />
            <Field label="Reorder at" name={`rp_${i.id}`} type="number" step="any" min={0} defaultValue={i.default_reorder_point} />
          </div>
        ))}
      </div>
      <Button type="submit">Save opening inventory</Button>
    </ActionForm>
  );
}

export function ChecklistForm({ action, value }: { action: Act; value: Record<string, boolean> }) {
  return (
    <ActionForm action={action} className="space-y-2">
      {INSTALL_CHECKLIST.map((c) => (
        <label key={c.key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={`chk_${c.key}`} defaultChecked={!!value[c.key]} className="size-4" />
          {c.label}
        </label>
      ))}
      <Button type="submit" variant="outline" size="sm">
        Save checklist
      </Button>
    </ActionForm>
  );
}

export function SimpleActionButton({ action, children, variant }: { action: () => Promise<ActionResult>; children: React.ReactNode; variant?: "default" | "outline" }) {
  return (
    <ActionForm action={action}>
      <Button type="submit" variant={variant}>
        {children}
      </Button>
    </ActionForm>
  );
}

export function StatusForm({ action, current }: { action: Act; current: string }) {
  return (
    <ActionForm action={action} className="flex items-end gap-2">
      <SelectField
        label="Status"
        name="status"
        defaultValue={current}
        className="w-36"
        options={[
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
          { value: "terminated", label: "Terminated" },
        ]}
      />
      <Button type="submit" variant="outline" size="sm">
        Update
      </Button>
    </ActionForm>
  );
}
