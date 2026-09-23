-- Minimal stand-ins for the Supabase-managed schemas so migrations can be
-- tested against a plain Postgres (CI / no Docker). NOT applied to Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255) unique,
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255), email_change varchar(255),
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text, phone_confirmed_at timestamptz, phone_change text, phone_change_token varchar(255),
  phone_change_sent_at timestamptz, email_change_token_current varchar(255), email_change_confirm_status smallint,
  banned_until timestamptz, reauthentication_token varchar(255), reauthentication_sent_at timestamptz,
  is_sso_user boolean default false, deleted_at timestamptz, is_anonymous boolean default false
);
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz, email text, id uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated, anon, service_role;
grant select, insert on storage.objects to authenticated;
