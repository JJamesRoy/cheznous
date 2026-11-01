-- Chez Nous — shopping lists, tasks, notes.

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  match_key text generated always as (public.normalize_key(name)) stored,
  kind text not null default 'custom' check (kind in ('groceries', 'furniture', 'household', 'wishlist', 'custom')),
  project_id uuid,
  sort integer not null default 0,
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, match_key),
  foreign key (household_id, project_id) references public.projects (household_id, id) on delete set null (project_id)
);
create index shopping_lists_household_idx on public.shopping_lists (household_id, sort);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  list_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(8, 2) not null default 1 check (quantity > 0),
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents >= 0),
  url text check (url is null or url ~* '^https?://'),
  image_url text check (image_url is null or image_url ~* '^https?://'),
  category text,
  priority smallint not null default 0 check (priority between 0 and 2),
  assignee uuid,
  notes text,
  purchased_at timestamptz,
  purchased_by uuid references auth.users (id),
  expense_id uuid references public.expenses (id) on delete set null,
  sort double precision not null default extract(epoch from now()),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, list_id) references public.shopping_lists (household_id, id) on delete cascade,
  foreign key (household_id, assignee) references public.household_members (household_id, user_id)
);
create index shopping_items_list_idx on public.shopping_items (household_id, list_id, purchased_at nulls first, sort);
create trigger shopping_items_updated_at before update on public.shopping_items for each row execute function public.set_updated_at();

alter table public.expenses
  add constraint expenses_shopping_item_fk foreign key (shopping_item_id) references public.shopping_items (id) on delete set null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  notes text,
  kind text not null default 'general' check (kind in ('general', 'maintenance')),
  assignee uuid,
  due_on date,
  priority smallint not null default 0 check (priority between 0 and 2),
  tags text[] not null default '{}',
  frequency text check (frequency is null or frequency in ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly')),
  recurrence_anchor date,
  appliance_id uuid,
  project_id uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, assignee) references public.household_members (household_id, user_id),
  foreign key (household_id, project_id) references public.projects (household_id, id) on delete set null (project_id),
  check (frequency is null or (due_on is not null and recurrence_anchor is not null))
);
create index tasks_household_due_idx on public.tasks (household_id, completed_at nulls first, due_on);
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  label text not null check (char_length(label) between 1 and 160),
  done boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade
);
create index task_checklist_task_idx on public.task_checklist_items (household_id, task_id, sort);

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  due_on date,
  completed_by uuid not null default auth.uid() references auth.users (id),
  completed_at timestamptz not null default now(),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade
);
create index task_completions_task_idx on public.task_completions (household_id, task_id, completed_at desc);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 160),
  body_md text not null default '' check (char_length(body_md) <= 50000),
  is_private boolean not null default false,
  pinned boolean not null default false,
  tags text[] not null default '{}',
  search tsvector generated always as (
    setweight(to_tsvector('french', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('french', coalesce(body_md, '')), 'B')
  ) stored,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);
create index notes_household_idx on public.notes (household_id, pinned desc, updated_at desc);
create index notes_search_idx on public.notes using gin (search);
create trigger notes_updated_at before update on public.notes for each row execute function public.set_updated_at();

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_completions enable row level security;
alter table public.notes enable row level security;

create policy lists_all on public.shopping_lists for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy items_all on public.shopping_items for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy tasks_all on public.tasks for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy checklist_all on public.task_checklist_items for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy completions_all on public.task_completions for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy notes_select on public.notes for select to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy notes_insert on public.notes for insert to authenticated
  with check (public.is_member(household_id) and created_by = (select auth.uid()));
create policy notes_update on public.notes for update to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())))
  with check (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));
create policy notes_delete on public.notes for delete to authenticated
  using (public.is_member(household_id) and (not is_private or created_by = (select auth.uid())));

-- Default lists are created with the household.
create or replace function public.create_default_lists()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.shopping_lists (household_id, name, kind, sort, created_by) values
    (new.id, 'Épicerie', 'groceries', 10, new.created_by),
    (new.id, 'Meubles du condo', 'furniture', 20, new.created_by),
    (new.id, 'Produits ménagers', 'household', 30, new.created_by);
  return new;
end $$;

create trigger households_default_lists after insert on public.households
  for each row execute function public.create_default_lists();

-- Notes full-text search (French), private rows filtered by RLS.
create or replace function public.search_notes(p_household uuid, p_query text, p_limit integer default 20)
returns table (id uuid, title text, snippet text, rank real, updated_at timestamptz, pinned boolean, is_private boolean)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.title,
    ts_headline('french', n.body_md, q, 'MaxWords=24, MinWords=8, StartSel=«, StopSel=»') as snippet,
    ts_rank(n.search, q) as rank, n.updated_at, n.pinned, n.is_private
  from public.notes n, websearch_to_tsquery('french', p_query) q
  where n.household_id = p_household and n.search @@ q
  order by rank desc, n.updated_at desc
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.search_notes(uuid, text, integer) to authenticated;
