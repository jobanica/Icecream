"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { RpcButton } from "@/components/rpc-button";

export function AckForm({ id }: { id: string }) {
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-sm">Please review the numbers above. If you have questions, write them below or message the owner.</p>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Comment (optional)" />
      <RpcButton fn="acknowledge_statement" args={{ p_statement_id: id, p_note: note || null }} success="Statement acknowledged" className="h-12 w-full">
        I have reviewed this statement
      </RpcButton>
    </div>
  );
}
