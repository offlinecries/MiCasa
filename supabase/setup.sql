-- Mi Casa — "Dejá tu foto"
-- Ejecutar este script UNA VEZ en: Supabase dashboard > tu proyecto >
-- SQL Editor > New query > pegar todo esto > Run.
--
-- Crea:
--   - un bucket de Storage público llamado "visitor-photos" (las fotos)
--   - una tabla "visitor_photos" (el registro de cada foto)
--   - las policies necesarias para que cualquier visitante, SIN LOGIN,
--     pueda leer la colección y agregar su foto, pero nadie pueda
--     borrar ni modificar las fotos de otra persona desde la web.

-- 1) bucket público para las imágenes
insert into storage.buckets (id, name, public)
values ('visitor-photos', 'visitor-photos', true)
on conflict (id) do nothing;

-- 2) tabla que registra cada foto dejada
create table if not exists public.visitor_photos (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.visitor_photos enable row level security;

-- cualquiera puede LEER la colección (sin login)
drop policy if exists visitor_photos_select_anon on public.visitor_photos;
create policy visitor_photos_select_anon
  on public.visitor_photos
  for select
  to anon
  using (true);

-- cualquiera puede AGREGAR una foto nueva (sin login)
drop policy if exists visitor_photos_insert_anon on public.visitor_photos;
create policy visitor_photos_insert_anon
  on public.visitor_photos
  for insert
  to anon
  with check (true);

-- a propósito NO hay policy de UPDATE ni DELETE para "anon": sin
-- ellas, Postgres deniega esas operaciones por default, así que nadie
-- puede borrar ni modificar fotos ajenas desde la web pública.

-- 3) policies del bucket de Storage: leer y subir sin login,
--    nunca sobreescribir ni borrar lo ya subido
drop policy if exists visitor_photos_bucket_read on storage.objects;
create policy visitor_photos_bucket_read
  on storage.objects
  for select
  to anon
  using (bucket_id = 'visitor-photos');

drop policy if exists visitor_photos_bucket_insert on storage.objects;
create policy visitor_photos_bucket_insert
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'visitor-photos');

-- sin policies de update/delete acá tampoco: mismo motivo que arriba.

-- 4) posiciones libres + tiempo real ("dejá tu foto" con caos controlado)
-- Ejecutar esto también si ya habías corrido el bloque de arriba antes:
-- todo lo de acá es seguro de correr de nuevo (agrega columnas si
-- faltan, reemplaza la policy si ya existía, ignora el error si la
-- tabla ya estaba en la publicación de Realtime).

alter table public.visitor_photos
  add column if not exists x double precision,
  add column if not exists y double precision,
  add column if not exists rotation double precision,
  add column if not exists scale double precision;

-- cualquiera puede ACTUALIZAR la posición de CUALQUIER foto (mover la
-- ventana en la mesa compartida) — pero SOLO esas 4 columnas: el grant
-- de columna de abajo impide tocar filename/image_url/created_at aunque
-- la policy de RLS permita la fila. Sin policy de delete (sigue sin
-- poder borrarse nada desde la web pública).
drop policy if exists visitor_photos_update_position_anon on public.visitor_photos;
create policy visitor_photos_update_position_anon
  on public.visitor_photos
  for update
  to anon
  using (true)
  with check (true);

revoke update on public.visitor_photos from anon;
grant update (x, y, rotation, scale) on public.visitor_photos to anon;

-- habilita Realtime para esta tabla: cuando alguien mueve una foto,
-- los demás visitantes conectados reciben el cambio sin recargar
do $$
begin
  alter publication supabase_realtime add table public.visitor_photos;
exception when duplicate_object then
  null; -- ya estaba agregada a la publicación, no hay nada más que hacer
end $$;

-- ============================================================
-- Mi Casa — "Armá tu cara" (galería de caras guardadas)
-- Misma idea que "dejá tu foto" de arriba, pero en su propio bucket y
-- tabla (visitor-faces / visitor_faces) para no mezclar las fotos de
-- cámara con las caras armadas. Seguro de correr de nuevo.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('visitor-faces', 'visitor-faces', true)
on conflict (id) do nothing;

create table if not exists public.visitor_faces (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  image_url text not null,
  created_at timestamptz not null default now(),
  x double precision,
  y double precision,
  rotation double precision,
  scale double precision
);

alter table public.visitor_faces enable row level security;

drop policy if exists visitor_faces_select_anon on public.visitor_faces;
create policy visitor_faces_select_anon
  on public.visitor_faces
  for select
  to anon
  using (true);

drop policy if exists visitor_faces_insert_anon on public.visitor_faces;
create policy visitor_faces_insert_anon
  on public.visitor_faces
  for insert
  to anon
  with check (true);

drop policy if exists visitor_faces_update_position_anon on public.visitor_faces;
create policy visitor_faces_update_position_anon
  on public.visitor_faces
  for update
  to anon
  using (true)
  with check (true);

revoke update on public.visitor_faces from anon;
grant update (x, y, rotation, scale) on public.visitor_faces to anon;

-- sin policies de delete (tampoco acá se puede borrar nada desde la web pública)

drop policy if exists visitor_faces_bucket_read on storage.objects;
create policy visitor_faces_bucket_read
  on storage.objects
  for select
  to anon
  using (bucket_id = 'visitor-faces');

drop policy if exists visitor_faces_bucket_insert on storage.objects;
create policy visitor_faces_bucket_insert
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'visitor-faces');

do $$
begin
  alter publication supabase_realtime add table public.visitor_faces;
exception when duplicate_object then
  null;
end $$;
