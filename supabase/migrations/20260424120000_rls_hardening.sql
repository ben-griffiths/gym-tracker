-- Harden RLS: ensure users can only link rows to their own workouts (not just matching user_id on the row).
-- Safe to re-apply: drops prior policy names from init migration, then recreates stricter rules.

-- workout_groups (unchanged semantics, recreate for idempotency)
drop policy if exists "workout_groups_select_own" on public.workout_groups;
drop policy if exists "workout_groups_insert_own" on public.workout_groups;
drop policy if exists "workout_groups_update_own" on public.workout_groups;
drop policy if exists "workout_groups_delete_own" on public.workout_groups;

create policy "workout_groups_select_own"
  on public.workout_groups for select
  using (auth.uid() = user_id);

create policy "workout_groups_insert_own"
  on public.workout_groups for insert
  with check (auth.uid() = user_id);

create policy "workout_groups_update_own"
  on public.workout_groups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workout_groups_delete_own"
  on public.workout_groups for delete
  using (auth.uid() = user_id);

-- workout_sessions: workout_group_id must belong to the same user when set
drop policy if exists "workout_sessions_select_own" on public.workout_sessions;
drop policy if exists "workout_sessions_insert_own" on public.workout_sessions;
drop policy if exists "workout_sessions_update_own" on public.workout_sessions;
drop policy if exists "workout_sessions_delete_own" on public.workout_sessions;

create policy "workout_sessions_select_own"
  on public.workout_sessions for select
  using (auth.uid() = user_id);

create policy "workout_sessions_insert_own"
  on public.workout_sessions for insert
  with check (
    auth.uid() = user_id
    and (
      workout_group_id is null
      or exists (
        select 1
        from public.workout_groups wg
        where wg.id = workout_group_id
          and wg.user_id = auth.uid()
      )
    )
  );

create policy "workout_sessions_update_own"
  on public.workout_sessions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      workout_group_id is null
      or exists (
        select 1
        from public.workout_groups wg
        where wg.id = workout_group_id
          and wg.user_id = auth.uid()
      )
    )
  );

create policy "workout_sessions_delete_own"
  on public.workout_sessions for delete
  using (auth.uid() = user_id);

-- exercises
drop policy if exists "exercises_select_own" on public.exercises;
drop policy if exists "exercises_insert_own" on public.exercises;
drop policy if exists "exercises_update_own" on public.exercises;
drop policy if exists "exercises_delete_own" on public.exercises;

create policy "exercises_select_own"
  on public.exercises for select
  using (auth.uid() = user_id);

create policy "exercises_insert_own"
  on public.exercises for insert
  with check (auth.uid() = user_id);

create policy "exercises_update_own"
  on public.exercises for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "exercises_delete_own"
  on public.exercises for delete
  using (auth.uid() = user_id);

-- session_exercises: session must belong to the same user
drop policy if exists "session_exercises_select_own" on public.session_exercises;
drop policy if exists "session_exercises_insert_own" on public.session_exercises;
drop policy if exists "session_exercises_update_own" on public.session_exercises;
drop policy if exists "session_exercises_delete_own" on public.session_exercises;

create policy "session_exercises_select_own"
  on public.session_exercises for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.workout_sessions ws
      where ws.id = session_id
        and ws.user_id = auth.uid()
    )
    and (
      exercise_id is null
      or exists (
        select 1
        from public.exercises e
        where e.id = exercise_id
          and e.user_id = auth.uid()
      )
    )
  );

create policy "session_exercises_insert_own"
  on public.session_exercises for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.workout_sessions ws
      where ws.id = session_id
        and ws.user_id = auth.uid()
    )
    and (
      exercise_id is null
      or exists (
        select 1
        from public.exercises e
        where e.id = exercise_id
          and e.user_id = auth.uid()
      )
    )
  );

create policy "session_exercises_update_own"
  on public.session_exercises for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.workout_sessions ws
      where ws.id = session_id
        and ws.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.workout_sessions ws
      where ws.id = session_id
        and ws.user_id = auth.uid()
    )
    and (
      exercise_id is null
      or exists (
        select 1
        from public.exercises e
        where e.id = exercise_id
          and e.user_id = auth.uid()
      )
    )
  );

create policy "session_exercises_delete_own"
  on public.session_exercises for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.workout_sessions ws
      where ws.id = session_id
        and ws.user_id = auth.uid()
    )
  );

-- set_entries: session_exercise must belong to the same user
drop policy if exists "set_entries_select_own" on public.set_entries;
drop policy if exists "set_entries_insert_own" on public.set_entries;
drop policy if exists "set_entries_update_own" on public.set_entries;
drop policy if exists "set_entries_delete_own" on public.set_entries;

create policy "set_entries_select_own"
  on public.set_entries for select
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.session_exercises se
      where se.id = session_exercise_id
        and se.user_id = auth.uid()
    )
  );

create policy "set_entries_insert_own"
  on public.set_entries for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.session_exercises se
      where se.id = session_exercise_id
        and se.user_id = auth.uid()
    )
  );

create policy "set_entries_update_own"
  on public.set_entries for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.session_exercises se
      where se.id = session_exercise_id
        and se.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.session_exercises se
      where se.id = session_exercise_id
        and se.user_id = auth.uid()
    )
  );

create policy "set_entries_delete_own"
  on public.set_entries for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.session_exercises se
      where se.id = session_exercise_id
        and se.user_id = auth.uid()
    )
  );

-- vision_detections: optional link to session_exercise must still be owned by user
drop policy if exists "vision_detections_select_own" on public.vision_detections;
drop policy if exists "vision_detections_insert_own" on public.vision_detections;
drop policy if exists "vision_detections_update_own" on public.vision_detections;
drop policy if exists "vision_detections_delete_own" on public.vision_detections;

create policy "vision_detections_select_own"
  on public.vision_detections for select
  using (
    auth.uid() = user_id
    and (
      session_exercise_id is null
      or exists (
        select 1
        from public.session_exercises se
        where se.id = session_exercise_id
          and se.user_id = auth.uid()
      )
    )
  );

create policy "vision_detections_insert_own"
  on public.vision_detections for insert
  with check (
    auth.uid() = user_id
    and (
      session_exercise_id is null
      or exists (
        select 1
        from public.session_exercises se
        where se.id = session_exercise_id
          and se.user_id = auth.uid()
      )
    )
  );

create policy "vision_detections_update_own"
  on public.vision_detections for update
  using (
    auth.uid() = user_id
    and (
      session_exercise_id is null
      or exists (
        select 1
        from public.session_exercises se
        where se.id = session_exercise_id
          and se.user_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() = user_id
    and (
      session_exercise_id is null
      or exists (
        select 1
        from public.session_exercises se
        where se.id = session_exercise_id
          and se.user_id = auth.uid()
      )
    )
  );

create policy "vision_detections_delete_own"
  on public.vision_detections for delete
  using (
    auth.uid() = user_id
    and (
      session_exercise_id is null
      or exists (
        select 1
        from public.session_exercises se
        where se.id = session_exercise_id
          and se.user_id = auth.uid()
      )
    )
  );

alter table public.workout_groups enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.exercises enable row level security;
alter table public.session_exercises enable row level security;
alter table public.set_entries enable row level security;
alter table public.vision_detections enable row level security;
