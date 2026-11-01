-- Chez Nous — money: projects, recurring rules, expenses & splits, refunds,
-- settlements, joint-account contributions, budgets, goals.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),
  status text not null default 'active' check (status in ('active', 'done', 'archived')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);
create index projects_household_idx on public.projects (household_id, created_at desc);
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('expense', 'bill')),
  title text not null check (char_length(title) between 1 and 120),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  category_id uuid,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'installments')),
  anchor_date date not null,
  installment_dates date[] not null default '{}',
  end_date date,
  -- Template for generated expenses: payer, split mode, weights/shares.
  template jsonb not null default '{}'::jsonb,
  auto_create boolean not null default false,
  materialized_until date,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, category_id) references public.budget_categories (household_id, id),
  check (frequency <> 'installments' or cardinality(installment_dates) > 0)
);
create index recurring_rules_household_idx on public.recurring_rules (household_id, anchor_date);
create trigger recurring_rules_updated_at before update on public.recurring_rules for each row execute function public.set_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (char_length(description) between 1 and 140),
  match_key text generated always as (public.normalize_key(description)) stored,
  spent_on date not null,
  category_id uuid,
  paid_by_user uuid,
  paid_by_account uuid,
  split_mode text not null check (split_mode in ('equal', 'percentage', 'exact', 'income', 'none')),
  is_private boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  receipt_path text,
  project_id uuid,
  recurring_rule_id uuid,
  recurring_occurrence date,
  shopping_item_id uuid,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, category_id) references public.budget_categories (household_id, id),
  foreign key (household_id, paid_by_user) references public.household_members (household_id, user_id),
  foreign key (household_id, paid_by_account) references public.accounts (household_id, id),
  foreign key (household_id, project_id) references public.projects (household_id, id) on delete set null (project_id),
  foreign key (household_id, recurring_rule_id) references public.recurring_rules (household_id, id) on delete set null (recurring_rule_id),
  -- Exactly one payer.
  check ((paid_by_user is null) <> (paid_by_account is null)),
  -- Private and joint-account expenses carry no split; shared member-paid ones always do.
  check ((split_mode = 'none') = (is_private or paid_by_account is not null)),
  -- A private expense is paid by its creator.
  check (not is_private or paid_by_user = created_by),
  unique (recurring_rule_id, recurring_occurrence)
);
create index expenses_household_date_idx on public.expenses (household_id, spent_on desc);
create index expenses_household_category_idx on public.expenses (household_id, category_id, spent_on);
create index expenses_household_project_idx on public.expenses (household_id, project_id) where project_id is not null;
create index expenses_match_key_idx on public.expenses (household_id, match_key);
create trigger expenses_updated_at before update on public.expenses for each row execute function public.set_updated_at();

create table public.expense_splits (
  expense_id uuid not null,
  household_id uuid not null,
  user_id uuid not null,
  share_cents bigint not null check (share_cents >= 0),
  -- Weight used to compute the share (equal: 1, percentage/income: basis points, exact: null).
  weight integer,
  primary key (expense_id, user_id),
  foreign key (household_id, expense_id) references public.expenses (household_id, id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id)
);
create index expense_splits_household_idx on public.expense_splits (household_id, user_id);

-- Σ shares = amount, checked at commit so an expense and its splits can be written in any order.
create or replace function public.check_expense_splits()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id uuid := case when tg_table_name = 'expenses' then (v_row ->> 'id')::uuid else (v_row ->> 'expense_id')::uuid end;
  v_exp public.expenses;
  v_sum bigint;
  v_count integer;
begin
  select * into v_exp from public.expenses where id = v_id;
  if not found then return null; end if;
  select coalesce(sum(share_cents), 0), count(*) into v_sum, v_count from public.expense_splits where expense_id = v_id;
  if v_exp.split_mode = 'none' then
    if v_count > 0 then
      raise exception 'expense % must not have splits', v_id using errcode = '23514';
    end if;
  elsif v_count = 0 or v_sum <> v_exp.amount_cents then
    raise exception 'splits of expense % sum to % instead of %', v_id, v_sum, v_exp.amount_cents using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger expenses_splits_sum after insert or update on public.expenses
  deferrable initially deferred for each row execute function public.check_expense_splits();
create constraint trigger expense_splits_sum after insert or update or delete on public.expense_splits
  deferrable initially deferred for each row execute function public.check_expense_splits();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  expense_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  received_by_user uuid,
  received_by_account uuid,
  refunded_on date not null,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, expense_id) references public.expenses (household_id, id) on delete cascade,
  foreign key (household_id, received_by_user) references public.household_members (household_id, user_id),
  foreign key (household_id, received_by_account) references public.accounts (household_id, id),
  check ((received_by_user is null) <> (received_by_account is null))
);
create index refunds_household_date_idx on public.refunds (household_id, refunded_on desc);
create index refunds_expense_idx on public.refunds (expense_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  settled_on date not null,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, from_user) references public.household_members (household_id, user_id),
  foreign key (household_id, to_user) references public.household_members (household_id, user_id),
  check (from_user <> to_user)
);
create index settlements_household_date_idx on public.settlements (household_id, settled_on desc);

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  user_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  contributed_on date not null,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id)
);
create index contributions_household_date_idx on public.contributions (household_id, contributed_on desc);

-- A budget row applies from `month` onward until a later row for the same category.
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents >= 0),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, category_id) references public.budget_categories (household_id, id) on delete cascade,
  unique (household_id, category_id, month)
);
create index budgets_household_month_idx on public.budgets (household_id, month);
create trigger budgets_updated_at before update on public.budgets for each row execute function public.set_updated_at();

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'savings' check (kind in ('savings', 'mortgage_prepayment')),
  target_cents bigint check (target_cents is null or target_cents > 0),
  target_date date,
  project_id uuid,
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, project_id) references public.projects (household_id, id) on delete set null (project_id)
);
create index savings_goals_household_idx on public.savings_goals (household_id, created_at);
create trigger savings_goals_updated_at before update on public.savings_goals for each row execute function public.set_updated_at();

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  goal_id uuid not null,
  user_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  contributed_on date not null,
  note text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (household_id, goal_id) references public.savings_goals (household_id, id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id)
);
create index goal_contributions_goal_idx on public.goal_contributions (household_id, goal_id, contributed_on);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.refunds enable row level security;
alter table public.settlements enable row level security;
alter table public.contributions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.goal_contributions enable row level security;

create policy projects_all on public.projects for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy recurring_all on public.recurring_rules for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Private expenses: visible and writable only by their creator.
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.is_member(household_id) and created_by = (select auth.uid()));
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())))
  with check (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));

-- Splits follow their (visible) expense.
create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));
create policy splits_insert on public.expense_splits for insert to authenticated
  with check (public.is_member(household_id) and exists (select 1 from public.expenses e where e.id = expense_id));
create policy splits_update on public.expense_splits for update to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id))
  with check (public.is_member(household_id));
create policy splits_delete on public.expense_splits for delete to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

create policy refunds_all on public.refunds for all to authenticated
  using (public.is_member(household_id) and exists (select 1 from public.expenses e where e.id = expense_id))
  with check (public.is_member(household_id) and exists (select 1 from public.expenses e where e.id = expense_id));
create policy settlements_select on public.settlements for select to authenticated
  using (public.is_member(household_id));
create policy settlements_insert on public.settlements for insert to authenticated
  with check (public.is_member(household_id) and created_by = (select auth.uid()));
create policy settlements_delete on public.settlements for delete to authenticated
  using (public.is_member(household_id));
create policy contributions_all on public.contributions for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy budgets_all on public.budgets for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy goals_all on public.savings_goals for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy goal_contributions_all on public.goal_contributions for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- ---------------------------------------------------------------------------
-- Atomic expense writes with idempotency (SECURITY INVOKER: RLS applies).
-- Split math happens in TypeScript (src/domain/splits.ts); these functions only
-- persist atomically, and the constraint trigger re-checks Σ shares = amount.
-- ---------------------------------------------------------------------------

create or replace function public.claim_idempotency(p_key text, p_operation text, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.idempotency_keys;
begin
  if p_key is null then return null; end if;
  insert into public.idempotency_keys (user_id, key, operation, request_hash)
  values (auth.uid(), p_key, p_operation, p_hash)
  on conflict (user_id, key) do nothing;
  if found then return null; end if;

  select * into v_row from public.idempotency_keys where user_id = auth.uid() and key = p_key;
  if v_row.operation <> p_operation or v_row.request_hash <> p_hash then
    raise exception 'idempotency key reused with a different request' using errcode = 'P0001', hint = 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_row.response is null then
    raise exception 'request with this idempotency key is still in progress' using errcode = 'P0001', hint = 'IDEMPOTENCY_IN_PROGRESS';
  end if;
  return v_row.response;
end $$;

create or replace function public.create_expense_tx(
  p_expense jsonb,
  p_splits jsonb,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_prior jsonb;
  v_id uuid;
  v_result jsonb;
begin
  v_prior := public.claim_idempotency(p_idempotency_key, 'expenses.create', coalesce(p_request_hash, ''));
  if v_prior is not null then
    return v_prior || jsonb_build_object('replayed', true);
  end if;

  insert into public.expenses (
    household_id, amount_cents, description, spent_on, category_id, paid_by_user, paid_by_account,
    split_mode, is_private, notes, receipt_path, project_id, recurring_rule_id, recurring_occurrence, shopping_item_id
  ) values (
    (p_expense ->> 'household_id')::uuid,
    (p_expense ->> 'amount_cents')::bigint,
    p_expense ->> 'description',
    (p_expense ->> 'spent_on')::date,
    nullif(p_expense ->> 'category_id', '')::uuid,
    nullif(p_expense ->> 'paid_by_user', '')::uuid,
    nullif(p_expense ->> 'paid_by_account', '')::uuid,
    p_expense ->> 'split_mode',
    coalesce((p_expense ->> 'is_private')::boolean, false),
    nullif(p_expense ->> 'notes', ''),
    nullif(p_expense ->> 'receipt_path', ''),
    nullif(p_expense ->> 'project_id', '')::uuid,
    nullif(p_expense ->> 'recurring_rule_id', '')::uuid,
    nullif(p_expense ->> 'recurring_occurrence', '')::date,
    nullif(p_expense ->> 'shopping_item_id', '')::uuid
  ) returning id into v_id;

  insert into public.expense_splits (expense_id, household_id, user_id, share_cents, weight)
  select v_id, (p_expense ->> 'household_id')::uuid, (s ->> 'user_id')::uuid, (s ->> 'share_cents')::bigint, nullif(s ->> 'weight', '')::integer
  from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) s;

  v_result := jsonb_build_object('expense_id', v_id);
  if p_idempotency_key is not null then
    update public.idempotency_keys set response = v_result where user_id = auth.uid() and key = p_idempotency_key;
  end if;
  return v_result || jsonb_build_object('replayed', false);
end $$;

create or replace function public.update_expense_tx(p_id uuid, p_expense jsonb, p_splits jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.expenses set
    amount_cents = (p_expense ->> 'amount_cents')::bigint,
    description = p_expense ->> 'description',
    spent_on = (p_expense ->> 'spent_on')::date,
    category_id = nullif(p_expense ->> 'category_id', '')::uuid,
    paid_by_user = nullif(p_expense ->> 'paid_by_user', '')::uuid,
    paid_by_account = nullif(p_expense ->> 'paid_by_account', '')::uuid,
    split_mode = p_expense ->> 'split_mode',
    is_private = coalesce((p_expense ->> 'is_private')::boolean, false),
    notes = nullif(p_expense ->> 'notes', ''),
    receipt_path = nullif(p_expense ->> 'receipt_path', ''),
    project_id = nullif(p_expense ->> 'project_id', '')::uuid
  where id = p_id;
  if not found then
    raise exception 'expense not found' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;

  delete from public.expense_splits where expense_id = p_id;
  insert into public.expense_splits (expense_id, household_id, user_id, share_cents, weight)
  select p_id, (p_expense ->> 'household_id')::uuid, (s ->> 'user_id')::uuid, (s ->> 'share_cents')::bigint, nullif(s ->> 'weight', '')::integer
  from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) s;
end $$;

revoke execute on function public.create_expense_tx(jsonb, jsonb, text, text) from anon, public;
revoke execute on function public.update_expense_tx(uuid, jsonb, jsonb) from anon, public;
revoke execute on function public.claim_idempotency(text, text, text) from anon, public;
grant execute on function public.create_expense_tx(jsonb, jsonb, text, text) to authenticated;
grant execute on function public.update_expense_tx(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.claim_idempotency(text, text, text) to authenticated;
