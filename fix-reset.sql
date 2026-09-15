create or replace function public.reset_pool(new_total int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i int;
begin
  if new_total is null or new_total < 1 then
    raise exception 'total must be >= 1';
  end if;

  delete from public.override_queue where true;
  delete from public.history where true;
  delete from public.pool where true;

  for i in 1..new_total loop
    insert into public.pool (number) values (i);
  end loop;

  insert into public.settings (key, value)
  values ('total', new_total::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;

grant execute on function public.reset_pool(int) to anon, authenticated;