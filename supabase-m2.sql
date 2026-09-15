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
  order_seq int,
  force_seq int
);

-- idempotent: tambahkan kolom jika tabel sudah ada dari versi sebelumnya
alter table public.groups add column if not exists order_seq int;
alter table public.groups add column if not exists force_seq int;
-- migrasi: kolom checkbox lama diganti kolom urutan angka
alter table public.groups drop column if exists forced;

alter table public.groups enable row level security;

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
      'order_seq', order_seq,
      'forceSeq', force_seq
    ) order by id), '[]'::jsonb)
  from public.groups;
$$;

-- Admin: tentukan urutan undian berikutnya lewat nomor urut grup
-- (posisi grup dalam daftar). Array berisi id grup sesuai urutan
-- antrian; nilainya disimpan ke force_seq. Antrian kosong = acak.
create or replace function public.set_groups_forced(p_group_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i   int := 1;
  pid bigint;
begin
  update public.groups set force_seq = null where true;
  foreach pid in array p_group_ids loop
    update public.groups set force_seq = i
    where id = pid
      and not drawn;
    i := i + 1;
  end loop;
end;
$$;

-- Undi satu grup berikutnya secara acak dari yang belum diundi.
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
  select * into g
  from public.groups
  where not drawn
  order by (force_seq is null) asc, force_seq asc, id asc
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
  update public.groups set drawn = false, order_seq = null, force_seq = null where true;
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
end;
$$;