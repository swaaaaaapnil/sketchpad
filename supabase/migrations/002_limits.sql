-- Abuse guards for a public deployment with anonymous sign-ins.
-- 1) A single board's shapes may not exceed ~2 MB.
-- 2) Each user may keep at most 200 boards.

alter table public.boards drop constraint if exists boards_shapes_size;
alter table public.boards add constraint boards_shapes_size
  check (pg_column_size(shapes) < 2000000);

create or replace function public.enforce_board_quota() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.boards where owner = new.owner) >= 200 then
    raise exception 'Board limit reached (200). Delete some sketches to make room.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists boards_quota on public.boards;
create trigger boards_quota before insert on public.boards
  for each row execute function public.enforce_board_quota();
