import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("admin", "staff");
  const isAdmin = profile.role === "admin";
  const links = [
    ...(isAdmin
      ? [
          { href: "/admin", label: "Inbox" },
          { href: "/admin/dashboard", label: "Dashboard" },
        ]
      : []),
    { href: "/admin/locations", label: "Locations" },
    { href: "/admin/deliveries", label: "Deliveries" },
    { href: "/admin/stock", label: "Stock" },
    { href: "/admin/audits", label: "Audits" },
    ...(isAdmin
      ? [
          { href: "/admin/reconciliations", label: "Payouts" },
          { href: "/admin/export", label: "Export" },
          { href: "/admin/settings", label: "Settings" },
        ]
      : []),
  ];
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href={isAdmin ? "/admin" : "/admin/deliveries"} className="font-bold">
            🍦 <span className="hidden sm:inline">Soft-Serve Partners</span>
          </Link>
          <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
          <form action={signOut} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden xl:inline">
              {profile.full_name} · {profile.role}
            </span>
            <button className="underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
