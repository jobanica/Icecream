-- Behavioural tests for RLS + business rules. Run after reset_local.sh --seed:
--   psql -d softserve_test -f supabase/tests/rls_and_rules.sql
-- Each block raises an exception on failure.
\set ON_ERROR_STOP 1
\pset pager off

-- act as partner SS-001
create or replace function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

select pg_temp.act_as('00000000-0000-4000-b000-000000000001');
set role authenticated;

do $$
declare n int; loc uuid := '10000000-0000-4000-8000-000000000001';
begin
  select count(distinct location_id) into n from public.daily_sales_reports;
  if n <> 1 then raise exception 'FAIL partner sees % locations of sales', n; end if;
  select count(*) into n from public.locations;
  if n <> 1 then raise exception 'FAIL partner sees % locations', n; end if;
  select count(*) into n from public.weekly_audits;
  if n <> 0 then raise exception 'FAIL partner can read internal audits'; end if;
  select count(*) into n from public.audit_partner_summaries;
  if n < 1 then raise exception 'FAIL partner cannot read own audit summary'; end if;
  select count(*) into n from public.reconciliations;
  if n <> 0 then raise exception 'FAIL partner can read reconciliations'; end if;
  select count(*) into n from public.partner_statements;
  if n < 1 then raise exception 'FAIL partner statement not visible'; end if;
  select count(*) into n from public.activity_log;
  if n <> 0 then raise exception 'FAIL partner can read activity log'; end if;
  select count(*) into n from public.v_stock_on_hand;
  if n <> 6 then raise exception 'FAIL partner stock rows %', n; end if;
  raise notice 'PASS partner read scoping';

  -- direct writes are blocked
  begin
    insert into public.daily_checks (location_id, business_date, tolerance_servings, major_threshold_servings)
    values (loc, current_date, 3, 10);
    raise exception 'FAIL partner inserted a daily check';
  exception when insufficient_privilege then raise notice 'PASS partner direct insert blocked';
  end;
  update public.daily_remittances set amount_due_centavos = 1 where location_id = loc;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL partner updated remittances'; end if;
  raise notice 'PASS partner direct update blocked';

  -- partner cannot act on another store
  begin
    perform public.submit_container_count('10000000-0000-4000-8000-000000000002', private.today_ph(), 10, 10);
    raise exception 'FAIL cross-store submit';
  exception when insufficient_privilege then raise notice 'PASS cross-store submit blocked';
  end;

  -- partner cannot backdate beyond yesterday
  begin
    perform public.submit_container_count(loc, private.today_ph() - 5, 10, 10);
    raise exception 'FAIL backdate allowed';
  exception when raise_exception then raise notice 'PASS backdate blocked: %', sqlerrm;
  end;

  -- photo must exist in storage
  begin
    perform public.submit_counter_reading(loc, private.today_ph(), '20000000-0000-4000-8000-000000000001', 99999999, loc || '/counter/x.jpg');
    raise exception 'FAIL missing photo accepted';
  exception when raise_exception then raise notice 'PASS missing photo rejected: %', sqlerrm;
  end;
end $$;

-- simulate an upload, then test counter rules
reset role;
insert into storage.objects (bucket_id, name) values
  ('evidence', '10000000-0000-4000-8000-000000000001/counter/today.jpg'),
  ('evidence', '10000000-0000-4000-8000-000000000001/receipt/today.jpg');
set role authenticated;

do $$
declare
  loc uuid := '10000000-0000-4000-8000-000000000001';
  m uuid := '20000000-0000-4000-8000-000000000001';
  last bigint;
  r public.counter_readings;
  c public.daily_container_counts;
  s public.daily_sales_reports;
  rem public.daily_remittances;
  chk public.daily_checks;
  ctx jsonb;
  p_cone uuid; p_cup uuid;
begin
  select reading into last from public.counter_readings where machine_id = m order by business_date desc limit 1;
  begin
    perform public.submit_counter_reading(loc, private.today_ph(), m, last - 1, loc || '/counter/today.jpg');
    raise exception 'FAIL lower reading accepted';
  exception when raise_exception then raise notice 'PASS lower reading rejected: %', sqlerrm;
  end;
  r := public.submit_counter_reading(loc, private.today_ph(), m, last + 30, loc || '/counter/today.jpg');
  if r.delta <> 30 then raise exception 'FAIL delta %', r.delta; end if;
  begin
    perform public.submit_counter_reading(loc, private.today_ph(), m, last + 31, loc || '/counter/today.jpg');
    raise exception 'FAIL duplicate reading';
  exception when unique_violation then raise notice 'PASS duplicate reading rejected';
  end;
  begin
    update public.counter_readings set reading = 1 where id = r.id;
  exception when others then null;
  end;
  if (select reading from public.counter_readings where id = r.id) <> last + 30 then raise exception 'FAIL reading edited'; end if;

  ctx := public.daily_flow_context(loc, private.today_ph());
  c := public.submit_container_count(loc, private.today_ph(),
         (ctx->'previous_count'->>'cones')::int - 20, (ctx->'previous_count'->>'cups')::int - 10);
  if c.cones_used <> 20 or c.cups_used <> 10 then raise exception 'FAIL container usage % %', c.cones_used, c.cups_used; end if;

  select id into p_cone from public.products where location_id = loc and name = 'Cone';
  select id into p_cup from public.products where location_id = loc and name = 'Cup';
  begin
    perform public.submit_sales_report(loc, private.today_ph(), 'sales',
      jsonb_build_array(jsonb_build_object('product_id', p_cone, 'qty', 20), jsonb_build_object('product_id', p_cup, 'qty', 10)),
      100000, 0, 0, 0, 0, null);
    raise exception 'FAIL payment mismatch accepted';
  exception when raise_exception then raise notice 'PASS payment mismatch rejected: %', sqlerrm;
  end;
  s := public.submit_sales_report(loc, private.today_ph(), 'sales',
      jsonb_build_array(jsonb_build_object('product_id', p_cone, 'qty', 20), jsonb_build_object('product_id', p_cup, 'qty', 10)),
      69000, 40000, 0, 0, 0, null);
  if s.net_sales_centavos <> 109000 then raise exception 'FAIL net %', s.net_sales_centavos; end if;
  select * into chk from public.daily_checks where location_id = loc and business_date = private.today_ph();
  if chk.status <> 'matched' then raise exception 'FAIL check status %', chk.status; end if;
  select * into rem from public.daily_remittances where sales_report_id = s.id;
  if rem.amount_due_centavos <> 109000 or rem.status <> 'pending' then raise exception 'FAIL remittance'; end if;
  rem := public.submit_remittance(rem.id, 109000, 'gcash', 'GC123', loc || '/receipt/today.jpg');
  if rem.status <> 'submitted' then raise exception 'FAIL remit status'; end if;
  begin
    perform public.verify_remittance(rem.id, null);
    raise exception 'FAIL partner verified own remittance';
  exception when insufficient_privilege then raise notice 'PASS partner cannot verify';
  end;
  raise notice 'PASS full partner daily flow';
end $$;

-- admin verifies; verified is immutable
reset role;
select pg_temp.act_as('00000000-0000-4000-a000-000000000001');
set role authenticated;
do $$
declare rem public.daily_remittances; loc uuid := '10000000-0000-4000-8000-000000000001';
begin
  select * into rem from public.daily_remittances where location_id = loc and business_date = private.today_ph();
  rem := public.verify_remittance(rem.id, 'ok');
  begin
    update public.daily_remittances set amount_sent_centavos = 1 where id = rem.id;
    raise exception 'FAIL verified remittance edited';
  exception when raise_exception then raise notice 'PASS verified remittance immutable';
  end;
  begin
    delete from public.payouts;
    raise exception 'FAIL payout deleted';
  exception when raise_exception then raise notice 'PASS payouts immutable';
  end;
  begin
    perform public.create_reconciliation((select id from public.weekly_audits where status = 'scheduled' limit 1));
    raise exception 'FAIL reconciliation without completed audit';
  exception when raise_exception then raise notice 'PASS reconciliation requires completed audit';
  end;
end $$;

-- counter chain: admin correction, reset event, rollover
reset role;
insert into storage.objects (bucket_id, name) values
  ('evidence', '10000000-0000-4000-8000-000000000002/counter/today.jpg');
select pg_temp.act_as('00000000-0000-4000-a000-000000000001');
set role authenticated;
do $$
declare
  loc uuid := '10000000-0000-4000-8000-000000000002';
  m uuid := '20000000-0000-4000-8000-000000000002';
  y public.counter_readings;
  prev public.counter_readings;
  r public.counter_readings;
begin
  select * into y from public.counter_readings where machine_id = m order by business_date desc limit 1;
  select * into prev from public.counter_readings where id = y.previous_reading_id;
  -- yesterday's reading was typed 10 too high
  y := public.correct_counter_reading(y.id, y.reading - 10, 'Typo, photo shows lower number');
  if y.submitted_reading = y.reading or y.delta <> (y.reading - prev.reading) then raise exception 'FAIL correction'; end if;
  -- counter reset to 0 after repair, then today's reading 25
  perform public.record_counter_reset(m, y.reading + 7, 0, 'Board replaced');
  r := public.submit_counter_reading(loc, private.today_ph(), m, 25, loc || '/counter/today.jpg');
  if r.delta <> 32 then raise exception 'FAIL reset delta %, expected 32', r.delta; end if;
  raise notice 'PASS correction + reset chain';
end $$;

reset role;
update public.machines set counter_max = 999999 where id = '20000000-0000-4000-8000-000000000003';
insert into storage.objects (bucket_id, name) values ('evidence', '10000000-0000-4000-8000-000000000003/counter/today.jpg');
do $$
declare
  m uuid := '20000000-0000-4000-8000-000000000003';
  loc uuid := '10000000-0000-4000-8000-000000000003';
  r public.counter_readings;
begin
  -- pretend the machine is near the end of its counter by recording a reset to 999990
  perform set_config('app.seed_mode', 'on', false);
  perform public.record_counter_reset(m, (select reading from public.counter_readings where machine_id = m order by business_date desc limit 1), 999990, 'test');
  perform set_config('app.seed_mode', 'off', false);
  perform pg_temp.act_as('00000000-0000-4000-b000-000000000003');
  r := public.submit_counter_reading(loc, private.today_ph(), m, 15, loc || '/counter/today.jpg');
  if r.delta <> 25 or not ('rollover' = any(r.flags)) then raise exception 'FAIL rollover delta % flags %', r.delta, r.flags; end if;
  raise notice 'PASS automatic rollover';
end $$;

-- phase 2: audits only change through RPCs; draft reconciliation lifecycle
reset role;
select pg_temp.act_as('00000000-0000-4000-a000-000000000002');
set role authenticated;
do $$
declare a public.weekly_audits; n int;
begin
  select * into a from public.weekly_audits where status = 'scheduled' limit 1;
  update public.weekly_audits set status = 'completed' where id = a.id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL staff updated audit status directly'; end if;
  begin
    perform public.set_audit_item((select id from public.audit_items where audit_id = a.id limit 1), 'pass', null, null);
    raise exception 'FAIL answered checklist before starting';
  exception when raise_exception then raise notice 'PASS checklist needs a started audit';
  end;
  a := public.start_audit(a.id);
  update public.audit_items set result = 'pass' where audit_id = a.id;  -- blocked by RLS (no policy)
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL staff updated audit items directly'; end if;
  perform public.set_audit_item(i.id, 'pass', null, null) from public.audit_items i where i.audit_id = a.id;
  a := public.complete_audit(a.id);
  if a.score_passed <> 25 then raise exception 'FAIL score %', a.score_passed; end if;
  begin
    perform public.create_reconciliation(a.id);
    raise exception 'FAIL staff created reconciliation';
  exception when insufficient_privilege then raise notice 'PASS reconciliation is admin-only';
  end;
end $$;

reset role;
select pg_temp.act_as('00000000-0000-4000-a000-000000000001');
set role authenticated;
do $$
declare a uuid; r public.reconciliations; r2 public.reconciliations;
begin
  select id into a from public.weekly_audits w where status = 'completed'
     and not exists (select 1 from public.reconciliations x where x.audit_id = w.id) limit 1;
  r := public.create_reconciliation(a);
  if public.delete_draft_reconciliation(r.id) <> a then raise exception 'FAIL discard draft'; end if;
  r2 := public.create_reconciliation(a);
  perform public.confirm_reconciliation(r2.id);
  begin
    perform public.delete_draft_reconciliation(r2.id);
    raise exception 'FAIL deleted confirmed reconciliation';
  exception when raise_exception then raise notice 'PASS confirmed reconciliation cannot be discarded';
  end;
  begin
    perform public.record_payout(r2.id, (select partner_payable_centavos from public.reconciliations where id = r2.id) + 1, 'gcash', 'X', 'x', current_date);
    raise exception 'FAIL wrong payout amount accepted';
  exception when raise_exception then raise notice 'PASS payout must equal payable';
  end;
end $$;

-- staff can not verify remittances or read reconciliations
reset role;
select pg_temp.act_as('00000000-0000-4000-a000-000000000002');
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.reconciliations;
  if n <> 0 then raise exception 'FAIL staff reads reconciliations'; end if;
  select count(distinct location_id) into n from public.daily_sales_reports;
  if n <> 3 then raise exception 'FAIL staff should see all stores'; end if;
  raise notice 'PASS staff scoping';
  begin
    perform * from public.dashboard_summary(current_date - 7, current_date);
    raise exception 'FAIL staff read the dashboard';
  exception when insufficient_privilege then raise notice 'PASS dashboard is admin-only';
  end;
end $$;

-- anon sees nothing
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
begin
  begin
    perform count(*) from public.locations;
    raise exception 'FAIL anon read locations';
  exception when insufficient_privilege then raise notice 'PASS anon blocked';
  end;
end $$;
reset role;
\echo ALL TESTS PASSED
