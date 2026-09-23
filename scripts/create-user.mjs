#!/usr/bin/env node
// Create an admin or staff login (e.g. on a clean database without demo data).
//   node --env-file=.env.local scripts/create-user.mjs admin you@example.com "Your Name"
// Prints a temporary password; change it after first sign-in (Supabase dashboard → Authentication → Users).
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const [role, email, fullName = ""] = process.argv.slice(2);
if (!["admin", "staff"].includes(role) || !email) {
  console.error('Usage: node --env-file=.env.local scripts/create-user.mjs <admin|staff> <email> ["Full Name"]');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const password = randomBytes(9).toString("base64url");
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role },
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error(error.message);
  process.exit(1);
}
const { error: pErr } = await supabase.from("profiles").upsert({ id: data.user.id, role, full_name: fullName });
if (pErr) {
  console.error(pErr.message);
  process.exit(1);
}
console.log(`Created ${role} ${email}\nTemporary password: ${password}`);
