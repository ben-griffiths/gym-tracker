import { describe, expect, it } from "vitest";
import {
  isLater,
  mergeAliases,
  mergeRow,
  mergeTranscript,
} from "@/lib/sync/mergers";
import type {
  ExerciseRow,
  SetEntryRow,
  WorkoutSessionRow,
} from "@/lib/sync/types";

const baseMeta = {
  server_updated_at: null,
  local_updated_at: "2026-01-01T00:00:00.000Z",
  dirty: 0 as const,
};

describe("isLater", () => {
  it("returns true when a is strictly later than b", () => {
    expect(isLater("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(
      true,
    );
  });
  it("treats null as -infinity", () => {
    expect(isLater(null, "2026-01-01T00:00:00.000Z")).toBe(false);
    expect(isLater("2026-01-01T00:00:00.000Z", null)).toBe(true);
  });
});

describe("mergeAliases", () => {
  it("unions and dedups case-insensitively", () => {
    const merged = mergeAliases(["Bench", "BP"], ["bench", "press"]);
    expect(merged.map((v) => v.toLowerCase()).sort()).toEqual(
      ["bench", "bp", "press"].sort(),
    );
  });
  it("preserves remote values when both sides agree", () => {
    expect(mergeAliases(["bench"], ["bench"])).toEqual(["bench"]);
  });
});

describe("mergeTranscript", () => {
  it("merges by message id, LWW per message", () => {
    const local = {
      messages: [
        { id: "m1", text: "local v2", updated_at: "2026-02-01T00:00:00.000Z" },
        { id: "m3", text: "only local" },
      ],
    };
    const remote = {
      messages: [
        { id: "m1", text: "remote v1", updated_at: "2026-01-01T00:00:00.000Z" },
        { id: "m2", text: "only remote" },
      ],
    };
    const merged = mergeTranscript(local, remote) as {
      messages: Array<{ id: string; text: string }>;
    };
    const byId = Object.fromEntries(merged.messages.map((m) => [m.id, m.text]));
    expect(byId.m1).toBe("local v2");
    expect(byId.m2).toBe("only remote");
    expect(byId.m3).toBe("only local");
  });
  it("falls back to whichever side is non-null", () => {
    expect(mergeTranscript(null, { messages: [{ id: "x" }] })).toEqual({
      messages: [{ id: "x" }],
    });
    expect(mergeTranscript({ messages: [{ id: "x" }] }, null)).toEqual({
      messages: [{ id: "x" }],
    });
  });
});

describe("mergeRow LWW", () => {
  const row = (over: Partial<SetEntryRow>): SetEntryRow => ({
    ...baseMeta,
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "u",
    session_exercise_id: "se",
    set_number: 1,
    reps: 5,
    weight: 100,
    weight_unit: "kg",
    rpe: null,
    rir: null,
    feel: null,
    is_warmup: false,
    notes: null,
    logged_at: "2026-01-01T00:00:00.000Z",
    source: "manual",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    client_updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  });

  it("takes server when local is clean", () => {
    const local = row({ reps: 5 });
    const remote = row({ reps: 8, client_updated_at: "2026-02-01T00:00:00.000Z" });
    const merged = mergeRow("set_entries", local, remote);
    expect(merged.reps).toBe(8);
  });

  it("keeps local when local is dirty AND newer", () => {
    const local = row({ reps: 5, dirty: 1, client_updated_at: "2026-03-01T00:00:00.000Z" });
    const remote = row({ reps: 8, client_updated_at: "2026-02-01T00:00:00.000Z" });
    const merged = mergeRow("set_entries", local, remote);
    expect(merged.reps).toBe(5);
  });

  it("tombstones win when later", () => {
    const local = row({ reps: 5, dirty: 1, client_updated_at: "2026-03-01T00:00:00.000Z" });
    const remote = row({
      reps: 8,
      client_updated_at: "2026-04-01T00:00:00.000Z",
      deleted_at: "2026-04-01T00:00:00.000Z",
    });
    const merged = mergeRow("set_entries", local, remote);
    expect(merged.deleted_at).toBe("2026-04-01T00:00:00.000Z");
  });

  it("merges exercises.aliases as a union", () => {
    const local: ExerciseRow = {
      ...baseMeta,
      id: "id",
      user_id: "u",
      name: "Bench Press",
      aliases: ["bp"],
      dirty: 1,
      client_updated_at: "2026-03-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
    };
    const remote: ExerciseRow = { ...local, dirty: 0, aliases: ["bench"], client_updated_at: "2026-02-01T00:00:00.000Z" };
    const merged = mergeRow("exercises", local, remote);
    expect(merged.aliases.map((a) => a.toLowerCase()).sort()).toEqual(
      ["bench", "bp"].sort(),
    );
  });

  it("merges workout_sessions.chat_transcript by message id", () => {
    const local: WorkoutSessionRow = {
      ...baseMeta,
      id: "s",
      user_id: "u",
      workout_group_id: null,
      name: "n",
      notes: null,
      started_at: "2026-01-01T00:00:00.000Z",
      ended_at: null,
      status: "ACTIVE",
      chat_transcript: { messages: [{ id: "m1", text: "L" }] },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      client_updated_at: "2026-03-01T00:00:00.000Z",
      deleted_at: null,
      dirty: 1,
    };
    const remote: WorkoutSessionRow = {
      ...local,
      dirty: 0,
      chat_transcript: { messages: [{ id: "m2", text: "R" }] },
      client_updated_at: "2026-02-01T00:00:00.000Z",
    };
    const merged = mergeRow("workout_sessions", local, remote);
    const t = merged.chat_transcript as { messages: Array<{ id: string }> };
    expect(t.messages.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });
});
