import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { StatementView } from "@/components/statement-view";
import { AckForm } from "./ack-form";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("partner");
  const { id } = await params;
  const supabase = await createClient();
  const { data: st } = await supabase.from("partner_statements").select("*").eq("id", id).maybeSingle();
  if (!st) notFound();
  return (
    <div className="space-y-6">
      <StatementView snapshot={st.snapshot} statementNo={st.statement_no} />
      <div className="rounded-xl border p-4">
        {st.acknowledged_at ? (
          <p className="text-sm text-emerald-700">
            ✅ You acknowledged this statement {fmtDateTime(st.acknowledged_at)}
            {st.acknowledgment_note ? ` — “${st.acknowledgment_note}”` : ""}
          </p>
        ) : (
          <AckForm id={st.id} />
        )}
      </div>
    </div>
  );
}
