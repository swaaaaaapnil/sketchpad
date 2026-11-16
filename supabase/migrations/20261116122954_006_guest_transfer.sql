-- When a guest signs in to a Google account that already exists, their user id
-- changes. The guest first asks for a one-time ticket; after signing in, the real
-- account redeems it and the guest's boards move over.
create table if not exists public.guest_transfers (
  token      text primary key,
  guest_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.guest_transfers enable row level security;
revoke all on public.guest_transfers from anon, authenticated;

create or replace function public.start_guest_transfer() returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if auth.uid() is null or public.is_real_user() then return null; end if;
  delete from public.guest_transfers where guest_id = auth.uid() or created_at < now() - interval '1 day';
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.guest_transfers (token, guest_id) values (t, auth.uid());
  return t;
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
  -- Memberships the guest held (view links) carry over unless the account already has one.
  update public.board_members m set user_id = auth.uid()
    where m.user_id = g
      and not exists (select 1 from public.board_members x where x.board_id = m.board_id and x.user_id = auth.uid());
  delete from public.board_members where user_id = g;
  update public.boards set owner = auth.uid() where owner = g;
  get diagnostics n = row_count;
  -- The new owner should not also be listed as a member of their own board.
  delete from public.board_members m using public.boards b
    where b.id = m.board_id and b.owner = auth.uid() and m.user_id = auth.uid();
  return n;
end $$;

revoke all on function public.start_guest_transfer(), public.finish_guest_transfer(text) from public, anon;
grant execute on function public.start_guest_transfer(), public.finish_guest_transfer(text) to authenticated;
