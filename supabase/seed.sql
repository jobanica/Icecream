-- =====================================================================
-- Demo seed. Runs automatically on `supabase db reset`, or manually:
--   psql "$DATABASE_URL" -f supabase/seed.sql
-- All data is written through the same RPCs the app uses (seed mode lets
-- them accept historical dates). Dates are relative to today (Asia/Manila):
--   day −15      : onboarding, opening inventory, machines installed
--   days −14..−1 : two weeks of daily flows
--   today        : empty, so each partner can run the end-of-day wizard
--
-- Logins (password / PIN):
--   admin@example.com        demo1234   (admin)
--   staff@example.com        demo1234   (staff)
--   Store SS-001 / PIN 111111, SS-002 / 222222, SS-003 / 333333 (partners)
-- =====================================================================

set search_path = public, extensions;
select set_config('app.seed_mode', 'on', false);

do $seed$
declare
  v_today date := private.today_ph();
  v_open date := private.today_ph() - 15;
  v_admin uuid := '00000000-0000-4000-a000-000000000001';
  v_staff uuid := '00000000-0000-4000-a000-000000000002';
  v_partner uuid[] := array['00000000-0000-4000-b000-000000000001',
                            '00000000-0000-4000-b000-000000000002',
                            '00000000-0000-4000-b000-000000000003']::uuid[];
  v_loc uuid[] := array['10000000-0000-4000-8000-000000000001',
                        '10000000-0000-4000-8000-000000000002',
                        '10000000-0000-4000-8000-000000000003']::uuid[];
  v_machine uuid[] := array['20000000-0000-4000-8000-000000000001',
                            '20000000-0000-4000-8000-000000000002',
                            '20000000-0000-4000-8000-000000000003']::uuid[];
  v_baseline bigint[] := array[10500, 20340, 5120];
  v_pins text[] := array['111111', '222222', '333333'];
  v_names text[][] := array[
    array['Nena Cruz', 'Aling Nena''s Sari-Sari', 'Brgy. Lahug, Cebu City', 'Nena Cruz'],
    array['Jun Villanueva', 'Kuya Jun''s Mini Mart', 'A.C. Cortes Ave, Mandaue City', 'Rosa Villanueva'],
    array['Maricel Tan', 'Bayanihan Canteen', 'M.L. Quezon Hwy, Lapu-Lapu City', 'Maricel Tan']];
  i_premix uuid; i_cone uuid; i_cup uuid; i_kitkat uuid; i_syrup uuid; i_rootbeer uuid;
  p_cone uuid; p_cup uuid; p_float uuid; p_kitkat uuid;
  k integer;
  d date;
  v_off integer;
  h bigint;
  n_cone integer; n_cup integer; n_float integer; n_kitkat integer; n_free integer;
  extra_counter integer; extra_cups integer; extra_cones integer;
  v_reading bigint;
  v_cones integer; v_cups integer;
  v_gross bigint; v_gcash bigint; v_disc bigint;
  v_rem public.daily_remittances;
  v_chk public.daily_checks;
  v_audit public.weekly_audits;
  v_recon public.reconciliations;
  v_stmt public.partner_statements;
  v_payout public.payouts;
  v_item record;
  v_closed boolean;
begin

  -- ------------------------------------------------------------------
  -- Settings
  -- ------------------------------------------------------------------
  update public.app_settings set
    business_name = 'Swirl & Share Soft-Serve',
    remit_gcash_name = 'J. Dela Cruz', remit_gcash_number = '0917 555 0101',
    remit_bank_name = 'BDO', remit_bank_account_name = 'Juan Dela Cruz', remit_bank_account_number = '0012 3456 7890',
    gcash_fee_bps = 150, maintenance_reserve_per_week_centavos = 30000
  where id = 1;

  -- ------------------------------------------------------------------
  -- Inventory items
  -- ------------------------------------------------------------------
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, container_type, is_premix, default_reorder_point, sort_order)
  values ('Soft-serve premix (1 kg bag)', 'bag', 45, 38000, 'none', true, 4, 1) returning id into i_premix;
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, container_type, default_reorder_point, sort_order)
  values ('Cones', 'pc', 1, 150, 'cone', 60, 2) returning id into i_cone;
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, container_type, default_reorder_point, sort_order)
  values ('Cups with lids (12 oz)', 'pc', 1, 350, 'cup', 60, 3) returning id into i_cup;
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, default_reorder_point, sort_order)
  values ('KitKat (2-finger)', 'pc', 1, 1400, 15, 4) returning id into i_kitkat;
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, default_reorder_point, sort_order)
  values ('Chocolate syrup (1 L)', 'bottle', 60, 18000, 1, 5) returning id into i_syrup;
  insert into public.inventory_items (name, unit, yield_servings, unit_cost_centavos, default_reorder_point, sort_order)
  values ('Root beer (330 ml can)', 'can', 1, 2800, 10, 6) returning id into i_rootbeer;

  -- ------------------------------------------------------------------
  -- Team users
  -- ------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'admin@example.com',
     crypt('demo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"],"role":"admin"}', '{"full_name":"Juan Dela Cruz (Owner)"}',
     now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_staff, 'authenticated', 'authenticated', 'staff@example.com',
     crypt('demo1234', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"],"role":"staff"}', '{"full_name":"Ramon Santos (Field Staff)"}',
     now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
    from auth.users u where u.id in (v_admin, v_staff);

  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);

  -- ------------------------------------------------------------------
  -- Locations, partners, machines, products, opening inventory
  -- ------------------------------------------------------------------
  for k in 1..3 loop
    insert into public.locations (id, partner_name, store_name, address, contact_phone, store_hours, responsible_person,
                                  partnership_start_date, status, payout_method, payout_account_name, payout_account_number,
                                  installation_checklist, notes)
    values (v_loc[k], v_names[k][1], v_names[k][2], v_names[k][3], '0917 555 01' || lpad((10 + k)::text, 2, '0'),
            '9:00 AM – 9:00 PM', v_names[k][4], v_open, 'pending', 'gcash', v_names[k][1], '0918 555 02' || lpad((10 + k)::text, 2, '0'),
            '{"machine_installed":true,"machine_tested":true,"staff_trained":true,"signage":true,"cleaning_kit":true,"app_login_tested":true}',
            'Demo location');

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_partner[k], 'authenticated', 'authenticated',
            'ss-00' || k || '@partners.example.com', crypt(v_pins[k], gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'partner', 'location_id', v_loc[k]),
            jsonb_build_object('full_name', v_names[k][1]), now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_partner[k]::text, v_partner[k],
            jsonb_build_object('sub', v_partner[k]::text, 'email', 'ss-00' || k || '@partners.example.com', 'email_verified', true),
            'email', now(), now(), now());

    insert into public.machines (id, serial_number, model, purchase_value_centavos, location_id, status, baseline_reading,
                                 baseline_photo_path, counter_max, installed_at)
    values (v_machine[k], 'SSM-24-00' || k, 'SSM-200 countertop (1 flavor)', 8500000, v_loc[k], 'active', v_baseline[k],
            v_loc[k] || '/machine/' || v_open || '/baseline.jpg', 999999,
            (v_open + time '10:00') at time zone 'Asia/Manila');
    insert into public.machine_events (machine_id, location_id, event_type, occurred_at, reading_after, description, recorded_by)
    values (v_machine[k], v_loc[k], 'installed', (v_open + time '10:00') at time zone 'Asia/Manila', v_baseline[k],
            'Installed and tested. Baseline counter ' || v_baseline[k], v_staff);

    insert into public.products (location_id, name, price_centavos, servings_per_unit, container_type, sort_order)
    values (v_loc[k], 'Cone', 2500, 1, 'cone', 1) returning id into p_cone;
    insert into public.products (location_id, name, price_centavos, servings_per_unit, container_type, sort_order)
    values (v_loc[k], 'Cup', 5900, 1, 'cup', 2) returning id into p_cup;
    insert into public.products (location_id, name, price_centavos, servings_per_unit, container_type, sort_order)
    values (v_loc[k], 'Float', 6900, 1, 'cup', 3) returning id into p_float;
    insert into public.products (location_id, name, price_centavos, servings_per_unit, container_type, sort_order)
    values (v_loc[k], 'KitKat', 7900, 1, 'cup', 4) returning id into p_kitkat;
    insert into public.product_components (product_id, item_id, qty_per_unit) values
      (p_float, i_rootbeer, 1), (p_kitkat, i_kitkat, 1), (p_kitkat, i_syrup, 0.017);

    perform public.set_opening_inventory(v_loc[k], v_open, jsonb_build_array(
      jsonb_build_object('item_id', i_premix, 'qty', 10, 'reorder_point', 4),
      jsonb_build_object('item_id', i_cone, 'qty', 300, 'reorder_point', 60),
      jsonb_build_object('item_id', i_cup, 'qty', 300, 'reorder_point', 60),
      jsonb_build_object('item_id', i_kitkat, 'qty', 50, 'reorder_point', 15),
      jsonb_build_object('item_id', i_syrup, 'qty', 3, 'reorder_point', 1),
      jsonb_build_object('item_id', i_rootbeer, 'qty', 24, 'reorder_point', 10)));

    perform public.activate_location(v_loc[k]);
    update public.locations set activated_at = (v_open + time '11:00') at time zone 'Asia/Manila' where id = v_loc[k];
  end loop;

  -- ------------------------------------------------------------------
  -- Two weeks of daily flows
  -- ------------------------------------------------------------------
  for k in 1..3 loop
    select id into p_cone from public.products where location_id = v_loc[k] and name = 'Cone';
    select id into p_cup from public.products where location_id = v_loc[k] and name = 'Cup';
    select id into p_float from public.products where location_id = v_loc[k] and name = 'Float';
    select id into p_kitkat from public.products where location_id = v_loc[k] and name = 'KitKat';
    v_reading := v_baseline[k];
    v_cones := 300;
    v_cups := 300;

    for v_off in reverse 14..1 loop
      d := v_today - v_off;

      -- deliveries (staff) on day −8 and day −3, before closing
      if v_off in (8, 3) then
        perform set_config('request.jwt.claim.sub', v_staff::text, false);
        perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, false);
        perform public.record_delivery(v_loc[k], d, jsonb_build_array(
          jsonb_build_object('item_id', i_premix, 'qty', case when v_off = 8 then 8 else 6 end),
          jsonb_build_object('item_id', i_cone, 'qty', 200),
          jsonb_build_object('item_id', i_cup, 'qty', 200),
          jsonb_build_object('item_id', i_kitkat, 'qty', case when k = 3 then 10 else 40 end),
          jsonb_build_object('item_id', i_rootbeer, 'qty', 24)), 15000, 'Weekly replenishment');
        v_cones := v_cones + 200;
        v_cups := v_cups + 200;
        -- partner confirms the day −8 delivery; day −3 left unconfirmed for SS-002
        if not (v_off = 3 and k = 2) then
          perform set_config('request.jwt.claim.sub', v_partner[k]::text, false);
          perform set_config('request.jwt.claims', json_build_object('sub', v_partner[k], 'role', 'authenticated')::text, false);
          perform public.confirm_delivery((select id from public.deliveries where location_id = v_loc[k] and business_date = d), true, null);
        end if;
      end if;

      perform set_config('request.jwt.claim.sub', v_partner[k]::text, false);
      perform set_config('request.jwt.claims', json_build_object('sub', v_partner[k], 'role', 'authenticated')::text, false);

      v_closed := (k = 3 and v_off = 7);   -- SS-003 closed for the barangay fiesta
      h := abs(hashtext(k || ':' || d::text));
      if v_closed then
        n_cone := 0; n_cup := 0; n_float := 0; n_kitkat := 0; n_free := 0;
      else
        n_cone := 18 + (h % 20)::int;
        n_cup := 8 + ((h / 7) % 12)::int;
        n_float := 2 + ((h / 31) % 6)::int;
        n_kitkat := 2 + ((h / 101) % 6)::int;
        n_free := case when h % 5 = 0 then 1 else 0 end;   -- a free cone now and then
        if extract(isodow from d) in (6, 7) then
          n_cone := n_cone + 10; n_cup := n_cup + 5;
        end if;
      end if;

      -- injected discrepancies
      extra_counter := 0; extra_cups := 0; extra_cones := 0;
      if k = 1 and v_off = 11 then extra_counter := 15; extra_cups := 15; end if;  -- major, unexplained (unreported cup sales)
      if k = 1 and v_off = 4 then extra_counter := 5; end if;                      -- minor: spillage
      if k = 2 and v_off = 9 then extra_counter := 6; end if;                      -- minor: test dispense (resolved)
      if k = 2 and v_off = 2 then extra_counter := 4; extra_cones := 4; end if;    -- minor: unresolved
      if k = 3 and v_off = 6 then extra_counter := 5; extra_cones := 2; end if;    -- minor: unresolved

      -- 1) counter
      v_reading := v_reading + n_cone + n_free + n_cup + n_float + n_kitkat + extra_counter;
      perform public.submit_counter_reading(v_loc[k], d, v_machine[k], v_reading,
                                            v_loc[k] || '/counter/' || d || '/reading.jpg');

      -- SS-002 missed everything after the counter yesterday
      continue when k = 2 and v_off = 1;

      -- 2) cones / cups left
      v_cones := v_cones - (n_cone + n_free) - extra_cones;
      v_cups := v_cups - (n_cup + n_float + n_kitkat) - extra_cups;
      perform public.submit_container_count(v_loc[k], d, v_cones, v_cups);

      -- 3) sales
      v_gross := n_cone * 2500 + n_cup * 5900 + n_float * 6900 + n_kitkat * 7900;
      v_disc := case when k = 2 and v_off = 6 then 2000 else 0 end;   -- senior discount
      v_gcash := round((v_gross - v_disc) * (20 + (h % 20)) / 100.0 / 100.0) * 100;
      perform public.submit_sales_report(
        v_loc[k], d, case when v_closed then 'closed' else 'sales' end::public.report_type,
        case when v_closed then '[]'::jsonb else jsonb_build_array(
          jsonb_build_object('product_id', p_cone, 'qty', n_cone, 'free_qty', n_free),
          jsonb_build_object('product_id', p_cup, 'qty', n_cup),
          jsonb_build_object('product_id', p_float, 'qty', n_float),
          jsonb_build_object('product_id', p_kitkat, 'qty', n_kitkat)) end,
        v_gross - v_disc - v_gcash, v_gcash, 0, v_disc, 0,
        case when v_closed then 'Closed for barangay fiesta' end);

      -- partner explanations
      if k = 1 and v_off = 4 then
        perform public.explain_daily_check(v_loc[k], d, 'Around 5 servings spilled when the drip tray overflowed');
      elsif k = 2 and v_off = 9 then
        perform public.explain_daily_check(v_loc[k], d, 'Test dispense after cleaning the machine');
      elsif k = 2 and v_off = 2 then
        perform public.explain_daily_check(v_loc[k], d, '4 cones broke, threw away with the ice cream');
      end if;

      -- 4) remittance
      select * into v_rem from public.daily_remittances where location_id = v_loc[k] and business_date = d;
      continue when v_rem.status = 'verified';           -- ₱0 day auto-verified
      continue when k = 3 and v_off = 1;                  -- SS-003 has not remitted yesterday yet
      perform public.submit_remittance(v_rem.id, v_rem.amount_due_centavos,
                                       case when h % 3 = 0 then 'bank' else 'gcash' end::public.payment_method,
                                       case when h % 3 = 0 then 'BDO-' else 'GC' end || lpad((h % 100000000)::text, 10, '0'),
                                       v_loc[k] || '/receipt/' || d || '/receipt.jpg');

      -- admin verifies (except the most recent days, left in the inbox)
      perform set_config('request.jwt.claim.sub', v_admin::text, false);
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);
      if k = 3 and v_off = 3 then
        perform public.reject_remittance(v_rem.id, 'Reference number not found in GCash history. Please upload the correct receipt.');
      elsif v_off > 2 then
        perform public.verify_remittance(v_rem.id, null);
      end if;
    end loop;
  end loop;

  -- ------------------------------------------------------------------
  -- Admin resolves older discrepancies
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);
  select * into v_chk from public.daily_checks where location_id = v_loc[2] and business_date = v_today - 9;
  perform public.resolve_daily_check(v_chk.id, 'test_dispense', 'Confirmed with staff: test pours after cleaning.');

  -- ------------------------------------------------------------------
  -- Week 1 audit for SS-001 (days −14..−8) → reconciliation → payout
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_staff::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, false);
  v_audit := public.create_audit(v_loc[1], v_today - 14, v_today - 8, v_today - 7);
  v_audit := public.start_audit(v_audit.id);

  -- full inventory count at the end of the period: 0.4 bag premix and 2 KitKat short
  perform public.submit_inventory_count(v_loc[1], v_today - 8, (
    select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'actual_qty',
             case when s.item_id = i_premix then round(s.on_hand - 0.4, 1)
                  when s.item_id = i_kitkat then s.on_hand - 2
                  else s.on_hand end))
      from (select id as item_id, private.on_hand(v_loc[1], id, v_today - 8) as on_hand
              from public.inventory_items where is_active) s), v_audit.id, 'Counted with Nena at closing');

  for v_item in select * from public.audit_items where audit_id = v_audit.id loop
    perform public.set_audit_item(v_item.id,
      case when v_item.item_key in ('counter_week_vs_servings', 'inv_toppings_ok') then 'fail' else 'pass' end::public.audit_result,
      case v_item.item_key
        when 'counter_week_vs_servings' then '15 servings dispensed on ' || to_char(v_today - 11, 'Mon DD') || ' not in the sales report'
        when 'inv_toppings_ok' then '2 KitKat unaccounted for'
        when 'counter_photos_spotcheck' then 'Checked 3 days — all match'
        else null end,
      null);
  end loop;

  select * into v_chk from public.daily_checks where location_id = v_loc[1] and business_date = v_today - 11;
  perform public.resolve_daily_check(v_chk.id, 'unexplained',
    'Staff could not explain 15 extra cup servings. Treated as unreported sales; deducted at reconciliation.');

  perform public.add_audit_finding(v_audit.id, 'major',
    to_char(v_today - 11, 'Mon DD') || ': counter shows 15 more servings than the sales report, 15 extra cups used. No explanation.',
    'Value deducted from partner share. Retrain staff to log every sale before handing it over.');
  perform public.add_audit_finding(v_audit.id, 'minor', '2 KitKat bars missing in the physical count.',
    'Keep toppings in the locked drawer.');
  perform public.add_audit_finding(v_audit.id, 'info', 'Machine clean and in good condition. Premix stored properly.', null);
  v_audit := public.complete_audit(v_audit.id);

  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, false);
  v_recon := public.create_reconciliation(v_audit.id);
  v_stmt := public.confirm_reconciliation(v_recon.id);
  select * into v_recon from public.reconciliations where id = v_recon.id;
  v_payout := public.record_payout(v_recon.id, v_recon.partner_payable_centavos, 'gcash',
                                   'GC' || to_char(v_today - 6, 'YYYYMMDD') || '8812',
                                   v_loc[1] || '/payout/' || (v_today - 6) || '/proof.jpg', v_today - 6);

  perform set_config('request.jwt.claim.sub', v_partner[1]::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_partner[1], 'role', 'authenticated')::text, false);
  perform public.acknowledge_statement(v_stmt.id, 'Received and understood. We will log every sale.');
  perform public.confirm_payout_received(v_payout.id);

  -- Week 2 audit scheduled for SS-001 (for the staff demo)
  perform set_config('request.jwt.claim.sub', v_staff::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, false);
  perform public.create_audit(v_loc[1], v_today - 7, v_today - 1, v_today);

end
$seed$;

select set_config('app.seed_mode', 'off', false);
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);
-- keep the SS-### sequence ahead of the demo codes
select setval('public.location_code_seq', greatest((select max(substring(code from 4)::int) from public.locations), 1));
