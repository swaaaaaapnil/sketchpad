-- Owner-only: how many people joined through the share link.
create or replace function public.board_member_count(b uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case when exists (select 1 from boards where id = b and owner = auth.uid())
    then (select count(*)::int from board_members where board_id = b)
    else 0 end;
$$;
revoke all on function public.board_member_count(uuid) from public, anon;
grant execute on function public.board_member_count(uuid) to authenticated;
