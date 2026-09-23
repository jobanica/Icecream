-- =====================================================================
-- Phase 2 support: audit writes only through RPCs, helpers for the
-- audit / reconciliation screens.
-- =====================================================================

-- Direct UPDATE on weekly_audits let a team member overwrite status/summary.
-- All audit changes now go through RPCs.
drop policy if exists weekly_audits_team_update on public.weekly_audits;

create or replace function private.assert_audit_open(p_audit_id uuid)
returns public.weekly_audits
language plpgsql stable security definer set search_path = ''
as $$
declare a public.weekly_audits;
begin
  select * into a from public.weekly_audits where id = p_audit_id;
  if not found then
    raise exception 'Audit not found' using errcode = 'P0001';
  end if;
  if a.status <> 'in_progress' and not private.seed_mode() then
    raise exception 'Start the audit first (status: %)', a.status using errcode = 'P0001';
  end if;
  return a;
end $$;

-- Checklist answers require an in-progress audit
create or replace function public.set_audit_item(p_item_id uuid, p_result public.audit_result, p_notes text default null, p_photo_path text default null)
returns public.audit_items
language plpgsql security definer set search_path = ''
as $$
declare i public.audit_items;
begin
  if not private.is_team() and not private.seed_mode() then
    raise exception 'Only admin or staff can conduct audits' using errcode = '42501';
  end if;
  select * into i from public.audit_items where id = p_item_id;
  if not found then
    raise exception 'Checklist item not found' using errcode = 'P0001';
  end if;
  perform private.assert_audit_open(i.audit_id);
  if p_photo_path is not null then
    perform private.assert_photo(i.location_id, p_photo_path, 'Evidence');
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
  a := private.assert_audit_open(p_audit_id);
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Describe the finding' using errcode = 'P0001';
  end if;
  if p_photo_path is not null then
    perform private.assert_photo(a.location_id, p_photo_path, 'Evidence');
  end if;
  insert into public.audit_findings (audit_id, location_id, severity, description, action_item, photo_path, created_by, created_at)
  values (p_audit_id, a.location_id, p_severity, btrim(p_description), nullif(btrim(p_action_item), ''), p_photo_path, auth.uid(),
          private.stamp(a.period_end + 1, '-10 hours'))
  returning * into f;
  return f;
end $$;

create or replace function public.remove_audit_finding(p_finding_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.audit_findings;
begin
  if not private.is_team() then
    raise exception 'Only admin or staff can edit findings' using errcode = '42501';
  end if;
  select * into f from public.audit_findings where id = p_finding_id;
  if not found then
    return;
  end if;
  perform private.assert_audit_open(f.audit_id);
  delete from public.audit_findings where id = p_finding_id;
end $$;

create or replace function public.set_audit_notes(p_audit_id uuid, p_notes text)
returns public.weekly_audits
language plpgsql security definer set search_path = ''
as $$
declare a public.weekly_audits;
begin
  if not private.is_team() then
    raise exception 'Only admin or staff can edit audits' using errcode = '42501';
  end if;
  perform private.assert_audit_open(p_audit_id);
  update public.weekly_audits set notes = nullif(btrim(p_notes), '') where id = p_audit_id returning * into a;
  return a;
end $$;

-- A scheduled (not started) audit can be deleted, e.g. wrong period
create or replace function public.delete_scheduled_audit(p_audit_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admin can delete audits' using errcode = '42501';
  end if;
  if not exists (select 1 from public.weekly_audits where id = p_audit_id and status = 'scheduled') then
    raise exception 'Only scheduled audits can be deleted' using errcode = 'P0001';
  end if;
  delete from public.audit_items where audit_id = p_audit_id;
  delete from public.weekly_audits where id = p_audit_id;
end $$;

-- Full-count sheet for the audit screen: system on-hand as of a date and the
-- expected usage since the previous full count, per item.
create or replace function public.inventory_count_sheet(p_location_id uuid, p_business_date date)
returns table (
  item_id uuid, item_name text, unit text, container_type public.container_type, is_premix boolean,
  yield_servings numeric, unit_cost_centavos bigint, system_qty numeric, expected_usage numeric, last_count_date date
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_team() then
    raise exception 'Only admin or staff can count inventory' using errcode = '42501';
  end if;
  return query
  select i.id, i.name, i.unit, i.container_type, i.is_premix, i.yield_servings, i.unit_cost_centavos,
         private.on_hand(p_location_id, i.id, p_business_date),
         coalesce((select -sum(m.qty) from public.stock_movements m
                    where m.location_id = p_location_id and m.item_id = i.id and m.kind = 'usage'
                      and m.business_date <= p_business_date
                      and m.business_date > coalesce(lc.d, '-infinity'::date)), 0),
         lc.d
    from public.inventory_items i
    left join lateral (
      select max(ic.business_date) as d
        from public.inventory_counts ic
        join public.inventory_count_lines l on l.count_id = ic.id and l.item_id = i.id
       where ic.location_id = p_location_id and ic.business_date < p_business_date
    ) lc on true
   where i.is_active
   order by i.sort_order, i.name;
end $$;

-- Period preview while the audit is in progress (same numbers the summary will use)
create or replace function public.audit_period_totals(p_audit_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare a public.weekly_audits;
begin
  if not private.is_team() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into a from public.weekly_audits where id = p_audit_id;
  return private.period_totals(a.location_id, a.period_start, a.period_end);
end $$;

revoke execute on function public.remove_audit_finding(uuid), public.set_audit_notes(uuid, text),
  public.delete_scheduled_audit(uuid), public.inventory_count_sheet(uuid, date), public.audit_period_totals(uuid)
  from public, anon;
grant execute on function public.remove_audit_finding(uuid), public.set_audit_notes(uuid, text),
  public.delete_scheduled_audit(uuid), public.inventory_count_sheet(uuid, date), public.audit_period_totals(uuid)
  to authenticated, service_role;
grant execute on function private.assert_audit_open(uuid) to authenticated, service_role;

-- Discard a draft reconciliation (e.g. remittances were verified after it was
-- created) so it can be created again from the audit with fresh numbers.
create or replace function public.delete_draft_reconciliation(p_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_audit uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admin can discard reconciliations' using errcode = '42501';
  end if;
  select audit_id into v_audit from public.reconciliations where id = p_id and status = 'draft';
  if not found then
    raise exception 'Only draft reconciliations can be discarded' using errcode = 'P0001';
  end if;
  delete from public.reconciliation_adjustments where reconciliation_id = p_id;
  delete from public.reconciliations where id = p_id;
  return v_audit;
end $$;

revoke execute on function public.delete_draft_reconciliation(uuid) from public, anon;
grant execute on function public.delete_draft_reconciliation(uuid) to authenticated, service_role;
