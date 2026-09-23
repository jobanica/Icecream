# Deploying: Supabase + Vercel

About 20 minutes. Order matters: **Supabase first** (the app needs its URL and keys), then Vercel.

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project** in your organization.
2. Name `softserve-partners`, region **Southeast Asia (Singapore) — ap-southeast-1** (closest to the Philippines).
3. Save the **database password** somewhere safe.
4. Wait until the project shows *Healthy*.

## 2. Apply the schema (and demo data)

From this repo on your computer (Node 20+):

```bash
npm install
npx supabase login
npx supabase link --project-ref <your-project-ref>      # ref = the id in the project URL
npx supabase db push                                    # applies supabase/migrations/* in order
```

Demo data (3 stores, two weeks of history, one completed audit → payout). It runs as a direct
database session, which is what lets it write historical dates:

```bash
psql "<connection string from Project Settings → Database → Connection string → URI>" -f supabase/seed.sql
```

(or paste the contents of `supabase/seed.sql` into **SQL Editor** and run it).

No demo data instead? Skip the seed and create your own admin login after step 5:

```bash
node --env-file=.env.local scripts/create-user.mjs admin you@example.com "Your Name"
```

## 3. Supabase Auth settings

**Authentication → Sign In / Providers**

- Email provider: **enabled**
- **Allow new users to sign up: OFF** (only the admin creates logins: store PINs from the app, team via the script)
- Confirm email: can stay on — accounts created by the app are pre-confirmed.

**Authentication → URL Configuration**

- Site URL: your Vercel URL (after step 4), e.g. `https://softserve-partners.vercel.app`

**Storage** — nothing to do: the migration created the private `evidence` bucket and its policies.

## 4. Vercel

1. <https://vercel.com/new> → import **jobanica/icecream**.
2. Framework: Next.js (auto). Root directory: `/`.
3. **Environment variables** (Production + Preview):

   | Name | Value (Supabase → Project Settings → API) |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / secret key — **server only, never share** |
   | `PARTNER_EMAIL_DOMAIN` | `partners.example.com` (must match the seed if you loaded it) |

4. Deploy. To deploy a branch other than `main` (e.g. `claude/affectionate-darwin-vbwwoc`), push it and
   Vercel builds a Preview URL automatically; or set it as the production branch under
   Settings → Git → Production Branch.
5. `vercel.json` pins functions to **sin1 (Singapore)**, next to the database.

If the env vars are missing, the site shows an "Almost there" page instead of errors.

## 5. First sign-in and hardening

- Owner: `admin@example.com` / `demo1234` (demo) — **change this password** in Supabase → Authentication →
  Users, or create your own admin with the script and delete the demo users.
- Stores: `SS-001` + PIN `111111`, etc. (demo) — reset each PIN from **Locations → store → Partner login**.
- Settings → put in your real GCash / bank details and fee / maintenance-reserve defaults.
- Before going live with real stores, start from a clean database:
  `npx supabase db reset --linked --no-seed` (**erases everything**), then create your admin with the script.

## 6. Afterwards

- New migrations: `npx supabase db push`.
- Backups: Supabase Pro takes daily backups (Database → Backups).
- Everything can be exported any time from **Export** in the admin area (CSV or one ZIP).
