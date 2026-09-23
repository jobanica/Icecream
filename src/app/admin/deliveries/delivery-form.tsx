"use client";

import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { todayPH } from "@/lib/format";
import type { InventoryItem } from "@/lib/types";
import { recordDelivery } from "./actions";

export function DeliveryForm({
  locations,
  items,
  suggested,
  defaultLocation,
}: {
  locations: { id: string; code: string; store_name: string }[];
  items: InventoryItem[];
  suggested: Record<string, Record<string, number>>;
  defaultLocation?: string;
}) {
  const sug = defaultLocation ? suggested[defaultLocation] ?? {} : {};
  return (
    <ActionForm action={recordDelivery} className="space-y-4" resetOnSuccess key={defaultLocation}>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Location"
          name="location_id"
          defaultValue={defaultLocation ?? ""}
          options={[{ value: "", label: "Choose…" }, ...locations.map((l) => ({ value: l.id, label: `${l.code} · ${l.store_name}` }))]}
        />
        <Field label="Date (counts toward this day's closing count)" name="date" type="date" defaultValue={todayPH()} max={todayPH()} />
        <Field label="Delivery cost (₱)" name="fee" inputMode="decimal" defaultValue="0" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.id} className="grid grid-cols-[1fr_110px] items-end gap-2">
            <div className="text-sm">
              {i.name}
              {sug[i.id] ? <span className="block text-xs text-amber-700">Suggested: {sug[i.id]}</span> : null}
            </div>
            <Field label={`Qty (${i.unit})`} name={`qty_${i.id}`} type="number" step="any" min={0} defaultValue={sug[i.id] ?? ""} />
          </div>
        ))}
      </div>
      <Field label="Notes" name="notes" />
      <Button type="submit" className="h-11 w-full sm:w-auto">
        Record delivery
      </Button>
    </ActionForm>
  );
}
