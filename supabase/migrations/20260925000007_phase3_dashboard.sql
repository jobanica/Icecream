-- =====================================================================
-- Phase 3: dashboard, per-location trends, audit history (admin only)
-- =====================================================================

-- One row per location for a date range
create or replace function public.dashboard_summary(p_from date, p_to date)
returns table (
  location_id uuid,
  code text,
  store_name text,
  status public.location_status,
  days integer,                          -- finished trading days in range (since partnership start, before today)
  complete_days integer,                 -- counter + count + sales + remittance sent/verified
  sales_centavos bigint,
  verified_centavos bigint,
  sales_days integer,                    -- days with net sales > 0
  remit_verified_days integer,
  remit_sent_days integer,               -- submitted or verified
  matched_days integer,
  minor_days integer,
  major_days integer,
  open_discrepancies integer,            -- unresolved minor/major (all time)
  last_audit_score text,
  last_audit_date date,
  net_profit_centavos bigint,            -- reconciliations whose period ends in range
  partner_share_paid_centavos bigint,
  partner_share_pending_centavos bigint, -- confirmed, not yet paid (all time)
  outstanding_all_time_centavos bigint,  -- all sales − all verified remittances
  stock_low integer,
  stock_out integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admin can view the dashboard' using errcode = '42501';
  end if;
  return query
  with loc as (
    select l.* from public.locations l where l.status in ('active', 'paused')
  ),
  span as (
    select l.id, greatest(p_from, coalesce(l.partnership_start_date, l.opening_count_date, p_from)) as s,
           least(p_to, private.today_ph()) as e
      from loc l
  ),
  days as (
    select sp.id, d::date as d from span sp cross join lateral generate_series(sp.s, sp.e, '1 day') d
  ),
  daily as (
    select dy.id, dy.d,
           exists (select 1 from public.counter_readings c where c.location_id = dy.id and c.business_date = dy.d) as has_counter,
           exists (select 1 from public.daily_container_counts c where c.location_id = dy.id and c.business_date = dy.d) as has_count,
           r.net_sales_centavos, rm.status as rstatus, rm.amount_sent_centavos, ch.status as cstatus
      from days dy
      left join public.daily_sales_reports r on r.location_id = dy.id and r.business_date = dy.d
      left join public.daily_remittances rm on rm.location_id = dy.id and rm.business_date = dy.d
      left join public.daily_checks ch on ch.location_id = dy.id and ch.business_date = dy.d
  ),
  agg as (
    select id,
           -- today is still in progress, so it never counts as missed
           count(*) filter (where d < private.today_ph())::int as days,
           count(*) filter (where d < private.today_ph() and has_counter and has_count and net_sales_centavos is not null
                              and rstatus in ('submitted', 'verified'))::int as complete_days,
           coalesce(sum(net_sales_centavos), 0)::bigint as sales,
           coalesce(sum(amount_sent_centavos) filter (where rstatus = 'verified'), 0)::bigint as verified,
           count(*) filter (where net_sales_centavos > 0)::int as sales_days,
           count(*) filter (where net_sales_centavos > 0 and rstatus = 'verified')::int as rv,
           count(*) filter (where net_sales_centavos > 0 and rstatus in ('submitted', 'verified'))::int as rs,
           count(*) filter (where cstatus = 'matched')::int as m,
           count(*) filter (where cstatus = 'minor')::int as mi,
           count(*) filter (where cstatus = 'major')::int as ma
      from daily group by id
  )
  select l.id, l.code, l.store_name, l.status,
         coalesce(a.days, 0), coalesce(a.complete_days, 0), coalesce(a.sales, 0), coalesce(a.verified, 0),
         coalesce(a.sales_days, 0), coalesce(a.rv, 0), coalesce(a.rs, 0),
         coalesce(a.m, 0), coalesce(a.mi, 0), coalesce(a.ma, 0),
         (select count(*)::int from public.daily_checks c where c.location_id = l.id and c.status in ('minor', 'major') and c.resolved_at is null),
         (select w.score_passed || '/' || w.score_total from public.weekly_audits w where w.location_id = l.id and w.status = 'completed' order by w.period_end desc limit 1),
         (select w.period_end from public.weekly_audits w where w.location_id = l.id and w.status = 'completed' order by w.period_end desc limit 1),
         (select coalesce(sum(x.net_profit_centavos), 0)::bigint from public.reconciliations x
           where x.location_id = l.id and x.status <> 'draft' and x.period_end between p_from and p_to),
         (select coalesce(sum(p.amount_centavos), 0)::bigint from public.payouts p where p.location_id = l.id and p.paid_on between p_from and p_to),
         (select coalesce(sum(x.partner_payable_centavos), 0)::bigint from public.reconciliations x
           where x.location_id = l.id and x.status = 'confirmed' and x.partner_payable_centavos > 0),
         (select coalesce(sum(r.net_sales_centavos), 0) from public.daily_sales_reports r where r.location_id = l.id)::bigint
           - (select coalesce(sum(rm.amount_sent_centavos), 0) from public.daily_remittances rm where rm.location_id = l.id and rm.status = 'verified')::bigint,
         (select count(*)::int from public.v_stock_on_hand s where s.location_id = l.id and s.stock_status = 'low'),
         (select count(*)::int from public.v_stock_on_hand s where s.location_id = l.id and s.stock_status = 'out')
    from loc l
    left join agg a on a.id = l.id
   order by l.code;
end $$;

-- Daily series for one location: sales and the three servings numbers
create or replace function public.location_trend(p_location_id uuid, p_from date, p_to date)
returns table (
  business_date date, sales_centavos bigint, counter_delta integer, reported_servings integer,
  container_servings integer, check_status public.check_status, remittance_status public.remittance_status
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_team() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select d::date, r.net_sales_centavos, c.counter_delta, c.reported_servings, c.container_servings, c.status, rm.status
    from generate_series(p_from, least(p_to, private.today_ph()), '1 day') d
    left join public.daily_sales_reports r on r.location_id = p_location_id and r.business_date = d::date
    left join public.daily_checks c on c.location_id = p_location_id and c.business_date = d::date
    left join public.daily_remittances rm on rm.location_id = p_location_id and rm.business_date = d::date
   order by 1;
end $$;

-- Audit history for one location: scores, findings, discrepancy rate per audited period
create or replace function public.audit_history(p_location_id uuid)
returns table (
  audit_id uuid, period_start date, period_end date, completed_at timestamptz,
  score_passed integer, score_total integer,
  findings_major integer, findings_minor integer, findings_info integer,
  checked_days integer, discrepancy_days integer, reconciliation_status public.reconciliation_status,
  partner_payable_centavos bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_team() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select w.id, w.period_start, w.period_end, w.completed_at, w.score_passed, w.score_total,
         (select count(*)::int from public.audit_findings f where f.audit_id = w.id and f.severity = 'major'),
         (select count(*)::int from public.audit_findings f where f.audit_id = w.id and f.severity = 'minor'),
         (select count(*)::int from public.audit_findings f where f.audit_id = w.id and f.severity = 'info'),
         (select count(*)::int from public.daily_checks c where c.location_id = w.location_id
            and c.business_date between w.period_start and w.period_end and c.status <> 'incomplete'),
         (select count(*)::int from public.daily_checks c where c.location_id = w.location_id
            and c.business_date between w.period_start and w.period_end and c.status in ('minor', 'major')),
         x.status, x.partner_payable_centavos
    from public.weekly_audits w
    left join public.reconciliations x on x.audit_id = w.id
   where w.location_id = p_location_id and w.status = 'completed'
   order by w.period_end;
end $$;

-- Checklist items that failed in more than one audit (recurring problems)
create or replace function public.recurring_audit_failures(p_location_id uuid)
returns table (item_key text, label text, section public.audit_section, fail_count integer, audits integer, last_failed date, last_notes text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_team() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select i.item_key, max(i.label), max(i.section::text)::public.audit_section,
         count(*) filter (where i.result = 'fail')::int,
         count(*)::int,
         max(w.period_end) filter (where i.result = 'fail'),
         (array_agg(i.notes order by w.period_end desc) filter (where i.result = 'fail' and i.notes is not null))[1]
    from public.audit_items i
    join public.weekly_audits w on w.id = i.audit_id and w.status = 'completed'
   where i.location_id = p_location_id
   group by i.item_key
  having count(*) filter (where i.result = 'fail') > 0
   order by 4 desc, 6 desc;
end $$;

revoke execute on function public.dashboard_summary(date, date), public.location_trend(uuid, date, date),
  public.audit_history(uuid), public.recurring_audit_failures(uuid) from public, anon;
grant execute on function public.dashboard_summary(date, date), public.location_trend(uuid, date, date),
  public.audit_history(uuid), public.recurring_audit_failures(uuid) to authenticated, service_role;
