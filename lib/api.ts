import type {
  ChatContext,
  ChatSetSuggestion,
  EffortFeel,
  VisionRecognitionResponse,
} from "@/lib/types/workout";

async function throwIfNotOk(response: Response, fallbackMessage: string) {
  if (response.ok) return;
  let message = fallbackMessage;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {}
  throw new Error(message);
}

export async function createWorkoutSession(input: {
  groupName: string;
  sessionName: string;
}) {
  const response = await fetch("/api/workouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  await throwIfNotOk(response, "Failed to create workout session");

  return response.json() as Promise<{
    group: { id: string; name: string };
    session: { id: string; name: string };
    storageMode?: "database";
  }>;
}

export async function recognizeVision(imageBase64: string, mimeType: string) {
  const response = await fetch("/api/vision/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType }),
  });

  await throwIfNotOk(response, "Camera recognition failed");

  return response.json() as Promise<VisionRecognitionResponse>;
}

export async function getChatSuggestion(
  message: string,
  context?: ChatContext,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
  });

  await throwIfNotOk(response, "Chat request failed");

  const body = (await response.json()) as { suggestion: ChatSetSuggestion };
  return body.suggestion;
}

export async function updateSet(
  setId: string,
  patch: {
    reps?: number | null;
    weight?: number | null;
    weightUnit?: "kg" | "lb";
    rpe?: number | null;
    rir?: number | null;
    feel?: EffortFeel | null;
  },
) {
  const response = await fetch(`/api/sets/${setId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await throwIfNotOk(response, "Failed to update set");
  return response.json();
}

export async function deleteSet(setId: string) {
  const response = await fetch(`/api/sets/${setId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    await throwIfNotOk(response, "Failed to delete set");
  }
  return response.ok ? response.json() : null;
}

export async function deleteWorkoutSession(sessionId: string) {
  const response = await fetch(`/api/workouts/${sessionId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    await throwIfNotOk(response, "Failed to delete workout");
  }
  return response.ok ? response.json() : null;
}

export async function patchWorkoutTranscript(
  sessionId: string,
  chatTranscript: unknown,
) {
  const response = await fetch(`/api/workouts/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatTranscript }),
  });
  await throwIfNotOk(response, "Failed to save chat");
}

/** Ensures a `session_exercises` row exists (e.g. block with zero sets). */
export async function registerSessionExercise(
  sessionId: string,
  exerciseName: string,
) {
  const response = await fetch("/api/session-exercises", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, exercise: exerciseName }),
  });
  await throwIfNotOk(response, "Failed to register exercise");
  return response.json() as Promise<{
    sessionExercise: { id: string; sessionId: string; orderIndex: number };
  }>;
}

export async function createSet(payload: {
  sessionId: string;
  exercise: string;
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  setNumber: number;
  source: "manual" | "camera" | "chat";
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
}) {
  const response = await fetch("/api/sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await throwIfNotOk(response, "Failed to save set");

  return response.json();
}

export async function createManySets(payload: {
  sessionId: string;
  exercise: string;
  source: "manual" | "camera" | "chat";
  /** First `set_number` for this batch (e.g. existing sets + 1 when appending). */
  startingSetNumber?: number;
  entries: Array<{
    reps: number | null;
    weight: number | null;
    weightUnit: "kg" | "lb";
    rpe?: number | null;
    rir?: number | null;
    feel?: EffortFeel | null;
  }>;
}) {
  const response = await fetch("/api/sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      exercise: payload.exercise,
      source: payload.source,
      ...(payload.startingSetNumber != null
        ? { startingSetNumber: payload.startingSetNumber }
        : {}),
      entries: payload.entries,
    }),
  });

  await throwIfNotOk(response, "Failed to save sets");

  return response.json() as Promise<{
    created: Array<{
      id: string;
      setNumber: number;
      reps: number | null;
      weight: number | null;
      weightUnit: "kg" | "lb";
      source: string;
    }>;
    session: unknown;
    storageMode?: string;
  }>;
}
