-- Live collaboration v2.
-- Edits travel peer to peer over a private Realtime broadcast channel ("live:<board>"),
-- so they show up for everyone right away. The database only receives batched
-- changes (a few per second at most) through save_board_ops, which merges them per
-- shape on the server, so two editors never overwrite each other's work.

-- 1) Who may use the live channel: everyone on the board listens, only owners and
--    editors send edits.
drop policy if exists "live_board_read" on realtime.messages;
create policy "live_board_read" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() ~ '^live:[0-9a-f-]{36}$'
    and public.board_role(substr(realtime.topic(), 6)::uuid) is not null
  );
drop policy if exists "live_board_write" on realtime.messages;
create policy "live_board_write" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() ~ '^live:[0-9a-f-]{36}$'
    and public.board_role(substr(realtime.topic(), 6)::uuid) in ('owner', 'edit')
  );

-- 2) A version number that goes up on every save. Peers use it to notice a missed edit.
alter table public.boards add column if not exists version bigint not null default 0;
grant select (version) on public.boards to authenticated;

-- 3) Rate limit: a token bucket per user per board (burst of 20 saves, refills 2 per second).
create table if not exists public.save_quota (
  user_id  uuid not null references auth.users (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  tokens   real not null,
  at       timestamptz not null default now(),
  primary key (user_id, board_id)
);
alter table public.save_quota enable row level security;
revoke all on public.save_quota from anon, authenticated;
create index if not exists save_quota_board_idx on public.save_quota (board_id);

-- 4) Save a batch of changes. up = shapes added or changed (matched by "id"),
--    del = ids removed, ord = full id order when shapes were reordered.
--    Raises SQLSTATE PT429 (HTTP 429) when the caller saves too fast.
create or replace function public.save_board_ops(
  b uuid,
  up jsonb default '[]'::jsonb,
  del text[] default '{}',
  ord text[] default null,
  new_title text default null,
  new_dark boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r text;
  t real;
  cur jsonb;
  merged jsonb;
  v bigint;
  ts timestamptz;
begin
  r := public.board_role(b);
  if r is null or r not in ('owner', 'edit') then
    raise exception 'You cannot edit this sketch' using errcode = 'insufficient_privilege';
  end if;
  up := coalesce(up, '[]'::jsonb);
  del := coalesce(del, '{}');
  if jsonb_typeof(up) <> 'array' or jsonb_array_length(up) > 5000
     or cardinality(del) > 5000 or coalesce(cardinality(ord), 0) > 10000 then
    raise exception 'Too many changes in one save' using errcode = 'check_violation';
  end if;

  insert into public.save_quota as q (user_id, board_id, tokens, at)
    values (auth.uid(), b, 20, now())
    on conflict (user_id, board_id) do update
      set tokens = least(20, q.tokens + extract(epoch from now() - q.at)::real * 2), at = now()
    returning tokens into t;
  if t < 1 then
    raise exception 'Saving too fast' using errcode = 'PT429';
  end if;
  update public.save_quota set tokens = t - 1 where user_id = auth.uid() and board_id = b;

  select shapes into cur from public.boards where id = b for update;
  if not found then
    raise exception 'Board not found' using errcode = 'no_data_found';
  end if;

  with u as (
    select e, e ->> 'id' as id
    from jsonb_array_elements(up) e
    where jsonb_typeof(e) = 'object' and e ? 'id'
  ),
  old as (
    select e, e ->> 'id' as id, i
    from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) with ordinality x(e, i)
  ),
  m as (
    select coalesce(u.e, old.e) as e, old.id, old.i::numeric as pos
    from old left join u on u.id = old.id
    where old.id is null or not (old.id = any (del))
    union all
    select u.e, u.id, 1000000000 + row_number() over ()
    from u
    where not exists (select 1 from old where old.id = u.id) and not (u.id = any (del))
  )
  select coalesce(jsonb_agg(e order by array_position(ord, id) nulls last, pos), '[]'::jsonb)
    into merged from m;

  update public.boards
     set shapes = merged,
         title = coalesce(left(nullif(btrim(new_title), ''), 120), title),
         dark = coalesce(new_dark, dark),
         version = version + 1
   where id = b
   returning version, updated_at into v, ts;

  return jsonb_build_object('version', v, 'updated_at', ts);
end $$;

revoke all on function public.save_board_ops(uuid, jsonb, text[], text[], text, boolean) from public, anon;
grant execute on function public.save_board_ops(uuid, jsonb, text[], text[], text, boolean) to authenticated;

-- 5) Full-row change events are no longer needed (edits go over broadcast), and they
--    sent the whole board to every subscriber on every save. Stop publishing them.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'boards') then
    alter publication supabase_realtime drop table public.boards;
  end if;
end $$;

-- 6) All edits go through save_board_ops (role check + rate limit), so clients no
--    longer update rows directly.
revoke update on public.boards from anon, authenticated;
