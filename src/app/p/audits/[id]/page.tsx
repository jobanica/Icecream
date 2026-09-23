import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditSummaryView } from "@/components/audit-summary";

export default async function PartnerAuditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("partner");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("audit_partner_summaries").select("summary").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Weekly audit summary</h1>
      <AuditSummaryView summary={data.summary} partner />
    </div>
  );
}
