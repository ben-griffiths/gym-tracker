import { describe, expect, it } from "vitest";
import {
  primitivesToXml,
  validatePrimitive,
  type Primitive,
} from "@/lib/workout-chat/primitive-builders";

const ALLOWED = new Set(["bench-press", "incline-dumbbell-bench-press"]);

describe("validatePrimitive", () => {
  it("accepts a clean log_new", () => {
    const out = validatePrimitive(
      {
        type: "log_new",
        lift: "bench",
        sets: 5,
        reps: 5,
        weight: 100,
        unit: "kg",
      },
      ALLOWED,
    );
    expect(out).toEqual({
      type: "log_new",
      lift: "bench",
      sets: 5,
      reps: 5,
      weight: 100,
      unit: "kg",
    });
  });

  it("clamps non-integer sets/reps", () => {
    const out = validatePrimitive(
      { type: "log_new", lift: "bench", sets: 5.4, reps: 5.6 },
      ALLOWED,
    );
    expect(out).toEqual({ type: "log_new", lift: "bench", sets: 5, reps: 6 });
  });

  it("rejects out-of-range counts", () => {
    expect(
      validatePrimitive(
        { type: "log_new", lift: "bench", sets: 999, reps: 5 },
        ALLOWED,
      ),
    ).toBeNull();
    expect(
      validatePrimitive({ type: "add_warmups", count: 99 }, ALLOWED),
    ).toBeNull();
  });

  it("requires at least one field on update_last_set", () => {
    expect(
      validatePrimitive({ type: "update_last_set" }, ALLOWED),
    ).toBeNull();
    expect(
      validatePrimitive(
        { type: "update_last_set", weight: 105, unit: "kg" },
        ALLOWED,
      ),
    ).toEqual({ type: "update_last_set", weight: 105, unit: "kg" });
  });

  it("rejects switch_exercise when slug isn't allowed and isn't in catalog", () => {
    expect(
      validatePrimitive(
        { type: "switch_exercise", slug: "totally-fake-slug" },
        ALLOWED,
      ),
    ).toBeNull();
  });

  it("accepts switch_exercise when slug is in catalog (catalog override)", () => {
    const out = validatePrimitive(
      { type: "switch_exercise", slug: "deadlift" },
      ALLOWED,
    );
    expect(out).toEqual({ type: "switch_exercise", slug: "deadlift" });
  });

  it("rejects unknown type", () => {
    expect(
      validatePrimitive({ type: "explode_block" }, ALLOWED),
    ).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(validatePrimitive("nope", ALLOWED)).toBeNull();
    expect(validatePrimitive(null, ALLOWED)).toBeNull();
    expect(validatePrimitive([], ALLOWED)).toBeNull();
  });
});

describe("primitivesToXml", () => {
  const ctx = {
    previousXml:
      '<workout exercise="bench-press"><s n="1" kind="working" r="5" w="100" u="kg"/><s n="2" kind="working" r="5" w="100" u="kg"/><s n="3" kind="working" r="5" w="100" u="kg"/></workout>',
    defaultUnit: "kg" as const,
  };

  it("log_new produces a fresh workout with the right rows", () => {
    const primitives: Primitive[] = [
      { type: "log_new", lift: "bench", sets: 5, reps: 5, weight: 100, unit: "kg" },
    ];
    const out = primitivesToXml(primitives, {
      previousXml: '<workout exercise=""></workout>',
      defaultUnit: "kg",
    });
    expect(out.workoutXml).toContain('<workout exercise="">');
    expect((out.workoutXml ?? "").match(/<s\s/g)?.length).toBe(5);
    expect(out.workoutXml).toContain('w="100"');
    expect(out.editXml).toBeNull();
  });

  it("add_warmups uses gym-coach reps when working reps are known", () => {
    const out = primitivesToXml([{ type: "add_warmups", count: 2 }], ctx);
    expect(out.editXml).not.toBeNull();
    // suggestWarmupRepsBeforeWorking(5, 2) → [8, 4]; emitted in reverse so
    // the higher rep ends up on top after each insert pushes earlier rows down.
    const inserts = out.editXml!.match(/r="(\d+)"/g) ?? [];
    expect(inserts).toHaveLength(2);
    // Reverse order: r=4 first, then r=8 (each pushes prior to position 1)
    expect(inserts[0]).toBe('r="4"');
    expect(inserts[1]).toBe('r="8"');
  });

  it("add_warmups falls back to template insert when no working reps available", () => {
    const out = primitivesToXml([{ type: "add_warmups", count: 2 }], {
      previousXml: '<workout exercise=""></workout>',
      defaultUnit: "kg",
    });
    expect(out.editXml).toContain('count="2"');
    expect(out.editXml).toContain('kind="warmup"');
    expect(out.editXml).not.toMatch(/r="/);
  });

  it("append_more copies the last working row's reps and weight", () => {
    const out = primitivesToXml(
      [{ type: "append_more", count: 1 }],
      ctx,
    );
    expect(out.editXml).toContain('count="1"');
    expect(out.editXml).toContain('r="5"');
    expect(out.editXml).toContain('w="100"');
  });

  it("update_last_set with weight only emits a w-only update", () => {
    const out = primitivesToXml(
      [{ type: "update_last_set", weight: 105, unit: "kg" }],
      ctx,
    );
    expect(out.editXml).toContain('target="last-set"');
    expect(out.editXml).toContain('w="105"');
    expect(out.editXml).toContain('u="kg"');
    expect(out.editXml).not.toMatch(/r="/);
  });

  it("composite log_new + add_warmups builds workout AND edit", () => {
    const primitives: Primitive[] = [
      { type: "log_new", lift: "bench", sets: 5, reps: 5, weight: 100, unit: "kg" },
      { type: "add_warmups", count: 2 },
    ];
    const out = primitivesToXml(primitives, {
      previousXml: '<workout exercise=""></workout>',
      defaultUnit: "kg",
    });
    expect(out.workoutXml).not.toBeNull();
    expect(out.editXml).not.toBeNull();
    // The add_warmups reads working reps from the freshly-built workout cursor,
    // so the rep schedule matches suggestWarmupRepsBeforeWorking(5, 2) → [8, 4].
    const inserts = out.editXml!.match(/r="(\d+)"/g) ?? [];
    expect(inserts).toHaveLength(2);
    expect(inserts).toContain('r="8"');
    expect(inserts).toContain('r="4"');
  });

  it("delete_last emits last-set delete edit", () => {
    const out = primitivesToXml([{ type: "delete_last" }], ctx);
    expect(out.editXml).toContain('<delete target="last-set"/>');
  });

  it("delete_set targets set:N", () => {
    const out = primitivesToXml(
      [{ type: "delete_set", index: 2 }],
      ctx,
    );
    expect(out.editXml).toContain('<delete target="set:2"/>');
  });

  it("noop produces nothing", () => {
    const out = primitivesToXml([{ type: "noop" }], ctx);
    expect(out.workoutXml).toBeNull();
    expect(out.editXml).toBeNull();
  });

  it("switch_exercise emits set-exercise op", () => {
    const out = primitivesToXml(
      [{ type: "switch_exercise", slug: "incline-dumbbell-bench-press" }],
      ctx,
    );
    expect(out.editXml).toContain(
      '<set-exercise slug="incline-dumbbell-bench-press"/>',
    );
  });
});
