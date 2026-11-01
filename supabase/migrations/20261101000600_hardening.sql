-- Hardening found during review of the condo use cases.

-- One mortgage per household in v1 (the UI and MCP speak of « l'hypothèque »).
create unique index mortgages_one_per_household on public.mortgages (household_id);

-- Links to expenses must stay inside the household (composite FKs like everywhere else).
alter table public.maintenance_records drop constraint maintenance_records_expense_id_fkey;
alter table public.maintenance_records
  add constraint maintenance_records_expense_fk foreign key (household_id, expense_id)
  references public.expenses (household_id, id) on delete set null (expense_id);

alter table public.shopping_items drop constraint shopping_items_expense_id_fkey;
alter table public.shopping_items
  add constraint shopping_items_expense_fk foreign key (household_id, expense_id)
  references public.expenses (household_id, id) on delete set null (expense_id);

alter table public.expenses drop constraint expenses_shopping_item_fk;
alter table public.shopping_items add constraint shopping_items_household_id_key unique (household_id, id);
alter table public.expenses
  add constraint expenses_shopping_item_fk foreign key (household_id, shopping_item_id)
  references public.shopping_items (household_id, id) on delete set null (shopping_item_id);

-- Non-negative money everywhere.
alter table public.properties
  add constraint properties_insurance_premium_nonneg check (insurance_premium_cents is null or insurance_premium_cents >= 0),
  add constraint properties_syndicate_deductible_nonneg check (syndicate_deductible_cents is null or syndicate_deductible_cents >= 0),
  add constraint properties_owner_deductible_nonneg check (owner_deductible_coverage_cents is null or owner_deductible_coverage_cents >= 0),
  add constraint properties_welcome_tax_nonneg check (welcome_tax_cents is null or welcome_tax_cents >= 0);
alter table public.appliances
  add constraint appliances_price_nonneg check (price_cents is null or price_cents >= 0);
