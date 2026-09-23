"use client";

import { ActionForm, type ActionResult } from "@/components/action-form";
import { Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Location } from "@/lib/types";

export function LocationForm({
  action,
  location,
  submitLabel,
}: {
  action: (p: ActionResult, fd: FormData) => Promise<ActionResult>;
  location?: Partial<Location>;
  submitLabel: string;
}) {
  const l = location ?? {};
  return (
    <ActionForm action={action} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Partner & store</legend>
        <Field label="Partner name *" name="partner_name" defaultValue={l.partner_name} required />
        <Field label="Store name *" name="store_name" defaultValue={l.store_name} required />
        <Field label="Address" name="address" defaultValue={l.address} className="sm:col-span-2" />
        <Field label="Contact phone" name="contact_phone" defaultValue={l.contact_phone ?? ""} inputMode="tel" />
        <Field label="Contact email" name="contact_email" type="email" defaultValue={l.contact_email ?? ""} />
        <Field label="Store hours" name="store_hours" defaultValue={l.store_hours ?? ""} placeholder="9 AM – 9 PM" />
        <Field label="Responsible person" name="responsible_person" defaultValue={l.responsible_person ?? ""} />
        <Field label="Partnership start date" name="partnership_start_date" type="date" defaultValue={l.partnership_start_date ?? ""} />
        <Field label="Partner share %" name="partner_share_pct" type="number" step="0.01" min={0} max={100} defaultValue={l.partner_share_pct ?? 50} hint="Default 50/50" />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Daily check tolerance (servings)</legend>
        <Field label="Matched if within ±" name="tolerance_servings" type="number" min={0} defaultValue={l.tolerance_servings ?? 3} />
        <Field label="Major if more than" name="major_threshold_servings" type="number" min={0} defaultValue={l.major_threshold_servings ?? 10} />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Where the partner remits (leave blank to use global settings)</legend>
        <Field label="GCash name" name="remit_gcash_name" defaultValue={l.remit_gcash_name ?? ""} />
        <Field label="GCash number" name="remit_gcash_number" defaultValue={l.remit_gcash_number ?? ""} />
        <Field label="Bank" name="remit_bank_name" defaultValue={l.remit_bank_name ?? ""} />
        <Field label="Bank account name" name="remit_bank_account_name" defaultValue={l.remit_bank_account_name ?? ""} />
        <Field label="Bank account number" name="remit_bank_account_number" defaultValue={l.remit_bank_account_number ?? ""} />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Partner payout details</legend>
        <SelectField
          label="Method"
          name="payout_method"
          defaultValue={l.payout_method}
          options={[
            { value: "", label: "—" },
            { value: "gcash", label: "GCash" },
            { value: "bank", label: "Bank transfer" },
            { value: "cash", label: "Cash" },
          ]}
        />
        <Field label="Account name" name="payout_account_name" defaultValue={l.payout_account_name ?? ""} />
        <Field label="Account / GCash number" name="payout_account_number" defaultValue={l.payout_account_number ?? ""} />
        <Field label="Bank (if bank)" name="payout_bank_name" defaultValue={l.payout_bank_name ?? ""} />
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="notes" className="text-xs">
          Notes
        </Label>
        <Textarea id="notes" name="notes" defaultValue={l.notes ?? ""} rows={2} />
      </div>
      <Button type="submit">{submitLabel}</Button>
    </ActionForm>
  );
}
