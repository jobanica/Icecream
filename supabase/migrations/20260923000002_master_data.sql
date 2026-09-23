-- =====================================================================
-- Master data: locations, machines, products, inventory items, stock
-- =====================================================================

-- ---------------------------------------------------------------------
-- Locations (partner file)
-- ---------------------------------------------------------------------
create sequence public.location_code_seq start 1;

create or replace function private.default_tolerance()
returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select default_tolerance_servings from public.app_settings where id = 1), 3) $$;

create or replace function private.default_major_threshold()
returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select default_major_threshold_servings from public.app_settings where id = 1), 10) $$;

grant execute on function private.default_tolerance(), private.default_major_threshold() to authenticated, service_role;

create table public.locations (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique
                               default ('SS-' || lpad(nextval('public.location_code_seq')::text, 3, '0'))
                               check (code ~ '^SS-[0-9]{3,}$'),
  partner_name               text not null,
  store_name                 text not null,
  address                    text not null default '',
  contact_phone              text,
  contact_email              text,
  store_hours                text,
  responsible_person         text,
  partnership_start_date     date,
  status                     public.location_status not null default 'pending',
  partner_share_pct          numeric(5,2) not null default 50 check (partner_share_pct between 0 and 100),
  -- Where this partner sends remittances (falls back to app_settings when null)
  remit_gcash_name           text,
  remit_gcash_number         text,
  remit_bank_name            text,
  remit_bank_account_name    text,
  remit_bank_account_number  text,
  -- Where I pay the partner's share
  payout_method              public.payment_method,
  payout_account_name        text,
  payout_account_number      text,
  payout_bank_name           text,
  -- Daily three-way check thresholds (servings)
  tolerance_servings         integer not null default private.default_tolerance() check (tolerance_servings >= 0),
  major_threshold_servings   integer not null default private.default_major_threshold() check (major_threshold_servings >= 0),
  -- Opening cone/cup counts (baseline for the first daily container count)
  opening_count_date         date,
  opening_cones              integer check (opening_cones >= 0),
  opening_cups               integer check (opening_cups >= 0),
  installation_checklist     jsonb not null default '{}'::jsonb,
  notes                      text,
  activated_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint thresholds_ordered check (major_threshold_servings >= tolerance_servings)
);

alter table public.profiles
  add constraint profiles_location_fk foreign key (location_id) references public.locations (id);
create index profiles_location_idx on public.profiles (location_id);

create table public.location_photos (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations (id),
  kind         text not null default 'installation' check (kind in ('installation', 'condition', 'other')),
  storage_path text not null,
  caption      text,
  uploaded_by  uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index location_photos_location_idx on public.location_photos (location_id);

create or replace function private.location_defaults()
returns trigger language plpgsql
as $$
begin
  if new.status = 'active' and new.activated_at is null then
    new.activated_at := now();
  end if;
  return new;
end $$;

create trigger locations_defaults before insert or update on public.locations
  for each row execute function private.location_defaults();
create trigger locations_touch before update on public.locations
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Machines
-- ---------------------------------------------------------------------
create table public.machines (
  id                       uuid primary key default gen_random_uuid(),
  serial_number            text not null unique,
  model                    text not null default '',
  purchase_value_centavos  bigint not null default 0 check (purchase_value_centavos >= 0),
  location_id              uuid references public.locations (id),
  status                   public.machine_status not null default 'in_storage',
  baseline_reading         bigint check (baseline_reading >= 0),
  baseline_photo_path      text,
  counter_max              bigint check (counter_max > 0),   -- e.g. 999999; null = never rolls over
  installed_at             timestamptz,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint active_machine_has_baseline check (
    status <> 'active' or (location_id is not null and baseline_reading is not null and installed_at is not null)
  )
);
create index machines_location_idx on public.machines (location_id);

create table public.machine_events (
  id              uuid primary key default gen_random_uuid(),
  machine_id      uuid not null references public.machines (id),
  location_id     uuid references public.locations (id),
  event_type      public.machine_event_type not null,
  occurred_at     timestamptz not null default now(),
  reading_before  bigint check (reading_before >= 0),
  reading_after   bigint check (reading_after >= 0),
  description     text not null default '',
  cost_centavos   bigint not null default 0 check (cost_centavos >= 0),
  photo_path      text,
  recorded_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  constraint counter_events_have_readings check (
    event_type not in ('reset', 'rollover', 'correction') or (reading_before is not null and reading_after is not null)
  )
);
create index machine_events_machine_idx on public.machine_events (machine_id, occurred_at);

create trigger machines_touch before update on public.machines
  for each row execute function private.touch_updated_at();
-- counter-affecting events are part of the counter chain: never edit, never delete
create trigger machine_events_immutable before update or delete on public.machine_events
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------
-- Inventory items (supplies)
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  unit                text not null default 'pc',           -- bag, pc, pack, bottle ...
  -- Servings obtainable from one unit (premix bag ≈ 45). Used for expected consumption.
  yield_servings      numeric(10,3) not null default 1 check (yield_servings > 0),
  unit_cost_centavos  bigint not null default 0 check (unit_cost_centavos >= 0),
  -- cone / cup items are counted by the partner every day
  container_type      public.container_type not null default 'none',
  -- premix usage is derived from the machine counter
  is_premix           boolean not null default false,
  default_reorder_point numeric(12,3) not null default 0,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- exactly one daily-count cone item and one cup item
create unique index inventory_items_one_cone on public.inventory_items (container_type)
  where container_type in ('cone', 'cup') and is_active;

create trigger inventory_items_touch before update on public.inventory_items
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Products (sellable, per location)
-- ---------------------------------------------------------------------
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations (id),
  name              text not null,
  price_centavos    bigint not null check (price_centavos >= 0),
  servings_per_unit integer not null default 1 check (servings_per_unit >= 0),
  container_type    public.container_type not null default 'cup',
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (location_id, name)
);
create index products_location_idx on public.products (location_id);

-- Extra supplies consumed per unit sold (toppings, syrup, soda). Cones/cups
-- come from container_type; premix comes from servings.
create table public.product_components (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  item_id     uuid not null references public.inventory_items (id),
  qty_per_unit numeric(10,3) not null check (qty_per_unit > 0),
  unique (product_id, item_id)
);

create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Stock: movement ledger is the source of truth. stock_levels holds the
-- per-location reorder configuration; on-hand = sum(movements).
-- ---------------------------------------------------------------------
create table public.stock_levels (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations (id),
  item_id        uuid not null references public.inventory_items (id),
  reorder_point  numeric(12,3) not null default 0 check (reorder_point >= 0),
  par_level      numeric(12,3) not null default 0 check (par_level >= 0),
  updated_at     timestamptz not null default now(),
  unique (location_id, item_id)
);

create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations (id),
  item_id       uuid not null references public.inventory_items (id),
  business_date date not null,
  kind          public.stock_movement_kind not null,
  qty           numeric(12,3) not null,      -- + in, − out
  ref_type      text,                          -- delivery / container_count / daily_usage / inventory_count / opening
  ref_id        uuid,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index stock_movements_loc_item_date_idx on public.stock_movements (location_id, item_id, business_date);
create index stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);

create trigger stock_levels_touch before update on public.stock_levels
  for each row execute function private.touch_updated_at();

-- Activity logging
create trigger locations_log after insert or update or delete on public.locations
  for each row execute function private.log_activity();
create trigger location_photos_log after insert or update or delete on public.location_photos
  for each row execute function private.log_activity();
create trigger machines_log after insert or update or delete on public.machines
  for each row execute function private.log_activity();
create trigger machine_events_log after insert or update or delete on public.machine_events
  for each row execute function private.log_activity();
create trigger inventory_items_log after insert or update or delete on public.inventory_items
  for each row execute function private.log_activity();
create trigger products_log after insert or update or delete on public.products
  for each row execute function private.log_activity();
create trigger product_components_log after insert or update or delete on public.product_components
  for each row execute function private.log_activity();
create trigger stock_levels_log after insert or update or delete on public.stock_levels
  for each row execute function private.log_activity();
create trigger stock_movements_log after insert or update or delete on public.stock_movements
  for each row execute function private.log_activity();
