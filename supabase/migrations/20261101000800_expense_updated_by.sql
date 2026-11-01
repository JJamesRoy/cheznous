-- Who last edited an expense (shown as « modifiée par … »).
alter table public.expenses add column updated_by uuid references auth.users (id);

create or replace function public.set_updated_by()
returns trigger language plpgsql as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger expenses_updated_by before update on public.expenses
  for each row execute function public.set_updated_by();
