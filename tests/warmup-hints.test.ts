import { describe, expect, it } from "vitest";
import {
  DEFAULT_WARMUP_START_PCT,
  hasWarmupRampPhrasing,
  parseWarmupHints,
} from "../lib/warmup-hints";

describe("parseWarmupHints", () => {
  it("parses digit-form warmup counts", () => {
    expect(parseWarmupHints("2 warmup sets").warmupSets).toBe(2);
    expect(parseWarmupHints("3 warm-up sets please").warmupSets).toBe(3);
    expect(parseWarmupHints("one warmup").warmupSets).toBe(1);
  });

  it("parses word-form warmup counts", () => {
    expect(parseWarmupHints("two warm up sets").warmupSets).toBe(2);
    expect(parseWarmupHints("three warm-up sets").warmupSets).toBe(3);
    expect(parseWarmupHints("five warmups").warmupSets).toBe(5);
  });

  it("treats informal 'a couple of warmups' as 2", () => {
    expect(parseWarmupHints("a couple of warmup sets").warmupSets).toBe(2);
    expect(parseWarmupHints("a few warmups").warmupSets).toBe(3);
  });

  it("returns zero when no warmup phrase is present", () => {
    expect(parseWarmupHints("bench 5x5 at 100kg").warmupSets).toBe(0);
    expect(parseWarmupHints("").warmupSets).toBe(0);
    expect(parseWarmupHints(undefined).warmupSets).toBe(0);
  });

  it("defaults the start pct to 30% 1RM", () => {
    expect(parseWarmupHints("two warmup sets").warmupStartPct).toBeCloseTo(
      DEFAULT_WARMUP_START_PCT,
    );
  });

  it("picks up an explicit start percentage", () => {
    expect(parseWarmupHints("warmup starting at 40%").warmupStartPct).toBeCloseTo(
      0.4,
    );
  });

  it("detects working-set counts (digit + word forms)", () => {
    expect(parseWarmupHints("3 working sets").workingSets).toBe(3);
    expect(parseWarmupHints("three working sets").workingSets).toBe(3);
    expect(parseWarmupHints("no working sets here").workingSets).toBeNull();
  });
});

describe("hasWarmupRampPhrasing", () => {
  it("flags warmup + ramp wording", () => {
    expect(
      hasWarmupRampPhrasing("two warm up sets with increasing weight"),
    ).toBe(true);
    expect(
      hasWarmupRampPhrasing(
        "two warmup sets building up to my 3 working sets",
      ),
    ).toBe(true);
  });

  it("does NOT flag when only warmup is mentioned without a ramp intent", () => {
    expect(hasWarmupRampPhrasing("bench 5x5 at 100kg")).toBe(false);
    expect(hasWarmupRampPhrasing("warmup sets logged already")).toBe(false);
  });

  it("flags bare 'N warmup sets, M working sets' even without ramp verbs", () => {
    // Regression for the screenshot bug: the user said
    // "bench press, dips, shoulder press, 2 warmup sets, 3 working sets at 5 reps"
    // — no "increasing" / "ramping" word, but the intent is clearly
    // to ramp warmups up to the working sets.
    expect(
      hasWarmupRampPhrasing("2 warmup sets, 3 working sets at 5 reps"),
    ).toBe(true);
    expect(
      hasWarmupRampPhrasing(
        "bench press, 2 warmup sets 3 working sets at 5 reps",
      ),
    ).toBe(true);
  });
});
