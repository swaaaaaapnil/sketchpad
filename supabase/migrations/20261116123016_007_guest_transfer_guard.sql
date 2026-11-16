-- Let finish_guest_transfer change a board's owner past the guard trigger, using a
-- transaction-local flag that only this security-definer function sets.
create or replace function public.guard_board_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.owner <> auth.uid() and new.owner is distinct from old.owner
     and coalesce(current_setting('sketchpad.guest_transfer', true), '') <> 'on' then
    raise exception 'Only the owner can change ownership' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create or replace function public.finish_guest_transfer(t text) returns integer
language plpgsql security definer set search_path = '' as $$
declare g uuid; n integer;
begin
  if not public.is_real_user() then return 0; end if;
  delete from public.guest_transfers
    where token = t and created_at > now() - interval '1 day'
    returning guest_id into g;
  if g is null or g = auth.uid() then return 0; end if;
  update public.board_members m set user_id = auth.uid()
    where m.user_id = g
      and not exists (select 1 from public.board_members x where x.board_id = m.board_id and x.user_id = auth.uid());
  delete from public.board_members where user_id = g;
  perform set_config('sketchpad.guest_transfer', 'on', true);
  update public.boards set owner = auth.uid() where owner = g;
  get diagnostics n = row_count;
  perform set_config('sketchpad.guest_transfer', 'off', true);
  delete from public.board_members m using public.boards b
    where b.id = m.board_id and b.owner = auth.uid() and m.user_id = auth.uid();
  return n;
end $$;
revoke all on function public.finish_guest_transfer(text) from public, anon;
grant execute on function public.finish_guest_transfer(text) to authenticated;
