-- Chez Nous — core: profiles, households, membership, invitations, accounts,
-- categories, audit, idempotency, MCP call log.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Accent- and case-insensitive key used for matching names (categories, lists).
create or replace function public.normalize_key(p text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), ''), 60)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Households & membership
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null default 'America/Toronto',
  week_start smallint not null default 0 check (week_start between 0 and 6),
  default_split_mode text not null default 'equal' check (default_split_mode in ('equal', 'income')),
  onboarding_step text not null default 'invite',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger households_updated_at before update on public.households
  for each row execute function public.set_updated_at();

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Income ratio in basis points (5500 = 55 %). Never salaries.
  income_weight_bp integer not null default 5000 check (income_weight_bp between 0 and 10000),
  -- Biweekly pay schedule anchor (any past payday).
  pay_anchor_date date,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

-- Membership check used by every RLS policy. SECURITY DEFINER avoids policy recursion.
create or replace function public.is_member(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  )
$$;

-- Same, for storage paths whose first segment should be a household id.
create or replace function public.is_member_path(p_folder text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_member(p_folder::uuid);
end $$;

create or replace function public.shares_household_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members a
    join public.household_members b on a.household_id = b.household_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  )
$$;

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz
);

create index household_invitations_household_idx on public.household_invitations (household_id, created_at desc);

-- Joint account ("Compte commun").
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null default 'Compte commun',
  kind text not null default 'joint' check (kind in ('joint')),
  created_at timestamptz not null default now(),
  unique (household_id, id)
);

create table public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  match_key text generated always as (public.normalize_key(name)) stored,
  kind text not null default 'variable' check (kind in ('fixed', 'variable')),
  sort integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, match_key)
);

-- ---------------------------------------------------------------------------
-- Audit log (written by triggers only)
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid references public.households (id) on delete cascade,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb,
  is_private boolean not null default false,
  actor uuid,
  at timestamptz not null default now()
);

create index audit_logs_household_idx on public.audit_logs (household_id, at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_logs (household_id, table_name, row_id, action, before, after, is_private, actor)
  values (
    (v_row ->> 'household_id')::uuid,
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

-- ---------------------------------------------------------------------------
-- Idempotency keys
-- ---------------------------------------------------------------------------

create table public.idempotency_keys (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 200),
  operation text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- MCP tool call log (also the rate-limit window)
-- ---------------------------------------------------------------------------

create table public.mcp_tool_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete cascade,
  client_id text,
  tool text not null,
  args_summary jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ok', 'error', 'rate_limited', 'preview')),
  error_code text,
  latency_ms integer not null default 0,
  at timestamptz not null default now()
);

create index mcp_tool_calls_user_at_idx on public.mcp_tool_calls (user_id, at desc);
create index mcp_tool_calls_household_idx on public.mcp_tool_calls (household_id, at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.accounts enable row level security;
alter table public.budget_categories enable row level security;
alter table public.audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.mcp_tool_calls enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_select on public.households for select to authenticated
  using (public.is_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

create policy members_select on public.household_members for select to authenticated
  using (public.is_member(household_id));
create policy members_update on public.household_members for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy invitations_select on public.household_invitations for select to authenticated
  using (public.is_member(household_id));
create policy invitations_insert on public.household_invitations for insert to authenticated
  with check (public.is_member(household_id) and created_by = (select auth.uid()));
create policy invitations_update on public.household_invitations for update to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy accounts_select on public.accounts for select to authenticated
  using (public.is_member(household_id));

create policy categories_all on public.budget_categories for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_member(household_id) and (not is_private or actor = (select auth.uid())));

create policy idem_all on public.idempotency_keys for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy mcp_calls_insert on public.mcp_tool_calls for insert to authenticated
  with check (user_id = (select auth.uid()) and (household_id is null or public.is_member(household_id)));
create policy mcp_calls_select on public.mcp_tool_calls for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC: create household (atomic: household + owner + joint account + defaults)
-- ---------------------------------------------------------------------------

create or replace function public.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then
    raise exception 'already in a household' using errcode = 'P0001', hint = 'ALREADY_MEMBER';
  end if;

  insert into public.households (name, created_by) values (trim(p_name), v_uid) returning id into v_id;
  insert into public.household_members (household_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.accounts (household_id, name, kind) values (v_id, 'Compte commun', 'joint');

  insert into public.budget_categories (household_id, name, kind, sort)
  select v_id, c.name, c.kind, c.sort
  from (values
    ('Épicerie', 'variable', 10), ('Resto', 'variable', 20), ('SAQ', 'variable', 30),
    ('Dépanneur', 'variable', 40), ('Frais de condo', 'fixed', 50), ('Hypothèque', 'fixed', 60),
    ('Taxes municipales', 'fixed', 70), ('Taxe scolaire', 'fixed', 80),
    ('Assurance habitation', 'fixed', 90), ('Électricité (Hydro-Québec)', 'fixed', 100),
    ('Internet et cellulaire', 'fixed', 110), ('Transport (STM, BIXI, auto)', 'variable', 120),
    ('Meubles et déco', 'variable', 130), ('Entretien et réparations', 'variable', 140),
    ('Santé et pharmacie', 'variable', 150), ('Abonnements', 'fixed', 160),
    ('Cadeaux', 'variable', 170), ('Voyages', 'variable', 180), ('Divers', 'variable', 190)
  ) as c (name, kind, sort);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: invitations (token is hashed with SHA-256; the raw token is never stored)
-- ---------------------------------------------------------------------------

create or replace function public.invitation_preview(p_token text)
returns table (household_name text, inviter_name text, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_inv public.household_invitations;
begin
  select * into v_inv from public.household_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then
    return query select null::text, null::text, null::timestamptz, 'invalid'::text;
    return;
  end if;
  return query
    select h.name, p.display_name, v_inv.expires_at,
      case
        when v_inv.revoked_at is not null then 'revoked'
        when v_inv.accepted_at is not null then 'used'
        when v_inv.expires_at < now() then 'expired'
        else 'valid'
      end
    from public.households h
    left join public.profiles p on p.id = v_inv.created_by
    where h.id = v_inv.household_id;
end $$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.household_invitations;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_inv from public.household_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then raise exception 'invalid invitation' using errcode = 'P0001', hint = 'INVITE_INVALID'; end if;
  if v_inv.revoked_at is not null then raise exception 'revoked' using errcode = 'P0001', hint = 'INVITE_REVOKED'; end if;
  if v_inv.accepted_at is not null then raise exception 'used' using errcode = 'P0001', hint = 'INVITE_USED'; end if;
  if v_inv.expires_at < now() then raise exception 'expired' using errcode = 'P0001', hint = 'INVITE_EXPIRED'; end if;

  if exists (select 1 from public.household_members where user_id = v_uid) then
    raise exception 'already in a household' using errcode = 'P0001', hint = 'ALREADY_MEMBER';
  end if;

  select count(*) into v_count from public.household_members where household_id = v_inv.household_id;
  if v_count >= 2 then
    raise exception 'household full' using errcode = 'P0001', hint = 'HOUSEHOLD_FULL';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_inv.household_id, v_uid, 'member');

  update public.household_invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  -- Any other pending invitations of this household are now pointless.
  update public.household_invitations
  set revoked_at = now()
  where household_id = v_inv.household_id and id <> v_inv.id and accepted_at is null and revoked_at is null;

  return v_inv.household_id;
end $$;

revoke execute on function public.create_household(text) from anon, public;
revoke execute on function public.accept_invitation(text) from anon, public;
revoke execute on function public.invitation_preview(text) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
