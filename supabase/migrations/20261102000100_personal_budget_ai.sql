-- Chez Nous — personal budget (per member, private) and AI budget recommendations.

-- ---------------------------------------------------------------------------
-- Personal budgets: one member's monthly amounts per category, for their PRIVATE
-- expenses (gym, clothes…). Same "effective from this month on" model as `budgets`.
-- Never visible to the partner.
-- ---------------------------------------------------------------------------
create table public.personal_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents >= 0),
  -- Always true: makes the audit rows private to their author (see audit_row / audit_select).
  is_private boolean not null default true check (is_private),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, category_id) references public.budget_categories (household_id, id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (household_id, user_id, category_id, month)
);
create index personal_budgets_user_month_idx on public.personal_budgets (household_id, user_id, month);
create trigger personal_budgets_updated_at before update on public.personal_budgets for each row execute function public.set_updated_at();
create trigger personal_budgets_audit after insert or update or delete on public.personal_budgets for each row execute function public.audit_row();

alter table public.personal_budgets enable row level security;
create policy personal_budgets_own on public.personal_budgets for all to authenticated
  using (public.is_member(household_id) and user_id = (select auth.uid()))
  with check (public.is_member(household_id) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Private recurring rules (e.g. the gym every month): only their author sees them,
-- and the expenses they generate are private.
-- ---------------------------------------------------------------------------
alter table public.recurring_rules add column is_private boolean not null default false;

drop policy recurring_all on public.recurring_rules;
create policy recurring_select on public.recurring_rules for select to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy recurring_insert on public.recurring_rules for insert to authenticated
  with check (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy recurring_update on public.recurring_rules for update to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())))
  with check (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy recurring_delete on public.recurring_rules for delete to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- AI recommendations: the last generated advice per member (kept so opening the page
-- never calls the model again). Private to the member who asked.
-- ---------------------------------------------------------------------------
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  model text not null,
  result jsonb not null,
  usage jsonb,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index ai_insights_user_idx on public.ai_insights (household_id, user_id, created_at desc);

alter table public.ai_insights enable row level security;
create policy ai_insights_select on public.ai_insights for select to authenticated
  using (public.is_member(household_id) and user_id = (select auth.uid()));
create policy ai_insights_insert on public.ai_insights for insert to authenticated
  with check (public.is_member(household_id) and user_id = (select auth.uid()));
