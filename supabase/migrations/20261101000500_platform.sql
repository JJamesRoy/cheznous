-- Chez Nous — audit triggers, realtime publication, storage, push subscriptions, grants.

-- Audit every write on household data (before/after JSON, actor = auth.uid()).
do $$
declare t text;
begin
  foreach t in array array[
    'households', 'household_members', 'household_invitations', 'budget_categories',
    'expenses', 'expense_splits', 'refunds', 'settlements', 'contributions', 'budgets',
    'recurring_rules', 'projects', 'savings_goals', 'goal_contributions',
    'shopping_lists', 'shopping_items', 'tasks', 'task_checklist_items', 'notes',
    'properties', 'mortgages', 'mortgage_prepayments', 'mortgage_statements', 'special_assessments',
    'appliances', 'maintenance_records', 'documents', 'capital_contributions'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Note: households has no household_id column; patch the audit function to use id for it.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_household uuid := coalesce((v_row ->> 'household_id')::uuid, case when tg_table_name = 'households' then (v_row ->> 'id')::uuid end);
begin
  -- The household itself may be gone (cascade delete); don't break the delete.
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = v_household) then
    return null;
  end if;
  insert into public.audit_logs (household_id, table_name, row_id, action, before, after, is_private, actor)
  values (
    v_household,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'expense_id'),
    tg_op,
    v_old,
    v_new,
    coalesce((v_row ->> 'is_private')::boolean, false),
    auth.uid()
  );
  return null;
end $$;

-- Splits of a private expense must not leak through the audit log either.
create or replace function public.audit_split_privacy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.table_name = 'expense_splits' then
    new.is_private := coalesce((select e.is_private from public.expenses e where e.id = (new.row_id)::uuid), false);
  end if;
  return new;
end $$;
create trigger audit_logs_split_privacy before insert on public.audit_logs
  for each row execute function public.audit_split_privacy();

-- Realtime
alter publication supabase_realtime add table
  public.expenses, public.expense_splits, public.refunds, public.settlements, public.contributions,
  public.budgets, public.budget_categories, public.shopping_lists, public.shopping_items,
  public.tasks, public.task_checklist_items, public.notes, public.household_members,
  public.savings_goals, public.goal_contributions, public.projects;

-- Push subscriptions (Web Push; only where the platform supports it).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Storage: one private bucket, paths are `<household_id>/<kind>/<file>`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-files', 'household-files', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;

create policy household_files_select on storage.objects for select to authenticated
  using (bucket_id = 'household-files' and public.is_member_path((storage.foldername(name))[1]));
create policy household_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'household-files' and public.is_member_path((storage.foldername(name))[1]));
create policy household_files_update on storage.objects for update to authenticated
  using (bucket_id = 'household-files' and public.is_member_path((storage.foldername(name))[1]));
create policy household_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'household-files' and public.is_member_path((storage.foldername(name))[1]));

-- Avatars live under `avatars/<user_id>/…` in the same bucket.
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'household-files' and (storage.foldername(name))[1] = 'avatars'
    and ((storage.foldername(name))[2] = (select auth.uid())::text or public.shares_household_with(nullif((storage.foldername(name))[2], '')::uuid)));
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'household-files' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- Anonymous users get nothing from the public schema except the invitation preview.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
