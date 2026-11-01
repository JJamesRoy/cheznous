-- Chez Nous — condo (Québec divided co-ownership): property, mortgage, documents,
-- appliances, maintenance, special assessments, capital contributions.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households (id) on delete cascade,
  address_line text,
  unit text,
  city text,
  postal_code text,
  year_built integer check (year_built is null or year_built between 1800 and 2100),
  area_sqft numeric(8, 1) check (area_sqft is null or area_sqft > 0),
  ownership_type text not null default 'divided' check (ownership_type in ('divided', 'undivided', 'freehold')),
  purchase_date date,
  purchase_price_cents bigint check (purchase_price_cents is null or purchase_price_cents > 0),
  -- Syndicate
  syndicate_name text,
  manager_name text,
  manager_email text,
  manager_phone text,
  agm_date date,
  condo_fee_cents bigint check (condo_fee_cents is null or condo_fee_cents >= 0),
  condo_fee_contingency_cents bigint check (condo_fee_contingency_cents is null or condo_fee_contingency_cents >= 0),
  -- Insurance
  insurer text,
  insurance_policy_number text,
  insurance_renewal_on date,
  insurance_premium_cents bigint,
  syndicate_deductible_cents bigint,
  owner_deductible_coverage_cents bigint,
  -- Welcome tax (droits de mutation) — one-time
  welcome_tax_cents bigint,
  welcome_tax_due_on date,
  welcome_tax_paid_on date,
  -- Optional ownership shares entered by the couple (basis points per user id). Never assumed.
  ownership_shares jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);
create trigger properties_updated_at before update on public.properties for each row execute function public.set_updated_at();

create table public.mortgages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  property_id uuid not null,
  lender text,
  original_principal_cents bigint check (original_principal_cents is null or original_principal_cents > 0),
  rate_pct numeric(6, 4) check (rate_pct is null or (rate_pct >= 0 and rate_pct < 30)),
  rate_type text not null default 'fixed' check (rate_type in ('fixed', 'variable')),
  term_months integer check (term_months is null or term_months between 1 and 120),
  start_date date,
  renewal_date date,
  amortization_months integer check (amortization_months is null or amortization_months between 12 and 480),
  payment_cents bigint check (payment_cents is null or payment_cents > 0),
  payment_frequency text not null default 'monthly' check (payment_frequency in ('monthly', 'semimonthly', 'biweekly', 'accelerated_biweekly', 'weekly', 'accelerated_weekly')),
  prepayment_privilege_bp integer check (prepayment_privilege_bp is null or prepayment_privilege_bp between 0 and 10000),
  prepayment_anniversary date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, property_id) references public.properties (household_id, id) on delete cascade
);
create index mortgages_household_idx on public.mortgages (household_id, renewal_date);
create trigger mortgages_updated_at before update on public.mortgages for each row execute function public.set_updated_at();

create table public.mortgage_prepayments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  mortgage_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  paid_by uuid,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, mortgage_id) references public.mortgages (household_id, id) on delete cascade,
  foreign key (household_id, paid_by) references public.household_members (household_id, user_id)
);
create index mortgage_prepayments_idx on public.mortgage_prepayments (household_id, mortgage_id, paid_on);

-- Balances read from the lender's statement override any computed schedule.
create table public.mortgage_statements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  mortgage_id uuid not null,
  balance_cents bigint not null check (balance_cents >= 0),
  as_of date not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, mortgage_id) references public.mortgages (household_id, id) on delete cascade
);
create index mortgage_statements_idx on public.mortgage_statements (household_id, mortgage_id, as_of desc);

create table public.special_assessments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_on date,
  paid_on date,
  notes text,
  created_at timestamptz not null default now()
);
create index special_assessments_idx on public.special_assessments (household_id, due_on);

create table public.appliances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  brand text,
  model text,
  serial_number text,
  purchased_on date,
  warranty_ends_on date,
  manual_url text check (manual_url is null or manual_url ~* '^https?://'),
  price_cents bigint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);
create index appliances_household_idx on public.appliances (household_id, warranty_ends_on);
create trigger appliances_updated_at before update on public.appliances for each row execute function public.set_updated_at();

alter table public.tasks
  add constraint tasks_appliance_fk foreign key (household_id, appliance_id) references public.appliances (household_id, id) on delete set null (appliance_id);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  done_on date not null,
  appliance_id uuid,
  task_id uuid,
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  expense_id uuid references public.expenses (id) on delete set null,
  notes text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, appliance_id) references public.appliances (household_id, id) on delete set null (appliance_id),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete set null (task_id)
);
create index maintenance_records_idx on public.maintenance_records (household_id, done_on desc);

-- Documents: uploaded to Storage OR linked externally (e.g. Google Drive). Both first-class.
-- Also used for note attachments (note_id).
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  doc_type text not null default 'other' check (doc_type in (
    'declaration', 'reglements', 'pv_assemblee', 'budget_syndicat', 'attestation', 'carnet_entretien',
    'etude_fonds_prevoyance', 'acte_vente', 'hypotheque', 'assurance', 'taxes', 'inspection', 'garantie', 'facture', 'other')),
  storage_path text,
  external_url text check (external_url is null or external_url ~* '^https?://'),
  mime_type text,
  size_bytes bigint,
  note_id uuid,
  appliance_id uuid,
  document_date date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check ((storage_path is null) <> (external_url is null)),
  foreign key (household_id, note_id) references public.notes (household_id, id) on delete cascade,
  foreign key (household_id, appliance_id) references public.appliances (household_id, id) on delete set null (appliance_id)
);
create index documents_household_idx on public.documents (household_id, doc_type, created_at desc);

create table public.capital_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('down_payment', 'notary', 'inspection', 'welcome_tax', 'renovation', 'prepayment', 'other')),
  source text check (source is null or source in ('celiapp', 'rap_reer', 'cash', 'gift', 'line_of_credit', 'other')),
  amount_cents bigint not null check (amount_cents > 0),
  contributed_on date not null,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id)
);
create index capital_contributions_idx on public.capital_contributions (household_id, user_id, contributed_on);

alter table public.properties enable row level security;
alter table public.mortgages enable row level security;
alter table public.mortgage_prepayments enable row level security;
alter table public.mortgage_statements enable row level security;
alter table public.special_assessments enable row level security;
alter table public.appliances enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.documents enable row level security;
alter table public.capital_contributions enable row level security;

create policy properties_all on public.properties for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy mortgages_all on public.mortgages for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy prepayments_all on public.mortgage_prepayments for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy statements_all on public.mortgage_statements for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy assessments_all on public.special_assessments for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy appliances_all on public.appliances for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy maintenance_all on public.maintenance_records for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
-- Documents attached to a private note follow the note's privacy.
create policy documents_all on public.documents for all to authenticated
  using (public.is_member(household_id) and (note_id is null or exists (select 1 from public.notes n where n.id = note_id)))
  with check (public.is_member(household_id) and (note_id is null or exists (select 1 from public.notes n where n.id = note_id)));
create policy capital_all on public.capital_contributions for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
