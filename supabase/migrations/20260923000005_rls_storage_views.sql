-- =====================================================================
-- Row Level Security, storage bucket + policies, reporting views, grants
--   admin   : everything
--   staff   : read operations data; writes via RPCs (deliveries, counts, audits)
--   partner : read own location only; writes via RPCs only
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','app_settings','activity_log','locations','location_photos','machines','machine_events',
    'inventory_items','products','product_components','stock_levels','stock_movements',
    'counter_readings','daily_container_counts','daily_sales_reports','daily_sales_lines',
    'sales_report_corrections','daily_remittances','remittance_submissions','daily_checks',
    'deliveries','delivery_lines','audit_checklist_template','weekly_audits','audit_items',
    'audit_findings','audit_partner_summaries','inventory_counts','inventory_count_lines',
    'reconciliations','reconciliation_adjustments','partner_statements','payouts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
-- profiles
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_team());
create policy profiles_admin_write on public.profiles for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- settings: everyone signed in can read (partners see remittance details)
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_admin on public.app_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy activity_log_admin on public.activity_log for select to authenticated using (private.is_admin());

-- locations
create policy locations_read on public.locations for select to authenticated
  using (private.is_team() or id = private.my_location_id());
create policy locations_admin_insert on public.locations for insert to authenticated with check (private.is_admin());
create policy locations_admin_update on public.locations for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Tables with a location_id: team reads all, partner reads own.
do $$
declare t text;
begin
  foreach t in array array[
    'location_photos','machines','machine_events','products','stock_levels','stock_movements',
    'counter_readings','daily_container_counts','daily_sales_reports','daily_sales_lines',
    'sales_report_corrections','daily_remittances','remittance_submissions','daily_checks',
    'deliveries','audit_partner_summaries'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select to authenticated
        using (private.is_team() or location_id = private.my_location_id())
    $f$, t);
  end loop;
end $$;

-- delivery lines inherit from their delivery
create policy delivery_lines_read on public.delivery_lines for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id
                 and (private.is_team() or d.location_id = private.my_location_id())));

-- product components inherit from product
create policy product_components_read on public.product_components for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id
                 and (private.is_team() or p.location_id = private.my_location_id())));
create policy product_components_admin on public.product_components for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- master data written directly by admin
create policy location_photos_team_insert on public.location_photos for insert to authenticated with check (private.is_team());
create policy machines_admin_insert on public.machines for insert to authenticated with check (private.is_admin());
create policy machines_admin_update on public.machines for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- non-counter machine events (maintenance / condition / install / removal) by team;
-- counter-affecting events only via RPCs
create policy machine_events_team_insert on public.machine_events for insert to authenticated
  with check (private.is_team() and event_type in ('installed', 'replaced', 'maintenance', 'condition', 'removed'));
create policy products_admin_insert on public.products for insert to authenticated with check (private.is_admin());
create policy products_admin_update on public.products for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy stock_levels_admin on public.stock_levels for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy inventory_items_read on public.inventory_items for select to authenticated using (true);
create policy inventory_items_admin on public.inventory_items for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy audit_template_read on public.audit_checklist_template for select to authenticated using (true);
create policy audit_template_admin on public.audit_checklist_template for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- audits: team only (partners read audit_partner_summaries)
create policy weekly_audits_team on public.weekly_audits for select to authenticated using (private.is_team());
create policy weekly_audits_team_update on public.weekly_audits for update to authenticated
  using (private.is_team()) with check (private.is_team());
create policy audit_items_team on public.audit_items for select to authenticated using (private.is_team());
create policy audit_findings_team on public.audit_findings for select to authenticated using (private.is_team());
create policy inventory_counts_team on public.inventory_counts for select to authenticated using (private.is_team());
create policy inventory_count_lines_team on public.inventory_count_lines for select to authenticated using (private.is_team());

-- finance: admin + own partner (statements / payouts). Reconciliation
-- internals are admin-only; the statement snapshot carries the breakdown.
create policy reconciliations_admin on public.reconciliations for select to authenticated using (private.is_admin());
create policy reconciliation_adjustments_admin on public.reconciliation_adjustments for select to authenticated using (private.is_admin());
create policy partner_statements_read on public.partner_statements for select to authenticated
  using (private.is_admin() or location_id = private.my_location_id());
create policy payouts_read on public.payouts for select to authenticated
  using (private.is_admin() or location_id = private.my_location_id());

-- ---------------------------------------------------------------------
-- Storage: one private bucket, one folder per location:
--   evidence/<location_id>/<kind>/<yyyy-mm-dd>/<uuid>.jpg
-- Partners can read/upload only inside their own folder; nobody can
-- overwrite or delete (evidence is permanent).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence'
         and (private.is_team() or (storage.foldername(name))[1] = private.my_location_id()::text));

create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence'
              and (private.is_team() or (storage.foldername(name))[1] = private.my_location_id()::text));

-- ---------------------------------------------------------------------
-- Views (security_invoker => RLS of the caller applies)
-- ---------------------------------------------------------------------
create view public.v_stock_on_hand with (security_invoker = true) as
select
  l.id as location_id,
  l.code as location_code,
  i.id as item_id,
  i.name as item_name,
  i.unit,
  i.container_type,
  i.is_premix,
  i.yield_servings,
  i.sort_order,
  coalesce(m.on_hand, 0)::numeric(12,3) as on_hand,
  coalesce(sl.reorder_point, i.default_reorder_point) as reorder_point,
  coalesce(sl.par_level, 0) as par_level,
  case
    when coalesce(m.on_hand, 0) <= 0 then 'out'
    when coalesce(m.on_hand, 0) <= coalesce(sl.reorder_point, i.default_reorder_point) then 'low'
    else 'ok'
  end as stock_status
from public.locations l
cross join public.inventory_items i
left join (
  select location_id, item_id, sum(qty) as on_hand from public.stock_movements group by location_id, item_id
) m on m.location_id = l.id and m.item_id = i.id
left join public.stock_levels sl on sl.location_id = l.id and sl.item_id = i.id
where i.is_active and l.status in ('pending', 'active', 'paused');

-- Daily flow status: one row per location per trading day since the partnership start (max 60 days)
create view public.v_daily_status with (security_invoker = true) as
select
  l.id as location_id,
  l.code as location_code,
  l.store_name,
  d::date as business_date,
  (select count(*) from public.counter_readings cr where cr.location_id = l.id and cr.business_date = d::date) > 0 as has_counter,
  exists (select 1 from public.daily_container_counts c where c.location_id = l.id and c.business_date = d::date) as has_count,
  exists (select 1 from public.daily_sales_reports s where s.location_id = l.id and s.business_date = d::date) as has_sales,
  (select r.status from public.daily_remittances r where r.location_id = l.id and r.business_date = d::date) as remittance_status,
  (select r.amount_due_centavos from public.daily_remittances r where r.location_id = l.id and r.business_date = d::date) as amount_due_centavos,
  (select ch.status from public.daily_checks ch where ch.location_id = l.id and ch.business_date = d::date) as check_status,
  (select ch.resolved_at is not null from public.daily_checks ch where ch.location_id = l.id and ch.business_date = d::date) as check_resolved
from public.locations l
cross join lateral generate_series(
  -- first trading day = partnership start date (falls back to the opening count date)
  greatest(coalesce(l.partnership_start_date, l.opening_count_date, private.today_ph()), private.today_ph() - 59),
  private.today_ph(), interval '1 day') d
where l.status = 'active';

-- Stock movement summary for a period: beginning / delivered / used / adjusted / ending
create or replace function public.stock_summary(p_location_id uuid, p_from date, p_to date)
returns table (
  item_id uuid, item_name text, unit text, beginning numeric, delivered numeric, used numeric,
  adjusted numeric, ending numeric, reorder_point numeric
)
language sql stable security invoker set search_path = ''
as $$
  select i.id, i.name, i.unit,
         coalesce(sum(m.qty) filter (where m.business_date < p_from), 0),
         coalesce(sum(m.qty) filter (where m.business_date between p_from and p_to and m.kind in ('delivery', 'opening')), 0),
         coalesce(-sum(m.qty) filter (where m.business_date between p_from and p_to and m.kind = 'usage'), 0),
         coalesce(sum(m.qty) filter (where m.business_date between p_from and p_to and m.kind in ('count_adjustment', 'wastage', 'transfer')), 0),
         coalesce(sum(m.qty) filter (where m.business_date <= p_to), 0),
         coalesce(sl.reorder_point, i.default_reorder_point)
    from public.inventory_items i
    left join public.stock_movements m on m.item_id = i.id and m.location_id = p_location_id
    left join public.stock_levels sl on sl.item_id = i.id and sl.location_id = p_location_id
   where i.is_active
   group by i.id, i.name, i.unit, i.sort_order, sl.reorder_point, i.default_reorder_point
   order by i.sort_order, i.name
$$;

-- Previous values the partner wizard needs (last reading per machine, last count)
create or replace function public.daily_flow_context(p_location_id uuid, p_business_date date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.locations;
  v_prev_count public.daily_container_counts;
  v_prev_date date;
  v_prev_cones integer;
  v_prev_cups integer;
begin
  if not private.can_access_location(p_location_id) then
    raise exception 'You do not have access to this store' using errcode = '42501';
  end if;
  select * into l from public.locations where id = p_location_id;
  select * into v_prev_count from public.daily_container_counts
   where location_id = p_location_id and business_date < p_business_date order by business_date desc limit 1;
  if found then
    v_prev_date := v_prev_count.business_date; v_prev_cones := v_prev_count.cones_remaining; v_prev_cups := v_prev_count.cups_remaining;
  else
    v_prev_date := l.opening_count_date; v_prev_cones := coalesce(l.opening_cones, 0); v_prev_cups := coalesce(l.opening_cups, 0);
  end if;
  return jsonb_build_object(
    'machines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'serial_number', m.serial_number, 'model', m.model,
        'last_reading', coalesce(r.reading, m.baseline_reading),
        'last_date', r.business_date,
        'today_reading', t.reading, 'today_delta', t.delta) order by m.serial_number)
       from public.machines m
       left join lateral (select reading, business_date from public.counter_readings
                           where machine_id = m.id and business_date < p_business_date
                           order by business_date desc limit 1) r on true
       left join public.counter_readings t on t.machine_id = m.id and t.business_date = p_business_date
      where m.location_id = p_location_id and m.status = 'active'), '[]'::jsonb),
    'previous_count', jsonb_build_object('date', v_prev_date, 'cones', v_prev_cones, 'cups', v_prev_cups),
    'delivered', jsonb_build_object(
      'cones', private.delivered_containers(p_location_id, 'cone', v_prev_date, p_business_date),
      'cups', private.delivered_containers(p_location_id, 'cup', v_prev_date, p_business_date))
  );
end $$;

-- ---------------------------------------------------------------------
-- Grants: RPCs callable by signed-in users only
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
