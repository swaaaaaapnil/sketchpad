-- Shareable edit links. The owner turns on a secret share token; anyone who opens
-- the link (board id + token) is added as a collaborator and can read and edit the
-- board. Only the owner can delete the board, change its link or see the token.

alter table public.boards add column if not exists share_token text unique;

create table if not exists public.board_members (
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_members_user_idx on public.board_members (user_id);
alter table public.board_members enable row level security;

-- Members can see their own memberships; rows are only written by join_board().
drop policy if exists "members_select_own" on public.board_members;
create policy "members_select_own" on public.board_members
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "members_leave" on public.board_members;
create policy "members_leave" on public.board_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- Helper used by the boards policies (security definer avoids policy recursion).
create or replace function public.is_board_member(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.board_members m where m.board_id = b and m.user_id = auth.uid());
$$;
revoke all on function public.is_board_member(uuid) from public, anon;
grant execute on function public.is_board_member(uuid) to authenticated;

drop policy if exists "boards_select_own" on public.boards;
create policy "boards_select_own" on public.boards
  for select to authenticated using (owner = (select auth.uid()) or public.is_board_member(id));

drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_own" on public.boards
  for update to authenticated
  using (owner = (select auth.uid()) or public.is_board_member(id))
  with check (owner = (select auth.uid()) or public.is_board_member(id));

-- Collaborators may edit content but never take over ownership or the share link.
create or replace function public.guard_board_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.owner <> auth.uid() then
    if new.owner is distinct from old.owner or new.share_token is distinct from old.share_token then
      raise exception 'Only the owner can change sharing' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists boards_guard on public.boards;
create trigger boards_guard before update on public.boards
  for each row execute function public.guard_board_update();

-- Owner: create (or replace) the share token. Returns the new token.
create or replace function public.enable_board_share(b uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  update public.boards set share_token = t where id = b and owner = auth.uid();
  if not found then raise exception 'Board not found' using errcode = 'no_data_found'; end if;
  return t;
end $$;

-- Owner: turn the link off and remove everyone who joined through it.
create or replace function public.disable_board_share(b uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.boards set share_token = null where id = b and owner = auth.uid();
  if not found then raise exception 'Board not found' using errcode = 'no_data_found'; end if;
  delete from public.board_members where board_id = b;
end $$;

-- Owner: read the current token (null when sharing is off).
create or replace function public.get_board_share(b uuid) returns text
language sql stable security definer set search_path = '' as $$
  select share_token from public.boards where id = b and owner = auth.uid();
$$;

-- Anyone signed in with the right token joins the board as a collaborator.
create or replace function public.join_board(b uuid, token text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from public.boards where id = b and share_token is not null and share_token = token) then
    return false;
  end if;
  insert into public.board_members (board_id, user_id)
    select b, auth.uid() where not exists (select 1 from public.boards where id = b and owner = auth.uid())
    on conflict do nothing;
  return true;
end $$;

revoke all on function public.enable_board_share(uuid), public.disable_board_share(uuid),
  public.get_board_share(uuid), public.join_board(uuid, text) from public, anon;
grant execute on function public.enable_board_share(uuid), public.disable_board_share(uuid),
  public.get_board_share(uuid), public.join_board(uuid, text) to authenticated;

-- Keep the token out of normal reads by collaborators: column grant excludes it.
revoke select on public.boards from authenticated;
grant select (id, owner, title, shapes, dark, created_at, updated_at) on public.boards to authenticated;

-- Live updates for people editing the same board.
alter table public.boards replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.boards;
exception when duplicate_object then null; end $$;
