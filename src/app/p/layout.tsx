import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, History, Home, Package } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("partner");
  if (!profile.location_id) redirect("/login");
  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("code, store_name").eq("id", profile.location_id).single();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{loc?.store_name ?? "My store"}</div>
          <div className="text-xs text-muted-foreground">{loc?.code}</div>
        </div>
        <form action={signOut}>
          <button className="rounded-md px-2 py-1 text-xs text-muted-foreground underline">Sign out</button>
        </form>
      </header>
      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-md grid-cols-4 border-t bg-background text-xs">
        {[
          { href: "/p", label: "Home", icon: Home },
          { href: "/p/today", label: "End of day", icon: ClipboardList },
          { href: "/p/history", label: "History", icon: History },
          { href: "/p/stock", label: "Stock", icon: Package },
        ].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-0.5 py-2.5 text-muted-foreground active:bg-muted">
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
