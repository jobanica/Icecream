import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** Current user's profile (cached per request). null when signed out. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, full_name, location_id, is_active")
    .eq("id", user.id)
    .single();
  return (data as Profile) ?? null;
});

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile || !profile.is_active) redirect("/login");
  if (!roles.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}

export function homeFor(role: Role): string {
  if (role === "partner") return "/p";
  if (role === "staff") return "/admin/deliveries";
  return "/admin";
}
