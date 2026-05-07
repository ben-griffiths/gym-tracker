import { describe, expect, it } from "vitest";
import {
  findComposerTokenSpans,
  segmentComposerLine,
} from "@/lib/workout-chat/composer-tokens";

const miniPhrases = ["Bench Press", "Squat", "leg curl"];

function assertNonOverlappingSorted(spans: { start: number; end: number }[]) {
  let prev = 0;
  for (const s of spans) {
    expect(s.start).toBeGreaterThanOrEqual(prev);
    prev = s.end;
  }
}

describe("composer-tokens", () => {
  it("resolves same-start overlap by longest span (weight vs shorter numeric)", () => {
    const spans = findComposerTokenSpans("100kg", {
      exercisePhrases: [],
    });
    expect(spans).toEqual([{ start: 0, end: 5, kind: "weight" }]);
  });

  it("keeps adjacent tokens non-overlapping", () => {
    const spans = findComposerTokenSpans("100kg 5x5", {
      exercisePhrases: [],
    });
    assertNonOverlappingSorted(spans);
    expect(spans).toEqual([
      { start: 0, end: 5, kind: "weight" },
      { start: 6, end: 9, kind: "setsReps" },
    ]);
  });

  it("matches @ optional prefix on weight", () => {
    const spans = findComposerTokenSpans("@ 20kg warmup", {
      exercisePhrases: [],
    });
    expect(spans[0]).toEqual({ start: 0, end: 6, kind: "weight" });
  });

  it("prefers numeric @ load over bodyweight when both start with @", () => {
    const spans = findComposerTokenSpans("@ 20kg", { exercisePhrases: [] });
    expect(spans).toEqual([{ start: 0, end: 6, kind: "weight" }]);
  });

  it("matches @ BW / @ bodyweight as bodyweight token", () => {
    expect(findComposerTokenSpans("@ BW", { exercisePhrases: [] })).toEqual([
      { start: 0, end: 4, kind: "bodyweight" },
    ]);
    expect(
      findComposerTokenSpans("@ bodyweight", { exercisePhrases: [] }),
    ).toEqual([{ start: 0, end: 12, kind: "bodyweight" }]);
    expect(findComposerTokenSpans("@ BodyWeight", { exercisePhrases: [] })).toEqual([
      { start: 0, end: 12, kind: "bodyweight" },
    ]);
  });

  it("segments bodyweight next to other tokens", () => {
    const segs = segmentComposerLine("pullups @ BW 3x10", {
      exercisePhrases: [],
    });
    expect(
      segs.map((s) =>
        s.kind === "plain" ? `P:${s.text}` : `T:${s.token}:${s.text}`,
      ),
    ).toEqual(["P:pullups ", "T:bodyweight:@ BW", "P: ", "T:setsReps:3x10"]);
  });

  it("does not treat @bw inside an email-like token as bodyweight", () => {
    const spans = findComposerTokenSpans("a@bw x", { exercisePhrases: [] });
    expect(spans.some((s) => s.kind === "bodyweight")).toBe(false);
  });

  it("matches unicode multiplication sign for sets×reps", () => {
    const spans = findComposerTokenSpans("3×10", { exercisePhrases: [] });
    expect(spans).toEqual([{ start: 0, end: 4, kind: "setsReps" }]);
  });

  it("matches reps and sets words with boundaries", () => {
    const spans = findComposerTokenSpans("10 reps and 3 sets", {
      exercisePhrases: [],
    });
    assertNonOverlappingSorted(spans);
    expect(spans.map((s) => s.kind)).toEqual(["repsWord", "setsWord"]);
  });

  it("matches exercise phrases on word boundaries with custom catalog", () => {
    const spans = findComposerTokenSpans("do leg curl then stop", {
      exercisePhrases: miniPhrases,
    });
    const curl = spans.find((s) => s.kind === "exercise");
    expect(curl).toEqual({ start: 3, end: 11, kind: "exercise" });
    assertNonOverlappingSorted(spans);
  });

  it("does not match exercise inside a larger word", () => {
    const spans = findComposerTokenSpans("asquatly", {
      exercisePhrases: miniPhrases,
    });
    expect(spans.every((s) => s.kind !== "exercise")).toBe(true);
  });

  it("segmentComposerLine interleaves plain gaps", () => {
    const segs = segmentComposerLine("a 5x5 b", { exercisePhrases: [] });
    expect(segs.map((s) => (s.kind === "plain" ? `P:${s.text}` : `T:${s.token}:${s.text}`))).toEqual([
      "P:a ",
      "T:setsReps:5x5",
      "P: b",
    ]);
  });
});
