/**
 * Dexie-backed live query that reproduces the legacy GET /api/workouts
 * response shape. UI components subscribe via `useHistoryGroups()` and
 * re-render the moment the local Dexie row changes — no React Query
 * invalidation, no service-worker caching, no waiting for the sync push
 * to reach Supabase.
 */

"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDb, type LiftLogLocalDB } from "@/lib/sync/db";
import {
  projectExercise,
  projectGroup,
  projectSession,
  projectSessionExercise,
  projectSetEntry,
} from "@/lib/sync/projectors";
import type { HistoryGroup, HistoryResponse } from "@/lib/workout-history";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";

const GROUP_LIMIT = 8;

export async function selectHistoryGroups(
  db: LiftLogLocalDB,
  userId: string,
): Promise<HistoryGroup[]> {
  const allGroups = await db.workout_groups
    .where("user_id")
    .equals(userId)
    .toArray();

  const liveGroups = allGroups
    .filter((g) => !g.deleted_at)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, GROUP_LIMIT);

  if (liveGroups.length === 0) return [];

  const groupIds = liveGroups.map((g) => g.id);
  const sessions = (
    await db.workout_sessions
      .where("workout_group_id")
      .anyOf(groupIds)
      .toArray()
  )
    .filter((s) => !s.deleted_at)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  const sessionIds = sessions.map((s) => s.id);

  const sessionExercises =
    sessionIds.length === 0
      ? []
      : (
          await db.session_exercises
            .where("session_id")
            .anyOf(sessionIds)
            .toArray()
        )
          .filter((se) => !se.deleted_at)
          .sort((a, b) => a.order_index - b.order_index);

  const exerciseIds = Array.from(
    new Set(
      sessionExercises
        .map((se) => se.exercise_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const exercises =
    exerciseIds.length === 0
      ? []
      : (await db.exercises.where("id").anyOf(exerciseIds).toArray()).filter(
          (e) => !e.deleted_at,
        );
  const exerciseById = new Map(exercises.map((e) => [e.id, projectExercise(e)]));

  const sessionExerciseIds = sessionExercises.map((se) => se.id);
  const sets =
    sessionExerciseIds.length === 0
      ? []
      : (
          await db.set_entries
            .where("session_exercise_id")
            .anyOf(sessionExerciseIds)
            .toArray()
        )
          .filter((s) => !s.deleted_at)
          .sort((a, b) => a.set_number - b.set_number);

  const setsByExercise = new Map<string, ReturnType<typeof projectSetEntry>[]>();
  for (const s of sets) {
    const list = setsByExercise.get(s.session_exercise_id) ?? [];
    list.push(projectSetEntry(s));
    setsByExercise.set(s.session_exercise_id, list);
  }

  const exercisesBySession = new Map<
    string,
    Array<
      ReturnType<typeof projectSessionExercise> & {
        exercise: ReturnType<typeof projectExercise> | null;
        sets: ReturnType<typeof projectSetEntry>[];
      }
    >
  >();
  for (const se of sessionExercises) {
    const list = exercisesBySession.get(se.session_id) ?? [];
    list.push({
      ...projectSessionExercise(se),
      exercise: se.exercise_id ? exerciseById.get(se.exercise_id) ?? null : null,
      sets: setsByExercise.get(se.id) ?? [],
    });
    exercisesBySession.set(se.session_id, list);
  }

  const sessionsByGroup = new Map<
    string,
    Array<
      ReturnType<typeof projectSession> & {
        exercises: NonNullable<ReturnType<typeof exercisesBySession.get>>;
      }
    >
  >();
  for (const s of sessions) {
    if (!s.workout_group_id) continue;
    const list = sessionsByGroup.get(s.workout_group_id) ?? [];
    list.push({
      ...projectSession(s),
      exercises: exercisesBySession.get(s.id) ?? [],
    });
    sessionsByGroup.set(s.workout_group_id, list);
  }

  return liveGroups.map((g) => ({
    ...projectGroup(g),
    sessions: sessionsByGroup.get(g.id) ?? [],
  })) as unknown as HistoryGroup[];
}

/**
 * Reactive hook — every Dexie write to the relevant tables re-runs the
 * query and re-renders subscribers. Returns the same `HistoryResponse`
 * envelope the legacy fetcher returned so call sites are unchanged.
 */
export function useHistoryGroups(): {
  data: HistoryResponse | undefined;
  isLoading: boolean;
} {
  const userId = useCurrentUserId();
  const groups = useLiveQuery(
    async () => {
      if (!userId) return undefined;
      return selectHistoryGroups(getLocalDb(), userId);
    },
    [userId],
    undefined,
  );
  return {
    data: groups ? { groups, storageMode: "database" } : undefined,
    isLoading: userId === undefined || groups === undefined,
  };
}

function useCurrentUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const client = createBrowserSupabase();
    client.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    const sub = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);
  return userId;
}
