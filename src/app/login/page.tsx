import { redirect } from "next/navigation";
import { getProfile, homeFor } from "@/lib/auth";
import { LoginForms } from "./login-forms";

export default async function LoginPage() {
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
