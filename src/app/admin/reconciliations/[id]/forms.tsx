"use client";

import { useState } from "react";
import { ActionForm, type ActionResult } from "@/components/action-form";
import { Field, SelectField } from "@/components/field";
import { Button } from "@/components/ui/button";
import { PhotoCapture } from "@/components/photo-capture";
import { centavosToInput, todayPH } from "@/lib/format";

type Act = (p: ActionResult, fd: FormData) => Promise<ActionResult>;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function DeductionsForm({ action, r }: { action: Act; r: any }) {
  const rows = [
    ["product_cost", "Product cost (consumption × unit cost)"],
    ["payment_fees", "Payment fees"],
    ["maintenance_reserve", "Maintenance reserve"],
    ["wastage", "Wastage / stock loss"],
    ["delivery_cost", "Delivery cost"],
    ["other_deductions", "Other deductions"],
  ] as const;
  return (
    <ActionForm action={action} className="space-y-2">
      {rows.map(([k, label]) => (
        <div key={k} className="grid grid-cols-[1fr_140px] items-center gap-2">
          <span className="text-sm">{label}</span>
          <Field label="" name={k} inputMode="decimal" defaultValue={centavosToInput(r[`${k}_centavos`]) || "0"} className="[&_label]:hidden" />
        </div>
      ))}
      <Field label="Notes (internal)" name="notes" defaultValue={r.notes ?? ""} />
      <Button type="submit" variant="outline" size="sm">
        Update deductions
      </Button>
    </ActionForm>
  );
}

export function AdjustmentForm({ action }: { action: Act }) {
  return (
    <ActionForm action={action} className="grid items-end gap-2 sm:grid-cols-[150px_120px_1fr_auto]" resetOnSuccess>
      <SelectField
        label="Direction"
        name="direction"
        defaultValue="deduct"
        options={[
          { value: "deduct", label: "Deduct from partner" },
          { value: "add", label: "Add to partner" },
        ]}
      />
      <Field label="Amount ₱" name="amount" inputMode="decimal" required />
      <Field label="Reason (shown to partner)" name="reason" required />
      <Button type="submit" size="sm">
        Add
      </Button>
    </ActionForm>
  );
}

export function PayoutForm({
  action,
  locationId,
  amountCentavos,
  defaultMethod,
}: {
  action: Act;
  locationId: string;
  amountCentavos: number;
  defaultMethod: string | null;
}) {
  const [proof, setProof] = useState<string | null>(null);
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="Amount ₱ (must equal payable)" name="amount" defaultValue={centavosToInput(amountCentavos)} readOnly />
      <SelectField
        label="Method"
        name="method"
        defaultValue={defaultMethod ?? "gcash"}
        options={[
          { value: "gcash", label: "GCash" },
          { value: "bank", label: "Bank transfer" },
          { value: "cash", label: "Cash" },
          { value: "other", label: "Other" },
        ]}
      />
      <Field label="Reference number" name="reference_no" required />
      <Field label="Date paid" name="paid_on" type="date" defaultValue={todayPH()} max={todayPH()} />
      <input type="hidden" name="proof_path" value={proof ?? ""} />
      <PhotoCapture
        locationId={locationId}
        kind="payout"
        date={todayPH()}
        label="Upload proof of payment"
        value={proof}
        onUploaded={setProof}
        source="any"
        allowPdf
        className="sm:col-span-2"
      />
      <Button type="submit" disabled={!proof} className="sm:col-span-2">
        {proof ? "Record payout" : "Proof of payment required"}
      </Button>
    </ActionForm>
  );
}
