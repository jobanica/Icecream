import { NextResponse } from "next/server";
import { strToU8, zipSync } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { buildCsv, DATASETS } from "@/lib/export";

// GET /admin/export/<dataset>?from=&to=&location=   (dataset "all" = ZIP of every CSV)
export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  const url = new URL(req.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const f = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    location: url.searchParams.get("location") || undefined,
  };
  const suffix = `${f.from && f.to ? `_${f.from}_to_${f.to}` : ""}`;
  try {
    if (dataset === "all") {
      const files: Record<string, Uint8Array> = {};
      for (const ds of DATASETS) files[`${ds.key}.csv`] = strToU8((await buildCsv(supabase, ds, f)).csv);
      return new NextResponse(new Uint8Array(zipSync(files)), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="softserve_export${suffix}.zip"`,
          "cache-control": "private, no-store",
        },
      });
    }
    const ds = DATASETS.find((d) => d.key === dataset);
    if (!ds) return new NextResponse("Unknown dataset", { status: 404 });
    const { csv } = await buildCsv(supabase, ds, f);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${ds.key}${suffix}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Export failed", { status: 500 });
  }
}
