create extension if not exists pgcrypto;

create table if not exists public.workout_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, slug)
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_group_id uuid references public.workout_groups(id) on delete set null,
  name text not null,
  notes text,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'PAUSED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, name)
);

create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  custom_exercise_name text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.set_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_number integer not null,
  reps integer,
  weight numeric(6, 2),
  weight_unit text not null default 'kg',
  rir integer,
  rpe numeric(3, 1),
  feel text,
  is_warmup boolean not null default false,
  notes text,
  logged_at timestamptz not null default timezone('utc', now()),
  source text not null default 'manual'
);

create table if not exists public.vision_detections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_exercise_id uuid references public.session_exercises(id) on delete set null,
  image_url text,
  image_base64 text,
  candidates jsonb not null,
  selected_exercise text,
  selected_weight numeric(6, 2),
  selected_weight_unit text not null default 'kg',
  confidence numeric(5, 4),
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED')),
  model text not null,
  raw_response jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists workout_groups_user_id_idx on public.workout_groups(user_id);
create index if not exists workout_groups_updated_at_idx on public.workout_groups(updated_at desc);

create index if not exists workout_sessions_user_id_idx on public.workout_sessions(user_id);
create index if not exists workout_sessions_group_id_idx on public.workout_sessions(workout_group_id);
create index if not exists workout_sessions_status_idx on public.workout_sessions(status);

create index if not exists exercises_user_id_name_idx on public.exercises(user_id, name);
create index if not exists exercises_aliases_gin_idx on public.exercises using gin (aliases);

create index if not exists session_exercises_session_order_idx on public.session_exercises(session_id, order_index);
create index if not exists session_exercises_exercise_id_idx on public.session_exercises(exercise_id);

create index if not exists set_entries_session_exercise_number_idx on public.set_entries(session_exercise_id, set_number);
create index if not exists set_entries_logged_at_idx on public.set_entries(logged_at);

create index if not exists vision_detections_session_exercise_idx on public.vision_detections(session_exercise_id);
create index if not exists vision_detections_status_idx on public.vision_detections(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_workout_groups_updated_at on public.workout_groups;
create trigger set_workout_groups_updated_at
before update on public.workout_groups
for each row execute function public.set_updated_at();

drop trigger if exists set_workout_sessions_updated_at on public.workout_sessions;
create trigger set_workout_sessions_updated_at
before update on public.workout_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_exercises_updated_at on public.exercises;
create trigger set_exercises_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

drop trigger if exists set_session_exercises_updated_at on public.session_exercises;
create trigger set_session_exercises_updated_at
before update on public.session_exercises
for each row execute function public.set_updated_at();

drop trigger if exists set_vision_detections_updated_at on public.vision_detections;
create trigger set_vision_detections_updated_at
before update on public.vision_detections
for each row execute function public.set_updated_at();

alter table public.workout_groups enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.exercises enable row level security;
alter table public.session_exercises enable row level security;
alter table public.set_entries enable row level security;
alter table public.vision_detections enable row level security;

create policy "workout_groups_select_own"
on public.workout_groups
for select
using (auth.uid() = user_id);

create policy "workout_groups_insert_own"
on public.workout_groups
for insert
with check (auth.uid() = user_id);

create policy "workout_groups_update_own"
on public.workout_groups
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workout_groups_delete_own"
on public.workout_groups
for delete
using (auth.uid() = user_id);

create policy "workout_sessions_select_own"
on public.workout_sessions
for select
using (auth.uid() = user_id);

create policy "workout_sessions_insert_own"
on public.workout_sessions
for insert
with check (auth.uid() = user_id);

create policy "workout_sessions_update_own"
on public.workout_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workout_sessions_delete_own"
on public.workout_sessions
for delete
using (auth.uid() = user_id);

create policy "exercises_select_own"
on public.exercises
for select
using (auth.uid() = user_id);

create policy "exercises_insert_own"
on public.exercises
for insert
with check (auth.uid() = user_id);

create policy "exercises_update_own"
on public.exercises
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "exercises_delete_own"
on public.exercises
for delete
using (auth.uid() = user_id);

create policy "session_exercises_select_own"
on public.session_exercises
for select
using (auth.uid() = user_id);

create policy "session_exercises_insert_own"
on public.session_exercises
for insert
with check (auth.uid() = user_id);

create policy "session_exercises_update_own"
on public.session_exercises
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "session_exercises_delete_own"
on public.session_exercises
for delete
using (auth.uid() = user_id);

create policy "set_entries_select_own"
on public.set_entries
for select
using (auth.uid() = user_id);

create policy "set_entries_insert_own"
on public.set_entries
for insert
with check (auth.uid() = user_id);

create policy "set_entries_update_own"
on public.set_entries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "set_entries_delete_own"
on public.set_entries
for delete
using (auth.uid() = user_id);

create policy "vision_detections_select_own"
on public.vision_detections
for select
using (auth.uid() = user_id);

create policy "vision_detections_insert_own"
on public.vision_detections
for insert
with check (auth.uid() = user_id);

create policy "vision_detections_update_own"
on public.vision_detections
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "vision_detections_delete_own"
on public.vision_detections
for delete
using (auth.uid() = user_id);
