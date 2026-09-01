-- DayFlow — database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query).
--
-- The server stores ciphertext and nothing else. There is deliberately no
-- title, priority, due date or person column: those live inside the encrypted
-- blob, so a database dump reveals only how many tasks exist and when they
-- changed. DayFlow cannot read your tasks, and neither can Supabase.

create table if not exists tasks (
  -- Client-generated, so a task keeps its identity across devices without a
  -- round trip to the server before it can be saved offline.
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- AES-256 blob: the whole task, encrypted on the device.
  ciphertext  text not null,

  -- Used for last-write-wins merging. Set by the client, because the device
  -- that made the edit is the one that knows when it happened.
  updated_at  timestamptz not null default now(),

  -- Tombstone. A deleted task is kept as a flagged row so a device that was
  -- offline during the delete does not resurrect it on its next push.
  deleted     boolean not null default false,

  created_at  timestamptz not null default now()
);

create index if not exists idx_tasks_user on tasks(user_id);
create index if not exists idx_tasks_user_updated on tasks(user_id, updated_at desc);

alter table tasks enable row level security;

-- Every policy is scoped to auth.uid(), so the anon key shipped in the app
-- bundle cannot read or write anyone else's rows.
drop policy if exists "read own tasks" on tasks;
create policy "read own tasks" on tasks
  for select using (auth.uid() = user_id);

drop policy if exists "insert own tasks" on tasks;
create policy "insert own tasks" on tasks
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own tasks" on tasks;
create policy "update own tasks" on tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own tasks" on tasks;
create policy "delete own tasks" on tasks
  for delete using (auth.uid() = user_id);

-- Housekeeping: drop tombstones once every device has certainly seen them.
-- Optional — schedule it from Supabase's cron extension if you like.
create or replace function purge_old_tombstones() returns void
language sql security definer as $$
  delete from tasks where deleted and updated_at < now() - interval '90 days';
$$;

-- ---------------------------------------------------------------------------
-- Vault records: the data key, wrapped twice.
--
-- Both columns are ciphertext. The server holds them so a newly signed-in
-- device can obtain the data key, and can read neither — one is sealed by the
-- key your password derives, the other by a recovery code only you hold.
create table if not exists vaults (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  version             integer not null default 1,
  wrapped_by_password text not null,
  wrapped_by_recovery text not null,
  updated_at          timestamptz not null default now()
);

alter table vaults enable row level security;

drop policy if exists "read own vault" on vaults;
create policy "read own vault" on vaults
  for select using (auth.uid() = user_id);

drop policy if exists "insert own vault" on vaults;
create policy "insert own vault" on vaults
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own vault" on vaults;
create policy "update own vault" on vaults
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Account deletion.
--
-- App Store Guideline 5.1.1(v) requires any app offering account creation to
-- offer deletion from inside the app. Removing a row from auth.users normally
-- needs the service_role key, which must never ship in a client bundle — so
-- this runs as the function owner instead, and can only ever delete the caller.
--
-- security definer is a loaded gun, so: search_path is pinned (an unqualified
-- name could otherwise be captured by a schema the caller controls), auth.uid()
-- is the only thing that decides what gets deleted, and execute is granted to
-- authenticated users alone rather than to anon or public.
create or replace function delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Both cascade from auth.users, but deleting them explicitly keeps the
  -- function correct even if that constraint is ever changed.
  delete from public.tasks  where user_id = auth.uid();
  delete from public.vaults where user_id = auth.uid();
  delete from auth.users    where id = auth.uid();
end;
$$;

revoke all on function delete_own_account() from public;
revoke all on function delete_own_account() from anon;
grant execute on function delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime.
--
-- Devices subscribe to changes on tasks rather than polling. Row Level Security
-- still applies to the stream, so a subscriber only ever receives their own
-- rows — and those rows are ciphertext, so the notification carries nothing
-- readable either way. It is only a signal to go and merge.
alter publication supabase_realtime add table tasks;
