-- Datos iniciales opcionales basados en InventarioEquipos.csv adjunto.
insert into public.offices(name) values ('Jurídico') on conflict (name) do nothing;

with o as (select id from public.offices where name='Jurídico')
insert into public.equipment_names(office_id,name)
select o.id, x.name from o cross join (values ('JURIDICO5'),('JURIDICO029'),('JURIDICO201'),('JURIDICO12'),('JURIDICO49')) x(name)
on conflict (office_id,name) do nothing;
