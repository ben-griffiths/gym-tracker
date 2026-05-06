/**
 * WebLLM E2E tests — drive a real Chromium browser running the Llama 3.2 1B
 * checkpoint that ships in production (`lib/webllm/config.ts`).
 *
 * Run with: npm test (or npm run test:e2e)
 *
 * Every test runs 3× back-to-back via `repeatEach: 3` in `playwright.config.ts`.
 * That makes flakes in the chat agent visible on every run; a test that
 * passes 1/3 or 2/3 is treated the same as a failure.
 *
 * The model is loaded once per run and stays in GPU memory between tests.
 * Tests run serially, accumulate state, and use locator filters to assert on
 * the *new* block added by each turn rather than navigating fresh (which would
 * recompile the engine — adds minutes). Dips ladder cases append a second batch
 * of four sets onto the same block on the typo follow-up turn (8 delete buttons).
 *
 * First run downloads model weights (cold cache; size per `lib/webllm/config.ts`);
 * subsequent runs hit CacheStorage. Allow up to
 * 30 minutes for a cold-cache run.
 *
 * Workout chat always uses `runWorkoutChatDraft` (deterministic regex →
 * LLM-decomposer JSON → primitive builders → existing apply chain). No LLM
 * call ever produces XML directly — only typed primitives that TS converts.
 *
 * Auth: `PLAYWRIGHT_BYPASS_AUTH` + `NEXT_PUBLIC_PLAYWRIGHT_BYPASS_AUTH` when
 * Playwright starts the dev server. If you **reuse** an existing `npm run dev`,
 * middleware still skips auth when it sees header `x-gym-playwright-bypass` (dev
 * only; default secret `local-playwright-e2e`), and sets cookie `gym_playwright_bypass`
 * so `getCurrentUserId()` / Dexie work without the public env inlined.
 */
import { test as base, expect, type Locator, type Page } from "@playwright/test";

const MODEL_LOAD_TIMEOUT = 25 * 60_000;
const INFERENCE_TIMEOUT = 60_000;
const RENDER_TIMEOUT = 10_000;

// Single page kept alive across the suite so the engine stays in GPU memory.
let sharedPage: Page | undefined;
let sharedModelReady = false;

const test = base.extend<{ page: Page }>({
  page: [
    async ({ browser }, use, testInfo) => {
      // First test pays for the cold-cache 700 MB download.
      testInfo.setTimeout(30 * 60_000);

      if (!sharedPage) {
        // Manual context — Playwright's per-test cleanup never sees it.
        const ctx = await browser.newContext();
        sharedPage = await ctx.newPage();
        sharedModelReady = await loadModel(sharedPage);
      }

      await use(sharedPage);
    },
    { scope: "test" },
  ],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadModel(page: Page): Promise<boolean> {
  await page.goto("/workout/new");
  await page.waitForLoadState("domcontentloaded");

  const gpuSupported = await page.evaluate(
    () => "gpu" in navigator && (navigator as { gpu?: unknown }).gpu != null,
  );
  if (!gpuSupported) return false;

  // The WebLLM provider autoloads from `idle` on first paint, so we don't
  // click anything — we just race for the ready state.
  //
  // Ready = the message input is enabled and no overlay UI text is showing.
  // Polling defaults to RAF (~16ms) so this picks up the transition fast.
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      if (text.includes("WebGPU is not supported")) return true; // bail
      if (text.includes("Loading local AI")) return false;
      if (text.includes("Install LiftLog to enable")) return false;
      if (text.includes("Model failed:")) return false;
      const idleOrAwaiting = Array.from(document.querySelectorAll("button"))
        .some((b) => {
          const t = b.textContent?.trim();
          return t === "Load model now" || t === "Load on-device model";
        });
      if (idleOrAwaiting) return false;
      // Also require the chat input to be enabled — guards against any
      // status we forgot to enumerate.
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Log a set, e.g. bench 5x5 at 100kg"]',
      );
      return !!input && !input.disabled;
    },
    { timeout: MODEL_LOAD_TIMEOUT },
  );

  return !(await page.evaluate(() =>
    document.body.innerText.includes("WebGPU is not supported"),
  ));
}

async function sendMessage(page: Page, message: string) {
  const input = page.getByPlaceholder("Log a set, e.g. bench 5x5 at 100kg");
  await input.click();
  await input.fill(message);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({
    timeout: 5_000,
  });
  await input.press("Enter");

  const typing = page.getByLabel("Assistant is typing");
  await typing.waitFor({ state: "visible", timeout: INFERENCE_TIMEOUT });
  await typing.waitFor({ state: "hidden", timeout: INFERENCE_TIMEOUT });
}

/**
 * The assistant emits "Added N set(s) to <Exercise>." after a successful
 * Dexie write. This text persists in the chat regardless of whether the
 * exercise block is later collapsed (which happens when a new block becomes
 * active), so it's the reliable signal that sets actually persisted.
 */
function setsLoggedReceipts(page: Page): Locator {
  return page.getByText(/^Added \d+ sets? to .+\.$/);
}

/** Parses kg from the last seven bench rows once weight inputs are stable. */
async function extractBenchSegmentKgValues(
  rows: Locator,
  segmentStart: number,
): Promise<number[] | null> {
  const lbToKg = 0.45359237;
  const kgValues: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const row = rows.nth(segmentStart + i);
    const weightInput = row.locator('input[data-field="weight"]');
    const raw = (await weightInput.inputValue()).trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const unit = await row.getAttribute("data-weight-unit");
    kgValues.push(unit === "lb" ? n * lbToKg : n);
  }
  return kgValues;
}

/** All currently-rendered "Delete set N" buttons (active block only). */
function deleteSetButtons(page: Page): Locator {
  return page.getByRole("button", { name: /^Delete set \d+$/ });
}

/** List rows in the expanded exercise block (each row has a delete-set control). */
function activeBlockSetLines(page: Page): Locator {
  return page.locator("li").filter({
    has: page.getByRole("button", { name: /^Delete set \d+$/ }),
  });
}

/**
 * Asserts the dips BW-tier ladder from deterministic parsing:
 * 2× bodyweight (no kg), 10 kg, 20 kg; reps ramp 10→7→5→2.
 *
 * When `tailFourSets` is true, only the **last** four set rows are checked (same
 * suite sends two dips ladder turns back-to-back, each appending four sets).
 */
async function expectDipsBwTierFourSets(
  page: Page,
  options?: { tailFourSets?: boolean },
) {
  await expect(page.getByText(/^Added 4 sets to Dips\.?$/i).last()).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  const rows = activeBlockSetLines(page);
  const total = await rows.count();
  expect(total).toBeGreaterThanOrEqual(4);
  const offset = options?.tailFourSets ? total - 4 : 0;
  if (!options?.tailFourSets) {
    expect(total).toBe(4);
  }

  const rowAt = (i: number) => rows.nth(offset + i);

  // Bodyweight tiers: no weight / no unit chip; weighted tiers use kg inputs.
  await expect(rowAt(0)).not.toContainText(/\bkg\b/i);
  await expect(rowAt(1)).not.toContainText(/\bkg\b/i);
  await expect(rowAt(2).locator('input[data-field="weight"]')).toHaveValue("10");
  await expect(rowAt(2)).toHaveAttribute("data-weight-unit", "kg");
  await expect(rowAt(3).locator('input[data-field="weight"]')).toHaveValue("20");
  await expect(rowAt(3)).toHaveAttribute("data-weight-unit", "kg");
  await expect(rowAt(0).locator('input[data-field="reps"]')).toHaveValue("10");
  await expect(rowAt(1).locator('input[data-field="reps"]')).toHaveValue("7");
  await expect(rowAt(2).locator('input[data-field="reps"]')).toHaveValue("5");
  await expect(rowAt(3).locator('input[data-field="reps"]')).toHaveValue("2");
}

// ---------------------------------------------------------------------------
// Tests — serial mode, shared state. Each test asserts on the delta from the
// previous turn, not absolute counts.
// ---------------------------------------------------------------------------

test.describe("WebLLM chat — real Llama 3.2 1B", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page: _ }) => {
    if (!sharedModelReady) test.skip();
  });

  test("bench 5x5 100kg → 5 sets logged to bench press at 100 kg", async ({ page }) => {
    const before = await setsLoggedReceipts(page).count();
    await sendMessage(page, "bench 5x5 100kg");

    await expect(page.getByText(/bench press/i).first()).toBeVisible({
      timeout: RENDER_TIMEOUT,
    });
    // The "Added N sets to <Exercise>." receipt only renders after a
    // successful Dexie write — proves sets actually persisted.
    await expect(
      page.getByText(/^Added 5 sets to Bench Press\.$/i),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
    // Active block: weight inputs show 100 kg for working sets.
    const benchExpanded = page
      .locator("[data-exercise-block][data-expanded-block]")
      .filter({ has: page.getByText(/bench press/i) })
      .last();
    await expect(
      benchExpanded.locator('input[data-field="weight"]').first(),
    ).toHaveValue("100", { timeout: RENDER_TIMEOUT });
    // Active-block sanity: 5 delete buttons in the only expanded block.
    expect(await deleteSetButtons(page).count()).toBe(5);
    void before;
  });

  test("bench 5x5 100kg 2 warmup sets → 7 rows with ≥2 distinct kg (warmup ramp)", async ({
    page,
  }) => {
    const beforeDeletes = await deleteSetButtons(page).count();
    // Include working weight — isolated runs skip prior suite turns that seed TM/kg.
    await sendMessage(page, "bench 5x5 100kg 2 warmup sets");

    await expect(
      page.getByText(/^Added 7 sets to Bench Press\.?$/i).last(),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });

    expect(await deleteSetButtons(page).count()).toBe(beforeDeletes + 7);

    const benchBlock = page
      .locator("[data-exercise-block]")
      .filter({ hasText: /Bench Press/i })
      .last();

    const rows = benchBlock.locator("li").filter({
      has: page.getByRole("button", { name: /^Delete set \d+$/ }),
    });
    const total = await rows.count();
    expect(total).toBe(beforeDeletes + 7);

    // Last 7 rows are this turn (serial suite may already have bench rows).
    // Warmup reps match suggestWarmupRepsBeforeWorking(5, 2) → [8, 4]
    // (see tests/rep-percentages.test.ts).
    const segmentStart = total - 7;
    const warmupReps = [8, 4] as const;

    for (let w = 0; w < 2; w += 1) {
      await expect(
        rows
          .nth(segmentStart + w)
          .locator('input[data-field="reps"]'),
      ).toHaveValue(String(warmupReps[w]));
    }
    for (let j = 0; j < 5; j += 1) {
      await expect(
        rows.nth(segmentStart + 2 + j).locator('input[data-field="reps"]'),
      ).toHaveValue("5");
    }

    let kgValues: number[] = [];
    await expect(async () => {
      const vals = await extractBenchSegmentKgValues(rows, segmentStart);
      expect(vals).not.toBeNull();
      kgValues = vals!;
    }).toPass({
      timeout: 25_000,
      intervals: [50, 100, 250, 500],
    });

    expect([...new Set(kgValues)].length).toBeGreaterThanOrEqual(2);
    // Warmups may round to the same kg when slots are coarse.
    expect(kgValues[0]).toBeLessThanOrEqual(kgValues[1]);
    // Gym rounding often lands the final warmup on the same plate stack as working sets.
    expect(kgValues[0]).toBeLessThan(kgValues[6]);
    expect(kgValues[1]).toBeLessThanOrEqual(kgValues[6]);
    // The last 5 rows (working) all share one kg (within rounding) — this guards
    // against decomposer weight-leak into working sets across the 3× repeat.
    const workingKgs = kgValues.slice(2);
    expect([...new Set(workingKgs)].length).toBe(1);
    expect(workingKgs[0]).toBe(100);
  });

  test("squat 3x5 140kg → 3 sets logged to squat at 140 kg", async ({ page }) => {
    await sendMessage(page, "squat 3x5 140kg");

    await expect(page.getByText(/squat/i).first()).toBeVisible({
      timeout: RENDER_TIMEOUT,
    });
    await expect(
      page.getByText(/^Added 3 sets to .*Squat\.?$/i),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(
      page
        .locator("[data-exercise-block][data-expanded-block]")
        .filter({ has: page.getByText(/squat/i) })
        .last()
        .locator('input[data-field="weight"]')
        .first(),
    ).toHaveValue("140", {
      timeout: RENDER_TIMEOUT,
    });
  });

  test("how much rest? → conversational reply, no Added-sets receipt", async ({ page }) => {
    const before = await setsLoggedReceipts(page).count();
    await sendMessage(page, "how much rest between heavy sets?");

    // No new "Added N sets" receipt — this is purely conversational.
    expect(await setsLoggedReceipts(page).count()).toBe(before);
    await expect(
      page.getByPlaceholder("Log a set, e.g. bench 5x5 at 100kg"),
    ).toBeEnabled();
  });

  test("bodyweight pull-ups → 3 sets logged to pull-ups, no kg", async ({ page }) => {
    await sendMessage(page, "pull-ups 3 sets to failure, bodyweight");

    // Receipt must name pull-ups (system prompt resolves bodyweight as a
    // weight modifier, not an exercise slug).
    await expect(
      page.getByText(/^Added 3 sets to Pull[- ]?Ups?\.?$/i),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(
      page.getByText(/^Added .* to Bodyweight Squat\.?$/i),
    ).toHaveCount(0);

    // Bodyweight ⇒ no kg on any of the 3 set rows in the active block.
    const setLines = activeBlockSetLines(page);
    expect(await setLines.count()).toBe(3);
    for (let i = 0; i < 3; i++) {
      await expect(setLines.nth(i)).not.toContainText(/\bkg\b/i);
    }
  });

  test("multi-exercise turn → both squat and deadlift receipts appear", async ({ page }) => {
    await sendMessage(page, "squat 3x5 140kg and deadlift 1x5 200kg");

    await expect(
      page.getByText(/^Added 3 sets to .*Squat\.?$/i).last(),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(
      page.getByText(/^Added 1 set to .*Deadlift\.?$/i),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
  });

  test('"bench" alone resolves to bench press, not bench dips', async ({ page }) => {
    await sendMessage(page, "bench 5 sets of 5");

    // Receipt names the resolved exercise — bench press, not bench dips.
    await expect(
      page.getByText(/^Added 5 sets to Bench Press\.$/i).last(),
    ).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(
      page.getByText(/^Added .* to Bench Dips\.?$/i),
    ).toHaveCount(0);
  });

  test.describe("dips BW tier ladders (parser-shaped prompts)", () => {
    test("clean spelling → 4 sets: BW×2, 10 kg, 20 kg + rep ramp", async ({
      page,
    }) => {
      await sendMessage(
        page,
        "dips 2 sets at bodyweight then 10kg then 20kg starting at 10 reps, going down proportionally to 2 reps",
      );
      await expect(page.getByText(/\bdips\b/i).first()).toBeVisible({
        timeout: RENDER_TIMEOUT,
      });
      await expectDipsBwTierFourSets(page);
      expect(await deleteSetButtons(page).count()).toBe(4);
    });

    test("typo-heavy phrase → same ladder as normalized deterministic parse", async ({
      page,
    }) => {
      await sendMessage(
        page,
        "dips 2 sets at bodywright then 10kg then 20kg startung at 10 reps, going down proportially to 2 reps",
      );
      await expect(page.getByText(/\bdips\b/i).first()).toBeVisible({
        timeout: RENDER_TIMEOUT,
      });
      await expectDipsBwTierFourSets(page, { tailFourSets: true });
      expect(await deleteSetButtons(page).count()).toBe(8);
    });
  });

  test("hello → conversational reply, no Added-sets receipt", async ({ page }) => {
    const before = await setsLoggedReceipts(page).count();
    await sendMessage(page, "hello");

    expect(await setsLoggedReceipts(page).count()).toBe(before);
    await expect(
      page.getByPlaceholder("Log a set, e.g. bench 5x5 at 100kg"),
    ).toBeEnabled();
  });
});
