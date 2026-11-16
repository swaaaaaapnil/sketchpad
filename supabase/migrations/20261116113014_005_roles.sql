-- Lean sharing v2: signed-in owners share a board with a "view" link and/or an
-- "edit" link. Tokens live in their own table that no client role can read, so
-- they never appear in board reads or realtime payloads. Guests (anonymous
-- users) can open view links; edit links and sharing need a real account.

-- 1) Tokens move out of boards into a locked table.
create table if not exists public.board_links (
  board_id   uuid not null references public.boards (id) on delete cascade,
  role       text not null check (role in ('view', 'edit')),
  token      text not null unique,
  created_at timestamptz not null default now(),
  primary key (board_id, role)
);
alter table public.board_links enable row level security;
revoke all on public.board_links from anon, authenticated;
-- No policies on purpose: only the security-definer functions below touch it.

insert into public.board_links (board_id, role, token)
  select id, 'edit', share_token from public.boards where share_token is not null
  on conflict do nothing;

-- 2) Members get a role.
alter table public.board_members add column if not exists role text not null default 'edit'
  check (role in ('view', 'edit'));

-- 3) Helpers.
create or replace function public.is_real_user() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- 'owner' | 'edit' | 'view' | null for the current user.
create or replace function public.board_role(b uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.boards where id = b and owner = auth.uid()) then 'owner'
    else (select m.role from public.board_members m where m.board_id = b and m.user_id = auth.uid())
  end;
$$;
revoke all on function public.board_role(uuid) from public, anon;
grant execute on function public.board_role(uuid) to authenticated;
revoke all on function public.is_real_user() from public, anon;
grant execute on function public.is_real_user() to authenticated;

-- 4) Only owners and editors may update; viewers can only read.
drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_own" on public.boards
  for update to authenticated
  using (owner = (select auth.uid()) or public.board_role(id) = 'edit')
  with check (owner = (select auth.uid()) or public.board_role(id) = 'edit');

create or replace function public.guard_board_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.owner <> auth.uid() and new.owner is distinct from old.owner then
    raise exception 'Only the owner can change ownership' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- 5) Drop the old single-token design.
drop function if exists public.enable_board_share(uuid);
drop function if exists public.disable_board_share(uuid);
drop function if exists public.get_board_share(uuid);
drop function if exists public.join_board(uuid, text);
drop function if exists public.board_member_count(uuid);
alter table public.boards drop column if exists share_token;

-- 6) Owner RPCs (real accounts only).
-- Current links: {"view": token|null, "edit": token|null, "people": n}
create or replace function public.get_share(b uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Board not found' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'view', (select token from public.board_links where board_id = b and role = 'view'),
    'edit', (select token from public.board_links where board_id = b and role = 'edit'),
    'people', (select count(*) from public.board_members where board_id = b)
  );
end $$;

create or replace function public.enable_share(b uuid, r text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if not public.is_real_user() then
    raise exception 'Sign in to share' using errcode = 'insufficient_privilege';
  end if;
  if r not in ('view', 'edit') then raise exception 'Bad role'; end if;
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Board not found' using errcode = 'no_data_found';
  end if;
  select token into t from public.board_links where board_id = b and role = r;
  if t is null then
    t := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.board_links (board_id, role, token) values (b, r, t);
  end if;
  return t;
end $$;

-- Turning a link off also removes the people who joined with that role.
create or replace function public.disable_share(b uuid, r text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.boards where id = b and owner = auth.uid()) then
    raise exception 'Board not found' using errcode = 'no_data_found';
  end if;
  delete from public.board_links where board_id = b and role = r;
  delete from public.board_members where board_id = b and role = r;
end $$;

-- 7) Opening a link. Returns 'owner' | 'edit' | 'view', 'signin' when an edit
-- link is opened by a guest, or null when the link is not valid.
create or replace function public.join_board(b uuid, token text) returns text
language plpgsql security definer set search_path = '' as $$
declare r text; cur text;
begin
  if auth.uid() is null then return null; end if;
  select l.role into r from public.board_links l where l.board_id = b and l.token = join_board.token;
  if r is null then return null; end if;
  cur := public.board_role(b);
  if cur in ('owner', 'edit') then return cur; end if;
  if r = 'edit' and not public.is_real_user() then return 'signin'; end if;
  insert into public.board_members (board_id, user_id, role) values (b, auth.uid(), r)
    on conflict (board_id, user_id) do update set role = excluded.role
    where public.board_members.role = 'view';
  return r;
end $$;

revoke all on function public.get_share(uuid), public.enable_share(uuid, text),
  public.disable_share(uuid, text), public.join_board(uuid, text) from public, anon;
grant execute on function public.get_share(uuid), public.enable_share(uuid, text),
  public.disable_share(uuid, text), public.join_board(uuid, text) to authenticated;

-- 8) Board column grants (share_token is gone, so a plain grant again).
grant select (id, owner, title, shapes, dark, created_at, updated_at) on public.boards to authenticated;

-- 9) Presence channels "presence:<board id>" are private: only people on the board.
drop policy if exists "presence_board_read" on realtime.messages;
create policy "presence_board_read" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() ~ '^presence:[0-9a-f-]{36}$'
    and public.board_role(substr(realtime.topic(), 10)::uuid) is not null
  );
drop policy if exists "presence_board_write" on realtime.messages;
create policy "presence_board_write" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() ~ '^presence:[0-9a-f-]{36}$'
    and public.board_role(substr(realtime.topic(), 10)::uuid) is not null
  );
