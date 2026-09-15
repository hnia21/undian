-- ============================================================
--  SUPABASE SETUP MODE 2: UNDIAN GRUP (TANPA PESERTA)
--  Jalankan di SQL Editor setelah supabase.sql (mode 1).
--  Skema berubah dari versi lama (peserta): tabel peserta &
--  anggota grup sengaja dihapus. Jalankan ulang dengan aman.
-- ============================================================

-- Hapus artefak versi lama yang tidak dipakai lagi.
drop table if exists public.group_members;
drop table if exists public.participants;
drop function if exists public.save_participants(text[]);
drop function if exists public.get_participants();
drop function if exists public.set_group_participants(bigint, bigint[]);

create table if not exists public.groups (
  id   bigint generated always as identity primary key,
  name text not null,
  drawn boolean not null default false,
  order_seq int
);

-- idempotent: pertahankan order_seq, hapus kolom antrian lama
alter table public.groups add column if not exists order_seq int;
alter table public.groups drop column if exists force_seq;
alter table public.groups drop column if exists forced;

alter table public.groups enable row level security;

-- Konfigurasi nomor urut grup dari admin: NO + nama grup.
-- Entri ini tidak ditampilkan di halaman utama; saat sebuah grup diundi
-- dan namanya sama dengan salah satu entri, nomor yang tampil memakai NO ini.
create table if not exists public.group_no_map (
  id   bigint generated always as identity primary key,
  no   int  not null,
  name text not null
);

alter table public.group_no_map enable row level security;

-- ---------- RPC ----------

-- Ganti seluruh daftar grup.
create or replace function public.save_groups(names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.groups where true;
  insert into public.groups (name)
  select distinct trim(nm)
  from unnest(names) nm
  where trim(nm) <> '';
end;
$$;

create or replace function public.get_groups()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',       id,
      'name',     name,
      'drawn',    drawn,
      'order_seq', order_seq
    ) order by id), '[]'::jsonb)
  from public.groups;
$$;

-- Fungsi antrian (force_seq) sudah tidak dipakai lagi: urutan undian kini
-- mengikuti Konfigurasi NO (vlookup) pada draw_group.
drop function if exists public.set_groups_forced(bigint[]);

-- Undi satu grup berikutnya dari yang belum diundi.
-- Urutan ditentukan oleh Konfigurasi NO dari admin (vlookup):
-- yang ada di group_no_map dengan NO terkecil diundi duluan,
-- grup tanpa konfigurasi menyusul setelahnya (acak-praktis = urutan id).
-- Setiap grup yang terpilih mendapat nomor urut = urutan undiannya.
create or replace function public.draw_group()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
begin
  select g.id, g.name into g
  from public.groups g
  left join public.group_no_map m
    on lower(btrim(m.name)) = lower(btrim(g.name))
  where not g.drawn
  order by (m.no is null) asc, m.no asc, g.id asc
  limit 1;

  if g.id is null then
    return jsonb_build_object('done', true);
  end if;

  update public.groups
  set drawn = true,
      order_seq = (select coalesce(max(order_seq), 0) + 1 from public.groups where drawn)
  where id = g.id;

  return jsonb_build_object(
    'id',    g.id,
    'name',  g.name,
    'done',  false,
    'order', (select coalesce(max(order_seq), 0) from public.groups where drawn)
  );
end;
$$;

-- Reset undian grup: semua grup kembali belum diundi, urutan dihapus.
create or replace function public.reset_group_draw()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.groups set drawn = false, order_seq = null where true;
end;
$$;

-- Hapus semua data mode 2 (daftar grup).
create or replace function public.clear_group_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.groups where true;
  delete from public.group_no_map where true;
end;
$$;

-- ---------- NO GROUP: konfigurasi nomor urut dari admin ----------

create or replace function public.get_group_no_map()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'name', name) order by no, id), '[]'::jsonb)
  from public.group_no_map;
$$;

-- Ganti seluruh daftar NO + nama grup.
create or replace function public.save_group_no_map(rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  delete from public.group_no_map where true;
  for r in select * from jsonb_array_elements(rows)
  loop
    if r->>'name' is null or btrim(r->>'name') = '' then
      continue;
    end if;
    insert into public.group_no_map (no, name)
    values (coalesce((r->>'no')::int, 0), btrim(r->>'name'));
  end loop;
end;
$$;