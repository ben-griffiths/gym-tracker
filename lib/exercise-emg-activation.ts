/**
 * Approximate **relative** surface-EMG emphasis per exercise (hardcoded for reuse in UI).
 *
 * **Schema:** Each exercise carries `relativeEmg`: a full `Record<MuscleGroup, number>` with scores
 * from **0–100 comparing muscles within that exercise only** (not %MVIC, not normalized across the
 * catalog, and **values are not required to sum to 100**). Zeros mean “negligible emphasis” for
 * display ranking, not anatomical silence.
 *
 * **Sources & confidence:** Representative literature and practitioner summaries inform patterns.
 * `confidence: "cited"` marks a few flagship lifts explicitly tied to named references in `notes`.
 * Everything else is `"inferred"` from biomechanically similar movements; figures still vary with
 * technique, load, tempo, and normalization.
 *
 * **Limitations:** sEMG amplitude ≠ tension, force, or hypertrophy; depth, stance, bar path, and
 * electrode placement shift curves; individual anatomy differs.
 */

import {
  EXERCISES,
  getExerciseBySlug,
  type ExerciseRecord,
} from "./exercises";

/** Canonical muscle buckets (~20) — coarse enough for UI, finer than “upper body”. */
export const MUSCLE_GROUPS = [
  "chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "triceps",
  "biceps",
  "forearms",
  "traps",
  "upper_back",
  "lats",
  "lower_back",
  "abs",
  "obliques",
  "glutes",
  "quadriceps",
  "rectus_femoris",
  "hamstrings",
  "adductors",
  "calves",
  "hip_flexors",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export type EmgConfidence = "cited" | "inferred";

export type ExerciseEmgActivation = {
  relativeEmg: Record<MuscleGroup, number>;
  confidence: EmgConfidence;
  notes?: string;
};

/** Explicit Olympic / derivatives (exact slugs from catalog). */
const OLYMPIC_SLUGS = new Set([
  "clean",
  "clean-and-jerk",
  "clean-high-pull",
  "clean-pull",
  "dumbbell-hang-clean",
  "dumbbell-high-pull",
  "hang-clean",
  "hang-power-clean",
  "hang-snatch",
  "muscle-snatch",
  "power-clean",
  "power-snatch",
  "push-jerk",
  "snatch",
  "snatch-pull",
  "split-jerk",
  "dumbbell-snatch",
]);

function neutralRecord(): Record<MuscleGroup, number> {
  const o = {} as Record<MuscleGroup, number>;
  for (const m of MUSCLE_GROUPS) o[m] = 0;
  return o;
}

function make(
  partial: Partial<Record<MuscleGroup, number>>,
  confidence: EmgConfidence,
  notes?: string,
): ExerciseEmgActivation {
  const relativeEmg = neutralRecord();
  for (const m of MUSCLE_GROUPS) {
    const v = partial[m];
    if (v !== undefined) relativeEmg[m] = v;
  }
  return { relativeEmg, confidence, notes };
}

/** Routing keyed by catalog slug — exhaustive via {@link EXERCISES}. */
function activationForExercise(ex: ExerciseRecord): ExerciseEmgActivation {
  const slug = ex.slug;

  if (slug.includes("wrist-curl")) {
    return make({ forearms: 100, biceps: 18 }, "inferred");
  }
  if (slug.includes("neck-curl") || slug.includes("neck-extension")) {
    return make({ traps: 55, upper_back: 22 }, "inferred", "Neck flexion/extension — coarse proxy");
  }
  if (
    slug.includes("calf-raise") ||
    slug.includes("sled-press-calf") ||
    slug === "donkey-calf-raise"
  ) {
    return make({ calves: 100, quadriceps: 22 }, "inferred");
  }
  if (slug === "jumping-jack") {
    return make({ calves: 35, hip_flexors: 28, side_delts: 18 }, "inferred");
  }
  if (slug === "burpees") {
    return make(
      {
        chest: 52,
        triceps: 48,
        front_delts: 44,
        quadriceps: 62,
        glutes: 48,
        hip_flexors: 38,
        abs: 40,
        calves: 32,
      },
      "inferred",
    );
  }
  if (
    slug.includes("woodchop") ||
    slug.includes("woodchopper") ||
    slug.includes("russian-twist") ||
    slug.includes("bicycle-crunch")
  ) {
    return make({ obliques: 88, abs: 62, hip_flexors: 28 }, "inferred");
  }
  if (
    slug.includes("hip-abduction") ||
    slug.includes("floor-hip-abduction") ||
    slug.includes("side-leg-raise")
  ) {
    return make({ glutes: 72, side_delts: 12 }, "inferred");
  }
  if (slug.includes("hip-adduction")) {
    return make({ adductors: 92, glutes: 28 }, "inferred");
  }
  if (slug.includes("glute-kickback") || slug.includes("cable-kickback")) {
    return make({ glutes: 92, hamstrings: 42 }, "inferred");
  }
  if (slug.includes("leg-extension")) {
    return make({ quadriceps: 100, rectus_femoris: 82 }, "inferred");
  }
  if (
    slug.includes("leg-curl") ||
    slug.includes("nordic-hamstring") ||
    slug.includes("glute-ham-raise")
  ) {
    return make({ hamstrings: 100, calves: 22 }, "inferred");
  }
  if (slug.includes("shrug")) {
    return make({ traps: 100, forearms: 38 }, "inferred");
  }
  if (slug === "good-morning") {
    return make(
      { hamstrings: 72, lower_back: 88, glutes: 62 },
      "inferred",
      "Hinge pattern — erectors load shares with hamstrings",
    );
  }
  if (
    slug.includes("back-extension") ||
    slug.includes("reverse-hyper") ||
    slug.includes("hyperextension")
  ) {
    return make({ lower_back: 92, glutes: 68, hamstrings: 48 }, "inferred");
  }
  if (slug.includes("floor-hip-extension")) {
    return make({ glutes: 82, hamstrings: 58, lower_back: 35 }, "inferred");
  }
  if (slug.includes("hip-extension") && !slug.includes("back-extension")) {
    return make({ glutes: 85, hamstrings: 50 }, "inferred");
  }

  if (
    slug.includes("crunch") ||
    slug.includes("sit-up") ||
    slug.includes("leg-raise") ||
    slug.includes("knee-raise") ||
    slug.includes("toes-to-bar") ||
    slug.includes("flutter-kicks") ||
    slug.includes("scissor-kicks") ||
    slug.includes("mountain-climber") ||
    slug.includes("high-pulley-crunch") ||
    slug.includes("standing-cable-crunch") ||
    slug.includes("cable-crunch") ||
    slug.includes("machine-seated-crunch") ||
    slug.includes("superman")
  ) {
    if (slug.includes("superman")) {
      return make({ lower_back: 82, glutes: 52, hamstrings: 35 }, "inferred");
    }
    if (
      slug.includes("side-crunch") ||
      slug.includes("roman-chair-side-bend") ||
      slug.includes("side-bend")
    ) {
      return make({ obliques: 92, abs: 48 }, "inferred");
    }
    return make(
      {
        abs: 85,
        hip_flexors:
          slug.includes("leg-raise") || slug.includes("knee-raise") ? 52 : 38,
      },
      "inferred",
    );
  }
  if (slug.includes("ab-wheel")) {
    return make({ abs: 92, lats: 48, triceps: 42, front_delts: 38 }, "inferred");
  }
  if (slug.includes("side-bend")) {
    return make({ obliques: 92, abs: 48 }, "inferred");
  }

  if (
    slug.includes("lateral-raise") ||
    slug.includes("incline-y-raise") ||
    slug.includes("machine-lateral-raise") ||
    slug.includes("cable-lateral-raise")
  ) {
    return make({ side_delts: 100, traps: 35 }, "inferred");
  }
  if (slug.includes("front-raise")) {
    return make({ front_delts: 100, side_delts: 28 }, "inferred");
  }
  if (slug.includes("face-pull") || slug.includes("external-rotation")) {
    return make({ rear_delts: 72, upper_back: 68, traps: 42, biceps: 22 }, "inferred");
  }

  if (
    (slug.includes("-fly") ||
      slug.includes("chest-fly") ||
      slug.includes("cable-fly")) &&
    !slug.includes("reverse-fly")
  ) {
    return make({ chest: 100, front_delts: 42, biceps: 18 }, "inferred");
  }
  if (slug.includes("reverse-fly")) {
    return make({ rear_delts: 88, upper_back: 62 }, "inferred");
  }

  if (slug.includes("pullover")) {
    return make({ lats: 82, chest: 58, triceps: 48 }, "inferred");
  }
  if (slug.includes("straight-arm-pulldown")) {
    return make({ lats: 92, abs: 28, triceps: 22 }, "inferred");
  }

  if (
    slug.includes("tricep") ||
    slug.includes("pushdown") ||
    slug.includes("jm-press") ||
    slug.includes("tate-press") ||
    slug.includes("machine-tricep") ||
    slug.includes("rope-pushdown") ||
    slug === "lying-tricep-extension" ||
    slug.includes("lying-dumbbell-tricep") ||
    (slug.includes("lying-cable") && slug.includes("tricep"))
  ) {
    return make({ triceps: 100, chest: slug.includes("jm") ? 38 : 22 }, "inferred");
  }

  if (
    slug.includes("curl") ||
    slug.includes("preacher") ||
    slug.includes("concentration-curl") ||
    slug.includes("spider-curl") ||
    slug.includes("zottman") ||
    slug.includes("hammer-curl") ||
    slug.includes("machine-bicep") ||
    slug.includes("strict-curl") ||
    slug.includes("cheat-curl") ||
    slug.includes("reverse-barbell-curl") ||
    slug.includes("overhead-cable-curl") ||
    slug.includes("incline-cable-curl") ||
    slug.includes("one-arm-cable-bicep") ||
    slug.includes("one-arm-dumbbell-preacher")
  ) {
    const hammer = slug.includes("hammer");
    return make(
      { biceps: hammer ? 78 : 100, forearms: hammer ? 68 : 42 },
      "inferred",
    );
  }

  if (slug.includes("upright-row")) {
    return make({ side_delts: 82, traps: 72, biceps: 42 }, "inferred");
  }

  if (slug.includes("handstand-push") || slug.includes("pike-push")) {
    return make({ front_delts: 92, triceps: 88, traps: 42, abs: 52 }, "inferred");
  }

  const isBenchHorizPush =
    slug.includes("chest-press") ||
    (((slug.includes("bench-press") ||
      slug.includes("floor-press") ||
      slug.includes("smith-machine-bench") ||
      slug.includes("spoto-press") ||
      slug.includes("paused-bench") ||
      slug.includes("bench-pin-press")) &&
      !slug.includes("bench-pull")) ||
      slug.includes("close-grip-incline-bench-press") ||
      slug.includes("close-grip-dumbbell-bench-press"));

  if (isBenchHorizPush) {
    const close = slug.includes("close-grip");
    const incline = slug.includes("incline");
    const decline = slug.includes("decline");
    const rev = slug.includes("reverse-grip");
    const dumbbell = slug.includes("dumbbell");

    const citedBarbellBench =
      slug === "bench-press"
        ? ({
            confidence: "cited" as const,
            notes:
              "ACE-commissioned UW-La Crosse chest EMG ranking (barbell bench among highest pec major activation vs common chest exercises). Press release + PDF summary.",
          })
        : dumbbell && !incline && !decline
          ? ({
              confidence: "inferred" as const,
              notes:
                "Similar horizontal pressing pattern to barbell bench; stabilizers typically higher on dumbbells (literature-informed inference).",
            })
          : ({ confidence: "inferred" as const });

    const baseChest = decline ? 92 : incline ? 78 : 100;
    const baseFront = incline ? 82 : decline ? 46 : 54;
    const baseTri = close ? 92 : rev ? 62 : 72;

    return make(
      {
        chest: baseChest,
        triceps: baseTri,
        front_delts: close ? 58 : baseFront,
        side_delts: 22,
      },
      citedBarbellBench.confidence,
      citedBarbellBench.notes,
    );
  }

  if (
    slug.includes("shoulder-press") ||
    slug.includes("shoulder-pin-press") ||
    slug.includes("military-press") ||
    slug.includes("arnold-press") ||
    slug.includes("machine-shoulder-press") ||
    slug.includes("seated-dumbbell-shoulder-press") ||
    slug.includes("seated-shoulder-press") ||
    slug.includes("behind-the-neck-press") ||
    slug.includes("log-press") ||
    slug.includes("viking-press") ||
    slug.includes("landmine-press") ||
    slug.includes("one-arm-landmine-press") ||
    slug.includes("z-press") ||
    slug.includes("dumbbell-z-press") ||
    slug.includes("dumbbell-push-press") ||
    slug.includes("push-press") ||
    slug.includes("clean-and-press") ||
    slug.includes("dumbbell-clean-and-press")
  ) {
    const landmine = slug.includes("landmine");
    return make(
      {
        front_delts: landmine ? 88 : 92,
        side_delts: slug.includes("arnold") ? 62 : 38,
        triceps: 72,
        upper_back: landmine ? 42 : 28,
        traps: slug.includes("push-press") ? 48 : 32,
      },
      "inferred",
    );
  }

  if (slug.includes("push-up") || slug === "push-ups") {
    const diamond = slug.includes("diamond");
    const decline = slug.includes("decline");
    const incline = slug.includes("incline");
    return make(
      {
        chest: decline ? 92 : incline ? 68 : diamond ? 72 : 82,
        triceps: diamond ? 82 : 62,
        front_delts: 58,
        abs: 42,
      },
      "inferred",
    );
  }
  if (
    slug.includes("dip") ||
    slug.includes("bench-dips") ||
    slug.includes("ring-dips") ||
    slug.includes("seated-dip-machine")
  ) {
    const bench = slug.includes("bench-dips");
    return make(
      {
        chest: bench ? 52 : 62,
        triceps: 100,
        front_delts: 58,
      },
      "inferred",
    );
  }

  if (slug.includes("muscle-up")) {
    return make(
      {
        lats: 85,
        biceps: 72,
        chest: 62,
        triceps: 68,
        abs: 55,
        forearms: 62,
      },
      "inferred",
    );
  }

  if (OLYMPIC_SLUGS.has(slug)) {
    return make(
      {
        traps: 72,
        glutes: 68,
        quadriceps: 78,
        hamstrings: 52,
        lower_back: 58,
        front_delts: 62,
        side_delts: 42,
        calves: 38,
        forearms: 48,
        upper_back: 52,
      },
      "inferred",
      "Whole-body pulling from floor — coarse composite vs hypertrophy isolation",
    );
  }

  if (slug.includes("rack-pull")) {
    return make(
      {
        traps: 82,
        lower_back: 72,
        lats: 52,
        glutes: 58,
        hamstrings: 48,
        forearms: 62,
      },
      "inferred",
    );
  }

  if (
    slug.includes("romanian-deadlift") ||
    slug.includes("stiff-leg") ||
    slug.includes("single-leg-romanian")
  ) {
    return make(
      {
        hamstrings: 92,
        glutes: 88,
        lower_back: 62,
        forearms: 42,
        traps: 38,
      },
      "inferred",
      "Hinge with sustained hamstring length — typical EMG emphasis vs conventional pulls",
    );
  }

  if (
    slug.includes("deadlift") ||
    slug.includes("deficit-deadlift") ||
    slug.includes("pause-deadlift") ||
    slug.includes("jefferson-deadlift") ||
    slug.includes("behind-the-back-deadlift") ||
    slug.includes("zercher-deadlift") ||
    slug.includes("sumo-deadlift") ||
    slug.includes("hex-bar-deadlift") ||
    slug.includes("dumbbell-deadlift") ||
    slug.includes("single-leg-deadlift") ||
    slug.includes("single-leg-dumbbell-deadlift") ||
    slug.includes("snatch-deadlift")
  ) {
    const sumo = slug.includes("sumo");
    return make(
      {
        glutes: sumo ? 92 : 85,
        hamstrings: sumo ? 68 : 78,
        lower_back: sumo ? 72 : 88,
        quadriceps: sumo ? 62 : 48,
        traps: 72,
        lats: 58,
        forearms: 68,
        adductors: sumo ? 55 : 28,
      },
      "inferred",
      slug === "deadlift"
        ? "Composite conventional pull — knee/hip extensors and erectors vary with depth/set-up (common EMG characterization)"
        : undefined,
    );
  }

  if (slug.includes("pull-through")) {
    return make({ glutes: 92, hamstrings: 72, lower_back: 42 }, "inferred");
  }

  if (
    slug.includes("leg-press") ||
    slug.includes("horizontal-leg-press") ||
    slug.includes("vertical-leg-press") ||
    slug.includes("single-leg-press") ||
    slug.includes("sled-leg-press")
  ) {
    return make(
      {
        quadriceps: 100,
        rectus_femoris: 72,
        glutes: slug.includes("single-leg") ? 62 : 52,
        hamstrings: 35,
        calves: 28,
      },
      "inferred",
    );
  }

  if (
    slug.includes("hack-squat") ||
    slug.includes("belt-squat") ||
    slug.includes("sissy-squat")
  ) {
    return make({ quadriceps: 100, rectus_femoris: 78, calves: 38 }, "inferred");
  }

  if (
    slug.includes("lunge") ||
    slug.includes("split-squat") ||
    slug.includes("bulgarian") ||
    slug === "step-up"
  ) {
    return make(
      {
        quadriceps: 92,
        rectus_femoris: 72,
        glutes: 82,
        hamstrings: 48,
        calves: 42,
        adductors: 32,
      },
      "inferred",
    );
  }

  if (slug.includes("thruster") || slug.includes("wall-ball") || slug.includes("squat-thrust")) {
    return make(
      {
        quadriceps: 82,
        glutes: 68,
        front_delts: 72,
        abs: 48,
        triceps: 42,
      },
      "inferred",
    );
  }

  if (
    slug === "squat" ||
    slug.includes("front-squat") ||
    slug.includes("overhead-squat") ||
    slug.includes("zercher-squat") ||
    slug.includes("box-squat") ||
    slug.includes("pause-squat") ||
    slug.includes("pin-squat") ||
    slug.includes("goblet-squat") ||
    slug.includes("dumbbell-squat") ||
    slug.includes("smith-machine-squat") ||
    slug.includes("safety-bar-squat") ||
    slug.includes("landmine-squat") ||
    slug.includes("sumo-squat") ||
    slug.includes("jefferson-squat") ||
    slug.includes("bodyweight-squat") ||
    slug.includes("half-squat") ||
    slug.includes("squat-jump") ||
    slug.includes("single-leg-squat")
  ) {
    const front = slug.includes("front-squat") || slug.includes("dumbbell-front-squat");
    const oh = slug.includes("overhead-squat");
    const cited =
      slug === "squat"
        ? ({
            confidence: "cited" as const,
            notes:
              "JSCR 2017 da Silva et al. (incl. Schoenfeld): back squat VL/VM knee extensors robust; GM/BF/soleus vary with depth vs partial squat at equated 10RM.",
          })
        : ({
            confidence: "inferred" as const,
            notes:
              "Biomechanically related squat pattern — absolute %MVIC differs by bar position and depth.",
          });

    return make(
      {
        quadriceps: 100,
        rectus_femoris: 72,
        glutes: front ? 72 : 82,
        hamstrings: 52,
        lower_back: oh ? 62 : 58,
        calves: 42,
        abs: oh ? 52 : 35,
        upper_back: oh ? 58 : 42,
        front_delts: oh ? 48 : 22,
      },
      cited.confidence,
      cited.notes,
    );
  }

  if (slug.includes("pistol-squat")) {
    return make(
      {
        quadriceps: 92,
        glutes: 72,
        hamstrings: 42,
        calves: 55,
        abs: 62,
      },
      "inferred",
    );
  }

  if (
    slug.includes("glute-bridge") ||
    slug.includes("hip-thrust") ||
    slug.includes("barbell-glute-bridge")
  ) {
    return make({ glutes: 100, hamstrings: 58, quadriceps: 32 }, "inferred");
  }

  if (slug.includes("renegade-row")) {
    return make(
      {
        lats: 72,
        upper_back: 68,
        abs: 72,
        chest: 48,
        triceps: 42,
        biceps: 52,
      },
      "inferred",
    );
  }
  if (
    slug.includes("row") ||
    slug.includes("bench-pull") ||
    slug.includes("meadows-row") ||
    slug.includes("yates-row") ||
    slug.includes("pendlay-row") ||
    slug.includes("inverted-row") ||
    slug.includes("chest-supported") ||
    slug.includes("seated-cable-row") ||
    slug.includes("machine-row") ||
    slug.includes("t-bar-row")
  ) {
    const chestSup = slug.includes("chest-supported");
    return make(
      {
        lats: chestSup ? 78 : 72,
        upper_back: 82,
        biceps: 62,
        traps: slug.includes("pendlay") || slug.includes("bent-over") ? 48 : 38,
        lower_back: chestSup ? 28 : 58,
        rear_delts: 52,
      },
      "inferred",
    );
  }

  if (
    slug.includes("pulldown") ||
    slug.includes("pull-up") ||
    slug.includes("pull-ups") ||
    slug.includes("chin-up") ||
    slug.includes("chin-ups") ||
    slug.includes("neutral-grip-pull-ups") ||
    slug.includes("clap-pull-up") ||
    slug.includes("one-arm-pull-ups")
  ) {
    const chin = slug.includes("chin-up");
    return make(
      {
        lats: 100,
        biceps: chin ? 82 : 58,
        upper_back: 62,
        abs: 42,
        forearms: 52,
      },
      "inferred",
      chin ? "Chin-up — elbow-flexor emphasis vs pronated pull-up (common EMG characterization)" : undefined,
    );
  }

  return make(
    {
      upper_back: 42,
      abs: 38,
      glutes: 35,
      quadriceps: 35,
    },
    "inferred",
    "Fallback composite — verify slug routing if this appears unexpectedly",
  );
}

export const EXERCISE_EMG_ACTIVATION: Record<string, ExerciseEmgActivation> =
  Object.fromEntries(EXERCISES.map((ex) => [ex.slug, activationForExercise(ex)]));

export function getExerciseEmgActivation(slug: string): ExerciseEmgActivation | null {
  if (!getExerciseBySlug(slug)) return null;
  return EXERCISE_EMG_ACTIVATION[slug] ?? null;
}
