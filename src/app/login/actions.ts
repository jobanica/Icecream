"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { partnerEmail } from "@/lib/env";
import { homeFor } from "@/lib/auth";
import type { Role } from "@/lib/types";

export type LoginState = { error?: string };

export async function signInStore(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const pin = String(formData.get("pin") ?? "").trim();
  const normalized = /^\d{1,}$/.test(code) ? `SS-${code.padStart(3, "0")}` : code;
  if (!/^SS-\d{3,}$/.test(normalized) || !/^\d{6}$/.test(pin)) {
    return { error: "Enter your store code (e.g. SS-001) and 6-digit PIN" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: partnerEmail(normalized), password: pin });
  if (error) {
    return { error: error.status === 429 ? "Too many tries. Wait a few minutes." : "Wrong store code or PIN" };
  }
  redirect("/p");
}

export async function signInTeam(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Wrong email or password" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
  redirect(homeFor((profile?.role as Role) ?? "partner"));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
