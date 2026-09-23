import { redirect } from "next/navigation";
import { getProfile, homeFor } from "@/lib/auth";
import { LoginForms } from "./login-forms";
import { isConfigured } from "@/lib/configured";

export default async function LoginPage() {
  if (!isConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4 text-center">
        <div className="text-5xl" aria-hidden>🍦</div>
        <h1 className="text-xl font-bold">Almost there</h1>
        <p className="text-sm text-muted-foreground">
          The app is deployed but not connected to its database yet. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
          SUPABASE_SERVICE_ROLE_KEY in the hosting settings and redeploy (see DEPLOY.md).
        </p>
      </main>
    );
  }
  const profile = await getProfile();
  if (profile) redirect(homeFor(profile.role));
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <div className="text-5xl" aria-hidden>🍦</div>
        <h1 className="mt-2 text-2xl font-bold">Soft-Serve Partners</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue</p>
      </div>
      <LoginForms />
    </main>
  );
}
