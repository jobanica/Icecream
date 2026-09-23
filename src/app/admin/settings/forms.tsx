"use client";

import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { centavosToInput } from "@/lib/format";
import type { InventoryItem } from "@/lib/types";
import { saveItem, saveSettings } from "./actions";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function SettingsForm({ s }: { s: any }) {
  return (
    <ActionForm action={saveSettings} className="space-y-4">
      <Field label="Business name" name="business_name" defaultValue={s.business_name} />
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Where stores send remittances (default)</legend>
        <Field label="GCash name" name="remit_gcash_name" defaultValue={s.remit_gcash_name ?? ""} />
        <Field label="GCash number" name="remit_gcash_number" defaultValue={s.remit_gcash_number ?? ""} />
        <Field label="Bank" name="remit_bank_name" defaultValue={s.remit_bank_name ?? ""} />
        <Field label="Account name" name="remit_bank_account_name" defaultValue={s.remit_bank_account_name ?? ""} />
        <Field label="Account number" name="remit_bank_account_number" defaultValue={s.remit_bank_account_number ?? ""} />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Reconciliation deductions (defaults)</legend>
        <Field label="GCash fee %" name="gcash_fee_pct" type="number" step="0.01" min={0} defaultValue={s.gcash_fee_bps / 100} />
        <Field label="Other payment fee %" name="other_fee_pct" type="number" step="0.01" min={0} defaultValue={s.other_fee_bps / 100} />
        <Field label="Maintenance reserve per week (₱)" name="maintenance_reserve" inputMode="decimal" defaultValue={centavosToInput(s.maintenance_reserve_per_week_centavos)} />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Daily check defaults for new locations (servings)</legend>
        <Field label="Tolerance ±" name="default_tolerance_servings" type="number" min={0} defaultValue={s.default_tolerance_servings} />
        <Field label="Major if more than" name="default_major_threshold_servings" type="number" min={0} defaultValue={s.default_major_threshold_servings} />
      </fieldset>
      <Button type="submit">Save settings</Button>
    </ActionForm>
  );
}

export function ItemForm({ item }: { item?: InventoryItem }) {
  const i = item;
  return (
    <ActionForm action={saveItem} className="grid grid-cols-2 items-end gap-2 border-b py-3 sm:grid-cols-[1.5fr_70px_80px_90px_90px_90px_80px_60px_auto]" resetOnSuccess={!i}>
      {i && <input type="hidden" name="id" value={i.id} />}
      <Field label={i ? "Item" : "New item"} name="name" defaultValue={i?.name} required />
      <Field label="Unit" name="unit" defaultValue={i?.unit ?? "pc"} />
      <Field label="Yield (srv)" name="yield_servings" type="number" step="any" min={0.001} defaultValue={i?.yield_servings ?? 1} />
      <Field label="Unit cost ₱" name="unit_cost" inputMode="decimal" defaultValue={centavosToInput(i?.unit_cost_centavos)} />
      <SelectField
        label="Daily count"
        name="container_type"
        defaultValue={i?.container_type ?? "none"}
        options={[
          { value: "none", label: "No" },
          { value: "cone", label: "Cones" },
          { value: "cup", label: "Cups" },
        ]}
      />
      <SelectField
        label="Premix?"
        name="is_premix"
        defaultValue={String(i?.is_premix ?? false)}
        options={[
          { value: "false", label: "No" },
          { value: "true", label: "Yes" },
        ]}
      />
      <Field label="Reorder at" name="default_reorder_point" type="number" step="any" min={0} defaultValue={i?.default_reorder_point ?? 0} />
      <Field label="Order" name="sort_order" type="number" defaultValue={i?.sort_order ?? 0} />
      <Button type="submit" size="sm" variant={i ? "outline" : "default"}>
        {i ? "Save" : "Add"}
      </Button>
    </ActionForm>
  );
}
