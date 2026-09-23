# Soft-Serve Partners

Web app for running a network of soft-serve machines in partner stores under a 50/50 profit share.
The owner supplies machine + inventory; each store reports daily (machine counter, cone/cup count,
sales), remits 100% of sales with a receipt, and gets its share after a weekly audit.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · Supabase (Postgres, Auth, RLS, Storage) · Vercel.

## Status

| Phase | Scope | State |
|---|---|---|
| **1 — Daily loop** | Schema + RLS, admin onboarding, partner PIN login, end-of-day wizard, admin inbox (verify/reject remittances, resolve discrepancies, missed days), deliveries + partner confirmation, stock & reorder queue, settings | ✅ built |
| **2 — Audit & payout** | Weekly audit on a phone (checklist with photos, counter-photo spot check, full inventory count with live variance, week's discrepancies, findings) → auto summary (full + partner version) → one-click reconciliation (editable deductions, auto + manual adjustments) → confirm → statement → payout with proof → partner acknowledges + confirms receipt. Statement PDF download. | ✅ built |
| 3 — Scale | Dashboard, audit history, CSV export | ⏳ |

## Quick start (local)

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # applies migrations + supabase/seed.sql
cp .env.example .env.local  # fill in URL / anon key / service role key from `supabase status`
npm run dev
```

Hosted Supabase: `npx supabase link` → `npx supabase db push`, then load the demo data with
`psql "$DATABASE_URL" -f supabase/seed.sql` (optional). In the dashboard, **disable public sign-ups**
(Auth → Providers → Email); accounts are created by the admin only.

### Demo logins (seed)

| Who | Login |
|---|---|
| Owner (admin) | `admin@example.com` / `demo1234` |
| Field staff | `staff@example.com` / `demo1234` |
| Stores | code `SS-001` PIN `111111` · `SS-002` / `222222` · `SS-003` / `333333` |

The seed builds two weeks of history relative to *today* (Asia/Manila): mostly matched days, a few minor
discrepancies, one major unexplained one (SS-001), verified/pending/rejected remittances, one completed
audit → confirmed reconciliation → paid + acknowledged payout (SS-001), and a scheduled audit for this week.
Today is left empty so you can run the end-of-day wizard as any store.

## How it works

### Daily three-way check
For each store/day the database computes, whenever any input arrives:

- **A** counter delta = today's reading − previous reading (walking recorded resets/rollovers)
- **B** reported servings = Σ (qty + free qty) × servings per unit
- **C** container servings = cones used + cups used (+ servings of products without a container / extra servings of multi-serving products, so it's comparable to A/B)

`max(|A−B|, |A−C|, |B−C|)` ≤ tolerance → **matched**; ≤ major threshold → **minor**; else **major**.
Discrepancies never block the remittance; they queue in the admin inbox with the counter photo and the
store's explanation.

### Where rules are enforced
All daily-loop writes go through `SECURITY DEFINER` RPCs (`submit_counter_reading`, `submit_container_count`,
`submit_sales_report`, `submit_remittance`, `verify_remittance`, `record_delivery`, …). Partners have
**select-only** table access, scoped to their location by RLS. Immutability (submitted readings, verified
remittances, completed audits, confirmed reconciliations, statements, payouts) is enforced by triggers.
Every mutation is written to `activity_log`.

### Folder map
```
supabase/migrations/   schema, RPCs, RLS, storage, views (5 files, in order)
supabase/seed.sql      demo data, written through the same RPCs
supabase/tests/        plain-Postgres harness + RLS/business-rule tests
src/app/login          store code + PIN / team email + password
src/app/p              partner (mobile): home, end-of-day wizard, history, stock, deliveries, statements
src/app/admin          inbox, locations/onboarding, deliveries, stock, audits, reconciliations/payouts, settings
src/app/statements     statement PDF download (RLS-scoped, works for admin and partner)
```

### Tests
```bash
# requires a local Postgres 15+ (no Docker needed)
DB=softserve_test supabase/tests/reset_local.sh --seed
psql -d softserve_test -f supabase/tests/rls_and_rules.sql   # prints PASS lines, ends with ALL TESTS PASSED
```

## Defaults chosen (change if they don't match your rules)

- **Login:** stores sign in with **store code + 6-digit PIN** (maps to a hidden `ss-001@PARTNER_EMAIL_DOMAIN`
  Supabase account). Owner resets PINs from the location page. Team uses email + password.
- **Late entries:** a store can submit for **today or yesterday** only; older days must be entered by the owner.
  Remittances for older days can be (re)sent any time.
- **Discrepancy severity:** matched ≤ ±3, minor ≤ 10, major > 10 servings (both per location, defaults in Settings).
- **Deliveries** dated day D count toward D's closing cone/cup count.
- **Counter:** a lower reading is rejected unless an admin recorded a reset. An automatic rollover is
  accepted only if the previous reading was within 1,000 of the counter max and the implied servings ≤ 2,000
  (recorded as a `rollover` machine event). A mistyped reading is fixed by the admin via *Correct a reading*;
  the submitted value stays on record and a `correction` event is logged.
- **Sales payments must add up:** cash + GCash + other = net sales (gross − discounts − refunds).
- **₱0 days** (closed / no sales) auto-verify the remittance — no receipt needed.
- **Partial remittance:** the admin can verify whatever was actually sent; the shortfall stays outstanding.
- **Reconciliation:** profit = sales − (product cost from consumption × unit cost, GCash/other fees %, weekly
  maintenance reserve, stock loss from audit counts, delivery fees). Partner share is computed on profit, then
  automatic adjustments are **deducted from the partner's share**: sales not yet remitted/verified (the store
  still holds that cash) and, for unexplained major discrepancies, unreported servings × average price per paid serving.
- **Payout** must equal the confirmed partner payable (one payout per reconciliation). If the payable is ₱0 or
  negative, no payout is recorded; carry a negative balance as a manual adjustment next period.
- **Verify remittances before reconciling.** Sent-but-unverified remittances count as unremitted. The draft
  reconciliation warns about this and can be discarded and re-created; confirmed ones are permanent.
- **Audit inventory count** compares against system stock at the end of the audit period — count before the
  store starts selling on the visit day. A recount is allowed (both kept; the latest is used in the summary).
- **Audits:** staff and admin conduct audits; only admin reconciles and pays. A scheduled audit that hasn't
  started can be deleted; checklist answers need a started audit; completed audits are permanent.
- **Statement PDF** uses "PHP" instead of "₱" (the built-in PDF fonts have no peso sign).
- Remittance destination: global GCash/bank in Settings, overridable per location.

## Environment

See `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is only used server-side to create/reset partner logins.
