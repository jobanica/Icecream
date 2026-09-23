-- =====================================================================
-- Daily loop: counter readings, container counts, sales reports,
-- three-way daily checks, remittances, deliveries.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Timestamp for a record. In seed mode, historical records are stamped at
-- 21:00 Manila on their business date so the counter chain orders correctly.
create or replace function private.stamp(p_business_date date, p_offset interval default '0'::interval)
returns timestamptz language sql stable
as $$
  select case when private.seed_mode()
    then ((p_business_date + time '21:00') at time zone 'Asia/Manila') + p_offset
    else clock_timestamp() end
$$;

-- Validates that the caller may submit daily-flow data for this location/date.
create or replace function private.assert_can_submit(p_location_id uuid, p_business_date date)
returns public.locations
language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.locations;
  v_today date := private.today_ph();
begin
  select * into l from public.locations where id = p_location_id;
  if not found then
    raise exception 'Location not found' using errcode = 'P0001';
  end if;
  if private.seed_mode() then
    return l;
  end if;
  if not private.can_access_location(p_location_id) then
    raise exception 'You do not have access to this store' using errcode = '42501';
  end if;
  if l.status <> 'active' then
    raise exception 'Store % is not active (status: %)', l.code, l.status using errcode = 'P0001';
  end if;
  if p_business_date > v_today then
    raise exception 'Date % is in the future', p_business_date using errcode = 'P0001';
  end if;
  if l.opening_count_date is not null and p_business_date < l.opening_count_date then
    raise exception 'Date % is before this store opened (%)', p_business_date, l.opening_count_date using errcode = 'P0001';
  end if;
  -- partners may only submit for today, or yesterday (late closing)
  if not private.is_team() and p_business_date < v_today - 1 then
    raise exception 'You can only submit for today or yesterday. Ask admin to enter older days.' using errcode = 'P0001';
  end if;
  return l;
end $$;

-- Required photos must be real uploads inside the location's folder.
create or replace function private.assert_photo(p_location_id uuid, p_path text, p_label text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_path is null or btrim(p_path) = '' then
    raise exception '% photo is required', p_label using errcode = 'P0001';
  end if;
  if split_part(p_path, '/', 1) <> p_location_id::text then
    raise exception '% photo must be uploaded to this store''s folder', p_label using errcode = 'P0001';
  end if;
  if private.seed_mode() then
    return;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'evidence' and name = p_path) then
    raise exception '% photo was not uploaded. Please take the photo again.', p_label using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Counter readings
-- ---------------------------------------------------------------------
create table public.counter_readings (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid not null references public.locations (id),
  machine_id          uuid not null references public.machines (id),
  business_date       date not null,
  submitted_reading   bigint not null check (submitted_reading >= 0),  -- exactly what was entered; never changes
  reading             bigint not null check (reading >= 0),            -- effective reading (differs only after an admin correction)
  photo_path          text not null,
  previous_reading    bigint not null,           -- previous effective reading, or machine baseline
  previous_date       date,                      -- null = baseline
  previous_reading_id uuid references public.counter_readings (id),
  delta               bigint not null check (delta >= 0),   -- servings dispensed since previous reading
  events_applied      uuid[] not null default '{}',
  flags               text[] not null default '{}',         -- gap:N, rollover, corrected
  reported_by         uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  unique (machine_id, business_date)
);
create index counter_readings_location_date_idx on public.counter_readings (location_id, business_date);

-- Submitted counter readings are immutable. Only the admin correction
-- routine (which writes a 'correction' machine event) may restate the
-- effective reading / delta.
create or replace function private.counter_readings_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Counter readings are permanent and cannot be deleted' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.counter_recompute', true), '') <> 'on'
     or new.submitted_reading <> old.submitted_reading
     or new.photo_path <> old.photo_path
     or new.business_date <> old.business_date
     or new.machine_id <> old.machine_id
     or new.location_id <> old.location_id
     or new.reported_by is distinct from old.reported_by
     or new.created_at <> old.created_at then
    raise exception 'Submitted counter readings cannot be edited — ask admin to record a correction' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger counter_readings_guard before update or delete on public.counter_readings
  for each row execute function private.counter_readings_guard();

-- Walk the counter chain for one machine from a base reading to a new reading,
-- applying reset / rollover events recorded in between.
create or replace function private.counter_delta(
  p_machine_id uuid,
  p_base bigint,
  p_base_time timestamptz,
  p_reading bigint,
  p_until timestamptz,
  out delta bigint,
  out events uuid[],
  out needs_rollover boolean,
  out running bigint      -- counter position after applying events
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_running bigint := p_base;
  e public.machine_events;
begin
  delta := 0;
  events := '{}';
  needs_rollover := false;
  for e in
    select * from public.machine_events
    where machine_id = p_machine_id
      and event_type in ('reset', 'rollover')
      and occurred_at > p_base_time
      and occurred_at <= p_until
    order by occurred_at, created_at
  loop
    if e.reading_before < v_running then
      raise exception 'Machine event on % says the counter was % before the reset, but it was already %. Fix the event.',
        (e.occurred_at at time zone 'Asia/Manila')::date, e.reading_before, v_running using errcode = 'P0001';
    end if;
    delta := delta + (e.reading_before - v_running) + (case when e.event_type = 'rollover' then 1 else 0 end);
    v_running := e.reading_after;
    events := events || e.id;
  end loop;
  running := v_running;
  if p_reading < v_running then
    needs_rollover := true;
    return;
  end if;
  delta := delta + (p_reading - v_running);
end $$;

create or replace function public.submit_counter_reading(
  p_location_id uuid,
  p_business_date date,
  p_machine_id uuid,
  p_reading bigint,
  p_photo_path text
)
returns public.counter_readings
language plpgsql security definer set search_path = ''
as $$
declare
  m public.machines;
  prev public.counter_readings;
  v_base bigint;
  v_base_time timestamptz;
  v_prev_date date;
  v_stamp timestamptz := private.stamp(p_business_date);
  v_flags text[] := '{}';
  v_calc record;
  v_wrap bigint;
  v_event_id uuid;
  r public.counter_readings;
begin
  perform private.assert_can_submit(p_location_id, p_business_date);
  if p_reading is null or p_reading < 0 then
    raise exception 'Enter the number shown on the machine counter' using errcode = 'P0001';
  end if;

  select * into m from public.machines where id = p_machine_id for update;
  if not found or m.location_id is distinct from p_location_id or m.status <> 'active' then
    raise exception 'This machine is not active at this store' using errcode = 'P0001';
  end if;
  perform private.assert_photo(p_location_id, p_photo_path, 'Counter');

  select * into prev from public.counter_readings
   where machine_id = m.id order by business_date desc limit 1;
  if found then
    if prev.business_date = p_business_date then
      raise exception 'The counter reading for % is already submitted', p_business_date using errcode = '23505';
    elsif prev.business_date > p_business_date then
      raise exception 'A later reading (%) already exists. Older days cannot be added.', prev.business_date using errcode = 'P0001';
    end if;
    v_base := prev.reading;
    v_base_time := prev.created_at;
    v_prev_date := prev.business_date;
  else
    v_base := m.baseline_reading;
    v_base_time := m.installed_at;
    v_prev_date := (m.installed_at at time zone 'Asia/Manila')::date;
  end if;

  select * into v_calc from private.counter_delta(m.id, v_base, v_base_time, p_reading, v_stamp);

  if v_calc.needs_rollover then
    -- Allow an automatic rollover only when the counter was close to its max
    -- and the implied servings are plausible; otherwise reject.
    v_wrap := case when m.counter_max is not null
                   then (m.counter_max - v_calc.running) + 1 + p_reading end;
    if v_wrap is null or v_calc.running < m.counter_max - 1000 or v_wrap > 2000 then
      raise exception 'Reading % is lower than the last reading % (%). Check the number on the counter. If the machine counter was reset or replaced, ask admin to record it first.',
        p_reading, v_calc.running, coalesce(v_prev_date::text, 'installation') using errcode = 'P0001';
    end if;
    insert into public.machine_events (machine_id, location_id, event_type, occurred_at, reading_before, reading_after, description, recorded_by)
    values (m.id, p_location_id, 'rollover', v_stamp, m.counter_max, 0,
            'Automatic: counter rolled over past ' || m.counter_max, auth.uid())
    returning id into v_event_id;
    select * into v_calc from private.counter_delta(m.id, v_base, v_base_time, p_reading, v_stamp);
    v_flags := v_flags || 'rollover'::text;
  end if;

  if v_prev_date is not null and p_business_date - v_prev_date > 1 then
    v_flags := v_flags || ('gap:' || (p_business_date - v_prev_date - 1))::text;
  end if;

  insert into public.counter_readings (
    location_id, machine_id, business_date, submitted_reading, reading, photo_path,
    previous_reading, previous_date, previous_reading_id, delta, events_applied, flags,
    reported_by, created_at)
  values (
    p_location_id, m.id, p_business_date, p_reading, p_reading, p_photo_path,
    v_base, case when prev.id is not null then v_prev_date end, prev.id, v_calc.delta, v_calc.events, v_flags,
    auth.uid(), v_stamp)
  returning * into r;

  perform private.recompute_daily_check(p_location_id, p_business_date);
  return r;
end $$;

-- Admin: restate a wrongly entered reading. The submitted value stays on the
-- row; a 'correction' machine event is the permanent record of the change.
create or replace function public.correct_counter_reading(p_reading_id uuid, p_correct_reading bigint, p_reason text)
returns public.counter_readings
language plpgsql security definer set search_path = ''
as $$
declare
  r public.counter_readings;
  nxt public.counter_readings;
  v_calc record;
  v_base_time timestamptz;
  m public.machines;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can correct counter readings' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = 'P0001';
  end if;
  select * into r from public.counter_readings where id = p_reading_id for update;
  if not found then
    raise exception 'Reading not found' using errcode = 'P0001';
  end if;
  select * into m from public.machines where id = r.machine_id;

  insert into public.machine_events (machine_id, location_id, event_type, occurred_at, reading_before, reading_after, description, recorded_by)
  values (r.machine_id, r.location_id, 'correction', clock_timestamp(), r.reading, p_correct_reading,
          'Reading for ' || r.business_date || ' corrected: ' || p_reason, auth.uid());

  perform set_config('app.counter_recompute', 'on', true);

  v_base_time := coalesce((select created_at from public.counter_readings where id = r.previous_reading_id), m.installed_at);
  select * into v_calc from private.counter_delta(r.machine_id, r.previous_reading, v_base_time, p_correct_reading, r.created_at);
  if v_calc.needs_rollover then
    raise exception 'Corrected reading % is lower than the previous reading %', p_correct_reading, r.previous_reading using errcode = 'P0001';
  end if;
  update public.counter_readings
     set reading = p_correct_reading, delta = v_calc.delta,
         flags = array(select distinct unnest(flags || '{corrected}'::text[]))
   where id = r.id
  returning * into r;

  select * into nxt from public.counter_readings where previous_reading_id = r.id;
  if found then
    select * into v_calc from private.counter_delta(nxt.machine_id, r.reading, r.created_at, nxt.reading, nxt.created_at);
    if v_calc.needs_rollover then
      raise exception 'Corrected reading % is higher than the next day''s reading %', p_correct_reading, nxt.reading using errcode = 'P0001';
    end if;
    update public.counter_readings set previous_reading = r.reading, delta = v_calc.delta where id = nxt.id;
    perform private.recompute_daily_check(nxt.location_id, nxt.business_date);
  end if;

  perform set_config('app.counter_recompute', 'off', true);
  perform private.recompute_daily_check(r.location_id, r.business_date);
  return r;
end $$;

-- Admin: record a counter reset / replacement (so deltas stay correct)
create or replace function public.record_counter_reset(
  p_machine_id uuid, p_reading_before bigint, p_reading_after bigint, p_description text, p_photo_path text default null
)
returns public.machine_events
language plpgsql security definer set search_path = ''
as $$
declare
  m public.machines;
  e public.machine_events;
  v_last bigint;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can record a counter reset' using errcode = '42501';
  end if;
  select * into m from public.machines where id = p_machine_id for update;
  select reading into v_last from public.counter_readings where machine_id = p_machine_id order by business_date desc limit 1;
  v_last := coalesce(v_last, m.baseline_reading);
  if p_reading_before < v_last then
    raise exception 'Reading before reset (%) cannot be lower than the last recorded reading (%)', p_reading_before, v_last using errcode = 'P0001';
  end if;
  insert into public.machine_events (machine_id, location_id, event_type, occurred_at, reading_before, reading_after, description, photo_path, recorded_by)
  values (p_machine_id, m.location_id, 'reset', clock_timestamp(), p_reading_before, p_reading_after, coalesce(p_description, ''), p_photo_path, auth.uid())
  returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------
-- Daily container counts (cones / cups left at closing)
-- ---------------------------------------------------------------------
create table public.daily_container_counts (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references public.locations (id),
  business_date    date not null,
  cones_remaining  integer not null check (cones_remaining >= 0),
  cups_remaining   integer not null check (cups_remaining >= 0),
  -- computed by the system
  previous_date    date,
  previous_cones   integer not null default 0,
  previous_cups    integer not null default 0,
  cones_delivered  integer not null default 0,
  cups_delivered   integer not null default 0,
  cones_used       integer not null default 0,   -- previous + delivered − remaining
  cups_used        integer not null default 0,
  submitted_by     uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  unique (location_id, business_date)
);

create or replace function private.container_counts_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Container counts are permanent and cannot be deleted' using errcode = 'P0001';
  end if;
  if new.cones_remaining <> old.cones_remaining or new.cups_remaining <> old.cups_remaining
     or new.business_date <> old.business_date or new.location_id <> old.location_id
     or new.submitted_by is distinct from old.submitted_by or new.created_at <> old.created_at then
    raise exception 'Submitted counts cannot be edited' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger daily_container_counts_guard before update or delete on public.daily_container_counts
  for each row execute function private.container_counts_guard();

create or replace function private.item_for_container(p_type public.container_type)
returns uuid language sql stable security definer set search_path = ''
as $$ select id from public.inventory_items where container_type = p_type and is_active limit 1 $$;

create or replace function private.delivered_containers(
  p_location_id uuid, p_type public.container_type, p_after date, p_through date)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  return (select coalesce(sum(dl.qty), 0)::integer
    from public.delivery_lines dl
    join public.deliveries d on d.id = dl.delivery_id
    join public.inventory_items i on i.id = dl.item_id
   where d.location_id = p_location_id
     and d.status <> 'cancelled'
     and i.container_type = p_type
     and (p_after is null or d.business_date > p_after)
     and d.business_date <= p_through);
end $$;

-- Recompute derived fields + stock usage for one container count row.
create or replace function private.refresh_container_count(p_location_id uuid, p_business_date date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.daily_container_counts;
  prev public.daily_container_counts;
  l public.locations;
  v_prev_date date;
  v_prev_cones integer;
  v_prev_cups integer;
  v_cone_item uuid := private.item_for_container('cone');
  v_cup_item uuid := private.item_for_container('cup');
begin
  select * into c from public.daily_container_counts
   where location_id = p_location_id and business_date = p_business_date;
  if not found then
    return;
  end if;
  select * into l from public.locations where id = p_location_id;
  select * into prev from public.daily_container_counts
   where location_id = p_location_id and business_date < p_business_date
   order by business_date desc limit 1;
  if found then
    v_prev_date := prev.business_date;
    v_prev_cones := prev.cones_remaining;
    v_prev_cups := prev.cups_remaining;
  else
    v_prev_date := l.opening_count_date;
    v_prev_cones := coalesce(l.opening_cones, 0);
    v_prev_cups := coalesce(l.opening_cups, 0);
  end if;

  update public.daily_container_counts
     set previous_date = v_prev_date,
         previous_cones = v_prev_cones,
         previous_cups = v_prev_cups,
         cones_delivered = private.delivered_containers(p_location_id, 'cone', v_prev_date, p_business_date),
         cups_delivered  = private.delivered_containers(p_location_id, 'cup', v_prev_date, p_business_date)
   where id = c.id
  returning * into c;
  update public.daily_container_counts
     set cones_used = c.previous_cones + c.cones_delivered - c.cones_remaining,
         cups_used  = c.previous_cups + c.cups_delivered - c.cups_remaining
   where id = c.id
  returning * into c;

  -- cone / cup usage in the stock ledger follows the physical count
  delete from public.stock_movements where ref_type = 'container_count' and ref_id = c.id;
  if v_cone_item is not null and c.cones_used <> 0 then
    insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note, created_by)
    values (p_location_id, v_cone_item, p_business_date, 'usage', -c.cones_used, 'container_count', c.id, 'Daily cone count', c.submitted_by);
  end if;
  if v_cup_item is not null and c.cups_used <> 0 then
    insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note, created_by)
    values (p_location_id, v_cup_item, p_business_date, 'usage', -c.cups_used, 'container_count', c.id, 'Daily cup count', c.submitted_by);
  end if;
end $$;

create or replace function public.submit_container_count(
  p_location_id uuid, p_business_date date, p_cones_remaining integer, p_cups_remaining integer
)
returns public.daily_container_counts
language plpgsql security definer set search_path = ''
as $$
declare
  l public.locations;
  c public.daily_container_counts;
begin
  l := private.assert_can_submit(p_location_id, p_business_date);
  if p_cones_remaining is null or p_cups_remaining is null or p_cones_remaining < 0 or p_cups_remaining < 0 then
    raise exception 'Enter how many cones and cups are left (0 or more)' using errcode = 'P0001';
  end if;
  if l.opening_count_date is null then
    raise exception 'Opening cone/cup count is not set for this store. Ask admin.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.daily_container_counts
              where location_id = p_location_id and business_date >= p_business_date) then
    raise exception 'The cone/cup count for % (or a later day) is already submitted', p_business_date using errcode = '23505';
  end if;
  insert into public.daily_container_counts (location_id, business_date, cones_remaining, cups_remaining, submitted_by, created_at)
  values (p_location_id, p_business_date, p_cones_remaining, p_cups_remaining, auth.uid(), private.stamp(p_business_date, '1 minute'))
  returning * into c;
  perform private.refresh_container_count(p_location_id, p_business_date);
  perform private.recompute_daily_check(p_location_id, p_business_date);
  select * into c from public.daily_container_counts where id = c.id;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Daily sales reports
-- ---------------------------------------------------------------------
create table public.daily_sales_reports (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations (id),
  business_date      date not null,
  report_type        public.report_type not null default 'sales',
  gross_sales_centavos bigint not null default 0 check (gross_sales_centavos >= 0),
  discounts_centavos bigint not null default 0 check (discounts_centavos >= 0),
  refunds_centavos   bigint not null default 0 check (refunds_centavos >= 0),
  net_sales_centavos bigint not null default 0 check (net_sales_centavos >= 0),  -- = amount to remit
  cash_centavos      bigint not null default 0 check (cash_centavos >= 0),
  gcash_centavos     bigint not null default 0 check (gcash_centavos >= 0),
  other_centavos     bigint not null default 0 check (other_centavos >= 0),
  total_servings     integer not null default 0,        -- incl. freebies
  free_servings      integer not null default 0,
  notes              text,
  submitted_by       uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  corrected_at       timestamptz,
  unique (location_id, business_date),
  constraint net_matches check (net_sales_centavos = gross_sales_centavos - discounts_centavos - refunds_centavos),
  constraint payments_match check (cash_centavos + gcash_centavos + other_centavos = net_sales_centavos)
);

create table public.daily_sales_lines (
  id                   uuid primary key default gen_random_uuid(),
  report_id            uuid not null references public.daily_sales_reports (id),
  location_id          uuid not null references public.locations (id),
  product_id           uuid not null references public.products (id),
  product_name         text not null,               -- snapshot
  unit_price_centavos  bigint not null,             -- snapshot
  servings_per_unit    integer not null,            -- snapshot
  container_type       public.container_type not null,  -- snapshot
  qty                  integer not null default 0 check (qty >= 0),       -- paid
  free_qty             integer not null default 0 check (free_qty >= 0),  -- freebies: servings + containers, ₱0
  subtotal_centavos    bigint not null,
  unique (report_id, product_id),
  constraint subtotal_matches check (subtotal_centavos = qty * unit_price_centavos)
);
create index daily_sales_lines_report_idx on public.daily_sales_lines (report_id);

-- Remittance tables (defined here because sales RPCs reference them)
create table public.daily_remittances (
  id                   uuid primary key default gen_random_uuid(),
  location_id          uuid not null references public.locations (id),
  business_date        date not null,
  sales_report_id      uuid not null unique references public.daily_sales_reports (id),
  amount_due_centavos  bigint not null check (amount_due_centavos >= 0),  -- system-computed, 100% of net sales
  amount_sent_centavos bigint check (amount_sent_centavos >= 0),
  method               public.payment_method,
  reference_no         text,
  receipt_path         text,
  status               public.remittance_status not null default 'pending',
  rejection_reason     text,
  attempts             integer not null default 0,
  submitted_by         uuid references public.profiles (id),
  submitted_at         timestamptz,
  verified_by          uuid references public.profiles (id),
  verified_at          timestamptz,
  admin_note           text,
  created_at           timestamptz not null default now(),
  unique (location_id, business_date)
);
create index daily_remittances_status_idx on public.daily_remittances (status, business_date);

-- every submission attempt (incl. rejected ones) is kept
create table public.remittance_submissions (
  id                   uuid primary key default gen_random_uuid(),
  remittance_id        uuid not null references public.daily_remittances (id),
  location_id          uuid not null references public.locations (id),
  attempt              integer not null,
  amount_sent_centavos bigint not null,
  method               public.payment_method not null,
  reference_no         text not null,
  receipt_path         text not null,
  submitted_by         uuid references public.profiles (id),
  submitted_at         timestamptz not null default now(),
  outcome              public.remittance_status not null default 'submitted',
  outcome_reason       text,
  outcome_by           uuid references public.profiles (id),
  outcome_at           timestamptz,
  unique (remittance_id, attempt)
);

-- Sales reports can only change through an approved correction.
create or replace function private.sales_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() or coalesce(current_setting('app.sales_correction', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Sales reports cannot be edited. Request a correction (admin approval required).' using errcode = 'P0001';
end $$;

create trigger daily_sales_reports_guard before update or delete on public.daily_sales_reports
  for each row execute function private.sales_guard();
create trigger daily_sales_lines_guard before update or delete on public.daily_sales_lines
  for each row execute function private.sales_guard();

-- Writes lines + totals for a report from a JSON payload:
-- p_lines = [{"product_id": uuid, "qty": int, "free_qty": int}, ...]
create or replace function private.write_sales(
  p_report_id uuid, p_location_id uuid, p_type public.report_type, p_lines jsonb,
  p_cash bigint, p_gcash bigint, p_other bigint, p_discounts bigint, p_refunds bigint
)
returns public.daily_sales_reports
language plpgsql security definer set search_path = ''
as $$
declare
  ln jsonb;
  p public.products;
  v_qty integer;
  v_free integer;
  v_gross bigint := 0;
  v_serv integer := 0;
  v_free_serv integer := 0;
  v_net bigint;
  r public.daily_sales_reports;
begin
  p_cash := coalesce(p_cash, 0); p_gcash := coalesce(p_gcash, 0); p_other := coalesce(p_other, 0);
  p_discounts := coalesce(p_discounts, 0); p_refunds := coalesce(p_refunds, 0);
  if least(p_cash, p_gcash, p_other, p_discounts, p_refunds) < 0 then
    raise exception 'Amounts cannot be negative' using errcode = 'P0001';
  end if;

  delete from public.daily_sales_lines where report_id = p_report_id;

  if p_type = 'closed' then
    if exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
               where coalesce((x->>'qty')::int, 0) + coalesce((x->>'free_qty')::int, 0) > 0)
       or p_cash + p_gcash + p_other + p_discounts + p_refunds > 0 then
      raise exception 'A "closed / no sales" report cannot have sales or payments' using errcode = 'P0001';
    end if;
  else
    for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      v_qty := coalesce((ln->>'qty')::int, 0);
      v_free := coalesce((ln->>'free_qty')::int, 0);
      if v_qty < 0 or v_free < 0 then
        raise exception 'Quantities cannot be negative' using errcode = 'P0001';
      end if;
      continue when v_qty + v_free = 0;
      select * into p from public.products where id = (ln->>'product_id')::uuid and location_id = p_location_id;
      if not found then
        raise exception 'Unknown product for this store' using errcode = 'P0001';
      end if;
      insert into public.daily_sales_lines (report_id, location_id, product_id, product_name, unit_price_centavos,
                                            servings_per_unit, container_type, qty, free_qty, subtotal_centavos)
      values (p_report_id, p_location_id, p.id, p.name, p.price_centavos, p.servings_per_unit, p.container_type,
              v_qty, v_free, v_qty * p.price_centavos);
      v_gross := v_gross + v_qty * p.price_centavos;
      v_serv := v_serv + (v_qty + v_free) * p.servings_per_unit;
      v_free_serv := v_free_serv + v_free * p.servings_per_unit;
    end loop;
    if v_serv = 0 then
      raise exception 'No items entered. If the store had no sales, choose "Closed / no sales".' using errcode = 'P0001';
    end if;
  end if;

  v_net := v_gross - p_discounts - p_refunds;
  if v_net < 0 then
    raise exception 'Discounts and refunds are more than total sales' using errcode = 'P0001';
  end if;
  if p_cash + p_gcash + p_other <> v_net then
    raise exception 'Payments (cash ₱% + GCash ₱% + other ₱%) must add up to net sales ₱%',
      to_char(p_cash / 100.0, 'FM999,999,990.00'), to_char(p_gcash / 100.0, 'FM999,999,990.00'),
      to_char(p_other / 100.0, 'FM999,999,990.00'), to_char(v_net / 100.0, 'FM999,999,990.00')
      using errcode = 'P0001';
  end if;

  update public.daily_sales_reports
     set report_type = p_type,
         gross_sales_centavos = v_gross, discounts_centavos = p_discounts, refunds_centavos = p_refunds,
         net_sales_centavos = v_net, cash_centavos = p_cash, gcash_centavos = p_gcash, other_centavos = p_other,
         total_servings = v_serv, free_servings = v_free_serv
   where id = p_report_id
  returning * into r;
  return r;
end $$;

create or replace function public.submit_sales_report(
  p_location_id uuid,
  p_business_date date,
  p_report_type public.report_type,
  p_lines jsonb,
  p_cash_centavos bigint,
  p_gcash_centavos bigint,
  p_other_centavos bigint default 0,
  p_discounts_centavos bigint default 0,
  p_refunds_centavos bigint default 0,
  p_notes text default null
)
returns public.daily_sales_reports
language plpgsql security definer set search_path = ''
as $$
declare
  r public.daily_sales_reports;
  v_stamp timestamptz := private.stamp(p_business_date, '2 minutes');
begin
  perform private.assert_can_submit(p_location_id, p_business_date);
  if exists (select 1 from public.daily_sales_reports where location_id = p_location_id and business_date = p_business_date) then
    raise exception 'The sales report for % is already submitted. To change it, request a correction.', p_business_date
      using errcode = '23505';
  end if;

  perform set_config('app.sales_correction', 'on', true);
  insert into public.daily_sales_reports (location_id, business_date, report_type, notes, submitted_by, created_at)
  values (p_location_id, p_business_date, p_report_type, nullif(btrim(p_notes), ''), auth.uid(), v_stamp)
  returning * into r;
  r := private.write_sales(r.id, p_location_id, p_report_type, p_lines,
                           p_cash_centavos, p_gcash_centavos, p_other_centavos, p_discounts_centavos, p_refunds_centavos);
  perform set_config('app.sales_correction', 'off', true);

  -- Remittance due = 100% of net sales. A ₱0 day needs no transfer.
  insert into public.daily_remittances (location_id, business_date, sales_report_id, amount_due_centavos, status,
                                        amount_sent_centavos, verified_at, admin_note, created_at)
  values (p_location_id, p_business_date, r.id, r.net_sales_centavos,
          case when r.net_sales_centavos = 0 then 'verified'::public.remittance_status else 'pending' end,
          case when r.net_sales_centavos = 0 then 0 end,
          case when r.net_sales_centavos = 0 then v_stamp end,
          case when r.net_sales_centavos = 0 then 'Auto: no sales, nothing to remit' end,
          v_stamp);

  perform private.recompute_daily_check(p_location_id, p_business_date);
  return r;
end $$;

-- Corrections to a submitted sales report (admin approval required)
create table public.sales_report_corrections (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.daily_sales_reports (id),
  location_id        uuid not null references public.locations (id),
  business_date      date not null,
  proposed           jsonb not null,     -- same shape as submit_sales_report args
  previous_snapshot  jsonb,              -- report + lines before approval
  reason             text not null,
  status             public.correction_status not null default 'pending',
  requested_by       uuid references public.profiles (id),
  requested_at       timestamptz not null default now(),
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  review_note        text
);
create unique index sales_corrections_one_pending on public.sales_report_corrections (report_id) where status = 'pending';

create or replace function public.request_sales_correction(
  p_report_id uuid, p_report_type public.report_type, p_lines jsonb,
  p_cash_centavos bigint, p_gcash_centavos bigint, p_other_centavos bigint,
  p_discounts_centavos bigint, p_refunds_centavos bigint, p_reason text
)
returns public.sales_report_corrections
language plpgsql security definer set search_path = ''
as $$
declare
  r public.daily_sales_reports;
  c public.sales_report_corrections;
begin
  select * into r from public.daily_sales_reports where id = p_report_id;
  if not found or not private.can_access_location(r.location_id) then
    raise exception 'Report not found' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Please explain what was wrong' using errcode = 'P0001';
  end if;
  insert into public.sales_report_corrections (report_id, location_id, business_date, proposed, reason, requested_by)
  values (r.id, r.location_id, r.business_date,
          jsonb_build_object('report_type', p_report_type, 'lines', coalesce(p_lines, '[]'::jsonb),
                             'cash', coalesce(p_cash_centavos, 0), 'gcash', coalesce(p_gcash_centavos, 0),
                             'other', coalesce(p_other_centavos, 0), 'discounts', coalesce(p_discounts_centavos, 0),
                             'refunds', coalesce(p_refunds_centavos, 0)),
          btrim(p_reason), auth.uid())
  returning * into c;
  return c;
end $$;

create or replace function public.review_sales_correction(p_correction_id uuid, p_approve boolean, p_note text default null)
returns public.sales_report_corrections
language plpgsql security definer set search_path = ''
as $$
declare
  c public.sales_report_corrections;
  r public.daily_sales_reports;
  rem public.daily_remittances;
  v_snapshot jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only admin can review corrections' using errcode = '42501';
  end if;
  select * into c from public.sales_report_corrections where id = p_correction_id for update;
  if not found or c.status <> 'pending' then
    raise exception 'Correction is not pending' using errcode = 'P0001';
  end if;
  if not p_approve then
    update public.sales_report_corrections
       set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     where id = c.id returning * into c;
    return c;
  end if;

  select to_jsonb(x) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l)) from public.daily_sales_lines l where l.report_id = x.id), '[]'::jsonb))
    into v_snapshot from public.daily_sales_reports x where x.id = c.report_id;

  perform set_config('app.sales_correction', 'on', true);
  r := private.write_sales(c.report_id, c.location_id, (c.proposed->>'report_type')::public.report_type, c.proposed->'lines',
                           (c.proposed->>'cash')::bigint, (c.proposed->>'gcash')::bigint, (c.proposed->>'other')::bigint,
                           (c.proposed->>'discounts')::bigint, (c.proposed->>'refunds')::bigint);
  update public.daily_sales_reports set corrected_at = now() where id = r.id;

  -- Adjust the amount due if the remittance is not yet verified. A verified
  -- remittance is permanent; any difference shows as outstanding.
  select * into rem from public.daily_remittances where sales_report_id = r.id;
  if rem.status <> 'verified' then
    update public.daily_remittances set amount_due_centavos = r.net_sales_centavos where id = rem.id;
  end if;
  perform set_config('app.sales_correction', 'off', true);

  update public.sales_report_corrections
     set status = 'approved', previous_snapshot = v_snapshot, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = c.id returning * into c;

  perform private.recompute_daily_check(r.location_id, r.business_date);
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Daily remittances
-- ---------------------------------------------------------------------
create or replace function private.remittance_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Remittances cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'verified' then
    raise exception 'Verified remittances are permanent — record an adjustment instead' using errcode = 'P0001';
  end if;
  -- amount due is system-computed; only an approved sales correction may change it
  if new.amount_due_centavos <> old.amount_due_centavos
     and coalesce(current_setting('app.sales_correction', true), '') <> 'on' then
    raise exception 'The amount due is computed from the sales report and cannot be edited' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger daily_remittances_guard before update or delete on public.daily_remittances
  for each row execute function private.remittance_guard();
create trigger remittance_submissions_immutable before delete on public.remittance_submissions
  for each row execute function private.forbid_change();

create or replace function public.submit_remittance(
  p_remittance_id uuid,
  p_amount_sent_centavos bigint,
  p_method public.payment_method,
  p_reference_no text,
  p_receipt_path text
)
returns public.daily_remittances
language plpgsql security definer set search_path = ''
as $$
declare
  rem public.daily_remittances;
  v_stamp timestamptz;
begin
  select * into rem from public.daily_remittances where id = p_remittance_id for update;
  if not found or not (private.can_access_location(rem.location_id) or private.seed_mode()) then
    raise exception 'Remittance not found' using errcode = 'P0001';
  end if;
  if rem.status not in ('pending', 'rejected') then
    raise exception 'This remittance is already %', rem.status using errcode = 'P0001';
  end if;
  if p_amount_sent_centavos is null or p_amount_sent_centavos <= 0 then
    raise exception 'Enter the amount you sent' using errcode = 'P0001';
  end if;
  if p_method is null then
    raise exception 'Choose how you sent the money' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reference_no), '') = '' then
    raise exception 'Enter the reference number from your receipt' using errcode = 'P0001';
  end if;
  perform private.assert_photo(rem.location_id, p_receipt_path, 'Receipt');

  v_stamp := private.stamp(rem.business_date, '10 minutes');
  update public.daily_remittances
     set amount_sent_centavos = p_amount_sent_centavos, method = p_method, reference_no = btrim(p_reference_no),
         receipt_path = p_receipt_path, status = 'submitted', rejection_reason = null,
         attempts = attempts + 1, submitted_by = auth.uid(), submitted_at = v_stamp
   where id = rem.id
  returning * into rem;

  insert into public.remittance_submissions (remittance_id, location_id, attempt, amount_sent_centavos, method,
                                             reference_no, receipt_path, submitted_by, submitted_at)
  values (rem.id, rem.location_id, rem.attempts, p_amount_sent_centavos, p_method, btrim(p_reference_no),
          p_receipt_path, auth.uid(), v_stamp);
  return rem;
end $$;

create or replace function public.verify_remittance(p_remittance_id uuid, p_note text default null)
returns public.daily_remittances
language plpgsql security definer set search_path = ''
as $$
declare
  rem public.daily_remittances;
  v_stamp timestamptz;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can verify remittances' using errcode = '42501';
  end if;
  select * into rem from public.daily_remittances where id = p_remittance_id for update;
  if not found or rem.status <> 'submitted' then
    raise exception 'Only submitted remittances can be verified' using errcode = 'P0001';
  end if;
  v_stamp := private.stamp(rem.business_date + 1, '-10 hours');  -- seed: next morning
  update public.daily_remittances
     set status = 'verified', verified_by = auth.uid(), verified_at = v_stamp, admin_note = nullif(btrim(p_note), '')
   where id = rem.id returning * into rem;
  update public.remittance_submissions
     set outcome = 'verified', outcome_by = auth.uid(), outcome_at = v_stamp
   where remittance_id = rem.id and attempt = rem.attempts;
  return rem;
end $$;

create or replace function public.reject_remittance(p_remittance_id uuid, p_reason text)
returns public.daily_remittances
language plpgsql security definer set search_path = ''
as $$
declare
  rem public.daily_remittances;
  v_stamp timestamptz;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can reject remittances' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason so the store can fix it' using errcode = 'P0001';
  end if;
  select * into rem from public.daily_remittances where id = p_remittance_id for update;
  if not found or rem.status <> 'submitted' then
    raise exception 'Only submitted remittances can be rejected' using errcode = 'P0001';
  end if;
  v_stamp := private.stamp(rem.business_date + 1, '-10 hours');
  update public.daily_remittances
     set status = 'rejected', rejection_reason = btrim(p_reason)
   where id = rem.id returning * into rem;
  update public.remittance_submissions
     set outcome = 'rejected', outcome_reason = btrim(p_reason), outcome_by = auth.uid(), outcome_at = v_stamp
   where remittance_id = rem.id and attempt = rem.attempts;
  return rem;
end $$;

-- ---------------------------------------------------------------------
-- Daily checks (three-way verification)
-- ---------------------------------------------------------------------
create table public.daily_checks (
  id                     uuid primary key default gen_random_uuid(),
  location_id            uuid not null references public.locations (id),
  business_date          date not null,
  has_counter            boolean not null default false,
  has_count              boolean not null default false,
  has_sales              boolean not null default false,
  -- the three numbers
  counter_delta          integer,          -- A: servings dispensed per machine counter
  reported_servings      integer,          -- B: servings per sales report (incl. freebies)
  container_servings     integer,          -- C: servings implied by cones + cups used
  cones_used             integer,
  cups_used              integer,
  expected_cones         integer,          -- from sales lines
  expected_cups          integer,
  diff_counter_sales     integer,          -- A − B
  diff_counter_containers integer,         -- A − C
  diff_sales_containers  integer,          -- B − C
  max_abs_diff           integer,
  tolerance_servings     integer not null,
  major_threshold_servings integer not null,
  status                 public.check_status not null default 'incomplete',
  partner_explanation    text,
  resolution_cause       public.discrepancy_cause,
  resolution_notes       text,
  resolved_by            uuid references public.profiles (id),
  resolved_at            timestamptz,
  computed_at            timestamptz not null default now(),
  unique (location_id, business_date)
);
create index daily_checks_open_idx on public.daily_checks (status, resolved_at);

create or replace function private.recompute_daily_check(p_location_id uuid, p_business_date date)
returns public.daily_checks
language plpgsql security definer set search_path = ''
as $$
declare
  l public.locations;
  v_active_machines integer;
  v_read_machines integer;
  v_a integer;
  v_b integer;
  v_c integer;
  v_exp_cones integer;
  v_exp_cups integer;
  v_none_serv integer;
  v_multi_extra integer;
  cnt public.daily_container_counts;
  rep public.daily_sales_reports;
  v_has_counter boolean;
  v_has_count boolean;
  v_has_sales boolean;
  v_status public.check_status := 'incomplete';
  v_max integer;
  chk public.daily_checks;
  it record;
  v_premix_used numeric;
begin
  select * into l from public.locations where id = p_location_id;

  select count(*) into v_active_machines from public.machines where location_id = p_location_id and status = 'active';
  select count(*), coalesce(sum(delta), 0) into v_read_machines, v_a
    from public.counter_readings where location_id = p_location_id and business_date = p_business_date;
  v_has_counter := v_read_machines > 0 and v_read_machines >= v_active_machines;

  select * into cnt from public.daily_container_counts where location_id = p_location_id and business_date = p_business_date;
  v_has_count := found;

  select * into rep from public.daily_sales_reports where location_id = p_location_id and business_date = p_business_date;
  v_has_sales := found;
  if v_has_sales then
    select coalesce(sum((qty + free_qty) * servings_per_unit), 0),
           coalesce(sum(qty + free_qty) filter (where container_type = 'cone'), 0),
           coalesce(sum(qty + free_qty) filter (where container_type = 'cup'), 0),
           coalesce(sum((qty + free_qty) * servings_per_unit) filter (where container_type = 'none'), 0),
           coalesce(sum((qty + free_qty) * (servings_per_unit - 1)) filter (where container_type <> 'none'), 0)
      into v_b, v_exp_cones, v_exp_cups, v_none_serv, v_multi_extra
      from public.daily_sales_lines where report_id = rep.id;
  end if;

  if v_has_count then
    -- Convert containers to servings: products without a container, and
    -- multi-serving products in one container, are added back from sales.
    v_c := cnt.cones_used + cnt.cups_used + coalesce(v_none_serv, 0) + coalesce(v_multi_extra, 0);
  end if;

  if v_has_counter and v_has_count and v_has_sales then
    v_max := greatest(abs(v_a - v_b), abs(v_a - v_c), abs(v_b - v_c));
    v_status := case when v_max <= l.tolerance_servings then 'matched'
                     when v_max <= l.major_threshold_servings then 'minor'
                     else 'major' end;
  end if;

  insert into public.daily_checks as dc (
    location_id, business_date, has_counter, has_count, has_sales,
    counter_delta, reported_servings, container_servings, cones_used, cups_used, expected_cones, expected_cups,
    diff_counter_sales, diff_counter_containers, diff_sales_containers, max_abs_diff,
    tolerance_servings, major_threshold_servings, status, computed_at)
  values (
    p_location_id, p_business_date, v_has_counter, v_has_count, v_has_sales,
    case when v_read_machines > 0 then v_a end, v_b, v_c, cnt.cones_used, cnt.cups_used, v_exp_cones, v_exp_cups,
    v_a - v_b, v_a - v_c, v_b - v_c, v_max,
    l.tolerance_servings, l.major_threshold_servings, v_status, now())
  on conflict (location_id, business_date) do update set
    has_counter = excluded.has_counter, has_count = excluded.has_count, has_sales = excluded.has_sales,
    counter_delta = excluded.counter_delta, reported_servings = excluded.reported_servings,
    container_servings = excluded.container_servings, cones_used = excluded.cones_used, cups_used = excluded.cups_used,
    expected_cones = excluded.expected_cones, expected_cups = excluded.expected_cups,
    diff_counter_sales = excluded.diff_counter_sales, diff_counter_containers = excluded.diff_counter_containers,
    diff_sales_containers = excluded.diff_sales_containers, max_abs_diff = excluded.max_abs_diff,
    tolerance_servings = excluded.tolerance_servings, major_threshold_servings = excluded.major_threshold_servings,
    status = excluded.status, computed_at = excluded.computed_at
  returning * into chk;

  -- Expected supply usage for the day (premix from counter, extras from sales).
  delete from public.stock_movements where ref_type = 'daily_usage' and ref_id = chk.id;
  if v_has_counter and v_a > 0 then
    for it in select * from public.inventory_items where is_premix and is_active loop
      v_premix_used := round(v_a / it.yield_servings, 3);
      insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note)
      values (p_location_id, it.id, p_business_date, 'usage', -v_premix_used, 'daily_usage', chk.id,
              'Expected from counter: ' || v_a || ' servings');
    end loop;
  end if;
  if v_has_sales then
    insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note)
    select p_location_id, pc.item_id, p_business_date, 'usage', -sum((sl.qty + sl.free_qty) * pc.qty_per_unit),
           'daily_usage', chk.id, 'Expected from sales'
      from public.daily_sales_lines sl
      join public.product_components pc on pc.product_id = sl.product_id
     where sl.report_id = rep.id
     group by pc.item_id
    having sum((sl.qty + sl.free_qty) * pc.qty_per_unit) <> 0;
  end if;

  return chk;
end $$;

-- Partner explains a mismatch (e.g. "2 spilled")
create or replace function public.explain_daily_check(p_location_id uuid, p_business_date date, p_explanation text)
returns public.daily_checks
language plpgsql security definer set search_path = ''
as $$
declare chk public.daily_checks;
begin
  if not private.can_access_location(p_location_id) and not private.seed_mode() then
    raise exception 'You do not have access to this store' using errcode = '42501';
  end if;
  update public.daily_checks set partner_explanation = nullif(btrim(p_explanation), '')
   where location_id = p_location_id and business_date = p_business_date and resolved_at is null
  returning * into chk;
  if not found then
    raise exception 'Nothing to explain for this day (or already resolved)' using errcode = 'P0001';
  end if;
  return chk;
end $$;

-- Admin (or staff during an audit) resolves a discrepancy with a cause
create or replace function public.resolve_daily_check(
  p_check_id uuid, p_cause public.discrepancy_cause, p_notes text default null
)
returns public.daily_checks
language plpgsql security definer set search_path = ''
as $$
declare chk public.daily_checks;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can resolve discrepancies' using errcode = '42501';
  end if;
  if p_cause is null then
    raise exception 'Choose a cause' using errcode = 'P0001';
  end if;
  update public.daily_checks
     set resolution_cause = p_cause, resolution_notes = nullif(btrim(p_notes), ''),
         resolved_by = auth.uid(), resolved_at = private.stamp(business_date + 1, '-9 hours')
   where id = p_check_id and status in ('minor', 'major')
  returning * into chk;
  if not found then
    raise exception 'Only minor/major discrepancies can be resolved' using errcode = 'P0001';
  end if;
  return chk;
end $$;

-- ---------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------
create table public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid not null references public.locations (id),
  business_date       date not null,          -- counts toward this day's closing cone/cup count
  delivered_by        uuid references public.profiles (id),
  delivered_at        timestamptz not null default now(),
  delivery_fee_centavos bigint not null default 0 check (delivery_fee_centavos >= 0),
  notes               text,
  status              public.delivery_status not null default 'recorded',
  confirmed_by        uuid references public.profiles (id),
  confirmed_at        timestamptz,
  partner_note        text,
  created_at          timestamptz not null default now()
);
create index deliveries_location_date_idx on public.deliveries (location_id, business_date);

create table public.delivery_lines (
  id                 uuid primary key default gen_random_uuid(),
  delivery_id        uuid not null references public.deliveries (id),
  item_id            uuid not null references public.inventory_items (id),
  qty                numeric(12,3) not null check (qty > 0),
  unit_cost_centavos bigint not null default 0,    -- snapshot
  unique (delivery_id, item_id)
);

create or replace function private.deliveries_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Deliveries cannot be deleted — cancel instead' using errcode = 'P0001';
  end if;
  if old.status in ('confirmed', 'cancelled') and (new.status <> old.status or new.business_date <> old.business_date
      or new.delivery_fee_centavos <> old.delivery_fee_centavos) then
    raise exception 'This delivery is % and cannot be changed', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger deliveries_guard before update or delete on public.deliveries
  for each row execute function private.deliveries_guard();
create trigger delivery_lines_immutable before update or delete on public.delivery_lines
  for each row execute function private.forbid_change();

-- Recompute the first container count on/after a date, and its daily check.
create or replace function private.after_delivery_change(p_location_id uuid, p_business_date date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_date date;
begin
  select min(business_date) into v_date from public.daily_container_counts
   where location_id = p_location_id and business_date >= p_business_date;
  if v_date is not null then
    perform private.refresh_container_count(p_location_id, v_date);
    perform private.recompute_daily_check(p_location_id, v_date);
  end if;
end $$;

-- p_lines = [{"item_id": uuid, "qty": number}, ...]
create or replace function public.record_delivery(
  p_location_id uuid, p_business_date date, p_lines jsonb,
  p_delivery_fee_centavos bigint default 0, p_notes text default null
)
returns public.deliveries
language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
  ln jsonb;
  it public.inventory_items;
  v_qty numeric;
  v_count integer := 0;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can record deliveries' using errcode = '42501';
  end if;
  if p_business_date > private.today_ph() and not private.seed_mode() then
    raise exception 'Delivery date cannot be in the future' using errcode = 'P0001';
  end if;
  insert into public.deliveries (location_id, business_date, delivered_by, delivered_at, delivery_fee_centavos, notes, created_at)
  values (p_location_id, p_business_date, auth.uid(), private.stamp(p_business_date, '-8 hours'),
          coalesce(p_delivery_fee_centavos, 0), nullif(btrim(p_notes), ''), private.stamp(p_business_date, '-8 hours'))
  returning * into d;

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 0);
    continue when v_qty = 0;
    if v_qty < 0 then
      raise exception 'Quantities must be positive' using errcode = 'P0001';
    end if;
    select * into it from public.inventory_items where id = (ln->>'item_id')::uuid;
    if not found then
      raise exception 'Unknown inventory item' using errcode = 'P0001';
    end if;
    insert into public.delivery_lines (delivery_id, item_id, qty, unit_cost_centavos)
    values (d.id, it.id, v_qty, it.unit_cost_centavos);
    insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note, created_by)
    values (p_location_id, it.id, p_business_date, 'delivery', v_qty, 'delivery', d.id, 'Delivery', auth.uid());
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'Add at least one item' using errcode = 'P0001';
  end if;

  perform private.after_delivery_change(p_location_id, p_business_date);
  return d;
end $$;

create or replace function public.confirm_delivery(p_delivery_id uuid, p_all_received boolean, p_note text default null)
returns public.deliveries
language plpgsql security definer set search_path = ''
as $$
declare d public.deliveries;
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if not found or not (private.can_access_location(d.location_id) or private.seed_mode()) then
    raise exception 'Delivery not found' using errcode = 'P0001';
  end if;
  if d.status <> 'recorded' then
    raise exception 'This delivery is already %', d.status using errcode = 'P0001';
  end if;
  if not p_all_received and coalesce(btrim(p_note), '') = '' then
    raise exception 'Tell us what is wrong with the delivery' using errcode = 'P0001';
  end if;
  update public.deliveries
     set status = case when p_all_received then 'confirmed'::public.delivery_status else 'disputed' end,
         confirmed_by = auth.uid(), confirmed_at = private.stamp(d.business_date, '-7 hours'),
         partner_note = nullif(btrim(p_note), '')
   where id = d.id returning * into d;
  return d;
end $$;

create or replace function public.cancel_delivery(p_delivery_id uuid, p_reason text)
returns public.deliveries
language plpgsql security definer set search_path = ''
as $$
declare d public.deliveries;
begin
  if not private.is_admin() then
    raise exception 'Only admin can cancel deliveries' using errcode = '42501';
  end if;
  select * into d from public.deliveries where id = p_delivery_id for update;
  if not found or d.status not in ('recorded', 'disputed') then
    raise exception 'Only unconfirmed or disputed deliveries can be cancelled' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: ' || coalesce(p_reason, '')
   where id = d.id returning * into d;
  -- reverse the stock (ledger keeps both entries)
  insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note, created_by)
  select d.location_id, dl.item_id, d.business_date, 'delivery', -dl.qty, 'delivery_cancel', d.id, 'Delivery cancelled', auth.uid()
    from public.delivery_lines dl where dl.delivery_id = d.id;
  perform private.after_delivery_change(d.location_id, d.business_date);
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Opening inventory (onboarding) + activation
-- ---------------------------------------------------------------------
-- p_items = [{"item_id": uuid, "qty": number, "reorder_point": number}], cones/cups included
create or replace function public.set_opening_inventory(p_location_id uuid, p_date date, p_items jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.locations;
  ln jsonb;
  it public.inventory_items;
  v_qty numeric;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can set opening inventory' using errcode = '42501';
  end if;
  select * into l from public.locations where id = p_location_id for update;
  if l.status not in ('pending') and not private.seed_mode() then
    raise exception 'Opening inventory can only be set before activation' using errcode = 'P0001';
  end if;
  delete from public.stock_movements where location_id = p_location_id and kind = 'opening';
  for ln in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into it from public.inventory_items where id = (ln->>'item_id')::uuid;
    continue when not found;
    v_qty := coalesce((ln->>'qty')::numeric, 0);
    if v_qty < 0 then
      raise exception 'Quantities cannot be negative' using errcode = 'P0001';
    end if;
    if v_qty > 0 then
      insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, note, created_by)
      values (p_location_id, it.id, p_date, 'opening', v_qty, 'opening', 'Opening inventory', auth.uid());
    end if;
    insert into public.stock_levels (location_id, item_id, reorder_point)
    values (p_location_id, it.id, coalesce((ln->>'reorder_point')::numeric, it.default_reorder_point))
    on conflict (location_id, item_id) do update set reorder_point = excluded.reorder_point;
    if it.container_type = 'cone' then
      update public.locations set opening_cones = v_qty::integer where id = p_location_id;
    elsif it.container_type = 'cup' then
      update public.locations set opening_cups = v_qty::integer where id = p_location_id;
    end if;
  end loop;
  update public.locations
     set opening_count_date = p_date,
         opening_cones = coalesce(opening_cones, 0),
         opening_cups = coalesce(opening_cups, 0)
   where id = p_location_id;
end $$;

-- Returns the list of onboarding steps still missing (empty = ready)
create or replace function public.location_readiness(p_location_id uuid)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.locations;
  missing text[] := '{}';
  k text;
begin
  if not private.is_team() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into l from public.locations where id = p_location_id;
  if not exists (select 1 from public.profiles where location_id = p_location_id and role = 'partner' and is_active) then
    missing := missing || 'Partner login'::text;
  end if;
  if not exists (select 1 from public.machines where location_id = p_location_id and status = 'active'
                   and baseline_reading is not null and baseline_photo_path is not null) then
    missing := missing || 'Machine with baseline counter reading + photo'::text;
  end if;
  if not exists (select 1 from public.products where location_id = p_location_id and is_active) then
    missing := missing || 'Products'::text;
  end if;
  if l.opening_count_date is null then
    missing := missing || 'Opening inventory (incl. cone/cup count)'::text;
  end if;
  foreach k in array array['machine_installed','machine_tested','staff_trained','signage','cleaning_kit','app_login_tested'] loop
    if coalesce((l.installation_checklist ->> k)::boolean, false) is not true then
      missing := missing || ('Checklist: ' || k)::text;
    end if;
  end loop;
  return missing;
end $$;

create or replace function public.activate_location(p_location_id uuid)
returns public.locations
language plpgsql security definer set search_path = ''
as $$
declare
  l public.locations;
  missing text[];
begin
  if not private.is_admin() then
    raise exception 'Only admin can activate a store' using errcode = '42501';
  end if;
  missing := public.location_readiness(p_location_id);
  if cardinality(missing) > 0 then
    raise exception 'Not ready: %', array_to_string(missing, ', ') using errcode = 'P0001';
  end if;
  update public.locations set status = 'active', partnership_start_date = coalesce(partnership_start_date, private.today_ph())
   where id = p_location_id returning * into l;
  return l;
end $$;

-- ---------------------------------------------------------------------
-- Activity logging for daily-loop tables
-- ---------------------------------------------------------------------
create trigger counter_readings_log after insert or update or delete on public.counter_readings
  for each row execute function private.log_activity();
create trigger daily_container_counts_log after insert or update or delete on public.daily_container_counts
  for each row execute function private.log_activity();
create trigger daily_sales_reports_log after insert or update or delete on public.daily_sales_reports
  for each row execute function private.log_activity();
create trigger daily_sales_lines_log after insert or update or delete on public.daily_sales_lines
  for each row execute function private.log_activity();
create trigger sales_report_corrections_log after insert or update or delete on public.sales_report_corrections
  for each row execute function private.log_activity();
create trigger daily_remittances_log after insert or update or delete on public.daily_remittances
  for each row execute function private.log_activity();
create trigger remittance_submissions_log after insert or update or delete on public.remittance_submissions
  for each row execute function private.log_activity();
create trigger daily_checks_log after insert or update or delete on public.daily_checks
  for each row execute function private.log_activity();
create trigger deliveries_log after insert or update or delete on public.deliveries
  for each row execute function private.log_activity();
create trigger delivery_lines_log after insert or update or delete on public.delivery_lines
  for each row execute function private.log_activity();
