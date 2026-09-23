export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  /** Partners sign in with store code + PIN; this maps to a hidden email login. */
  partnerEmailDomain: process.env.PARTNER_EMAIL_DOMAIN ?? "partners.example.com",
};

export function partnerEmail(locationCode: string) {
  return `${locationCode.trim().toLowerCase()}@${env.partnerEmailDomain}`;
}
