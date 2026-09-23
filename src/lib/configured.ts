/** True when the Supabase env vars are present (false on an unconfigured deploy). */
export const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
