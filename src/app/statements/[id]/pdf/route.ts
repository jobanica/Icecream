import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderStatementPdf } from "@/lib/statement-pdf";

// Partners get their own statements only: RLS on partner_statements decides.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", _req.url));
  const [{ data: st }, { data: settings }] = await Promise.all([
    supabase.from("partner_statements").select("*").eq("id", id).maybeSingle(),
    supabase.from("app_settings").select("business_name").eq("id", 1).maybeSingle(),
  ]);
  if (!st) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderStatementPdf(st, settings?.business_name ?? "Soft-Serve Partners");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${st.statement_no}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
