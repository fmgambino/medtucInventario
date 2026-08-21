-- RELEVAMIENTO MANAGER v1.3.1
begin;
create index if not exists inventories_source_sheet_idx on public.inventories(source_sheet);
create index if not exists inventories_source_sheet_office_idx on public.inventories(source_sheet,office_id);
notify pgrst, 'reload schema';
commit;
