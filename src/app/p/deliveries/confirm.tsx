"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { RpcButton } from "@/components/rpc-button";
import { Button } from "@/components/ui/button";

export function DeliveryConfirm({ id }: { id: string }) {
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState("");
  if (!problem) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={() => setProblem(true)}>
          Something is wrong
        </Button>
        <RpcButton fn="confirm_delivery" args={{ p_delivery_id: id, p_all_received: true }} success="Delivery confirmed" className="h-12">
          All received ✓
        </RpcButton>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is missing or damaged?" rows={3} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={() => setProblem(false)}>
          Back
        </Button>
        <RpcButton
          fn="confirm_delivery"
          args={{ p_delivery_id: id, p_all_received: false, p_note: note }}
          success="Problem reported to the owner"
          variant="destructive"
          className="h-12"
          disabled={!note.trim()}
        >
          Report problem
        </RpcButton>
      </div>
    </div>
  );
}
