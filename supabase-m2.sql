-- ============================================================
--  SUPABASE SETUP MODE 2: UNDIAN GRUP
--  Jalankan di SQL Editor setelah supabase.sql (mode 1).
--  Tabel: participants, groups, group_members
-- ============================================================

create table if not exists public.participants (
  id   bigint generated always as identity primary key,
  name text not null
);

create table if not exists public.groups (
  id    bigint generated always as identity primary key,
  name  text not null,
  drawn boolean not null default false,
  order_seq int
);

-- idempotent: tambahkan kolom jika tabel sudah ada dari versi sebelumnya
alter table public.groups add column if not exists order_seq int;

create table if not exists public.group_members (
  group_id       bigint not null references public.groups(id) on delete cascade,
  participant_id bigint not null references public.participants(id) on delete cascade,
  primary key (group_id, participant_id)
);

alter table public.participants  enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- ---------- RPC ----------

-- Ganti seluruh daftar peserta (roster).
create or replace function public.save_participants(names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members where true;
  delete from public.participants where true;
  insert into public.participants (name)
  select distinct trim(nm)
  from unnest(names) nm
  where trim(nm) <> '';
end;
$$;

create or replace function public.get_participants()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
  from public.participants;
$$;

-- Ganti seluruh daftar grup (menghapus anggota grup yang lama).
create or replace function public.save_groups(names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members where true;
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
      'id',       g.id,
      'name',     g.name,
      'drawn',    g.drawn,
      'order_seq', g.order_seq,
      'memberIds', coalesce((
        select jsonb_agg(m.participant_id order by m.participant_id)
        from public.group_members m
        where m.group_id = g.id), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(p.name order by p.name)
        from public.group_members m
        join public.participants p on p.id = m.participant_id
        where m.group_id = g.id), '[]'::jsonb)
    ) order by g.id), '[]'::jsonb)
  from public.groups g;
$$;

-- Atur daftar peserta sebuah grup oleh admin.
create or replace function public.set_group_participants(p_group_id bigint, p_participant_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members where group_id = p_group_id;
  insert into public.group_members (group_id, participant_id)
  select p_group_id, pid
  from unnest(p_participant_ids) pid;
end;
$$;

-- Undi grup berikutnya (acak dari yang belum diundi).
-- - Grup yang sudah diatur admin: kembalikan nama + daftar pesertanya.
-- - Grup belum diatur: sisa roster dibagi rata secara acak ke SEMUA grup
--   yang belum diundi sekaligus, lalu grup terpilih mengembalikan porsinya.
-- - Jika semua grup sudah diundi: done = true.
create or replace function public.draw_group()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g         public.groups%rowtype;
  unset_ids bigint[];
  k         int;
  avail_ids bigint[];
  base      int;
  rem       int;
  start_i   int;
  chunk     bigint[];
  i         int;
  member_ns text[];
begin
  select * into g
  from public.groups
  where not drawn
  order by random()
  limit 1;

  if g.id is null then
    return jsonb_build_object('done', true);
  end if;

  -- grup yang sudah diatur admin -> langsung kembalikan hasilnya
  select array_agg(p.name order by p.name) into member_ns
  from public.group_members m
  join public.participants p on p.id = m.participant_id
  where m.group_id = g.id;

  if member_ns is not null then
    update public.groups
    set drawn = true,
        order_seq = (select coalesce(max(order_seq), 0) + 1 from public.groups where drawn)
    where id = g.id;
    return jsonb_build_object(
      'id', g.id, 'name', g.name, 'members', member_ns, 'done', false,
      'order', (select coalesce(max(order_seq), 0) from public.groups where drawn)
    );
  end if;

  -- semua grup yang belum diundi (termasuk g) + sisa roster bebas
  select array_agg(id order by random()) into unset_ids
  from public.groups
  where not drawn;

  select array_agg(p.id order by random()) into avail_ids
  from public.participants p
  where not exists (
    select 1 from public.group_members m where m.participant_id = p.id
  );

  k := coalesce(array_length(unset_ids, 1), 0);
  if avail_ids is null then avail_ids := '{}'::bigint[]; end if;
  base := 0; rem := 0;
  if k > 0 then
    base := array_length(avail_ids, 1) / k;
    rem  := array_length(avail_ids, 1) % k;
  end if;

  start_i := 0;
  for i in 1..k loop
    chunk := avail_ids[(start_i + 1) : (start_i + base + (i <= rem)::int)];
    start_i := start_i + base + (i <= rem)::int;
    insert into public.group_members (group_id, participant_id)
    select unset_ids[i], a
    from unnest(chunk) a;
  end loop;

  update public.groups
  set drawn = true,
      order_seq = (select coalesce(max(order_seq), 0) + 1 from public.groups where drawn)
  where id = g.id;

  select array_agg(p.name order by p.name) into member_ns
  from public.group_members m
  join public.participants p on p.id = m.participant_id
  where m.group_id = g.id;

  if member_ns is null then member_ns := '{}'::text[]; end if;

  return jsonb_build_object(
    'id',      g.id,
    'name',    g.name,
    'members', member_ns,
    'done',    false,
    'order',   (select coalesce(max(order_seq), 0) from public.groups where drawn)
  );
end;
$$;

-- Reset undian grup: semua grup belum diundi, anggota hasil undian dihapus
-- (aturan admin untuk grup yang diatur juga terhapus, daftar grup tetap).
create or replace function public.reset_group_draw()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members where true;
  update public.groups set drawn = false, order_seq = null where true;
end;
$$;

-- Hapus semua data mode 2 (peserta, grup, anggota).
create or replace function public.clear_group_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_members where true;
  delete from public.groups where true;
  delete from public.participants where true;
end;
$$;

-- ---------- AKSES ----------
grant execute on function public.save_participants(text[])     to anon, authenticated;
grant execute on function public.get_participants()            to anon, authenticated;
grant execute on function public.save_groups(text[])           to anon, authenticated;
grant execute on function public.get_groups()                  to anon, authenticated;
grant execute on function public.set_group_participants(bigint, bigint[]) to anon, authenticated;
grant execute on function public.draw_group()                  to anon, authenticated;
grant execute on function public.reset_group_draw()            to anon, authenticated;
grant execute on function public.clear_group_data()            to anon, authenticated;