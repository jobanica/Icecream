-- =====================================================================
-- Soft-serve partnership management — foundation
-- Enums, helper functions, profiles, settings, activity log.
-- Conventions:
--   * money is always BIGINT centavos, column suffix _centavos
--   * business dates are DATE in Asia/Manila (private.today_ph())
--   * all mutations of the daily loop go through SECURITY DEFINER RPCs;
--     partners have SELECT-only table access, scoped by RLS
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.user_role as enum ('admin', 'staff', 'partner');
create type public.location_status as enum ('pending', 'active', 'paused', 'terminated');
create type public.container_type as enum ('cone', 'cup', 'none');
create type public.machine_status as enum ('in_storage', 'active', 'retired');
create type public.machine_event_type as enum (
  'installed',     -- placed at a location (baseline reading recorded)
  'reset',         -- counter was reset (reading_before -> reading_after)
  'rollover',      -- counter wrapped at counter_max (system-recorded)
  'correction',    -- a wrongly entered reading is corrected (reading_before = wrong, reading_after = actual)
  'replaced',      -- machine swapped out; new machine gets its own 'installed' event
  'maintenance',
  'condition',
  'removed'
);
create type public.report_type as enum ('sales', 'closed');
create type public.check_status as enum ('incomplete', 'matched', 'minor', 'major');
create type public.discrepancy_cause as enum (
  'waste', 'spillage', 'test_dispense', 'staff_error', 'unexplained', 'other'
);
create type public.remittance_status as enum ('pending', 'submitted', 'verified', 'rejected');
create type public.payment_method as enum ('gcash', 'bank', 'cash', 'other');
create type public.delivery_status as enum ('recorded', 'confirmed', 'disputed', 'cancelled');
create type public.correction_status as enum ('pending', 'approved', 'rejected');
create type public.audit_status as enum ('scheduled', 'in_progress', 'completed');
create type public.audit_section as enum ('sales', 'remittances', 'counter', 'inventory', 'machine', 'finance');
create type public.audit_result as enum ('pass', 'fail', 'na');
create type public.severity as enum ('info', 'minor', 'major');
create type public.reconciliation_status as enum ('draft', 'confirmed', 'paid');
create type public.stock_movement_kind as enum (
  'opening', 'delivery', 'usage', 'count_adjustment', 'wastage', 'transfer'
);

-- ---------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------
create or replace function private.today_ph()
returns date language sql stable
as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- Seed mode lets supabase/seed.sql write historical data through the same
-- RPCs (bypasses "today/yesterday only" and immutability guards).
-- Only honoured for direct database sessions (psql / SQL editor as postgres);
-- API requests arrive as session_user 'authenticator' and can never use it.
create or replace function private.seed_mode()
returns boolean language sql stable
as $$
  select coalesce(current_setting('app.seed_mode', true), '') = 'on'
     and session_user in ('postgres', 'supabase_admin')
$$;

-- ---------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.user_role not null default 'partner',
  full_name    text not null default '',
  phone        text,
  location_id  uuid,               -- FK added after locations exists; partners only
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() and is_active $$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and is_active), false) $$;

-- staff OR admin
create or replace function private.is_team()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role in ('admin','staff') from public.profiles where id = auth.uid() and is_active), false) $$;

create or replace function private.my_location_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select location_id from public.profiles where id = auth.uid() and is_active and role = 'partner' $$;

-- Can the caller act on this location? (team: any, partner: own)
create or replace function private.can_access_location(p_location uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_team() or p_location = private.my_location_id() $$;

grant execute on function private.today_ph(), private.seed_mode(), private.current_user_role(),
  private.is_admin(), private.is_team(), private.my_location_id(), private.can_access_location(uuid)
  to authenticated, service_role;

-- Create/refresh a profile for each auth user. Role and location come from
-- app_metadata, which only the service role can set. GoTrue may write
-- app_metadata in a separate UPDATE after the INSERT, so both are handled.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.user_role := coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'partner');
  v_loc uuid := nullif(new.raw_app_meta_data ->> 'location_id', '')::uuid;
begin
  insert into public.profiles (id, role, full_name, location_id)
  values (new.id, v_role, coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_loc)
  on conflict (id) do update
    set role = case when new.raw_app_meta_data ? 'role' then excluded.role else public.profiles.role end,
        location_id = case when new.raw_app_meta_data ? 'location_id' then excluded.location_id else public.profiles.location_id end,
        full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Global settings (singleton row id = 1)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                              smallint primary key default 1 check (id = 1),
  business_name                   text not null default 'Soft-Serve Partners',
  -- Where partners send remittances (per-location override on locations)
  remit_gcash_name                text,
  remit_gcash_number              text,
  remit_bank_name                 text,
  remit_bank_account_name         text,
  remit_bank_account_number       text,
  -- Reconciliation deduction defaults
  gcash_fee_bps                   integer not null default 0 check (gcash_fee_bps between 0 and 10000),
  other_fee_bps                   integer not null default 0 check (other_fee_bps between 0 and 10000),
  maintenance_reserve_per_week_centavos bigint not null default 0 check (maintenance_reserve_per_week_centavos >= 0),
  -- Daily check defaults for new locations
  default_tolerance_servings      integer not null default 3 check (default_tolerance_servings >= 0),
  default_major_threshold_servings integer not null default 10 check (default_major_threshold_servings >= 0),
  updated_at                      timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Activity log (every mutation on every business table)
-- ---------------------------------------------------------------------
create table public.activity_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,          -- INSERT / UPDATE / DELETE
  location_id uuid,
  old_data    jsonb,
  new_data    jsonb
);
create index activity_log_table_row_idx on public.activity_log (table_name, row_id);
create index activity_log_location_idx on public.activity_log (location_id, occurred_at desc);

create or replace function private.log_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.activity_log (actor_id, table_name, row_id, action, location_id, old_data, new_data)
  values (
    auth.uid(),
    tg_table_name,
    v_row ->> 'id',
    tg_op,
    case when tg_table_name = 'locations' then (v_row ->> 'id')::uuid
         else nullif(v_row ->> 'location_id', '')::uuid end,
    v_old,
    v_new
  );
  return coalesce(new, old);
end $$;

-- Generic updated_at maintenance
create or replace function private.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;

-- Generic "this row can never change" guard
create or replace function private.forbid_change()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  raise exception '% records are permanent and cannot be % — record an adjustment instead',
    replace(tg_table_name, '_', ' '), lower(tg_op) || 'd'
    using errcode = 'P0001';
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger profiles_log after insert or update or delete on public.profiles
  for each row execute function private.log_activity();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_updated_at();
create trigger app_settings_log after insert or update or delete on public.app_settings
  for each row execute function private.log_activity();
