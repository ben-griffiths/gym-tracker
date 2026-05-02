import type { CreateSetInput } from "@/lib/validators/workout";
import type { SupabaseClient } from "@supabase/supabase-js";

type AppSupabaseClient = SupabaseClient;

type WorkoutGroupRow = {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type WorkoutSessionRow = {
  id: string;
  user_id: string;
  workout_group_id: string | null;
  name: string;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  status: "ACTIVE" | "COMPLETED" | "PAUSED";
  created_at: string;
  updated_at: string;
  chat_transcript?: unknown | null;
};

type ExerciseRow = {
  id: string;
  user_id: string;
  name: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

type SessionExerciseRow = {
  id: string;
  user_id: string;
  session_id: string;
  exercise_id: string | null;
  custom_exercise_name: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type SetEntryRow = {
  id: string;
  user_id: string;
  session_exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: string | number | null;
  weight_unit: "kg" | "lb";
  rir: number | null;
  rpe: string | number | null;
  feel: "easy" | "medium" | "hard" | null;
  is_warmup: boolean;
  notes: string | null;
  logged_at: string;
  source: "manual" | "camera" | "chat";
};

function asNumber(value: string | number | null) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapGroup(row: WorkoutGroupRow) {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: WorkoutSessionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    workoutGroupId: row.workout_group_id,
    name: row.name,
    notes: row.notes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chatTranscript: row.chat_transcript ?? null,
  };
}

function mapExercise(row: ExerciseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    aliases: row.aliases ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionExercise(row: SessionExerciseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    customExerciseName: row.custom_exercise_name,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSetEntry(row: SetEntryRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sessionExerciseId: row.session_exercise_id,
    setNumber: row.set_number,
    reps: row.reps,
    weight: asNumber(row.weight),
    weightUnit: row.weight_unit,
    rir: row.rir,
    rpe: asNumber(row.rpe),
    feel: row.feel,
    isWarmup: row.is_warmup,
    notes: row.notes,
    loggedAt: row.logged_at,
    source: row.source,
  };
}

function slugifyGroupName(groupName: string) {
  return groupName.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function listWorkoutGroups(client: AppSupabaseClient, userId: string) {
  const { data: groupsData, error: groupsError } = await client
    .from("workout_groups")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);

  if (groupsError) throw groupsError;
  const groupsRows = (groupsData ?? []) as WorkoutGroupRow[];
  if (groupsRows.length === 0) return [];

  const groupIds = groupsRows.map((row) => row.id);
  const { data: sessionsData, error: sessionsError } = await client
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("workout_group_id", groupIds)
    .order("started_at", { ascending: false });
  if (sessionsError) throw sessionsError;
  const sessionRows = (sessionsData ?? []) as WorkoutSessionRow[];

  const sessionIds = sessionRows.map((row) => row.id);
  let sessionExerciseRows: SessionExerciseRow[] = [];
  if (sessionIds.length > 0) {
    const { data, error } = await client
      .from("session_exercises")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("session_id", sessionIds)
      .order("order_index", { ascending: true });
    if (error) throw error;
    sessionExerciseRows = (data ?? []) as SessionExerciseRow[];
  }

  const exerciseIds = Array.from(
    new Set(
      sessionExerciseRows
        .map((row) => row.exercise_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  let exercisesById = new Map<string, ReturnType<typeof mapExercise>>();
  if (exerciseIds.length > 0) {
    const { data, error } = await client
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("id", exerciseIds);
    if (error) throw error;
    const exerciseRows = (data ?? []) as ExerciseRow[];
    exercisesById = new Map(exerciseRows.map((row) => [row.id, mapExercise(row)]));
  }

  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  let setRows: SetEntryRow[] = [];
  if (sessionExerciseIds.length > 0) {
    const { data, error } = await client
      .from("set_entries")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("session_exercise_id", sessionExerciseIds)
      .order("set_number", { ascending: true });
    if (error) throw error;
    setRows = (data ?? []) as SetEntryRow[];
  }

  const setsBySessionExerciseId = new Map<string, ReturnType<typeof mapSetEntry>[]>();
  for (const row of setRows) {
    const mapped = mapSetEntry(row);
    const existing = setsBySessionExerciseId.get(row.session_exercise_id) ?? [];
    existing.push(mapped);
    setsBySessionExerciseId.set(row.session_exercise_id, existing);
  }

  const sessionExercisesBySessionId = new Map<
    string,
    Array<
      ReturnType<typeof mapSessionExercise> & {
        exercise: ReturnType<typeof mapExercise> | null;
        sets: ReturnType<typeof mapSetEntry>[];
      }
    >
  >();
  for (const row of sessionExerciseRows) {
    const existing = sessionExercisesBySessionId.get(row.session_id) ?? [];
    existing.push({
      ...mapSessionExercise(row),
      exercise: row.exercise_id ? exercisesById.get(row.exercise_id) ?? null : null,
      sets: setsBySessionExerciseId.get(row.id) ?? [],
    });
    sessionExercisesBySessionId.set(row.session_id, existing);
  }

  const sessionsByGroupId = new Map<
    string,
    Array<
      ReturnType<typeof mapSession> & {
        exercises: Array<
          ReturnType<typeof mapSessionExercise> & {
            exercise: ReturnType<typeof mapExercise> | null;
            sets: ReturnType<typeof mapSetEntry>[];
          }
        >;
      }
    >
  >();
  for (const sessionRow of sessionRows) {
    if (!sessionRow.workout_group_id) continue;
    const existing = sessionsByGroupId.get(sessionRow.workout_group_id) ?? [];
    existing.push({
      ...mapSession(sessionRow),
      exercises: sessionExercisesBySessionId.get(sessionRow.id) ?? [],
    });
    sessionsByGroupId.set(sessionRow.workout_group_id, existing);
  }

  return groupsRows.map((groupRow) => ({
    ...mapGroup(groupRow),
    sessions: sessionsByGroupId.get(groupRow.id) ?? [],
  }));
}

export async function createWorkoutSession(
  client: AppSupabaseClient,
  userId: string,
  input: {
    groupName: string;
    sessionName: string;
    notes?: string;
  },
) {
  const slug = slugifyGroupName(input.groupName);
  const { data: groupData, error: groupError } = await client
    .from("workout_groups")
    .upsert(
      {
        user_id: userId,
        slug,
        name: input.groupName,
      },
      { onConflict: "user_id,slug" },
    )
    .select("*")
    .single();
  if (groupError) throw groupError;

  const group = mapGroup(groupData as WorkoutGroupRow);
  const { data: sessionData, error: sessionError } = await client
    .from("workout_sessions")
    .insert({
      user_id: userId,
      workout_group_id: group.id,
      name: input.sessionName,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (sessionError) throw sessionError;

  return {
    group,
    session: mapSession(sessionData as WorkoutSessionRow),
  };
}

export async function updateWorkoutSessionTranscript(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
  chatTranscript: unknown,
) {
  const { data, error } = await client
    .from("workout_sessions")
    .update({ chat_transcript: chatTranscript })
    .eq("user_id", userId)
    .eq("id", sessionId)
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function ensureSessionExercise(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
  exerciseName: string,
) {
  const normalized = exerciseName.trim();
  const key = normalized.toLowerCase();

  const { data: byNameData, error: byNameError } = await client
    .from("exercises")
    .select("*")
    .eq("user_id", userId)
    .ilike("name", normalized)
    .limit(1);
  if (byNameError) throw byNameError;

  let exercise = (byNameData?.[0] as ExerciseRow | undefined) ?? null;
  if (!exercise) {
    const { data: byAliasData, error: byAliasError } = await client
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .contains("aliases", [key])
      .limit(1);
    if (byAliasError) throw byAliasError;
    exercise = (byAliasData?.[0] as ExerciseRow | undefined) ?? null;
  }

  if (!exercise) {
    const { data, error } = await client
      .from("exercises")
      .insert({
        user_id: userId,
        name: normalized,
        aliases: [key],
      })
      .select("*")
      .single();
    if (error) throw error;
    exercise = data as ExerciseRow;
  }

  const { data: sessionExerciseData, error: sessionExerciseError } = await client
    .from("session_exercises")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });
  if (sessionExerciseError) throw sessionExerciseError;

  const sessionExercises = (sessionExerciseData ?? []) as SessionExerciseRow[];

  const existingSessionExercise = sessionExercises.find(
    (item) => item.exercise_id === exercise.id,
  );

  if (existingSessionExercise) {
    return mapSessionExercise(existingSessionExercise);
  }

  const { data: createdSessionExercise, error: createdSessionExerciseError } = await client
    .from("session_exercises")
    .insert({
      user_id: userId,
      session_id: sessionId,
      exercise_id: exercise.id,
      custom_exercise_name: normalized,
      order_index: sessionExercises.length,
    })
    .select("*")
    .single();
  if (createdSessionExerciseError) throw createdSessionExerciseError;

  return mapSessionExercise(createdSessionExercise as SessionExerciseRow);
}

export async function createSetEntry(
  client: AppSupabaseClient,
  userId: string,
  input: CreateSetInput,
) {
  const sessionExercise = await ensureSessionExercise(
    client,
    userId,
    input.sessionId,
    input.exercise,
  );

  const { data: createdSet, error: createdSetError } = await client
    .from("set_entries")
    .insert({
      user_id: userId,
      session_exercise_id: sessionExercise.id,
      set_number: input.setNumber,
      reps: input.reps ?? null,
      weight: input.weight ?? null,
      weight_unit: input.weightUnit,
      source: input.source,
      is_warmup: input.isWarmup ?? false,
      notes: input.notes ?? null,
      rpe: input.rpe ?? null,
      rir: input.rir ?? null,
      feel: input.feel ?? null,
    })
    .select("*")
    .single();
  if (createdSetError) throw createdSetError;

  return mapSetEntry(createdSet as SetEntryRow);
}

type ManySetEntryInput = {
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  rpe?: number | null;
  rir?: number | null;
  feel?: "easy" | "medium" | "hard" | null;
  isWarmup?: boolean;
  notes?: string | null;
};

export async function createManySetEntries(
  client: AppSupabaseClient,
  userId: string,
  input: {
    sessionId: string;
    exercise: string;
    source: CreateSetInput["source"];
    startingSetNumber?: number;
    entries: ManySetEntryInput[];
  },
) {
  if (input.entries.length === 0) return [];

  const sessionExercise = await ensureSessionExercise(
    client,
    userId,
    input.sessionId,
    input.exercise,
  );

  const base = input.startingSetNumber ?? 1;
  const rows = input.entries.map((entry, index) => ({
    user_id: userId,
    session_exercise_id: sessionExercise.id,
    set_number: base + index,
    reps: entry.reps ?? null,
    weight: entry.weight ?? null,
    weight_unit: entry.weightUnit,
    source: input.source,
    is_warmup: entry.isWarmup ?? false,
    notes: entry.notes ?? null,
    rpe: entry.rpe ?? null,
    rir: entry.rir ?? null,
    feel: entry.feel ?? null,
  }));

  const { data, error } = await client.from("set_entries").insert(rows).select("*");
  if (error) throw error;

  const list = (data ?? []) as SetEntryRow[];
  list.sort((a, b) => a.set_number - b.set_number);
  return list.map(mapSetEntry);
}

export async function deleteSetEntry(
  client: AppSupabaseClient,
  userId: string,
  setId: string,
) {
  const { data, error } = await client
    .from("set_entries")
    .delete()
    .eq("user_id", userId)
    .eq("id", setId)
    .select("*")
    .single();
  if (error) throw error;
  return mapSetEntry(data as SetEntryRow);
}

export async function deleteWorkoutSessionById(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
) {
  const { data, error } = await client
    .from("workout_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw error;
  return mapSession(data as WorkoutSessionRow);
}

export async function updateSetEntry(
  client: AppSupabaseClient,
  userId: string,
  setId: string,
  patch: {
    reps?: number | null;
    weight?: number | null;
    weightUnit?: "kg" | "lb";
    rpe?: number | null;
    rir?: number | null;
    feel?: "easy" | "medium" | "hard" | null;
    isWarmup?: boolean;
    notes?: string;
  },
) {
  const updatePayload: Record<string, unknown> = {};
  if (patch.reps !== undefined) updatePayload.reps = patch.reps;
  if (patch.weight !== undefined) updatePayload.weight = patch.weight;
  if (patch.weightUnit !== undefined) updatePayload.weight_unit = patch.weightUnit;
  if (patch.rpe !== undefined) updatePayload.rpe = patch.rpe;
  if (patch.rir !== undefined) updatePayload.rir = patch.rir;
  if (patch.feel !== undefined) updatePayload.feel = patch.feel;
  if (patch.isWarmup !== undefined) updatePayload.is_warmup = patch.isWarmup;
  if (patch.notes !== undefined) updatePayload.notes = patch.notes;

  const { data, error } = await client
    .from("set_entries")
    .update(updatePayload)
    .eq("user_id", userId)
    .eq("id", setId)
    .select("*")
    .single();
  if (error) throw error;
  return mapSetEntry(data as SetEntryRow);
}

export async function getSessionSummary(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
) {
  const { data: sessionData, error: sessionError } = await client
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .single();
  if (sessionError) throw sessionError;

  const sessionRow = sessionData as WorkoutSessionRow;
  let workoutGroup: ReturnType<typeof mapGroup> | null = null;
  if (sessionRow.workout_group_id) {
    const { data: groupData, error: groupError } = await client
      .from("workout_groups")
      .select("*")
      .eq("user_id", userId)
      .eq("id", sessionRow.workout_group_id)
      .single();
    if (groupError) throw groupError;
    workoutGroup = mapGroup(groupData as WorkoutGroupRow);
  }

  const { data: sessionExercisesData, error: sessionExercisesError } = await client
    .from("session_exercises")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });
  if (sessionExercisesError) throw sessionExercisesError;
  const sessionExerciseRows = (sessionExercisesData ?? []) as SessionExerciseRow[];

  const exerciseIds = Array.from(
    new Set(
      sessionExerciseRows
        .map((row) => row.exercise_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  let exercisesById = new Map<string, ReturnType<typeof mapExercise>>();
  if (exerciseIds.length > 0) {
    const { data: exerciseRowsData, error: exerciseError } = await client
      .from("exercises")
      .select("*")
      .eq("user_id", userId)
      .in("id", exerciseIds);
    if (exerciseError) throw exerciseError;
    const exerciseRows = (exerciseRowsData ?? []) as ExerciseRow[];
    exercisesById = new Map(exerciseRows.map((row) => [row.id, mapExercise(row)]));
  }

  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  let setRows: SetEntryRow[] = [];
  if (sessionExerciseIds.length > 0) {
    const { data: setsData, error: setsError } = await client
      .from("set_entries")
      .select("*")
      .eq("user_id", userId)
      .in("session_exercise_id", sessionExerciseIds)
      .order("set_number", { ascending: true });
    if (setsError) throw setsError;
    setRows = (setsData ?? []) as SetEntryRow[];
  }

  const setsBySessionExerciseId = new Map<string, ReturnType<typeof mapSetEntry>[]>();
  for (const row of setRows) {
    const existing = setsBySessionExerciseId.get(row.session_exercise_id) ?? [];
    existing.push(mapSetEntry(row));
    setsBySessionExerciseId.set(row.session_exercise_id, existing);
  }

  return {
    ...mapSession(sessionRow),
    exercises: sessionExerciseRows.map((row) => ({
      ...mapSessionExercise(row),
      exercise: row.exercise_id ? exercisesById.get(row.exercise_id) ?? null : null,
      sets: setsBySessionExerciseId.get(row.id) ?? [],
    })),
    workoutGroup,
  };
}
