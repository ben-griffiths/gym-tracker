// Re-fetch StrengthLevel standards for selected catalog rows and merge into
// public/exercises/exercises.json (no icon/guide downloads).
//
// Usage:
//   node scripts/refresh-exercise-standards.mjs pull-ups push-ups
//   node scripts/refresh-exercise-standards.mjs --bodyweight-missing
//
// Also normalizes legacy barbell entries with `kind: "barbellOneRm"` when writing.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStandards } from "./scrape-strengthlevel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(
  __dirname,
  "..",
  "public",
  "exercises",
  "exercises.json",
);

const PAUSE_MS = 200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeBarbellKinds(exercises) {
  for (const e of exercises) {
    const s = e.standards;
    if (!s || s.kind === "bodyweight") continue;
    if (!s.kind) s.kind = "barbellOneRm";
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const bodyweightMissing = argv.includes("--bodyweight-missing");
  let slugs = argv.filter((a) => !a.startsWith("--"));
  const raw = await readFile(JSON_PATH, "utf8");
  /** @type {{ scrapedAt?: string; exercises: Array<{ slug: string; standards: unknown; category?: string|null }> }} */
  const data = JSON.parse(raw);

  if (bodyweightMissing) {
    const extra = data.exercises
      .filter(
        (ex) =>
          ex.category === "Bodyweight" &&
          ex.standards == null &&
          !slugs.includes(ex.slug),
      )
      .map((ex) => ex.slug);
    slugs = [...new Set([...slugs, ...extra])];
  }

  if (slugs.length === 0) {
    console.error(
      "Pass one or more slugs, or use --bodyweight-missing to refresh Bodyweight rows with no standards.",
    );
    process.exit(1);
  }

  let updated = 0;
  for (const slug of slugs) {
    process.stdout.write(`${slug} … `);
    try {
      const standards = await fetchStandards(slug);
      const idx = data.exercises.findIndex((e) => e.slug === slug);
      if (idx === -1) {
        console.log("skip (not in catalog)");
        continue;
      }
      data.exercises[idx].standards = standards;
      updated += 1;
      console.log(standards ? "ok" : "null");
    } catch (err) {
      console.log(`fail (${/** @type {Error} */ (err).message})`);
    }
    await sleep(PAUSE_MS);
  }

  normalizeBarbellKinds(data.exercises);
  data.scrapedAt = new Date().toISOString();

  await writeFile(JSON_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote ${JSON_PATH} (${updated} slug(s) refreshed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
