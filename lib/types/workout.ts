import type { ExerciseRecord } from "@/lib/exercises";

export type {
  ExerciseGuide,
  ExerciseGuideStep,
  ExerciseRecord,
} from "@/lib/exercises";

export type WeightUnit = "kg" | "lb";

export type EffortFeel = "easy" | "medium" | "hard";

/**
 * Optional per-set effort rating. All three fields are independent so a set
 * can carry any combination (most users will log just one). RPE and RIR are
 * the standard numeric scales; `feel` is a lightweight easy/medium/hard tag
 * for users who don't care for numbers.
 */
export type Effort = {
  /** Rate of Perceived Exertion (1–10, typically in 0.5 steps). */
  rpe?: number | null;
  /** Reps In Reserve (0–10). */
  rir?: number | null;
  /** Simple easy/medium/hard feel tag. */
  feel?: EffortFeel | null;
};

export type SetDetail = {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: WeightUnit;
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

export type SetUpdate = {
  targetSetNumbers: number[];
  reps?: number | null;
  weight?: number | null;
  weightUnit?: WeightUnit;
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

export type ExerciseWeightCandidate = {
  exercise: ExerciseRecord;
  weight: number | null;
  weightUnit: WeightUnit;
  confidence: number;
  reasoning?: string;
};

/** How the #1 camera suggestion was chosen (vision slug vs server catalog/hint). */
export type VisionPrimarySource = "vision_model" | "equipment_catalog";

export type VisionRecognitionResponse = {
  candidates: ExerciseWeightCandidate[];
  /** True when a vision candidate passed family checks and the client may auto-log. */
  primarySource: VisionPrimarySource;
  /** Kept for compatibility; mirrors `description` from the two-phase vision response. */
  equipmentHint: string;
  /** What the vision model said it saw (equipment and context) in natural language. */
  description: string;
  /** Free-text exercise ideas before catalog matching. */
  suggestedInNaturalLanguage: string[];
  /** False if analytics insert to `vision_detections` failed. */
  detectionLogged?: boolean;
};

export type ChatContextSet = {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: WeightUnit;
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

export type ChatContextBlock = {
  exerciseSlug: string;
  exerciseName: string;
  sets: ChatContextSet[];
  isActive?: boolean;
};

export type ChatContext = {
  exerciseSlug?: string;
  exerciseName?: string;
  sets?: ChatContextSet[];
  /** All exercise blocks present in the chat stream, in order. */
  blocks?: ChatContextBlock[];
};

export type BlockOperation =
  | { kind: "remove"; exerciseSlug: string }
  | { kind: "replace"; fromSlug: string; toSlug: string };

export type ChatSetSuggestion = {
  exerciseOptions: ExerciseRecord[];
  /**
   * Set when the server is confident about the exercise (exact slug/name match).
   * Client should skip the option picker and create/activate the block automatically.
   */
  autoResolvedExercise: ExerciseRecord | null;
  sets: SetDetail[];
  /**
   * Sets destined for OTHER exercises mentioned in the same user message
   * (multi-exercise single-turn logging, e.g. "squat 160×1, deadlift 200×1").
   * Each entry produces its own exercise block in the chat stream, in order.
   * The primary exercise + its sets still live in `autoResolvedExercise` and
   * `sets` above; this is strictly for any extras past the first.
   */
  additionalExercises?: {
    exercise: ExerciseRecord;
    sets: SetDetail[];
  }[];
  updates: SetUpdate[];
  /** Operations that add/remove/replace entire exercise blocks. */
  blockOperations: BlockOperation[];
  /**
   * When true, the new sets should REPLACE any existing sets on the
   * active exercise block instead of appending to them. Set by phrases
   * like "okay, I'm gonna start at 60kg…" — a clean restart of the
   * current lift's progression.
   */
  resetActiveBlockSets?: boolean;
  /**
   * When set, the client should auto-fill rep counts on every set in the
   * active block using the same RPE-calibrated algorithm as the
   * suggestion chips (default RPE 8 = 2 reps in reserve). Triggered by
   * messages like "scale the reps for me" / "fill in the reps".
   */
  scaleActiveBlockReps?: {
    targetRpe: number;
  } | null;
  /**
   * Mirror of `scaleActiveBlockReps` for the WEIGHT axis: pick weights
   * for every set whose reps are known but weight is missing, using the
   * same RPE-calibrated table the suggestion chips use. Triggered by
   * "you choose the weight" / "suggest the weights" / "pick weights" as
   * well as warmup ramps ("2 warmup + 3 working sets").
   *
   * When `warmupSets > 0`, the client ramps the first N sets from
   * `warmupStartPct * 1RM` up toward the working load. The hints live
   * here (not on the original message) so the client never has to
   * re-parse the user's raw text — the server has already done it.
   */
  scaleActiveBlockWeights?: {
    targetRpe: number;
    warmupSets?: number;
    warmupStartPct?: number;
  } | null;
  suggestedCommonReps: number[];
  suggestedCommonWeights: number[];
  userMessage: string;
  /**
   * Conversational reply from the AI for messages that aren't logging
   * actions (general questions, chit-chat, "who are you", etc.). When a set
   * logging / update / block op path fires this is ignored. When none of
   * those fire and a reply is present, the client surfaces it directly
   * instead of the generic "could not parse" fallback.
   */
  reply?: string | null;
  /**
   * Set when the AI recognises the message as an exercise help request
   * ("how do I do squats?", "what is a deadlift?", etc.) and wants the
   * client to render a dedicated guide card. The slug must belong to the
   * provided catalog; `mode` picks between step-by-step instructions and
   * a short description.
   */
  exerciseHelp?: {
    exerciseSlug: string;
    mode: "instructions" | "description";
  } | null;
};
