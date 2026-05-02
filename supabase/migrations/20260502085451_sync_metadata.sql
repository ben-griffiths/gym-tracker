-- Sync metadata for offline-first / multi-device merge.
--
-- Adds three pieces to every user-mutable table:
--   * deleted_at   timestamptz  -- soft-delete tombstone (null = live row)
--   * client_updated_at timestamptz -- wall-clock at which the latest mutation
--                                       was authored on a device. Used as the
--                                       LWW key during sync.
--   * updated_at on set_entries (was missing) + trigger.

-- 1. set_entries gets updated_at + trigger.
alter table public.set_entries
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists set_set_entries_updated_at on public.set_entries;
create trigger set_set_entries_updated_at
before update on public.set_entries
for each row execute function public.set_updated_at();

-- 2. deleted_at + client_updated_at on every mutable table.
alter table public.workout_groups
  add column if not exists deleted_at timestamptz,
  add column if not exists client_updated_at timestamptz;

alter table public.workout_sessions
  add column if not exists deleted_at timestamptz,
  add column if not exists client_updated_at timestamptz;

alter table public.exercises
  add column if not exists deleted_at timestamptz,
  add column if not exists client_updated_at timestamptz;

alter table public.session_exercises
  add column if not exists deleted_at timestamptz,
  add column if not exists client_updated_at timestamptz;

alter table public.set_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists client_updated_at timestamptz;

-- 3. Indexes used by /api/sync/pull.
create index if not exists workout_groups_user_updated_idx
  on public.workout_groups(user_id, updated_at);
create index if not exists workout_sessions_user_updated_idx
  on public.workout_sessions(user_id, updated_at);
create index if not exists exercises_user_updated_idx
  on public.exercises(user_id, updated_at);
create index if not exists session_exercises_user_updated_idx
  on public.session_exercises(user_id, updated_at);
create index if not exists set_entries_user_updated_idx
  on public.set_entries(user_id, updated_at);
