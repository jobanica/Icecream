"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RpcButton } from "@/components/rpc-button";
import { CAUSE_LABELS, type DiscrepancyCause } from "@/lib/types";

export function RemittanceActions({ id }: { id: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  if (rejecting) {
    return (
      <div className="flex gap-2">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to store)" />
        <Button variant="outline" onClick={() => setRejecting(false)}>
          Cancel
        </Button>
        <RpcButton fn="reject_remittance" args={{ p_remittance_id: id, p_reason: reason }} variant="destructive" disabled={!reason.trim()} success="Rejected — store will resubmit">
          Reject
        </RpcButton>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" onClick={() => setRejecting(true)}>
        Reject…
      </Button>
      <RpcButton fn="verify_remittance" args={{ p_remittance_id: id }} success="Verified ✓">
        Verify ✓
      </RpcButton>
    </div>
  );
}

export function ResolveCheck({ id }: { id: string }) {
  const [cause, setCause] = useState<DiscrepancyCause | "">("");
  const [notes, setNotes] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={cause}
        onChange={(e) => setCause(e.target.value as DiscrepancyCause)}
        className="h-8 rounded-lg border bg-background px-2 text-sm"
        aria-label="Cause"
      >
        <option value="">Cause…</option>
        {Object.entries(CAUSE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="min-w-40 flex-1" />
      <RpcButton fn="resolve_daily_check" args={{ p_check_id: id, p_cause: cause, p_notes: notes || null }} disabled={!cause} success="Resolved">
        Resolve
      </RpcButton>
    </div>
  );
}

export function CorrectionActions({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <RpcButton fn="review_sales_correction" args={{ p_correction_id: id, p_approve: false }} variant="outline" success="Correction rejected">
        Reject
      </RpcButton>
      <RpcButton fn="review_sales_correction" args={{ p_correction_id: id, p_approve: true }} confirm="Apply this correction to the sales report?" success="Correction applied">
        Approve
      </RpcButton>
    </div>
  );
}
