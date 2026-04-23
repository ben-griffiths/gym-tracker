// Scrape https://strengthlevel.com/one-rep-max-calculator to pull out the
// "Repetition Percentages of 1RM" table and emit a JSON lookup that the app
// uses to estimate a user's 1RM from any logged set.
//
// Output:
//   public/exercises/rep-percentages.json
//
// Shape (percentage stored as a 0..1 multiplier):
//   {
//     "source": "https://strengthlevel.com/one-rep-max-calculator",
//     "scrapedAt": "<ISO timestamp>",
//     "percentages": { "1": 1, "2": 0.97, "3": 0.94, ... }
//   }

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "public", "exercises");
const JSON_PATH = path.join(OUT_DIR, "rep-percentages.json");

const SOURCE_URL = "https://strengthlevel.com/one-rep-max-calculator";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0 Safari/537.36";

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return response.text();
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the rep → percentage table from the page HTML.
 *
 * We don't pull in a DOM parser for a one-off script. The table has exactly
 * two columns — "Repetitions" and "Percentage of 1RM" — so a regex over
 * <tr>…</tr> works reliably against the rendered HTML.
 */
function parsePercentageTable(html) {
  const percentages = {};

  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cells || cells.length < 2) continue;

    const repsRaw = stripTags(cells[0]);
    const pctRaw = stripTags(cells[1]);

    const reps = Number.parseInt(repsRaw, 10);
    const pctMatch = pctRaw.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pctMatch) continue;
    const pct = Number.parseFloat(pctMatch[1]);

    if (!Number.isFinite(reps) || reps < 1 || reps > 50) continue;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) continue;

    // Monotonic sanity check — if the previous entry exists and this one
    // isn't strictly less, the table is misaligned and we should bail rather
    // than silently produce junk.
    const previous = percentages[reps - 1];
    if (previous !== undefined && pct > previous * 100 + 0.5) {
      throw new Error(
        `Non-monotonic percentages near ${reps} reps: ${pct}% > ${previous * 100}%`,
      );
    }

    percentages[reps] = Number((pct / 100).toFixed(4));
  }

  return percentages;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`);
  const html = await fetchText(SOURCE_URL);
  const percentages = parsePercentageTable(html);

  const repsPresent = Object.keys(percentages)
    .map((value) => Number.parseInt(value, 10))
    .sort((a, b) => a - b);

  if (repsPresent.length < 10) {
    throw new Error(
      `Expected at least 10 rows in the percentage table, got ${repsPresent.length}. ` +
        "The page structure may have changed.",
    );
  }
  if (percentages[1] !== 1) {
    throw new Error(
      `Row 1 percentage should be 100% (1.0), got ${percentages[1]}.`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  const payload = {
    source: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    percentages,
  };
  await writeFile(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const maxReps = repsPresent[repsPresent.length - 1];
  console.log(
    `Wrote ${Object.keys(percentages).length} entries (1..${maxReps} reps) to ${path.relative(
      PROJECT_ROOT,
      JSON_PATH,
    )}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
