import { EXERCISES } from "./exercises";

/**
 * Rep maxes **catalog (untracked)** sort: higher in this list = higher Google-style interest.
 *
 * **Sources (manual synthesis, not live API):**
 * - [Outlift — “The Most Popular Lifts (According to Google)”](https://outlift.com/most-popular-lifts/)
 *   (10y Google Trends: **squat** dominates; **bench** / **deadlift** tier below; **front squat**
 *   ~ **back squat** search volume; **pull-up** > **chin-up**; **barbell row** rising; etc.)
 * - [StrengthLog — popular lifts from app logs](https://www.strengthlog.com/most-popular-exercises/)
 *   (tier after big 3: lat pulldown, overhead press, row, lateral raise, leg extension, leg press, curl…)
 *
 * Unknown slugs (or `custom:*`) sort after everyone listed here, then by Est 1RM / name.
 */
const PRIORITY_SLUGS: readonly string[] = [
  // Big 3 — Outlift: squat highest search interest; bench & deadlift in next tier
  "squat",
  "bench-press",
  "deadlift",
  // StrengthLog-style “next most logged” + pulldown / press / row / isolation block
  "lat-pulldown",
  "military-press",
  "bent-over-row",
  "dumbbell-lateral-raise",
  "leg-extension",
  "sled-leg-press",
  "barbell-curl",
  // Outlift: front squat ~ back squat search frequency
  "front-squat",
  "incline-bench-press",
  "dumbbell-bench-press",
  // Outlift: pull-up more than chin-up
  "pull-ups",
  "chin-ups",
  "romanian-deadlift",
  "hip-thrust",
  "close-grip-lat-pulldown",
  "tricep-pushdown",
  "cable-fly",
  "dumbbell-fly",
  "face-pull",
  "pendlay-row",
  "t-bar-row",
  "seated-cable-row",
  "one-arm-seated-cable-row",
  "rack-pull",
  "sumo-deadlift",
  "close-grip-bench-press",
  "close-grip-incline-bench-press",
  "decline-bench-press",
  "dumbbell-shoulder-press",
  "arnold-press",
  "behind-the-neck-press",
  "upright-row",
  "cable-lateral-raise",
  "machine-lateral-raise",
  "barbell-shrug",
  "dumbbell-shrug",
  "dumbbell-curl",
  "hammer-curl",
  "preacher-curl",
  "vertical-leg-press",
  "horizontal-leg-press",
  "single-leg-press",
  "lying-leg-curl",
  "lunge",
  "bulgarian-split-squat",
  "goblet-squat",
  "box-squat",
  "barbell-calf-raise",
  "dumbbell-calf-raise",
  "seated-calf-raise",
  "machine-calf-raise",
  "dumbbell-face-pull",
  "good-morning",
  "reverse-hyperextension",
  "clean-and-press",
  "dumbbell-clean-and-press",
  "power-clean",
  "hang-clean",
  "clean-and-jerk",
  "snatch",
  "crunches",
  "cable-crunch",
  "hanging-leg-raise",
  "lying-leg-raise",
  "smith-machine-bench-press",
  "smith-machine-squat",
];

const CATALOG_SLUGS = new Set(EXERCISES.map((e) => e.slug));

/** Slugs that exist in the local catalog, in popularity order. */
export const REP_MAX_POPULARITY_ORDER: readonly string[] =
  PRIORITY_SLUGS.filter((s) => CATALOG_SLUGS.has(s));

const INDEX = new Map(
  REP_MAX_POPULARITY_ORDER.map((slug, index) => [slug, index]),
);

/**
 * Lower = more “popular” for sorting. Catalog slugs not listed get the same tail index so
 * they tie-break on Est 1RM / name as before.
 */
export function repMaxPopularityIndex(slug: string): number {
  if (slug.startsWith("custom:")) {
    return REP_MAX_POPULARITY_ORDER.length + 1;
  }
  return INDEX.get(slug) ?? REP_MAX_POPULARITY_ORDER.length;
}
