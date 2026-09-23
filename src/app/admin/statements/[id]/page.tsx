import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { StatementView } from "@/components/statement-view";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminStatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createClient();
  const { data: st } = await supabase.from("partner_statements").select("*").eq("id", id).maybeSingle();
  if (!st) notFound();
  return (
    <Card className="mx-auto max-w-3xl">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {st.acknowledged_at ? `Acknowledged by partner ${fmtDateTime(st.acknowledged_at)}` : "Not yet acknowledged by partner"}
          </span>
          <a href={`/statements/${st.id}/pdf`} className={buttonVariants({ size: "sm" })}>
            Download PDF
          </a>
        </div>
        <StatementView snapshot={st.snapshot} statementNo={st.statement_no} />
      </CardContent>
    </Card>
  );
}
