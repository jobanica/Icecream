-- =====================================================================
-- Weekly audits, inventory counts, reconciliation, statements, payouts
-- =====================================================================

-- ---------------------------------------------------------------------
-- Audit checklist template (copied into each audit)
-- ---------------------------------------------------------------------
create table public.audit_checklist_template (
  key        text primary key,
  section    public.audit_section not null,
  label      text not null,
  sort_order integer not null,
  is_active  boolean not null default true
);

insert into public.audit_checklist_template (key, section, label, sort_order) values
  ('sales_reports_complete',   'sales', 'Sales report submitted for every day in the period', 10),
  ('sales_cash_reconciled',    'sales', 'Cash sales match cash handled / remitted', 11),
  ('sales_gcash_reconciled',   'sales', 'GCash sales match the store''s GCash history', 12),
  ('sales_corrections_ok',     'sales', 'All sales corrections reviewed and explained', 13),
  ('sales_freebies_ok',        'sales', 'Freebies, discounts and refunds are reasonable', 14),
  ('remit_all_days',           'remittances', 'Every day with sales has a remittance', 20),
  ('remit_all_verified',       'remittances', 'All remittances verified', 21),
  ('remit_amounts_match',      'remittances', 'Amounts sent match amounts due', 22),
  ('remit_receipts_valid',     'remittances', 'Receipts and reference numbers are valid', 23),
  ('counter_all_readings',     'counter', 'Counter reading present for every day', 30),
  ('counter_all_photos',       'counter', 'Every reading has a counter photo', 31),
  ('counter_photos_spotcheck', 'counter', 'Spot-check: 3 counter photos match entered numbers', 32),
  ('counter_live_matches',     'counter', 'Counter on the machine today matches the last reading + today''s sales', 33),
  ('counter_week_vs_servings', 'counter', 'Weekly counter total is consistent with reported servings', 34),
  ('inv_full_count_done',      'inventory', 'Full physical count of all items done', 40),
  ('inv_containers_match',     'inventory', 'Cone and cup count matches system stock', 41),
  ('inv_premix_vs_counter',    'inventory', 'Premix used matches counter total (via yield)', 42),
  ('inv_toppings_ok',          'inventory', 'Toppings / syrup usage is reasonable', 43),
  ('inv_storage_ok',           'inventory', 'Storage is clean, dry, sealed, first-in-first-out', 44),
  ('machine_operating',        'machine', 'Machine operating normally', 50),
  ('machine_consistency',      'machine', 'Product consistency and temperature OK', 51),
  ('machine_cleaned',          'machine', 'Machine cleaned per schedule', 52),
  ('machine_condition_photos', 'machine', 'Condition photos taken', 53),
  ('finance_totals_checked',   'finance', 'Period totals checked against reports', 60),
  ('finance_outstanding_ok',   'finance', 'Outstanding balances reviewed with the partner', 61);

-- ---------------------------------------------------------------------
-- Weekly audits
-- ---------------------------------------------------------------------
create table public.weekly_audits (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations (id),
  period_start    date not null,
  period_end      date not null,
  status          public.audit_status not null default 'scheduled',
  scheduled_for   date,
  auditor_id      uuid references public.profiles (id),
  started_at      timestamptz,
  completed_at    timestamptz,
  score_passed    integer,
  score_total     integer,
  summary         jsonb,            -- full (admin) summary, generated on completion
  notes           text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  unique (location_id, period_start),
  constraint period_ok check (period_end >= period_start)
);

create table public.audit_items (
  id          uuid primary key default gen_random_uuid(),
  audit_id    uuid not null references public.weekly_audits (id),
  location_id uuid not null references public.locations (id),
  section     public.audit_section not null,
  item_key    text not null,
  label       text not null,
  sort_order  integer not null default 0,
  result      public.audit_result,
  notes       text,
  photo_path  text,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz,
  unique (audit_id, item_key)
);

create table public.audit_findings (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid not null references public.weekly_audits (id),
  location_id  uuid not null references public.locations (id),
  severity     public.severity not null default 'info',
  description  text not null,
  action_item  text,
  photo_path   text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

-- Partner-facing summary (no internal notes). Partners read this table,
-- never weekly_audits directly.
create table public.audit_partner_summaries (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid not null unique references public.weekly_audits (id),
  location_id  uuid not null references public.locations (id),
  period_start date not null,
  period_end   date not null,
  summary      jsonb not null,
  created_at   timestamptz not null default now()
);

-- Completed audits are permanent
create or replace function private.audit_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception 'Completed audits are permanent' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'completed' then
    raise exception 'Completed audits are permanent' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger weekly_audits_guard before update or delete on public.weekly_audits
  for each row execute function private.audit_guard();

create or replace function private.audit_child_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.weekly_audits where id = coalesce(new.audit_id, old.audit_id) and status = 'completed') then
    raise exception 'This audit is completed and cannot be changed' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger audit_items_guard before insert or update or delete on public.audit_items
  for each row execute function private.audit_child_guard();
create trigger audit_findings_guard before insert or update or delete on public.audit_findings
  for each row execute function private.audit_child_guard();
create trigger audit_partner_summaries_immutable before update or delete on public.audit_partner_summaries
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------
-- Inventory counts (full physical count by staff, usually during an audit)
-- ---------------------------------------------------------------------
create table public.inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations (id),
  audit_id      uuid references public.weekly_audits (id),
  business_date date not null,
  counted_by    uuid references public.profiles (id),
  notes         text,
  created_at    timestamptz not null default now()
);

create table public.inventory_count_lines (
  id              uuid primary key default gen_random_uuid(),
  count_id        uuid not null references public.inventory_counts (id),
  location_id     uuid not null references public.locations (id),
  item_id         uuid not null references public.inventory_items (id),
  system_qty      numeric(12,3) not null,    -- ledger on-hand before the count
  actual_qty      numeric(12,3) not null check (actual_qty >= 0),
  variance        numeric(12,3) not null,    -- actual − system
  expected_usage  numeric(12,3) not null default 0,  -- per yield factors since last full count
  actual_usage    numeric(12,3) not null default 0,  -- expected − variance
  unit_cost_centavos bigint not null default 0,
  unique (count_id, item_id)
);

create trigger inventory_counts_immutable before update or delete on public.inventory_counts
  for each row execute function private.forbid_change();
create trigger inventory_count_lines_immutable before update or delete on public.inventory_count_lines
  for each row execute function private.forbid_change();

-- On-hand for one item at a location as of the end of a date
create or replace function private.on_hand(p_location_id uuid, p_item_id uuid, p_through date)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(qty), 0) from public.stock_movements
   where location_id = p_location_id and item_id = p_item_id and business_date <= p_through
$$;

-- p_lines = [{"item_id": uuid, "actual_qty": number}]
create or replace function public.submit_inventory_count(
  p_location_id uuid, p_business_date date, p_lines jsonb, p_audit_id uuid default null, p_notes text default null
)
returns public.inventory_counts
language plpgsql security definer set search_path = ''
as $$
declare
  c public.inventory_counts;
  ln jsonb;
  it public.inventory_items;
  v_sys numeric;
  v_act numeric;
  v_last date;
  v_expected numeric;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can do full inventory counts' using errcode = '42501';
  end if;
  insert into public.inventory_counts (location_id, audit_id, business_date, counted_by, notes, created_at)
  values (p_location_id, p_audit_id, p_business_date, auth.uid(), nullif(btrim(p_notes), ''), private.stamp(p_business_date, '30 minutes'))
  returning * into c;

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into it from public.inventory_items where id = (ln->>'item_id')::uuid;
    continue when not found or ln->>'actual_qty' is null;
    v_act := (ln->>'actual_qty')::numeric;
    v_sys := private.on_hand(p_location_id, it.id, p_business_date);
    -- expected usage since the previous full count (or opening)
    select max(ic.business_date) into v_last
      from public.inventory_counts ic
      join public.inventory_count_lines icl on icl.count_id = ic.id and icl.item_id = it.id
     where ic.location_id = p_location_id and ic.business_date < p_business_date;
    select coalesce(-sum(qty), 0) into v_expected from public.stock_movements
     where location_id = p_location_id and item_id = it.id and kind = 'usage'
       and business_date <= p_business_date and (v_last is null or business_date > v_last);
    insert into public.inventory_count_lines (count_id, location_id, item_id, system_qty, actual_qty, variance,
                                              expected_usage, actual_usage, unit_cost_centavos)
    values (c.id, p_location_id, it.id, v_sys, v_act, v_act - v_sys, v_expected, v_expected - (v_act - v_sys), it.unit_cost_centavos);
    if v_act <> v_sys then
      insert into public.stock_movements (location_id, item_id, business_date, kind, qty, ref_type, ref_id, note, created_by)
      values (p_location_id, it.id, p_business_date, 'count_adjustment', v_act - v_sys, 'inventory_count', c.id,
              'Full count variance', auth.uid());
    end if;
  end loop;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Period totals (shared by audit summaries and reconciliations)
-- ---------------------------------------------------------------------
create or replace function private.period_totals(p_location_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
  v_days integer := p_end - p_start + 1;
begin
  with
  rep as (
    select * from public.daily_sales_reports
     where location_id = p_location_id and business_date between p_start and p_end
  ),
  rem as (
    select * from public.daily_remittances
     where location_id = p_location_id and business_date between p_start and p_end
  ),
  chk as (
    select * from public.daily_checks
     where location_id = p_location_id and business_date between p_start and p_end
  ),
  cr as (
    select * from public.counter_readings
     where location_id = p_location_id and business_date between p_start and p_end
  ),
  premix as (
    select i.name, i.yield_servings,
           coalesce(-sum(m.qty) filter (where m.kind = 'usage'), 0) as expected_used
      from public.inventory_items i
      left join public.stock_movements m
        on m.item_id = i.id and m.location_id = p_location_id and m.business_date between p_start and p_end
     where i.is_premix
     group by i.id, i.name, i.yield_servings
  )
  select jsonb_build_object(
    'period_start', p_start,
    'period_end', p_end,
    'days', v_days,
    'sales', jsonb_build_object(
      'reports', (select count(*) from rep),
      'closed_days', (select count(*) from rep where report_type = 'closed'),
      'missing_days', v_days - (select count(*) from rep),
      'gross_centavos', (select coalesce(sum(gross_sales_centavos), 0) from rep),
      'discounts_centavos', (select coalesce(sum(discounts_centavos), 0) from rep),
      'refunds_centavos', (select coalesce(sum(refunds_centavos), 0) from rep),
      'net_centavos', (select coalesce(sum(net_sales_centavos), 0) from rep),
      'cash_centavos', (select coalesce(sum(cash_centavos), 0) from rep),
      'gcash_centavos', (select coalesce(sum(gcash_centavos), 0) from rep),
      'other_centavos', (select coalesce(sum(other_centavos), 0) from rep),
      'servings', (select coalesce(sum(total_servings), 0) from rep),
      'free_servings', (select coalesce(sum(free_servings), 0) from rep),
      'paid_servings', (select coalesce(sum(l.qty * l.servings_per_unit), 0)
                          from public.daily_sales_lines l join rep on rep.id = l.report_id)
    ),
    'remittances', jsonb_build_object(
      'due_centavos', (select coalesce(sum(amount_due_centavos), 0) from rem),
      'sent_centavos', (select coalesce(sum(amount_sent_centavos), 0) from rem where status in ('submitted', 'verified')),
      'verified_centavos', (select coalesce(sum(amount_sent_centavos), 0) from rem where status = 'verified'),
      'outstanding_centavos', (select coalesce(sum(net_sales_centavos), 0) from rep)
                              - (select coalesce(sum(amount_sent_centavos), 0) from rem where status = 'verified'),
      'over_short_centavos', (select coalesce(sum(amount_sent_centavos - amount_due_centavos), 0) from rem where status = 'verified'),
      'verified_days', (select count(*) from rem where status = 'verified'),
      'submitted_days', (select count(*) from rem where status = 'submitted'),
      'pending_days', (select count(*) from rem where status = 'pending'),
      'rejected_days', (select count(*) from rem where status = 'rejected')
    ),
    'counter', jsonb_build_object(
      'readings', (select count(*) from cr),
      'missing_days', v_days - (select count(distinct business_date) from cr),
      'photos', (select count(*) from cr where photo_path is not null and photo_path <> ''),
      'total_delta', (select coalesce(sum(delta), 0) from cr),
      'corrected', (select count(*) from cr where 'corrected' = any(flags))
    ),
    'three_way', jsonb_build_object(
      'counter_delta', (select coalesce(sum(counter_delta), 0) from chk),
      'reported_servings', (select coalesce(sum(reported_servings), 0) from chk),
      'container_servings', (select coalesce(sum(container_servings), 0) from chk),
      'cones_used', (select coalesce(sum(cones_used), 0) from chk),
      'cups_used', (select coalesce(sum(cups_used), 0) from chk),
      'matched_days', (select count(*) from chk where status = 'matched'),
      'minor_days', (select count(*) from chk where status = 'minor'),
      'major_days', (select count(*) from chk where status = 'major'),
      'incomplete_days', v_days - (select count(*) from chk where status <> 'incomplete'),
      'unresolved', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'date', business_date, 'status', status, 'counter', counter_delta,
          'sales', reported_servings, 'containers', container_servings, 'max_diff', max_abs_diff,
          'explanation', partner_explanation) order by business_date)
          from chk where status in ('minor', 'major') and resolved_at is null), '[]'::jsonb),
      'resolved', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'date', business_date, 'status', status, 'max_diff', max_abs_diff,
          'cause', resolution_cause, 'notes', resolution_notes) order by business_date)
          from chk where status in ('minor', 'major') and resolved_at is not null), '[]'::jsonb)
    ),
    'premix', coalesce((select jsonb_agg(jsonb_build_object(
        'item', name, 'yield_servings', yield_servings, 'expected_used', expected_used)) from premix), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Audit workflow RPCs
-- ---------------------------------------------------------------------
create or replace function public.create_audit(p_location_id uuid, p_period_start date, p_period_end date, p_scheduled_for date default null)
returns public.weekly_audits
language plpgsql security definer set search_path = ''
as $$
declare a public.weekly_audits;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can schedule audits' using errcode = '42501';
  end if;
  if exists (select 1 from public.weekly_audits where location_id = p_location_id
              and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')) then
    raise exception 'An audit already covers part of this period' using errcode = '23505';
  end if;
  insert into public.weekly_audits (location_id, period_start, period_end, scheduled_for, created_by, created_at)
  values (p_location_id, p_period_start, p_period_end, coalesce(p_scheduled_for, p_period_end + 1), auth.uid(),
          private.stamp(p_period_end, '-12 hours'))
  returning * into a;
  insert into public.audit_items (audit_id, location_id, section, item_key, label, sort_order)
  select a.id, p_location_id, section, key, label, sort_order from public.audit_checklist_template where is_active;
  return a;
end $$;

create or replace function public.start_audit(p_audit_id uuid)
returns public.weekly_audits
language plpgsql security definer set search_path = ''
as $$
declare a public.weekly_audits;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can conduct audits' using errcode = '42501';
  end if;
  update public.weekly_audits
     set status = 'in_progress', auditor_id = coalesce(auditor_id, auth.uid()),
         started_at = coalesce(started_at, private.stamp(period_end + 1, '-11 hours'))
   where id = p_audit_id and status in ('scheduled', 'in_progress')
  returning * into a;
  if not found then
    raise exception 'Audit cannot be started' using errcode = 'P0001';
  end if;
  return a;
end $$;

create or replace function public.set_audit_item(p_item_id uuid, p_result public.audit_result, p_notes text default null, p_photo_path text default null)
returns public.audit_items
language plpgsql security definer set search_path = ''
as $$
declare i public.audit_items;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can conduct audits' using errcode = '42501';
  end if;
  update public.audit_items
     set result = p_result, notes = nullif(btrim(p_notes), ''), photo_path = coalesce(p_photo_path, photo_path),
         updated_by = auth.uid(), updated_at = now()
   where id = p_item_id
  returning * into i;
  return i;
end $$;

create or replace function public.add_audit_finding(p_audit_id uuid, p_severity public.severity, p_description text,
                                                    p_action_item text default null, p_photo_path text default null)
returns public.audit_findings
language plpgsql security definer set search_path = ''
as $$
declare f public.audit_findings; a public.weekly_audits;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can add findings' using errcode = '42501';
  end if;
  select * into a from public.weekly_audits where id = p_audit_id;
  insert into public.audit_findings (audit_id, location_id, severity, description, action_item, photo_path, created_by, created_at)
  values (p_audit_id, a.location_id, p_severity, btrim(p_description), nullif(btrim(p_action_item), ''), p_photo_path, auth.uid(),
          private.stamp(a.period_end + 1, '-10 hours'))
  returning * into f;
  return f;
end $$;

create or replace function public.complete_audit(p_audit_id uuid)
returns public.weekly_audits
language plpgsql security definer set search_path = ''
as $$
declare
  a public.weekly_audits;
  l public.locations;
  v_totals jsonb;
  v_passed integer;
  v_total integer;
  v_open integer;
  v_items jsonb;
  v_findings jsonb;
  v_inventory jsonb;
  v_summary jsonb;
  v_partner jsonb;
  v_auditor text;
  v_completed timestamptz;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can complete audits' using errcode = '42501';
  end if;
  select * into a from public.weekly_audits where id = p_audit_id for update;
  if not found or a.status <> 'in_progress' then
    raise exception 'Only an in-progress audit can be completed' using errcode = 'P0001';
  end if;
  select count(*) into v_open from public.audit_items where audit_id = a.id and result is null;
  if v_open > 0 then
    raise exception '% checklist item(s) still unanswered', v_open using errcode = 'P0001';
  end if;
  select * into l from public.locations where id = a.location_id;
  select full_name into v_auditor from public.profiles where id = a.auditor_id;
  v_completed := private.stamp(a.period_end + 1, '-8 hours');

  v_totals := private.period_totals(a.location_id, a.period_start, a.period_end);
  select count(*) filter (where result = 'pass'), count(*) filter (where result <> 'na')
    into v_passed, v_total from public.audit_items where audit_id = a.id;

  select coalesce(jsonb_agg(jsonb_build_object('section', section, 'label', label, 'result', result, 'notes', notes,
                                               'has_photo', photo_path is not null) order by sort_order), '[]'::jsonb)
    into v_items from public.audit_items where audit_id = a.id;
  select coalesce(jsonb_agg(jsonb_build_object('severity', severity, 'description', description, 'action_item', action_item)
                            order by case severity when 'major' then 0 when 'minor' then 1 else 2 end, created_at), '[]'::jsonb)
    into v_findings from public.audit_findings where audit_id = a.id;

  -- per-item variance from full counts done for this audit (or within the period)
  select coalesce(jsonb_agg(jsonb_build_object(
           'item', i.name, 'unit', i.unit, 'system_qty', icl.system_qty, 'actual_qty', icl.actual_qty,
           'variance', icl.variance, 'expected_usage', icl.expected_usage, 'actual_usage', icl.actual_usage,
           'variance_value_centavos', round(icl.variance * icl.unit_cost_centavos)) order by i.sort_order), '[]'::jsonb)
    into v_inventory
    from public.inventory_count_lines icl
    join public.inventory_counts ic on ic.id = icl.count_id
    join public.inventory_items i on i.id = icl.item_id
   where ic.id = (select id from public.inventory_counts
                   where location_id = a.location_id
                     and (audit_id = a.id or business_date between a.period_start and a.period_end + 1)
                   order by (audit_id = a.id) desc, business_date desc limit 1);

  v_summary := jsonb_build_object(
    'location', jsonb_build_object('code', l.code, 'store_name', l.store_name, 'partner_name', l.partner_name),
    'auditor', v_auditor,
    'completed_at', v_completed,
    'score', jsonb_build_object('passed', v_passed, 'total', v_total),
    'totals', v_totals,
    'inventory', v_inventory,
    'checklist', v_items,
    'findings', v_findings,
    'notes', a.notes
  );
  -- partner-facing: same numbers, no internal notes / checklist notes
  v_partner := v_summary - 'notes' || jsonb_build_object(
    'checklist', (select coalesce(jsonb_agg(x - 'notes'), '[]'::jsonb) from jsonb_array_elements(v_items) x));

  update public.weekly_audits
     set status = 'completed', completed_at = v_completed, score_passed = v_passed, score_total = v_total, summary = v_summary
   where id = a.id returning * into a;

  insert into public.audit_partner_summaries (audit_id, location_id, period_start, period_end, summary, created_at)
  values (a.id, a.location_id, a.period_start, a.period_end, v_partner, v_completed);
  return a;
end $$;

-- ---------------------------------------------------------------------
-- Reconciliations
-- ---------------------------------------------------------------------
create table public.reconciliations (
  id                         uuid primary key default gen_random_uuid(),
  location_id                uuid not null references public.locations (id),
  audit_id                   uuid not null unique references public.weekly_audits (id),
  period_start               date not null,
  period_end                 date not null,
  total_sales_centavos       bigint not null,
  gcash_sales_centavos       bigint not null default 0,
  other_sales_centavos       bigint not null default 0,
  verified_remittances_centavos bigint not null,
  outstanding_centavos       bigint not null,
  product_cost_centavos      bigint not null default 0,
  payment_fees_centavos      bigint not null default 0,
  maintenance_reserve_centavos bigint not null default 0,
  wastage_centavos           bigint not null default 0,
  delivery_cost_centavos     bigint not null default 0,
  other_deductions_centavos  bigint not null default 0,
  total_deductions_centavos  bigint not null default 0,
  net_profit_centavos        bigint not null default 0,
  partner_share_pct          numeric(5,2) not null,
  partner_share_centavos     bigint not null default 0,
  owner_share_centavos       bigint not null default 0,
  adjustments_centavos       bigint not null default 0,   -- sum of reconciliation_adjustments (negative = deducted from partner)
  partner_payable_centavos   bigint not null default 0,
  cost_breakdown             jsonb not null default '[]'::jsonb,
  status                     public.reconciliation_status not null default 'draft',
  notes                      text,
  created_by                 uuid references public.profiles (id),
  created_at                 timestamptz not null default now(),
  confirmed_by               uuid references public.profiles (id),
  confirmed_at               timestamptz
);

create table public.reconciliation_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  reconciliation_id  uuid not null references public.reconciliations (id),
  location_id        uuid not null references public.locations (id),
  kind               text not null default 'manual',   -- unremitted / unexplained_discrepancy / manual
  amount_centavos    bigint not null,                  -- negative = deducted from partner payable
  reason             text not null,
  auto_generated     boolean not null default false,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now()
);

create or replace function private.reconciliation_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Confirmed reconciliations are permanent' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'paid' then
    raise exception 'Paid reconciliations are permanent' using errcode = 'P0001';
  end if;
  if old.status = 'confirmed' and (new.status <> 'paid' or
     (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status')) then
    raise exception 'Confirmed reconciliations are permanent — only recording the payout is allowed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger reconciliations_guard before update or delete on public.reconciliations
  for each row execute function private.reconciliation_guard();

create or replace function private.reconciliation_adjustment_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.reconciliations where id = coalesce(new.reconciliation_id, old.reconciliation_id) and status <> 'draft') then
    raise exception 'Adjustments are locked once the reconciliation is confirmed' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger reconciliation_adjustments_guard before insert or update or delete on public.reconciliation_adjustments
  for each row execute function private.reconciliation_adjustment_guard();

-- Recalculate derived totals of a draft reconciliation
create or replace function private.recalc_reconciliation(p_id uuid)
returns public.reconciliations
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reconciliations;
  v_ded bigint;
  v_net bigint;
  v_share bigint;
  v_adj bigint;
begin
  select * into r from public.reconciliations where id = p_id;
  v_ded := r.product_cost_centavos + r.payment_fees_centavos + r.maintenance_reserve_centavos
         + r.wastage_centavos + r.delivery_cost_centavos + r.other_deductions_centavos;
  v_net := r.total_sales_centavos - v_ded;
  v_share := round(greatest(v_net, 0) * r.partner_share_pct / 100.0);
  select coalesce(sum(amount_centavos), 0) into v_adj from public.reconciliation_adjustments where reconciliation_id = p_id;
  update public.reconciliations
     set total_deductions_centavos = v_ded,
         net_profit_centavos = v_net,
         partner_share_centavos = v_share,
         owner_share_centavos = v_net - v_share,
         adjustments_centavos = v_adj,
         partner_payable_centavos = v_share + v_adj
   where id = p_id
  returning * into r;
  return r;
end $$;

-- One click from a completed audit
create or replace function public.create_reconciliation(p_audit_id uuid)
returns public.reconciliations
language plpgsql security definer set search_path = ''
as $$
declare
  a public.weekly_audits;
  l public.locations;
  s public.app_settings;
  t jsonb;
  r public.reconciliations;
  v_product_cost bigint;
  v_breakdown jsonb;
  v_wastage bigint;
  v_delivery bigint;
  v_fees bigint;
  v_maint bigint;
  v_outstanding bigint;
  v_avg_price numeric;
  v_missing integer;
  v_days text;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can create reconciliations' using errcode = '42501';
  end if;
  select * into a from public.weekly_audits where id = p_audit_id;
  if not found or a.status <> 'completed' then
    raise exception 'A reconciliation needs a completed audit for the period' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reconciliations where audit_id = a.id) then
    raise exception 'This audit already has a reconciliation' using errcode = '23505';
  end if;
  select * into l from public.locations where id = a.location_id;
  select * into s from public.app_settings where id = 1;
  t := private.period_totals(a.location_id, a.period_start, a.period_end);

  -- product cost = expected consumption (usage movements) × unit cost
  select coalesce(sum(cost), 0), coalesce(jsonb_agg(jsonb_build_object('item', name, 'unit', unit, 'qty', qty,
                                                   'unit_cost_centavos', unit_cost_centavos, 'cost_centavos', cost) order by sort_order), '[]'::jsonb)
    into v_product_cost, v_breakdown
    from (
      select i.name, i.unit, i.sort_order, i.unit_cost_centavos, -sum(m.qty) as qty,
             round(-sum(m.qty) * i.unit_cost_centavos)::bigint as cost
        from public.stock_movements m join public.inventory_items i on i.id = m.item_id
       where m.location_id = a.location_id and m.kind = 'usage'
         and m.business_date between a.period_start and a.period_end
       group by i.id
    ) x;

  -- wastage = stock lost per full counts (negative variances) × unit cost
  select coalesce(round(sum(-m.qty * i.unit_cost_centavos)), 0)::bigint into v_wastage
    from public.stock_movements m join public.inventory_items i on i.id = m.item_id
   where m.location_id = a.location_id and m.kind in ('count_adjustment', 'wastage') and m.qty < 0
     and m.business_date between a.period_start and a.period_end + 1;

  select coalesce(sum(delivery_fee_centavos), 0) into v_delivery from public.deliveries
   where location_id = a.location_id and status <> 'cancelled' and business_date between a.period_start and a.period_end;

  v_fees := round((t->'sales'->>'gcash_centavos')::bigint * s.gcash_fee_bps / 10000.0
                + (t->'sales'->>'other_centavos')::bigint * s.other_fee_bps / 10000.0);
  v_maint := round(s.maintenance_reserve_per_week_centavos * ((a.period_end - a.period_start + 1) / 7.0));

  insert into public.reconciliations (
    location_id, audit_id, period_start, period_end, total_sales_centavos, gcash_sales_centavos, other_sales_centavos,
    verified_remittances_centavos, outstanding_centavos, product_cost_centavos, payment_fees_centavos,
    maintenance_reserve_centavos, wastage_centavos, delivery_cost_centavos, partner_share_pct, cost_breakdown,
    created_by, created_at)
  values (
    a.location_id, a.id, a.period_start, a.period_end, (t->'sales'->>'net_centavos')::bigint,
    (t->'sales'->>'gcash_centavos')::bigint, (t->'sales'->>'other_centavos')::bigint,
    (t->'remittances'->>'verified_centavos')::bigint, (t->'remittances'->>'outstanding_centavos')::bigint,
    v_product_cost, v_fees, v_maint, v_wastage, v_delivery, l.partner_share_pct, v_breakdown,
    auth.uid(), private.stamp(a.period_end + 1, '-6 hours'))
  returning * into r;

  -- Automatic adjustments from audit findings
  v_outstanding := (t->'remittances'->>'outstanding_centavos')::bigint;
  if v_outstanding > 0 then
    select string_agg(to_char(business_date, 'Mon DD'), ', ' order by business_date) into v_days
      from public.daily_remittances
     where location_id = a.location_id and business_date between a.period_start and a.period_end and status <> 'verified';
    insert into public.reconciliation_adjustments (reconciliation_id, location_id, kind, amount_centavos, reason, auto_generated, created_by)
    values (r.id, a.location_id, 'unremitted', -v_outstanding,
            'Sales not yet remitted/verified' || coalesce(' (' || v_days || ')', '') || ' — deducted because the store still holds this cash',
            true, auth.uid());
  end if;

  -- unexplained major discrepancies: unreported servings × average paid price per serving
  v_avg_price := case when (t->'sales'->>'paid_servings')::numeric > 0
                      then (t->'sales'->>'gross_centavos')::numeric / (t->'sales'->>'paid_servings')::numeric end;
  if v_avg_price is not null then
    insert into public.reconciliation_adjustments (reconciliation_id, location_id, kind, amount_centavos, reason, auto_generated, created_by)
    select r.id, a.location_id, 'unexplained_discrepancy',
           -round((c.counter_delta - c.reported_servings) * v_avg_price)::bigint,
           to_char(c.business_date, 'Mon DD') || ': ' || (c.counter_delta - c.reported_servings)
             || ' servings dispensed but not reported (unexplained) × ₱' || to_char(v_avg_price / 100.0, 'FM999,990.00') || ' avg price',
           true, auth.uid()
      from public.daily_checks c
     where c.location_id = a.location_id and c.business_date between a.period_start and a.period_end
       and c.status = 'major' and (c.resolution_cause is null or c.resolution_cause = 'unexplained')
       and c.counter_delta > c.reported_servings;
  end if;

  return private.recalc_reconciliation(r.id);
end $$;

-- Admin adjusts deduction lines on a draft
create or replace function public.update_reconciliation_deductions(
  p_id uuid, p_product_cost bigint, p_payment_fees bigint, p_maintenance_reserve bigint,
  p_wastage bigint, p_delivery_cost bigint, p_other_deductions bigint, p_notes text default null
)
returns public.reconciliations
language plpgsql security definer set search_path = ''
as $$
declare r public.reconciliations;
begin
  if not private.is_admin() then
    raise exception 'Only admin can edit reconciliations' using errcode = '42501';
  end if;
  if least(p_product_cost, p_payment_fees, p_maintenance_reserve, p_wastage, p_delivery_cost, p_other_deductions) < 0 then
    raise exception 'Deductions cannot be negative' using errcode = 'P0001';
  end if;
  update public.reconciliations
     set product_cost_centavos = p_product_cost, payment_fees_centavos = p_payment_fees,
         maintenance_reserve_centavos = p_maintenance_reserve, wastage_centavos = p_wastage,
         delivery_cost_centavos = p_delivery_cost, other_deductions_centavos = p_other_deductions,
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_id and status = 'draft' returning * into r;
  if not found then
    raise exception 'Only draft reconciliations can be edited' using errcode = 'P0001';
  end if;
  return private.recalc_reconciliation(p_id);
end $$;

create or replace function public.add_reconciliation_adjustment(p_id uuid, p_amount_centavos bigint, p_reason text)
returns public.reconciliations
language plpgsql security definer set search_path = ''
as $$
declare r public.reconciliations;
begin
  if not private.is_admin() then
    raise exception 'Only admin can add adjustments' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' or p_amount_centavos is null or p_amount_centavos = 0 then
    raise exception 'Amount and reason are required' using errcode = 'P0001';
  end if;
  select * into r from public.reconciliations where id = p_id;
  insert into public.reconciliation_adjustments (reconciliation_id, location_id, kind, amount_centavos, reason, created_by)
  values (p_id, r.location_id, 'manual', p_amount_centavos, btrim(p_reason), auth.uid());
  return private.recalc_reconciliation(p_id);
end $$;

create or replace function public.remove_reconciliation_adjustment(p_adjustment_id uuid)
returns public.reconciliations
language plpgsql security definer set search_path = ''
as $$
declare v_recon uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admin can remove adjustments' using errcode = '42501';
  end if;
  delete from public.reconciliation_adjustments where id = p_adjustment_id returning reconciliation_id into v_recon;
  return private.recalc_reconciliation(v_recon);
end $$;

-- ---------------------------------------------------------------------
-- Partner statements
-- ---------------------------------------------------------------------
create sequence public.statement_no_seq start 1;

create table public.partner_statements (
  id                 uuid primary key default gen_random_uuid(),
  statement_no       text not null unique,
  reconciliation_id  uuid not null unique references public.reconciliations (id),
  location_id        uuid not null references public.locations (id),
  period_start       date not null,
  period_end         date not null,
  partner_payable_centavos bigint not null,
  snapshot           jsonb not null,     -- everything the partner needs to see how the payout was computed
  issued_at          timestamptz not null default now(),
  acknowledged_by    uuid references public.profiles (id),
  acknowledged_at    timestamptz,
  acknowledgment_note text
);

create or replace function private.statement_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Statements are permanent' using errcode = 'P0001';
  end if;
  if old.acknowledged_at is not null
     or (to_jsonb(new) - '{acknowledged_by,acknowledged_at,acknowledgment_note}'::text[])
        <> (to_jsonb(old) - '{acknowledged_by,acknowledged_at,acknowledgment_note}'::text[]) then
    raise exception 'Statements are permanent — only the partner acknowledgment can be recorded once' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger partner_statements_guard before update or delete on public.partner_statements
  for each row execute function private.statement_guard();

create or replace function public.confirm_reconciliation(p_id uuid)
returns public.partner_statements
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reconciliations;
  l public.locations;
  st public.partner_statements;
  v_snapshot jsonb;
  v_stamp timestamptz;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can confirm reconciliations' using errcode = '42501';
  end if;
  r := private.recalc_reconciliation(p_id);
  if r.status <> 'draft' then
    raise exception 'Reconciliation is already %', r.status using errcode = 'P0001';
  end if;
  select * into l from public.locations where id = r.location_id;
  v_stamp := private.stamp(r.period_end + 1, '-5 hours');

  update public.reconciliations set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = v_stamp
   where id = p_id returning * into r;

  v_snapshot := jsonb_build_object(
    'location', jsonb_build_object('code', l.code, 'store_name', l.store_name, 'partner_name', l.partner_name, 'address', l.address),
    'period_start', r.period_start,
    'period_end', r.period_end,
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'date', d.business_date, 'type', d.report_type, 'net_sales_centavos', d.net_sales_centavos,
        'servings', d.total_servings, 'remitted_centavos', case when rm.status = 'verified' then rm.amount_sent_centavos else 0 end,
        'remittance_status', rm.status, 'reference_no', rm.reference_no) order by d.business_date)
        from public.daily_sales_reports d
        left join public.daily_remittances rm on rm.sales_report_id = d.id
       where d.location_id = r.location_id and d.business_date between r.period_start and r.period_end), '[]'::jsonb),
    'sales_by_product', coalesce((select jsonb_agg(jsonb_build_object('product', product_name, 'qty', q, 'free_qty', f, 'amount_centavos', amt) order by amt desc)
        from (select l2.product_name, sum(l2.qty) q, sum(l2.free_qty) f, sum(l2.subtotal_centavos) amt
                from public.daily_sales_lines l2 join public.daily_sales_reports d2 on d2.id = l2.report_id
               where d2.location_id = r.location_id and d2.business_date between r.period_start and r.period_end
               group by l2.product_name) p), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_sales_centavos', r.total_sales_centavos,
      'verified_remittances_centavos', r.verified_remittances_centavos,
      'outstanding_centavos', r.outstanding_centavos),
    'deductions', jsonb_build_object(
      'product_cost_centavos', r.product_cost_centavos,
      'payment_fees_centavos', r.payment_fees_centavos,
      'maintenance_reserve_centavos', r.maintenance_reserve_centavos,
      'wastage_centavos', r.wastage_centavos,
      'delivery_cost_centavos', r.delivery_cost_centavos,
      'other_deductions_centavos', r.other_deductions_centavos,
      'total_deductions_centavos', r.total_deductions_centavos,
      'cost_breakdown', r.cost_breakdown),
    'net_profit_centavos', r.net_profit_centavos,
    'partner_share_pct', r.partner_share_pct,
    'partner_share_centavos', r.partner_share_centavos,
    'owner_share_centavos', r.owner_share_centavos,
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'amount_centavos', amount_centavos, 'kind', kind) order by created_at)
        from public.reconciliation_adjustments where reconciliation_id = r.id), '[]'::jsonb),
    'adjustments_centavos', r.adjustments_centavos,
    'partner_payable_centavos', r.partner_payable_centavos,
    'audit_summary', (select summary from public.audit_partner_summaries where audit_id = r.audit_id)
  );

  insert into public.partner_statements (statement_no, reconciliation_id, location_id, period_start, period_end,
                                         partner_payable_centavos, snapshot, issued_at)
  values (l.code || '-' || to_char(r.period_end, 'YYYYMMDD') || '-' || lpad(nextval('public.statement_no_seq')::text, 4, '0'),
          r.id, r.location_id, r.period_start, r.period_end, r.partner_payable_centavos, v_snapshot, v_stamp)
  returning * into st;
  return st;
end $$;

create or replace function public.acknowledge_statement(p_statement_id uuid, p_note text default null)
returns public.partner_statements
language plpgsql security definer set search_path = ''
as $$
declare st public.partner_statements;
begin
  select * into st from public.partner_statements where id = p_statement_id for update;
  if not found or not (private.my_location_id() = st.location_id or private.seed_mode()) then
    raise exception 'Only the partner can acknowledge their statement' using errcode = '42501';
  end if;
  if st.acknowledged_at is not null then
    raise exception 'Already acknowledged' using errcode = 'P0001';
  end if;
  update public.partner_statements
     set acknowledged_by = auth.uid(), acknowledged_at = private.stamp(st.period_end + 2, '-6 hours'),
         acknowledgment_note = nullif(btrim(p_note), '')
   where id = st.id returning * into st;
  return st;
end $$;

-- ---------------------------------------------------------------------
-- Payouts (my payment of the partner's share)
-- ---------------------------------------------------------------------
create table public.payouts (
  id                   uuid primary key default gen_random_uuid(),
  location_id          uuid not null references public.locations (id),
  reconciliation_id    uuid not null unique references public.reconciliations (id),
  statement_id         uuid not null unique references public.partner_statements (id),
  amount_centavos      bigint not null check (amount_centavos > 0),
  method               public.payment_method not null,
  reference_no         text not null,
  proof_path           text not null,
  paid_on              date not null,
  paid_by              uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  partner_confirmed_by uuid references public.profiles (id),
  partner_confirmed_at timestamptz
);

create or replace function private.payout_guard()
returns trigger language plpgsql
as $$
begin
  if private.seed_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Payouts are permanent' using errcode = 'P0001';
  end if;
  if old.partner_confirmed_at is not null
     or (to_jsonb(new) - '{partner_confirmed_by,partner_confirmed_at}'::text[])
        <> (to_jsonb(old) - '{partner_confirmed_by,partner_confirmed_at}'::text[]) then
    raise exception 'Payouts are permanent — only the partner''s receipt confirmation can be recorded once' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payouts_guard before update or delete on public.payouts
  for each row execute function private.payout_guard();

create or replace function public.record_payout(
  p_reconciliation_id uuid, p_amount_centavos bigint, p_method public.payment_method,
  p_reference_no text, p_proof_path text, p_paid_on date
)
returns public.payouts
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reconciliations;
  st public.partner_statements;
  p public.payouts;
begin
  if not private.is_admin() and not private.seed_mode() then
    raise exception 'Only admin can record payouts' using errcode = '42501';
  end if;
  select * into r from public.reconciliations where id = p_reconciliation_id for update;
  if not found or r.status <> 'confirmed' then
    raise exception 'A payout needs a confirmed reconciliation' using errcode = 'P0001';
  end if;
  select * into st from public.partner_statements where reconciliation_id = r.id;
  if p_amount_centavos <> r.partner_payable_centavos then
    raise exception 'Payout must equal the partner share payable (₱%)', to_char(r.partner_payable_centavos / 100.0, 'FM999,999,990.00')
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reference_no), '') = '' then
    raise exception 'Reference number is required' using errcode = 'P0001';
  end if;
  perform private.assert_photo(r.location_id, p_proof_path, 'Proof of payment');
  insert into public.payouts (location_id, reconciliation_id, statement_id, amount_centavos, method, reference_no,
                              proof_path, paid_on, paid_by, created_at)
  values (r.location_id, r.id, st.id, p_amount_centavos, p_method, btrim(p_reference_no), p_proof_path,
          p_paid_on, auth.uid(), private.stamp(p_paid_on, '-4 hours'))
  returning * into p;
  update public.reconciliations set status = 'paid' where id = r.id;
  return p;
end $$;

create or replace function public.confirm_payout_received(p_payout_id uuid)
returns public.payouts
language plpgsql security definer set search_path = ''
as $$
declare p public.payouts;
begin
  select * into p from public.payouts where id = p_payout_id for update;
  if not found or not (private.my_location_id() = p.location_id or private.seed_mode()) then
    raise exception 'Only the partner can confirm receipt' using errcode = '42501';
  end if;
  if p.partner_confirmed_at is not null then
    raise exception 'Already confirmed' using errcode = 'P0001';
  end if;
  update public.payouts set partner_confirmed_by = auth.uid(), partner_confirmed_at = private.stamp(p.paid_on, '-1 hours')
   where id = p.id returning * into p;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- Activity logging
-- ---------------------------------------------------------------------
create trigger weekly_audits_log after insert or update or delete on public.weekly_audits
  for each row execute function private.log_activity();
create trigger audit_items_log after insert or update or delete on public.audit_items
  for each row execute function private.log_activity();
create trigger audit_findings_log after insert or update or delete on public.audit_findings
  for each row execute function private.log_activity();
create trigger audit_partner_summaries_log after insert or update or delete on public.audit_partner_summaries
  for each row execute function private.log_activity();
create trigger inventory_counts_log after insert or update or delete on public.inventory_counts
  for each row execute function private.log_activity();
create trigger inventory_count_lines_log after insert or update or delete on public.inventory_count_lines
  for each row execute function private.log_activity();
create trigger reconciliations_log after insert or update or delete on public.reconciliations
  for each row execute function private.log_activity();
create trigger reconciliation_adjustments_log after insert or update or delete on public.reconciliation_adjustments
  for each row execute function private.log_activity();
create trigger partner_statements_log after insert or update or delete on public.partner_statements
  for each row execute function private.log_activity();
create trigger payouts_log after insert or update or delete on public.payouts
  for each row execute function private.log_activity();
