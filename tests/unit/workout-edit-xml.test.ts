import { describe, expect, it } from "vitest";
import {
  applyWorkoutEditXml,
  extractEditXml,
  sanitizeEditXml,
} from "@/lib/workout-chat/workout-edit-xml";

const ALLOWED = ["bench-press", "incline-dumbbell-press"];

describe("extractEditXml", () => {
  it("extracts edit from prose and fenced output", () => {
    const raw = `Here is the edit:
\`\`\`xml
<edit>
  <noop/>
</edit>
\`\`\``;
    const got = extractEditXml(raw);
    expect(got).toContain("<edit");
    expect(got).toContain("<noop/>");
    expect(got).toMatch(/<\/edit>\s*$/);
  });

  it("returns null when there is no edit root", () => {
    expect(extractEditXml("just some text")).toBeNull();
    expect(extractEditXml("<workout exercise=\"x\"></workout>")).toBeNull();
  });

  it("closes a truncated edit root", () => {
    const raw = `<edit><insert position="end" count="1"><s kind="working" r="5"/></insert>`;
    const got = extractEditXml(raw);
    expect(got).toMatch(/<\/edit>\s*$/);
  });
});

describe("sanitizeEditXml", () => {
  it("caps insert count at 10", () => {
    const edit = `<edit><insert position="before-first-working" count="999"><s kind="warmup"/></insert></edit>`;
    const got = sanitizeEditXml(edit, { allowedExerciseSlugs: ALLOWED });
    expect(got).toContain('count="10"');
    expect(got).not.toContain("999");
  });

  it("rejects set-exercise when slug is not allowed", () => {
    const edit = `<edit><set-exercise slug="random-bad-slug"/></edit>`;
    expect(sanitizeEditXml(edit, { allowedExerciseSlugs: ALLOWED })).toBeNull();
  });
});

describe("applyWorkoutEditXml", () => {
  it("inserts two warmups before first working; preserves working n attrs", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="3" w="145" u="kg"/>
  <s n="2" kind="working" r="3" w="145" u="kg"/>
  <s n="3" kind="working" r="3" w="145" u="kg"/>
  <s n="4" kind="working" r="3" w="145" u="kg"/>
  <s n="5" kind="working" r="3" w="145" u="kg"/>
</workout>`;
    const editXml = `<edit>
  <insert position="before-first-working" count="2">
    <s kind="warmup"/>
  </insert>
</edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    })!;
    expect(out).toContain('<s kind="warmup"/>');
    const warmupLines = out.split("\n").filter((l) => l.includes('kind="warmup"'));
    expect(warmupLines).toHaveLength(2);
    expect(warmupLines.every((l) => !l.includes('n="'))).toBe(true);
    expect(out).toContain('n="1" kind="working"');
    expect(out).toContain('n="5" kind="working"');
  });

  it("updates only the last set reps", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="5" w="100" u="kg"/>
  <s n="2" kind="working" r="5" w="100" u="kg"/>
</workout>`;
    const editXml = `<edit><update target="last-set" r="8"/></edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    })!;
    expect(out).toMatch(/n="1"[^\n]*r="5"/);
    expect(out).toMatch(/n="2"[^\n]*r="8"/);
  });

  it("removes only the second set", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="5" u="kg"/>
  <s n="2" kind="working" r="5" u="kg"/>
  <s n="3" kind="working" r="5" u="kg"/>
</workout>`;
    const editXml = `<edit><delete target="set:2"/></edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    })!;
    expect(out.match(/<s\b/g)).toHaveLength(2);
    expect(out).toContain('n="1"');
    expect(out).toContain('n="3"');
    expect(out).not.toContain('n="2"');
  });

  it("inserts backoff after last working", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="5" w="100" u="kg"/>
</workout>`;
    const editXml = `<edit>
  <insert position="after-last-working" count="1">
    <s kind="backoff" r="10" w="80" u="kg"/>
  </insert>
</edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    })!;
    expect(out).toMatch(/kind="backoff"[^\n]*r="10"[^\n]*w="80"/);
  });

  it("applies set-exercise when slug is allowed", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="5" u="kg"/>
</workout>`;
    const editXml = `<edit><set-exercise slug="incline-dumbbell-press"/></edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    })!;
    expect(out).toMatch(/<workout exercise="incline-dumbbell-press">/);
  });

  it("returns previous XML unchanged for noop-only edit", () => {
    const previousXml = `<workout exercise="bench-press">
  <s n="1" kind="working" r="5" u="kg"/>
</workout>`;
    const editXml = `<edit><noop/></edit>`;
    const sanitized = sanitizeEditXml(editXml, { allowedExerciseSlugs: ALLOWED })!;
    const out = applyWorkoutEditXml({
      previousXml,
      editXml: sanitized,
      allowedExerciseSlugs: ALLOWED,
    });
    expect(out).toBe(previousXml.trim());
  });
});
