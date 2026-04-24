import { describe, expect, it } from "vitest";
import { getExerciseBySlug } from "../lib/exercises";
import {
  chatTranscriptSchema,
  computeSlugToBlockId,
  deserializeWorkoutChatMessages,
  parseChatTranscriptPayload,
  serializeWorkoutChatTranscript,
  type WorkoutChatMessage,
} from "../lib/workout-chat-transcript";

const makeId = (() => {
  let n = 0;
  return (_prefix: string) => `id_${++n}`;
})();

function minimalExercise() {
  const ex = getExerciseBySlug("squat");
  expect(ex).not.toBeNull();
  return ex!;
}

describe("workout chat transcript", () => {
  it("round-trips text and camera", () => {
    const ex = minimalExercise();
    const messages: WorkoutChatMessage[] = [
      { id: "1", kind: "text", role: "user", text: "5x5 squat" },
      {
        id: "2",
        kind: "camera-image",
        role: "user",
        imageUrl: "data:image/jpeg;base64,abcd",
      },
    ];
    const blockId = "block_1";
    const blocks = {
      [blockId]: { exercise: ex },
    };
    const raw = serializeWorkoutChatTranscript(messages, blocks);
    const parsed = parseChatTranscriptPayload(raw);
    expect(parsed).not.toBeNull();

    const slugMap = new Map([["squat", blockId]]);
    const out = deserializeWorkoutChatMessages(raw, slugMap, makeId);
    expect(out).not.toBeNull();
    expect(out!.filter((m) => m.kind === "text")).toHaveLength(1);
    expect(out!.find((m) => m.kind === "camera-image")).toMatchObject({
      imageUrl: "data:image/jpeg;base64,abcd",
    });
  });

  it("maps exercise-block by slug and drops unknown slug", () => {
    const ex = minimalExercise();
    const blockId = "b1";
    const messages: WorkoutChatMessage[] = [
      { id: "1", kind: "exercise-block", role: "assistant", blockId },
    ];
    const raw = serializeWorkoutChatTranscript(messages, {
      [blockId]: { exercise: ex },
    });
    expect(raw).toEqual([{ kind: "exercise-block", exerciseSlug: "squat" }]);

    const empty = deserializeWorkoutChatMessages(raw, new Map(), makeId);
    expect(empty).toEqual([]);

    const withSlug = deserializeWorkoutChatMessages(
      raw,
      new Map([["squat", "newId"]]),
      makeId,
    );
    expect(withSlug).toHaveLength(1);
    expect(withSlug![0]).toMatchObject({
      kind: "exercise-block",
      blockId: "newId",
    });
  });

  it("serializes exercise-options boundBlockId to boundExerciseSlug", () => {
    const ex = minimalExercise();
    const alt = getExerciseBySlug("front-squat")!;
    const mainBlock = "b_main";
    const messages: WorkoutChatMessage[] = [
      {
        id: "1",
        kind: "exercise-options",
        role: "assistant",
        options: [alt],
        pendingSets: [],
        boundBlockId: mainBlock,
      },
    ];
    const raw = serializeWorkoutChatTranscript(messages, {
      [mainBlock]: { exercise: ex },
    });
    const payload = parseChatTranscriptPayload(raw)![0];
    expect(payload.kind).toBe("exercise-options");
    if (payload.kind === "exercise-options") {
      expect(payload.boundExerciseSlug).toBe("squat");
    }
  });

  it("rejects invalid transcript payloads", () => {
    expect(parseChatTranscriptPayload({ foo: 1 })).toBeNull();
    expect(parseChatTranscriptPayload([{ kind: "text" }])).toBeNull();
    const parsed = chatTranscriptSchema.safeParse("string");
    expect(parsed.success).toBe(false);
  });

  it("computeSlugToBlockId last block wins for duplicate slugs", () => {
    const ex = minimalExercise();
    const blocks = {
      first: { exercise: ex },
      second: { exercise: ex },
    };
    const m = computeSlugToBlockId(blocks);
    expect(m.get("squat")).toBe("second");
  });
});
