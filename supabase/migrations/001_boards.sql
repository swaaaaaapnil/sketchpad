-- Sketchpad boards. Each row belongs to the (anonymous or real) auth user that made it.
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'Untitled sketch' check (char_length(title) <= 120),
  shapes      jsonb not null default '[]'::jsonb check (jsonb_typeof(shapes) = 'array'),
  dark        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists boards_owner_updated_idx on public.boards (owner, updated_at desc);

-- Keep updated_at honest on every write.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists boards_touch on public.boards;
create trigger boards_touch before update on public.boards
  for each row execute function public.touch_updated_at();

-- Row level security: you only ever see and change your own boards.
alter table public.boards enable row level security;

drop policy if exists "boards_select_own" on public.boards;
create policy "boards_select_own" on public.boards
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "boards_insert_own" on public.boards;
create policy "boards_insert_own" on public.boards
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_own" on public.boards
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "boards_delete_own" on public.boards;
create policy "boards_delete_own" on public.boards
  for delete to authenticated using (owner = (select auth.uid()));
