"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { useAppScrollRootRef } from "@/components/layout/app-scroll-area";
import { CameraPopup } from "@/components/camera/camera-popup";
import { CameraCandidates } from "@/components/chat/camera-candidates";
import { Composer } from "@/components/chat/composer";
import { ExerciseDescription } from "@/components/chat/exercise-description";
import { ExerciseOptions } from "@/components/chat/exercise-options";
import { AssistantTypingDots } from "@/components/chat/assistant-typing-dots";
import { MessageBubble } from "@/components/chat/message-bubble";
import {
  RecentWorkoutSuggestions,
  type RecentWorkoutSummary,
} from "@/components/chat/recent-workout-suggestions";
import { SuggestionChips } from "@/components/chat/suggestion-chips";
import {
  ExerciseBlockCard,
  type BlockSet,
} from "@/components/workout/exercise-block-card";
import {
  createManySets,
  createSet,
  createWorkoutSession,
  deleteSet,
  getChatSuggestion,
  recognizeVision,
  updateSet,
} from "@/lib/api";
import { getExerciseByName, getExerciseBySlug } from "@/lib/exercises";
import { planChatTurn } from "@/lib/chat-flow";
import { toKg } from "@/lib/lift-profiles";
import {
  estimateOneRm,
  prefillSetsFromEstimatedOneRm,
  percentageOfOneRm,
  repsAtRpe,
  suggestWeightsForSetSequence,
} from "@/lib/rep-percentages";
import {
  DEFAULT_WARMUP_START_PCT,
  parseWarmupHints,
} from "@/lib/warmup-hints";
import {
  flattenSets,
  formatWorkoutTitle,
  groupByExercise,
  type HistoryResponse,
} from "@/lib/workout-history";
import type {
  BlockOperation,
  ChatContext,
  EffortFeel,
  ExerciseRecord,
  ExerciseWeightCandidate,
  SetDetail,
  SetUpdate,
} from "@/lib/types/workout";

type ExerciseBlock = {
  id: string;
  exercise: ExerciseRecord;
  sets: BlockSet[];
  // Soft-delete: the block is kept in the chat stream as a greyed-out
  // tombstone, but is excluded from totals, AI context, and active-block
  // selection. This preserves scroll/history continuity when the user
  // removes an exercise.
  deleted?: boolean;
};

type Message =
  | { id: string; kind: "text"; role: "user" | "assistant" | "system"; text: string }
  | { id: string; kind: "camera-image"; role: "user"; imageUrl: string }
  | { id: string; kind: "exercise-block"; role: "assistant"; blockId: string }
  | {
      id: string;
      kind: "exercise-description";
      role: "assistant";
      exercise: ExerciseRecord;
      mode: "instructions" | "description";
    }
  | {
      id: string;
      kind: "exercise-options";
      role: "assistant";
      options: ExerciseRecord[];
      pendingSets: SetDetail[];
      // When set, tapping an option swaps the exercise on this block instead
      // of creating a new one. Used for the "logged as X — not right?" flow.
      boundBlockId?: string;
      resolved?: boolean;
      resolvedExerciseName?: string;
    }
  | {
      id: string;
      kind: "candidates";
      role: "assistant";
      candidates: ExerciseWeightCandidate[];
      resolved?: boolean;
    };

const SEED_MESSAGES: Message[] = [
  {
    id: "seed-1",
    kind: "text",
    role: "assistant",
    text: "Hey. Log old lifts so suggestions match your training — or track a current workout: name a lift, log sets with reps and weight, or use the camera on equipment.",
  },
];

let idCounter = 0;
function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/** Auto-log camera #1 only when the API reports a vision slug and high enough confidence. */
const VISION_AUTO_LOG_MIN_CONFIDENCE = 0.68;

function visionResponseDescriptionText(
  r: Awaited<ReturnType<typeof recognizeVision>>,
): string | null {
  const desc = r.description?.trim() || r.equipmentHint?.trim() || "";
  const ideas = (r.suggestedInNaturalLanguage ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!desc && ideas.length === 0) return null;
  const parts: string[] = [];
  if (desc) parts.push(desc);
  if (ideas.length > 0) {
    parts.push(`Suggested: ${ideas.join(" · ")}`);
  }
  return parts.join("\n\n");
}

export default function Home() {
  const queryClient = useQueryClient();
  // `?edit=<id>` switches the chat into "resume this session" mode. We can't
  // read it via a `useState` initializer because in a "use client" page that
  // renders during SSR `window` is undefined on the server, React hydrates
  // with that null value, and the initializer never re-runs on the client —
  // so the edit id would always be missing. A one-shot client-only effect
  // avoids the hydration mismatch.
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const isEditMode = editSessionId !== null;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const creatingSessionRef = useRef<Promise<string | null> | null>(null);
  const rehydratedRef = useRef(false);
  const [storageMode, setStorageMode] = useState<"database" | null>(null);
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [blocks, setBlocks] = useState<Record<string, ExerciseBlock>>({});
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [cameraBusy, setCameraBusy] = useState(false);
  // Refs mirror state so async flows (chat -> create block -> append sets) can
  // read the latest values without waiting for React to flush setState.
  const blocksRef = useRef<Record<string, ExerciseBlock>>({});
  const activeBlockIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>(SEED_MESSAGES);
  const collapsedBlockIdsRef = useRef<Set<string>>(new Set());
  // Sets the user typed before any exercise was named. Drained on the next
  // turn that creates/activates a block (see lib/chat-flow.ts).
  const bufferedSetsRef = useRef<SetDetail[]>([]);

  const scrollRootRef = useAppScrollRootRef();

  function commitBlocks(next: Record<string, ExerciseBlock>) {
    blocksRef.current = next;
    setBlocks(next);
  }

  function commitActiveBlockId(next: string | null) {
    activeBlockIdRef.current = next;
    setActiveBlockId(next);
  }

  function commitMessages(next: Message[]) {
    messagesRef.current = next;
    setMessages(next);
  }

  function commitCollapsed(next: Set<string>) {
    collapsedBlockIdsRef.current = next;
    setCollapsedBlockIds(next);
  }

  function collapseOthers(keepExpandedId: string | null) {
    const next = new Set<string>();
    for (const id of Object.keys(blocksRef.current)) {
      if (id !== keepExpandedId) next.add(id);
    }
    commitCollapsed(next);
  }

  function toggleBlockCollapsed(blockId: string) {
    const current = collapsedBlockIdsRef.current;
    if (current.has(blockId)) {
      // Expanding this one → collapse all others.
      collapseOthers(blockId);
      commitActiveBlockId(blockId);
    } else {
      const next = new Set(current);
      next.add(blockId);
      commitCollapsed(next);
    }
  }

  // Read `?edit=<id>` once on the client. See the note on `editSessionId`
  // above — we can't use a useState initializer because SSR renders this
  // component with `window` undefined and React would then hydrate with the
  // server value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = new URLSearchParams(window.location.search).get("edit");
    if (value && value.trim()) setEditSessionId(value);
  }, []);

  useEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, blocks, scrollRootRef]);

  const createWorkoutMutation = useMutation({
    mutationFn: () =>
      createWorkoutSession({ groupName: "Today", sessionName: "Current workout" }),
    onSuccess: (payload) => {
      setSessionId(payload.session.id);
      sessionIdRef.current = payload.session.id;
      setStorageMode(payload.storageMode ?? null);
    },
    onError: () => toast.error("Could not start workout session"),
  });

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  async function ensureSessionId(): Promise<string | null> {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (creatingSessionRef.current) return creatingSessionRef.current;

    const pending = createWorkoutMutation
      .mutateAsync()
      .then((payload) => {
        const id = payload?.session?.id ?? null;
        if (id) sessionIdRef.current = id;
        return id;
      })
      .catch(() => null)
      .finally(() => {
        creatingSessionRef.current = null;
      });

    creatingSessionRef.current = pending;
    return pending;
  }

  const chatMutation = useMutation({
    mutationFn: (input: { message: string; context?: ChatContext }) =>
      getChatSuggestion(input.message, input.context),
  });

  // Pull the user's past sessions so we can offer "start from last workout"
  // templates at the top of a fresh chat. Shares the same query key as the
  // home page so both views stay in sync via React Query's cache.
  const historyQuery = useQuery<HistoryResponse>({
    queryKey: ["workouts"],
    queryFn: async () => {
      const response = await fetch("/api/workouts");
      if (!response.ok) {
        let message = "Failed to load history";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {}
        throw new Error(message);
      }
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const recentWorkouts = useMemo<RecentWorkoutSummary[]>(() => {
    const groups = historyQuery.data?.groups ?? [];
    const summaries: RecentWorkoutSummary[] = [];
    for (const group of groups) {
      for (const session of group.sessions) {
        // Never suggest "start from" the session we're actively editing —
        // it's already on the screen.
        if (session.id === editSessionId) continue;
        const sets = flattenSets(session);
        if (sets.length === 0) continue;
        const exerciseGroups = groupByExercise(sets);
        if (exerciseGroups.length === 0) continue;
        summaries.push({
          id: session.id,
          title: formatWorkoutTitle(session.startedAt, session.name),
          exerciseNames: exerciseGroups.map((entry) => entry.exerciseName),
          totalSets: sets.length,
        });
        if (summaries.length >= 5) return summaries;
      }
    }
    return summaries;
  }, [historyQuery.data, editSessionId]);

  // Rehydrate an existing workout session when the URL carries `?edit=<id>`.
  // Rebuilds the exercise blocks + sets from the cached history payload so
  // the user lands in the chat exactly as they left it — every existing set
  // carries its DB id so subsequent edits/deletes target real rows instead
  // of creating duplicates.
  useEffect(() => {
    if (!editSessionId || rehydratedRef.current) return;
    const groups = historyQuery.data?.groups;
    if (!groups) return;

    const session = groups
      .flatMap((group) => group.sessions)
      .find((candidate) => candidate.id === editSessionId);
    if (!session) {
      // Query loaded but session isn't present (deleted elsewhere / bad id).
      // Fall back to a fresh chat rather than leaving the user stuck with an
      // empty screen.
      rehydratedRef.current = true;
      toast.error("Couldn't find that workout — starting a fresh session.");
      commitMessages(SEED_MESSAGES);
      sessionIdRef.current = null;
      setSessionId(null);
      return;
    }

    sessionIdRef.current = session.id;
    setSessionId(session.id);
    setStorageMode(historyQuery.data?.storageMode ?? null);

    // `flattenSets` + `groupByExercise` normalise the nested API payload
    // (session.exercises[].sets[]) into a single per-exercise grouping.
    const flatSets = flattenSets(session);
    const exerciseGroups = groupByExercise(flatSets);

    const nextBlocks: Record<string, ExerciseBlock> = {};
    const orderedBlockIds: string[] = [];
    const blockMessages: Message[] = [];
    const seenSlugs = new Set<string>();

    for (const group of exerciseGroups) {
      const record = getExerciseByName(group.exerciseName);
      if (!record) continue;
      // Collapse duplicate blocks for the same exercise into one — the backend
      // allows multiple SessionExercise rows per session but our chat
      // UI treats each catalog exercise as a single block.
      if (seenSlugs.has(record.slug)) continue;
      seenSlugs.add(record.slug);

      const sortedSets = [...group.sets].sort((a, b) => {
        const aNum = a.setNumber ?? 0;
        const bNum = b.setNumber ?? 0;
        return aNum - bNum;
      });

      const blockSets: BlockSet[] = sortedSets.map((set, index) => {
        const weightNumber =
          set.weight === null || set.weight === undefined
            ? null
            : Number(set.weight);
        const rpeNumber =
          set.rpe === null || set.rpe === undefined ? null : Number(set.rpe);
        const feelValue =
          set.feel === "easy" || set.feel === "medium" || set.feel === "hard"
            ? set.feel
            : null;
        return {
          id: makeId("set"),
          dbId: set.id,
          setNumber: set.setNumber ?? index + 1,
          reps: typeof set.reps === "number" ? set.reps : null,
          weight:
            weightNumber === null || !Number.isFinite(weightNumber)
              ? null
              : weightNumber,
          weightUnit: set.weightUnit === "lb" ? "lb" : "kg",
          source: "chat",
          rpe:
            rpeNumber !== null && Number.isFinite(rpeNumber) ? rpeNumber : null,
          rir: typeof set.rir === "number" ? set.rir : null,
          feel: feelValue,
        };
      });

      const blockId = makeId("block");
      nextBlocks[blockId] = {
        id: blockId,
        exercise: record,
        sets: blockSets,
      };
      orderedBlockIds.push(blockId);
      blockMessages.push({
        id: makeId("msg"),
        kind: "exercise-block",
        role: "assistant",
        blockId,
      });
    }

    rehydratedRef.current = true;

    if (orderedBlockIds.length === 0) {
      // Session has no recognisable exercises — drop back to a blank chat
      // but still adopt the existing session id so new logs land on it.
      commitMessages(SEED_MESSAGES);
      return;
    }

    commitBlocks(nextBlocks);
    const activeId = orderedBlockIds[orderedBlockIds.length - 1];
    commitActiveBlockId(activeId);
    // Collapse every block except the last so the user sees the full
    // history stacked at the top with the newest one open for editing.
    const collapsed = new Set<string>(orderedBlockIds.slice(0, -1));
    commitCollapsed(collapsed);

    const intro: Message = {
      id: makeId("msg"),
      kind: "text",
      role: "assistant",
      text: `Resumed ${formatWorkoutTitle(session.startedAt, session.name)}. Keep logging or tweak any set — changes save straight to this session.`,
    };
    commitMessages([intro, ...blockMessages]);
  }, [editSessionId, historyQuery.data]);

  const duplicatingRef = useRef(false);
  async function handleDuplicateWorkout(sessionId: string) {
    if (duplicatingRef.current) return;

    const sessionMatch = (historyQuery.data?.groups ?? [])
      .flatMap((group) => group.sessions)
      .find((session) => session.id === sessionId);
    if (!sessionMatch) return;

    const exerciseGroups = groupByExercise(flattenSets(sessionMatch));

    // Resolve each historic exercise name to a catalog record and snapshot
    // its sets. Names that don't match (e.g. free-text custom exercises)
    // are skipped — we don't want phantom blocks that can't be logged
    // against.
    type CopyPlan = { record: ExerciseRecord; sets: SetDetail[] };
    const plans: CopyPlan[] = [];
    const seenSlugs = new Set<string>();
    for (const group of exerciseGroups) {
      const record = getExerciseByName(group.exerciseName);
      if (!record || seenSlugs.has(record.slug)) continue;
      seenSlugs.add(record.slug);

      const sets: SetDetail[] = group.sets.map((set, index) => {
        const weightNum =
          set.weight === null || set.weight === undefined
            ? null
            : Number(set.weight);
        const rpeNum =
          set.rpe === null || set.rpe === undefined ? null : Number(set.rpe);
        const feelValue =
          set.feel === "easy" || set.feel === "medium" || set.feel === "hard"
            ? set.feel
            : null;
        return {
          setNumber: index + 1,
          reps: typeof set.reps === "number" ? set.reps : null,
          weight:
            weightNum === null || !Number.isFinite(weightNum) ? null : weightNum,
          weightUnit: set.weightUnit === "lb" ? "lb" : "kg",
          rpe: rpeNum !== null && Number.isFinite(rpeNum) ? rpeNum : null,
          rir: typeof set.rir === "number" ? set.rir : null,
          feel: feelValue,
        };
      });

      plans.push({ record, sets });
    }

    if (plans.length === 0) {
      toast.error("Couldn't match any exercises in that workout.");
      return;
    }

    duplicatingRef.current = true;
    try {
      for (const plan of plans) {
        const { blockId } = ensureBlockForExercise(plan.record);
        if (plan.sets.length > 0) {
          await appendSetsToBlock(blockId, plan.sets, "chat");
        }
      }

      // Expand the FIRST block (not the last, which is what
      // ensureBlockForExercise leaves active) so the user starts from the
      // top of the copied workout.
      const firstSlug = plans[0].record.slug;
      const firstBlock = Object.values(blocksRef.current).find(
        (block) => !block.deleted && block.exercise.slug === firstSlug,
      );
      if (firstBlock) {
        commitActiveBlockId(firstBlock.id);
        collapseOthers(firstBlock.id);
      }

      const totalSets = plans.reduce((acc, plan) => acc + plan.sets.length, 0);
      const exerciseLabel =
        plans.length === 1 ? "exercise" : "exercises";
      const setLabel = totalSets === 1 ? "set" : "sets";
      toast.success(
        totalSets > 0
          ? `Copied ${plans.length} ${exerciseLabel} · ${totalSets} ${setLabel}.`
          : `Copied ${plans.length} ${exerciseLabel}.`,
      );
    } finally {
      duplicatingRef.current = false;
    }
  }

  const activeBlock = activeBlockId ? blocks[activeBlockId] ?? null : null;
  const activeExercise =
    activeBlock && !activeBlock.deleted ? activeBlock.exercise : null;
  const hasAnyBlock = useMemo(
    () => Object.values(blocks).some((block) => !block.deleted),
    [blocks],
  );
  // The "start from a recent workout" card should only appear on a fresh
  // chat — the moment the user types anything, it goes away so it doesn't
  // interrupt the conversation flow.
  const hasUserMessage = useMemo(
    () => messages.some((message) => message.role === "user"),
    [messages],
  );
  const allSets = useMemo(
    () =>
      Object.values(blocks)
        .filter((block) => !block.deleted)
        .flatMap((block) => block.sets),
    [blocks],
  );
  // `lastSet` feeds the quick-action chips (Same again, +5kg, etc.), so it
  // must refer to the last set of the *active* exercise — not the last set
  // across the whole session. Otherwise clicking "+5kg" on a fresh exercise
  // would base the delta off a previous exercise's weight (e.g. tapping
  // "+5kg" after switching from Bench to Dips would add 5 to the Bench
  // weight instead of starting Dips at 0 or its own baseline).
  const activeBlockLastSet =
    activeBlock && activeBlock.sets.length > 0
      ? activeBlock.sets[activeBlock.sets.length - 1]
      : null;
  const lastSet = activeBlockLastSet ?? allSets[allSets.length - 1] ?? null;
  const lastWeightUnit: "kg" | "lb" = lastSet?.weightUnit ?? "kg";

  const sessionStats = useMemo(() => {
    const totalVolume = allSets.reduce((sum, set) => {
      const reps = set.reps ?? 0;
      const weight = set.weight ?? 0;
      return sum + reps * weight;
    }, 0);
    return {
      count: allSets.length,
      volume: Math.round(totalVolume),
      unit: lastWeightUnit,
    };
  }, [allSets, lastWeightUnit]);

  function appendMessage(message: Message) {
    commitMessages([...messagesRef.current, message]);
  }

  function findBlockBySlug(slug: string): ExerciseBlock | null {
    return (
      Object.values(blocksRef.current).find(
        (block) => !block.deleted && block.exercise.slug === slug,
      ) ?? null
    );
  }

  function ensureBlockForExercise(
    exercise: ExerciseRecord,
  ): { blockId: string; created: boolean } {
    const currentActiveId = activeBlockIdRef.current;
    const existing = currentActiveId ? blocksRef.current[currentActiveId] : null;
    if (existing && !existing.deleted && existing.exercise.slug === exercise.slug) {
      return { blockId: existing.id, created: false };
    }

    const newBlock: ExerciseBlock = {
      id: makeId("block"),
      exercise,
      sets: [],
    };
    commitBlocks({ ...blocksRef.current, [newBlock.id]: newBlock });
    commitActiveBlockId(newBlock.id);
    // New block becomes the only expanded one.
    collapseOthers(newBlock.id);
    appendMessage({
      id: makeId("msg"),
      kind: "exercise-block",
      role: "assistant",
      blockId: newBlock.id,
    });
    return { blockId: newBlock.id, created: true };
  }

  function removeBlock(blockId: string) {
    const block = blocksRef.current[blockId];
    if (!block || block.deleted) return false;

    // Soft-delete: keep the card in the chat stream (greyed out) so the
    // conversation scroll position is preserved, but mark it so totals,
    // AI context, and active-block tracking skip it.
    const nextBlocks = {
      ...blocksRef.current,
      [blockId]: { ...block, deleted: true },
    };
    commitBlocks(nextBlocks);

    if (activeBlockIdRef.current === blockId) {
      // Fall back to the most recent non-deleted block, if any.
      const remainingIds = messagesRef.current
        .filter(
          (entry): entry is Extract<Message, { kind: "exercise-block" }> =>
            entry.kind === "exercise-block",
        )
        .map((entry) => entry.blockId)
        .filter((id) => nextBlocks[id] && !nextBlocks[id].deleted);
      const nextActive = remainingIds[remainingIds.length - 1] ?? null;
      commitActiveBlockId(nextActive);
      collapseOthers(nextActive);
    }

    // Collapse the tombstone so it doesn't take up space in the stream.
    if (!collapsedBlockIdsRef.current.has(blockId)) {
      const nextCollapsed = new Set(collapsedBlockIdsRef.current);
      nextCollapsed.add(blockId);
      commitCollapsed(nextCollapsed);
    }

    // DB-level: still remove the underlying set entries so totals on the
    // backend/history match what the user sees.
    Promise.all(
      block.sets
        .map((set) => set.dbId)
        .filter((id): id is string => Boolean(id))
        .map((id) => deleteSet(id).catch(() => undefined)),
    ).then(() => queryClient.invalidateQueries({ queryKey: ["workouts"] }));

    return true;
  }

  async function restoreBlock(blockId: string) {
    const block = blocksRef.current[blockId];
    if (!block || !block.deleted) return;
    const activeSessionId = sessionIdRef.current ?? (await ensureSessionId());
    if (!activeSessionId) {
      toast.error("Session not ready yet");
      return;
    }

    // Flip the flag first so the UI updates immediately. The DB sets below
    // are recreated in the background; their new `dbId`s get patched in as
    // each request resolves.
    commitBlocks({
      ...blocksRef.current,
      [blockId]: { ...block, deleted: false },
    });
    commitActiveBlockId(blockId);
    collapseOthers(blockId);

    // The backend copies of these sets were deleted when the block was
    // removed, so recreate each one and stitch the fresh `dbId` back onto
    // the local set entry.
    for (const set of block.sets) {
      try {
        const response = await createSet({
          sessionId: activeSessionId,
          exercise: block.exercise.name,
          reps: set.reps,
          weight: set.weight,
          weightUnit: set.weightUnit,
          setNumber: set.setNumber,
          source: set.source,
          rpe: set.rpe ?? null,
          rir: set.rir ?? null,
          feel: set.feel ?? null,
        });
        const dbId: string | undefined = response?.created?.id;
        const current = blocksRef.current[blockId];
        if (!current) break;
        commitBlocks({
          ...blocksRef.current,
          [blockId]: {
            ...current,
            sets: current.sets.map((entry) =>
              entry.id === set.id ? { ...entry, dbId } : entry,
            ),
          },
        });
      } catch {
        // Non-fatal: the set stays in local state without a dbId, so it
        // behaves like an unsynced entry until the next mutation.
      }
    }
    queryClient.invalidateQueries({ queryKey: ["workouts"] });
  }

  function replaceBlockExercise(blockId: string, nextExercise: ExerciseRecord) {
    const block = blocksRef.current[blockId];
    if (!block) return false;
    if (block.exercise.slug === nextExercise.slug) return false;

    commitBlocks({
      ...blocksRef.current,
      [blockId]: { ...block, exercise: nextExercise },
    });
    return true;
  }

  function clearSetsInBlock(blockId: string) {
    const block = blocksRef.current[blockId];
    if (!block || block.sets.length === 0) return;

    commitBlocks({
      ...blocksRef.current,
      [blockId]: { ...block, sets: [] },
    });

    const dbIds = block.sets
      .map((entry) => entry.dbId)
      .filter((id): id is string => Boolean(id));
    if (dbIds.length > 0) {
      Promise.all(dbIds.map((id) => deleteSet(id).catch(() => undefined))).then(
        () => queryClient.invalidateQueries({ queryKey: ["workouts"] }),
      );
    }
  }

  function removeSetFromBlock(blockId: string, setId: string) {
    const block = blocksRef.current[blockId];
    if (!block) return;
    const target = block.sets.find((entry) => entry.id === setId);
    if (!target) return;

    // Renumber remaining sets so the UI stays sequential (1..n).
    const nextSets: BlockSet[] = block.sets
      .filter((entry) => entry.id !== setId)
      .map((entry, index) => ({ ...entry, setNumber: index + 1 }));

    commitBlocks({
      ...blocksRef.current,
      [blockId]: { ...block, sets: nextSets },
    });

    if (target.dbId) {
      deleteSet(target.dbId)
        .catch(() => undefined)
        .finally(() =>
          queryClient.invalidateQueries({ queryKey: ["workouts"] }),
        );
    }
  }

  async function addSetToBlock(
    blockId: string,
    set: {
      reps: number | null;
      weight: number | null;
      weightUnit: "kg" | "lb";
      source: "manual" | "camera" | "chat";
      rpe?: number | null;
      rir?: number | null;
      feel?: EffortFeel | null;
    },
  ): Promise<boolean> {
    const activeSessionId = sessionIdRef.current ?? (await ensureSessionId());
    if (!activeSessionId) {
      toast.error("Session not ready yet");
      return false;
    }

    const block = blocksRef.current[blockId];
    if (!block) return false;

    // Per-block set numbering matches the DB's per-SessionExercise setNumber.
    const setNumber = block.sets.length + 1;

    try {
      const response = await createSet({
        sessionId: activeSessionId,
        exercise: block.exercise.name,
        reps: set.reps,
        weight: set.weight,
        weightUnit: set.weightUnit,
        setNumber,
        source: set.source,
        rpe: set.rpe ?? null,
        rir: set.rir ?? null,
        feel: set.feel ?? null,
      });

      const dbId: string | undefined = response?.created?.id;

      const newSet: BlockSet = {
        id: makeId("set"),
        dbId,
        setNumber,
        reps: set.reps,
        weight: set.weight,
        weightUnit: set.weightUnit,
        source: set.source,
        rpe: set.rpe ?? null,
        rir: set.rir ?? null,
        feel: set.feel ?? null,
      };

      const currentBlock = blocksRef.current[blockId];
      if (!currentBlock) return false;
      commitBlocks({
        ...blocksRef.current,
        [blockId]: { ...currentBlock, sets: [...currentBlock.sets, newSet] },
      });

      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      return true;
    } catch {
      toast.error("Could not log set");
      return false;
    }
  }

  // If the block's last set is missing a value that this incoming set can
  // fill (and nothing conflicts), patch the existing set in place instead of
  // creating a new one. Returns true when a merge happened.
  async function maybeMergeIntoLastSet(
    blockId: string,
    incoming: SetDetail,
  ): Promise<boolean> {
    const block = blocksRef.current[blockId];
    if (!block || block.sets.length === 0) return false;

    const last = block.sets[block.sets.length - 1];
    const lastMissingReps = last.reps === null || last.reps === undefined;
    const lastMissingWeight = last.weight === null || last.weight === undefined;
    if (!lastMissingReps && !lastMissingWeight) return false;

    const incomingHasReps = incoming.reps !== null && incoming.reps !== undefined;
    const incomingHasWeight =
      incoming.weight !== null && incoming.weight !== undefined;

    // Nothing new to contribute.
    if (!incomingHasReps && !incomingHasWeight) return false;

    // Don't overwrite values that already exist on the last set.
    if (incomingHasReps && !lastMissingReps && incoming.reps !== last.reps) {
      return false;
    }
    if (
      incomingHasWeight &&
      !lastMissingWeight &&
      Number(incoming.weight) !== Number(last.weight)
    ) {
      return false;
    }

    const nextReps = lastMissingReps && incomingHasReps ? incoming.reps : last.reps;
    const nextWeight =
      lastMissingWeight && incomingHasWeight ? incoming.weight : last.weight;
    const nextUnit =
      lastMissingWeight && incomingHasWeight
        ? incoming.weightUnit
        : last.weightUnit;

    // Fold in any effort the incoming set carries that the existing one
    // doesn't already have. We never overwrite an existing effort value.
    const nextRpe =
      incoming.rpe !== undefined && incoming.rpe !== null && (last.rpe === null || last.rpe === undefined)
        ? incoming.rpe
        : last.rpe ?? null;
    const nextRir =
      incoming.rir !== undefined && incoming.rir !== null && (last.rir === null || last.rir === undefined)
        ? incoming.rir
        : last.rir ?? null;
    const nextFeel =
      incoming.feel !== undefined && incoming.feel !== null && !last.feel
        ? incoming.feel
        : last.feel ?? null;

    // If nothing actually changed, bail out so we don't spam the server.
    if (
      nextReps === last.reps &&
      nextWeight === last.weight &&
      nextUnit === last.weightUnit &&
      nextRpe === (last.rpe ?? null) &&
      nextRir === (last.rir ?? null) &&
      nextFeel === (last.feel ?? null)
    ) {
      return false;
    }

    const updatedSet: BlockSet = {
      ...last,
      reps: nextReps,
      weight: nextWeight,
      weightUnit: nextUnit,
      rpe: nextRpe,
      rir: nextRir,
      feel: nextFeel,
    };
    const nextSets = [...block.sets.slice(0, -1), updatedSet];
    commitBlocks({
      ...blocksRef.current,
      [blockId]: { ...block, sets: nextSets },
    });

    if (last.dbId) {
      const patch: {
        reps?: number | null;
        weight?: number | null;
        weightUnit?: "kg" | "lb";
        rpe?: number | null;
        rir?: number | null;
        feel?: EffortFeel | null;
      } = {};
      if (nextReps !== last.reps) patch.reps = nextReps;
      if (nextWeight !== last.weight) patch.weight = nextWeight;
      if (nextUnit !== last.weightUnit) patch.weightUnit = nextUnit;
      if (nextRpe !== (last.rpe ?? null)) patch.rpe = nextRpe;
      if (nextRir !== (last.rir ?? null)) patch.rir = nextRir;
      if (nextFeel !== (last.feel ?? null)) patch.feel = nextFeel;
      if (Object.keys(patch).length > 0) {
        updateSet(last.dbId, patch)
          .catch(() => undefined)
          .finally(() =>
            queryClient.invalidateQueries({ queryKey: ["workouts"] }),
          );
      }
    }
    return true;
  }

  async function appendSetsToBlock(
    blockId: string,
    sets: SetDetail[],
    source: "manual" | "camera" | "chat",
    hintMessage?: string,
  ) {
    const block = blocksRef.current[blockId];
    const canAutoPrefill =
      source === "chat" &&
      Boolean(block) &&
      (block?.sets.length ?? 0) === 0 &&
      sets.some(
        (set) =>
          set.reps === null ||
          set.reps === undefined ||
          set.weight === null ||
          set.weight === undefined,
      );

    const estimateOneRmProfileForExercise = (
      exerciseSlug: string,
    ): { oneRmKg: number; sourceReps: number } | null => {
      let bestOneRm = 0;
      let sourceReps = 5;

      const sessions = (historyQuery.data?.groups ?? []).flatMap(
        (group) => group.sessions,
      );
      for (const session of sessions) {
        for (const entry of flattenSets(session)) {
          const matched = getExerciseByName(entry.exerciseName);
          if (!matched || matched.slug !== exerciseSlug) continue;
          const reps =
            typeof entry.reps === "number" && entry.reps > 0 ? entry.reps : null;
          const weight = Number(entry.weight);
          if (!reps || !Number.isFinite(weight) || weight <= 0) continue;
          const est = estimateOneRm(toKg(weight, entry.weightUnit), reps);
          if (est > bestOneRm) {
            bestOneRm = est;
            sourceReps = reps;
          }
        }
      }

      for (const entry of Object.values(blocksRef.current)) {
        if (entry.deleted || entry.exercise.slug !== exerciseSlug) continue;
        for (const set of entry.sets) {
          const reps = set.reps ?? null;
          const weight = set.weight ?? null;
          if (reps === null || reps < 1 || weight === null || weight <= 0) {
            continue;
          }
          const est = estimateOneRm(toKg(weight, set.weightUnit), reps);
          if (est > bestOneRm) {
            bestOneRm = est;
            sourceReps = reps;
          }
        }
      }

      return bestOneRm > 0 ? { oneRmKg: bestOneRm, sourceReps } : null;
    };

    const normalizedSets =
      canAutoPrefill && block
        ? (() => {
            const profile = estimateOneRmProfileForExercise(block.exercise.slug);
            if (!profile) return sets;
            // Prefer the rep target the user just asked for in THIS message
            // (e.g. "3 heavy 5s") when filling missing reps, rather than
            // defaulting to a historic PR rep-count like 1.
            const messageReps = sets
              .map((set) => set.reps)
              .filter(
                (reps): reps is number =>
                  typeof reps === "number" && Number.isFinite(reps) && reps > 0,
              );
            const defaultReps =
              messageReps.length > 0
                ? Math.round(
                    messageReps.reduce((sum, reps) => sum + reps, 0) /
                      messageReps.length,
                  )
                : Math.max(5, profile.sourceReps);
            const { warmupSets, warmupStartPct } = parseWarmupHints(hintMessage);

            // First fill missing reps from the message's working intent / 1RM
            // profile so downstream weight sequencing has explicit rep targets.
            const repFilled = prefillSetsFromEstimatedOneRm(sets, profile.oneRmKg, {
              targetRpe: 8,
              defaultReps,
            });

            const hasMissingWeight = repFilled.some(
              (set) => set.weight === null || set.weight === undefined || set.weight <= 0,
            );
            if (!hasMissingWeight) return repFilled;

            const kgSequence = suggestWeightsForSetSequence(
              repFilled.map((set) => ({ reps: set.reps })),
              profile.oneRmKg,
              {
                targetRpe: 8,
                defaultReps,
                warmupSets,
                warmupStartPct,
              },
            );
            const kgPerLb = 0.45359237;
            const increment = 5;

            return repFilled.map((set, index) => {
              if (set.weight !== null && set.weight !== undefined && set.weight > 0) {
                return set;
              }
              const kg = kgSequence[index];
              if (kg === null || kg <= 0) return set;
              const inUnit = set.weightUnit === "lb" ? kg / kgPerLb : kg;
              const rounded = Math.round(inUnit / increment) * increment;
              if (rounded <= 0) return set;
              return { ...set, weight: rounded };
            });
          })()
        : sets;

    const mergedFirst =
      normalizedSets.length > 0 &&
      (await maybeMergeIntoLastSet(blockId, normalizedSets[0]!));
    const toCreate = mergedFirst ? normalizedSets.slice(1) : normalizedSets;
    if (toCreate.length === 0) return;

    const activeSessionId = sessionIdRef.current ?? (await ensureSessionId());
    if (!activeSessionId) {
      toast.error("Session not ready yet");
      return;
    }

    const blockAfter = blocksRef.current[blockId];
    if (!blockAfter) return;

    const startNum = blockAfter.sets.length + 1;

    try {
      const response = await createManySets({
        sessionId: activeSessionId,
        exercise: blockAfter.exercise.name,
        source,
        startingSetNumber: startNum,
        entries: toCreate.map((set) => ({
          reps: set.reps,
          weight: set.weight,
          weightUnit: set.weightUnit,
          rpe: set.rpe ?? null,
          rir: set.rir ?? null,
          feel: set.feel ?? null,
        })),
      });

      const createdRows = response.created;
      const newSets: BlockSet[] = toCreate.map((set, index) => ({
        id: makeId("set"),
        dbId: createdRows[index]?.id,
        setNumber: startNum + index,
        reps: set.reps,
        weight: set.weight,
        weightUnit: set.weightUnit,
        source,
        rpe: set.rpe ?? null,
        rir: set.rir ?? null,
        feel: set.feel ?? null,
      }));

      commitBlocks({
        ...blocksRef.current,
        [blockId]: { ...blockAfter, sets: [...blockAfter.sets, ...newSets] },
      });

      queryClient.invalidateQueries({ queryKey: ["workouts"] });
    } catch {
      toast.error("Could not log sets");
    }
  }

  /**
   * Auto-fill rep counts on every weighted set in the active block using
   * the suggestion-chip algorithm: pick reps such that the lifter would
   * be at the requested RPE (default 8) on this weight given their
   * estimated 1RM. Mirrors the math in the chip useMemos above.
   *
   * Returns the number of sets that ended up changing.
   */
  async function scaleActiveBlockRepsByRpe(
    targetRpe: number,
    targetBlockId?: string,
  ): Promise<number> {
    const activeId = targetBlockId ?? activeBlockIdRef.current;
    if (!activeId) return 0;
    const block = blocksRef.current[activeId];
    if (!block || block.deleted) return 0;
    // Compute 1RM from refs directly — `activeExerciseOneRmKg` is stale
    // inside the same handler tick that just committed these sets.
    const oneRmKg = getEstimatedOneRmKgForSlug(block.exercise.slug);
    if (oneRmKg === null || oneRmKg <= 0) return 0;

    const updates: SetUpdate[] = [];
    for (const setEntry of block.sets) {
      if (setEntry.weight === null || setEntry.weight <= 0) continue;
      const reps = repsAtRpe(
        toKg(setEntry.weight, setEntry.weightUnit),
        oneRmKg,
        targetRpe,
      );
      if (reps === null || reps === setEntry.reps) continue;
      updates.push({ targetSetNumbers: [setEntry.setNumber], reps });
    }
    if (updates.length === 0) return 0;
    return applyUpdatesToBlock(activeId, updates);
  }

  /**
   * Mirror of scaleActiveBlockRepsByRpe for the weight axis: for every
   * set in the given block (active by default) that already has a rep
   * count but no weight, compute the working weight via the same RPE
   * table the chips use, then round to the closest gym-friendly
   * increment (5kg / 5lb).
   *
   * Prefers explicit `warmupSets` / `warmupStartPct` from the server
   * action (already parsed from the user's message) so we don't
   * double-parse and risk drifting.
   *
   * Returns a tuple: (number of sets changed, whether the target block
   * had a known 1RM). The 1RM flag lets the caller distinguish "I
   * couldn't scale because there's no 1RM" from "I couldn't scale
   * because every set was already fine".
   */
  async function scaleBlockWeightsByRpe(
    targetRpe: number,
    overrides?: {
      warmupSets?: number;
      warmupStartPct?: number;
      hintMessage?: string;
      targetBlockId?: string;
    },
  ): Promise<{ changed: number; hadOneRm: boolean }> {
    const activeId = overrides?.targetBlockId ?? activeBlockIdRef.current;
    if (!activeId) return { changed: 0, hadOneRm: false };
    const block = blocksRef.current[activeId];
    if (!block || block.deleted) return { changed: 0, hadOneRm: false };
    // Pull 1RM from refs so we see sets committed earlier in this same
    // handler tick (the memoised version would still report null).
    const oneRmKg = getEstimatedOneRmKgForSlug(block.exercise.slug);
    if (oneRmKg === null || oneRmKg <= 0) {
      return { changed: 0, hadOneRm: false };
    }
    const increment = 5;
    const lbPerKg = 1 / 0.45359237;

    const parsed = parseWarmupHints(overrides?.hintMessage);
    const warmupSets =
      overrides?.warmupSets ??
      parsed.warmupSets;
    const warmupStartPct =
      overrides?.warmupStartPct ??
      parsed.warmupStartPct ??
      DEFAULT_WARMUP_START_PCT;

    const warmupMode = warmupSets > 0;
    const fillable = block.sets.filter((setEntry) => {
      if (setEntry.reps === null || setEntry.reps <= 0) return false;
      // Warmup requests should be allowed to re-shape existing weights so
      // a previously prefilled warmup can't stay heavier than the working
      // sets. Non-warmup requests only fill truly missing weights.
      if (warmupMode) return true;
      return setEntry.weight === null || setEntry.weight <= 0;
    });
    const sequence = suggestWeightsForSetSequence(
      fillable.map((setEntry) => ({ reps: setEntry.reps })),
      oneRmKg,
      {
        targetRpe,
        warmupSets,
        warmupStartPct,
      },
    );

    const updates: SetUpdate[] = [];
    for (let i = 0; i < fillable.length; i += 1) {
      const setEntry = fillable[i]!;
      const recommendedKg = sequence[i];
      if (recommendedKg === null || recommendedKg <= 0) continue;
      const recommendedInUnit =
        setEntry.weightUnit === "lb" ? recommendedKg * lbPerKg : recommendedKg;
      const rounded = Math.round(recommendedInUnit / increment) * increment;
      if (rounded <= 0) continue;
      if (!warmupMode && setEntry.weight !== null && setEntry.weight > 0) {
        continue;
      }
      if (
        warmupMode &&
        setEntry.weight !== null &&
        Math.abs(setEntry.weight - rounded) < 0.001
      ) {
        continue;
      }
      updates.push({
        targetSetNumbers: [setEntry.setNumber],
        weight: rounded,
        weightUnit: setEntry.weightUnit,
      });
    }
    if (updates.length === 0) return { changed: 0, hadOneRm: true };
    const changed = await applyUpdatesToBlock(activeId, updates);
    return { changed, hadOneRm: true };
  }

  async function applyUpdatesToActiveBlock(updates: SetUpdate[]) {
    const activeId = activeBlockIdRef.current;
    if (!activeId) return 0;
    return applyUpdatesToBlock(activeId, updates);
  }

  async function applyUpdatesToBlock(blockId: string, updates: SetUpdate[]) {
    if (updates.length === 0 || !blockId) return 0;
    const activeId = blockId;
    const block = blocksRef.current[activeId];
    if (!block) return 0;

    const updatedSets = block.sets.map((setEntry) => {
      const relevant = updates.find((update) =>
        update.targetSetNumbers.includes(setEntry.setNumber),
      );
      if (!relevant) return setEntry;
      return {
        ...setEntry,
        ...(relevant.reps !== undefined ? { reps: relevant.reps } : {}),
        ...(relevant.weight !== undefined ? { weight: relevant.weight } : {}),
        ...(relevant.weightUnit !== undefined
          ? { weightUnit: relevant.weightUnit }
          : {}),
        ...(relevant.rpe !== undefined ? { rpe: relevant.rpe } : {}),
        ...(relevant.rir !== undefined ? { rir: relevant.rir } : {}),
        ...(relevant.feel !== undefined ? { feel: relevant.feel } : {}),
      };
    });

    const changedCount = updatedSets.reduce(
      (acc, next, index) => (next === block.sets[index] ? acc : acc + 1),
      0,
    );
    if (changedCount === 0) return 0;

    commitBlocks({
      ...blocksRef.current,
      [block.id]: { ...block, sets: updatedSets },
    });

    await Promise.all(
      updatedSets.flatMap((setEntry, index) => {
        const previous = block.sets[index];
        if (!setEntry.dbId || setEntry === previous) return [];
        const patch: {
          reps?: number | null;
          weight?: number | null;
          weightUnit?: "kg" | "lb";
          rpe?: number | null;
          rir?: number | null;
          feel?: EffortFeel | null;
        } = {};
        if (setEntry.reps !== previous.reps) patch.reps = setEntry.reps;
        if (setEntry.weight !== previous.weight) patch.weight = setEntry.weight;
        if (setEntry.weightUnit !== previous.weightUnit)
          patch.weightUnit = setEntry.weightUnit;
        if ((setEntry.rpe ?? null) !== (previous.rpe ?? null))
          patch.rpe = setEntry.rpe ?? null;
        if ((setEntry.rir ?? null) !== (previous.rir ?? null))
          patch.rir = setEntry.rir ?? null;
        if ((setEntry.feel ?? null) !== (previous.feel ?? null))
          patch.feel = setEntry.feel ?? null;
        if (Object.keys(patch).length === 0) return [];
        return [updateSet(setEntry.dbId, patch).catch(() => undefined)];
      }),
    );

    queryClient.invalidateQueries({ queryKey: ["workouts"] });
    return changedCount;
  }

  function applyBlockOperations(operations: BlockOperation[]): string[] {
    const feedback: string[] = [];
    for (const op of operations) {
      if (op.kind === "remove") {
        const block = findBlockBySlug(op.exerciseSlug);
        if (block) {
          removeBlock(block.id);
          feedback.push(`Removed ${block.exercise.name}.`);
        }
        continue;
      }
      if (op.kind === "replace") {
        const block = findBlockBySlug(op.fromSlug);
        const nextExercise = getExerciseBySlug(op.toSlug);
        if (block && nextExercise) {
          replaceBlockExercise(block.id, nextExercise);
          feedback.push(
            `Changed ${block.exercise.name} to ${nextExercise.name}.`,
          );
        }
      }
    }
    return feedback;
  }

  function buildChatContext(): ChatContext | undefined {
    const orderedBlocks = messagesRef.current
      .filter(
        (entry): entry is Extract<Message, { kind: "exercise-block" }> =>
          entry.kind === "exercise-block",
      )
      .map((entry) => blocksRef.current[entry.blockId])
      .filter((block): block is ExerciseBlock => Boolean(block) && !block.deleted);

    if (orderedBlocks.length === 0) return undefined;

    const activeId = activeBlockIdRef.current;
    const activeBlockEntry = activeId ? blocksRef.current[activeId] ?? null : null;
    const active =
      activeBlockEntry && !activeBlockEntry.deleted ? activeBlockEntry : null;

    return {
      exerciseSlug: active?.exercise.slug,
      exerciseName: active?.exercise.name,
      sets: active?.sets.map((set) => ({
        setNumber: set.setNumber,
        reps: set.reps,
        weight: set.weight,
        weightUnit: set.weightUnit,
        rpe: set.rpe ?? null,
        rir: set.rir ?? null,
        feel: set.feel ?? null,
      })),
      blocks: orderedBlocks.map((block) => ({
        exerciseSlug: block.exercise.slug,
        exerciseName: block.exercise.name,
        isActive: block.id === activeId,
        sets: block.sets.map((set) => ({
          setNumber: set.setNumber,
          reps: set.reps,
          weight: set.weight,
          weightUnit: set.weightUnit,
          rpe: set.rpe ?? null,
          rir: set.rir ?? null,
          feel: set.feel ?? null,
        })),
      })),
    };
  }

  async function handleChatSubmit(message: string) {
    appendMessage({
      id: makeId("msg"),
      kind: "text",
      role: "user",
      text: message,
    });

    const suggestion = await chatMutation
      .mutateAsync({ message, context: buildChatContext() })
      .catch(() => null);
    if (!suggestion) {
      appendMessage({
        id: makeId("msg"),
        kind: "text",
        role: "assistant",
        text: "I could not parse that one.",
      });
      return;
    }

    const actions = planChatTurn({
      suggestion,
      hasActiveBlock: Boolean(activeBlockIdRef.current),
      bufferedSets: bufferedSetsRef.current,
    });

    for (const action of actions) {
      switch (action.type) {
        case "applyBlockOps": {
          const feedback = applyBlockOperations(action.operations);
          for (const line of feedback) {
            appendMessage({
              id: makeId("msg"),
              kind: "text",
              role: "assistant",
              text: line,
            });
          }
          break;
        }
        case "applyUpdates": {
          const changed = await applyUpdatesToActiveBlock(action.updates);
          if (changed > 0) {
            appendMessage({
              id: makeId("msg"),
              kind: "text",
              role: "assistant",
              text: `Updated ${changed} ${changed === 1 ? "set" : "sets"}.`,
            });
          }
          break;
        }
        case "ensureBlockAndAppend": {
          const { blockId, created } = ensureBlockForExercise(action.exercise);
          if (!created && action.resetSetsBeforeAppend) {
            clearSetsInBlock(blockId);
          }
          if (action.sets.length > 0) {
            await appendSetsToBlock(blockId, action.sets, "chat", message);
          }
          // Sets have landed on a real block now — the buffer is drained.
          bufferedSetsRef.current = [];
          // "Not right?" switch suggestions are a just-in-case correction for
          // the exercise we just auto-resolved. Only surface them when a new
          // block was created this turn — if we appended to an existing
          // block the user already confirmed the exercise earlier.
          if (
            created &&
            action.switchAlternates &&
            action.switchAlternates.length > 0
          ) {
            appendMessage({
              id: makeId("msg"),
              kind: "exercise-options",
              role: "assistant",
              options: action.switchAlternates,
              pendingSets: [],
              boundBlockId: blockId,
            });
          }
          break;
        }
        case "appendToActiveBlock": {
          const activeId = activeBlockIdRef.current;
          if (activeId) {
            if (action.resetSetsBeforeAppend) {
              clearSetsInBlock(activeId);
            }
            await appendSetsToBlock(activeId, action.sets, "chat", message);
            bufferedSetsRef.current = [];
          }
          break;
        }
        case "resetActiveBlockSets": {
          const activeId = activeBlockIdRef.current;
          if (activeId) clearSetsInBlock(activeId);
          break;
        }
        case "scaleActiveBlockReps": {
          const changed = await scaleActiveBlockRepsByRpe(action.targetRpe);
          appendMessage({
            id: makeId("msg"),
            kind: "text",
            role: "assistant",
            text:
              changed > 0
                ? `Filled in reps on ${changed} ${changed === 1 ? "set" : "sets"} targeting RPE ${action.targetRpe} (~${10 - action.targetRpe} reps in reserve).`
                : activeExerciseOneRmKg === null
                  ? "I need an estimated 1RM for this lift first — log a heavier set or two and try again."
                  : "Couldn't find any weighted sets to scale reps on.",
          });
          break;
        }
        case "scaleActiveBlockWeights": {
          // Resolve target block IDs: if the action names specific
          // exercise slugs (multi-exercise turn) we scale each; otherwise
          // fall back to the currently-active block.
          const targetSlugs = action.exerciseSlugs ?? null;
          const targetIds: string[] = [];
          if (targetSlugs && targetSlugs.length > 0) {
            for (const slug of targetSlugs) {
              const match = Object.values(blocksRef.current).find(
                (block) => !block.deleted && block.exercise.slug === slug,
              );
              if (match) targetIds.push(match.id);
            }
          } else if (activeBlockIdRef.current) {
            targetIds.push(activeBlockIdRef.current);
          }

          let totalChanged = 0;
          let anyHadOneRm = false;
          for (const blockId of targetIds) {
            const result = await scaleBlockWeightsByRpe(action.targetRpe, {
              warmupSets: action.warmupSets,
              warmupStartPct: action.warmupStartPct,
              hintMessage: message,
              targetBlockId: blockId,
            });
            totalChanged += result.changed;
            anyHadOneRm = anyHadOneRm || result.hadOneRm;
          }

          appendMessage({
            id: makeId("msg"),
            kind: "text",
            role: "assistant",
            text:
              totalChanged > 0
                ? `Picked weights for ${totalChanged} ${totalChanged === 1 ? "set" : "sets"} targeting RPE ${action.targetRpe} (~${10 - action.targetRpe} reps in reserve).`
                : !anyHadOneRm
                  ? "I need an estimated 1RM for this lift first — log a few weighted sets and try again."
                  : "Couldn't find any sets missing weight to fill in.",
          });
          break;
        }
        case "showPicker": {
          appendMessage({
            id: makeId("msg"),
            kind: "exercise-options",
            role: "assistant",
            options: action.options,
            pendingSets: action.pendingSets,
          });
          break;
        }
        case "bufferSets": {
          bufferedSetsRef.current = [
            ...bufferedSetsRef.current,
            ...action.sets,
          ];
          break;
        }
        case "reply": {
          appendMessage({
            id: makeId("msg"),
            kind: "text",
            role: "assistant",
            text: action.text,
          });
          break;
        }
        case "showExerciseHelp": {
          const exercise = getExerciseBySlug(action.exerciseSlug);
          if (exercise) {
            appendMessage({
              id: makeId("msg"),
              kind: "exercise-description",
              role: "assistant",
              exercise,
              mode: action.mode,
            });
          } else {
            appendMessage({
              id: makeId("msg"),
              kind: "text",
              role: "assistant",
              text: "I couldn't find that exercise in the catalog.",
            });
          }
          break;
        }
      }
    }
  }

  async function handleSelectExerciseOption(
    messageId: string,
    exercise: ExerciseRecord,
  ) {
    const target = messagesRef.current.find(
      (entry) => entry.id === messageId && entry.kind === "exercise-options",
    );
    if (!target || target.kind !== "exercise-options" || target.resolved) return;

    // Route through commitMessages so messagesRef stays in sync — otherwise
    // the next appendMessage call (e.g. inside ensureBlockForExercise) reads
    // stale refs and clobbers the resolved flag we just set.
    commitMessages(
      messagesRef.current.map((entry) =>
        entry.id === messageId && entry.kind === "exercise-options"
          ? { ...entry, resolved: true, resolvedExerciseName: exercise.name }
          : entry,
      ),
    );

    // "Switch" flow: sets are already logged against boundBlockId — just swap
    // the exercise on that block.
    if (target.boundBlockId) {
      replaceBlockExercise(target.boundBlockId, exercise);
      return;
    }

    const { blockId } = ensureBlockForExercise(exercise);
    if (target.pendingSets.length > 0) {
      await appendSetsToBlock(blockId, target.pendingSets, "chat");
    }
  }

  async function handleCameraCapture(payload: {
    imageBase64: string;
    mimeType: string;
  }) {
    const imageUrl = `data:${payload.mimeType};base64,${payload.imageBase64}`;
    appendMessage({
      id: makeId("msg"),
      kind: "camera-image",
      role: "user",
      imageUrl,
    });

    const response = await recognizeVision(payload.imageBase64, payload.mimeType);
    const matched = response.candidates.filter((candidate) => candidate.confidence > 0);
    if (matched.length === 0) {
      toast.error("No exercises detected in image");
      return;
    }

    const shouldAutoLog =
      response.primarySource === "vision_model" &&
      matched[0] !== undefined &&
      matched[0].confidence >= VISION_AUTO_LOG_MIN_CONFIDENCE;

    const blurb = visionResponseDescriptionText(response);

    if (!shouldAutoLog) {
      const text = blurb
        ? `${blurb}\n\nPick the exercise that best matches below.`
        : "Pick the exercise that best matches this photo.";
      appendMessage({ id: makeId("msg"), kind: "text", role: "assistant", text });
      appendMessage({ id: makeId("msg"), kind: "candidates", role: "assistant", candidates: matched });
      return;
    }

    if (blurb) {
      appendMessage({ id: makeId("msg"), kind: "text", role: "assistant", text: blurb });
    }

    const primary = matched[0];
    const { blockId } = ensureBlockForExercise(primary.exercise);
    if (primary.weight !== null) {
      await addSetToBlock(blockId, {
        reps: lastSet?.reps ?? null,
        weight: primary.weight,
        weightUnit: primary.weightUnit,
        source: "camera",
      });
    }

    appendMessage({
      id: makeId("msg"),
      kind: "text",
      role: "assistant",
      text: `Logged as ${primary.exercise.name}.`,
    });

    const alternatives = matched
      .slice(1)
      .map((candidate) => candidate.exercise)
      .filter(
        (exercise, index, all) =>
          all.findIndex((item) => item.slug === exercise.slug) === index,
      );

    if (alternatives.length > 0) {
      appendMessage({
        id: makeId("msg"),
        kind: "exercise-options",
        role: "assistant",
        options: alternatives,
        pendingSets: [],
        boundBlockId: blockId,
      });
    }
  }

  async function handleConfirmCandidate(
    messageId: string,
    candidate: ExerciseWeightCandidate,
  ) {
    commitMessages(
      messagesRef.current.map((entry) =>
        entry.id === messageId && entry.kind === "candidates"
          ? { ...entry, resolved: true }
          : entry,
      ),
    );

    const { blockId } = ensureBlockForExercise(candidate.exercise);
    if (candidate.weight !== null) {
      await addSetToBlock(blockId, {
        reps: lastSet?.reps ?? null,
        weight: candidate.weight,
        weightUnit: candidate.weightUnit,
        source: "camera",
      });
    }
  }

  // Always reads the freshest last set of the currently active block via
  // refs, so quick-chip handlers can't compound stale closures (e.g. a
  // rapid double-tap on "+5" previously picked up a pre-update lastSet on
  // the first fire and a post-update one on the second, producing a single
  // set at +10 from the perceived base).
  function readActiveLastSet(): BlockSet | null {
    const id = activeBlockIdRef.current;
    if (!id) return null;
    const block = blocksRef.current[id];
    if (!block || block.deleted || block.sets.length === 0) return null;
    return block.sets[block.sets.length - 1];
  }

  const chipBusyRef = useRef(false);
  async function runChipAction(action: () => Promise<unknown>) {
    if (chipBusyRef.current) return;
    chipBusyRef.current = true;
    try {
      await action();
    } finally {
      chipBusyRef.current = false;
    }
  }

  async function handleSameAgain() {
    await runChipAction(async () => {
      const activeId = activeBlockIdRef.current;
      if (!activeId) return;
      const last = readActiveLastSet() ?? lastSet;
      if (!last) return;
      await addSetToBlock(activeId, {
        reps: last.reps,
        weight: last.weight,
        weightUnit: last.weightUnit,
        source: "manual",
      });
    });
  }

  async function handleAdjustWeight(delta: number) {
    await runChipAction(async () => {
      const activeId = activeBlockIdRef.current;
      if (!activeId) return;
      const last = readActiveLastSet();
      const baseWeight = last?.weight;
      if (baseWeight === null || baseWeight === undefined) return;
      const nextWeight = Math.max(0, baseWeight + delta);
      await addSetToBlock(activeId, {
        reps: last?.reps ?? null,
        weight: nextWeight,
        weightUnit: last?.weightUnit ?? lastWeightUnit,
        source: "manual",
      });
    });
  }

  async function handleSetRepsAndWeight(reps: number, weight: number) {
    await runChipAction(async () => {
      const activeId = activeBlockIdRef.current;
      if (!activeId) return;
      const last = readActiveLastSet();
      await addSetToBlock(activeId, {
        reps,
        weight,
        weightUnit: last?.weightUnit ?? lastWeightUnit,
        source: "manual",
      });
    });
  }

  /**
   * Estimate the best 1RM (in kg) for a given exercise slug, aggregating
   * every weighted set we know about (historical sessions + current chat
   * blocks) through StrengthLevel's rep-percentage table.
   *
   * Reads from `blocksRef.current` (not `blocks` state) so callers inside
   * `handleChatSubmit` see sets that were just committed earlier in the
   * same turn without waiting for React to re-render. That closure-sync
   * bug is why warmup-scaling used to silently bail with "I need an
   * estimated 1RM for this lift first" immediately after logging sets.
   */
  const getEstimatedOneRmKgForSlug = useCallback(
    (slug: string | null | undefined): number | null => {
      if (!slug) return null;
      let best = 0;

      const historySessions = (historyQuery.data?.groups ?? []).flatMap(
        (group) => group.sessions,
      );
      for (const session of historySessions) {
        for (const set of flattenSets(session)) {
          const matched = getExerciseByName(set.exerciseName);
          if (!matched || matched.slug !== slug) continue;
          const weight = Number(set.weight);
          if (!Number.isFinite(weight) || weight <= 0) continue;
          const reps =
            typeof set.reps === "number" && set.reps > 0 ? set.reps : 1;
          const est = estimateOneRm(toKg(weight, set.weightUnit), reps);
          if (est > best) best = est;
        }
      }

      for (const block of Object.values(blocksRef.current)) {
        if (block.deleted) continue;
        if (block.exercise.slug !== slug) continue;
        for (const set of block.sets) {
          if (
            set.weight === null ||
            set.weight === undefined ||
            set.weight <= 0
          ) {
            continue;
          }
          const reps = set.reps ?? 1;
          const est = estimateOneRm(toKg(set.weight, set.weightUnit), reps);
          if (est > best) best = est;
        }
      }

      return best > 0 ? best : null;
    },
    [historyQuery.data],
  );

  // Memoised 1RM for the currently-active exercise, used by chip rendering
  // and other UI that reads during render. Stale inside the same handler
  // tick, so imperative callers go through `getEstimatedOneRmKgForSlug`.
  const activeExerciseOneRmKg = useMemo(
    () => getEstimatedOneRmKgForSlug(activeExercise?.slug ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeExercise, historyQuery.data, blocks, getEstimatedOneRmKgForSlug],
  );

  // Two separate chip groups so we can drop the "estimated Xkg 1RM …"
  // caption between them — the basic chips (same-again, ±5) and the
  // RPE-calibrated rep × weight suggestions, which need context.
  const basicChips = useMemo(() => {
    if (!activeExercise) return [];

    const chips: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];

    if (lastSet && lastSet.reps !== null && lastSet.weight !== null) {
      chips.push({
        label: `Same again · ${lastSet.reps}×${lastSet.weight}${lastWeightUnit}`,
        onClick: handleSameAgain,
      });
    }

    if (lastSet?.weight !== undefined && lastSet?.weight !== null) {
      chips.push({ label: `+5${lastWeightUnit}`, onClick: () => handleAdjustWeight(5) });
      chips.push({ label: `-5${lastWeightUnit}`, onClick: () => handleAdjustWeight(-5) });
    }

    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExercise, lastSet, lastWeightUnit]);

  // Combined (reps × weight) suggestions calibrated to ~8/10 effort
  // (RPE 8, roughly 2 reps in reserve). For a target of N reps at RPE 8
  // we pick the weight a lifter could take to failure for N + 2 reps,
  // which maps cleanly onto StrengthLevel's rep-percentage table.
  const rpeChips = useMemo(() => {
    if (!activeExercise || activeExerciseOneRmKg === null) return [];

    const chips: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];
    const oneRmInUnit =
      lastWeightUnit === "lb"
        ? activeExerciseOneRmKg / 0.45359237
        : activeExerciseOneRmKg;
    const increment = 5;
    const repsInReserveForRpe8 = 2;
    for (const targetReps of [1, 3, 5, 8, 10]) {
      const pct = percentageOfOneRm(targetReps + repsInReserveForRpe8);
      const rounded = Math.round((oneRmInUnit * pct) / increment) * increment;
      if (rounded <= 0) continue;
      chips.push({
        label: `${targetReps} × ${rounded}${lastWeightUnit}`,
        onClick: () => handleSetRepsAndWeight(targetReps, rounded),
      });
    }

    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExercise, lastWeightUnit, activeExerciseOneRmKg]);

  const hasAnyChip = basicChips.length > 0 || rpeChips.length > 0;

  const cameraTrigger = (trigger: ReactNode) => (
    <CameraPopup
      onCapture={handleCameraCapture}
      onBusyChange={setCameraBusy}
      trigger={trigger}
    />
  );

  // Collapsed cards in message order (excluding deleted blocks). Used to
  // compute stacked `top` offsets so sticky cards chain instead of overlap.
  const collapsedStickyOrder = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    for (const message of messages) {
      if (message.kind !== "exercise-block") continue;
      if (!collapsedBlockIds.has(message.blockId)) continue;
      const block = blocks[message.blockId];
      if (!block || block.deleted) continue;
      map.set(block.id, index);
      index += 1;
    }
    return map;
  }, [messages, collapsedBlockIds, blocks]);

  // Height (px) reserved for a collapsed/sticky exercise pill. Matches the
  // rendered height of `ExerciseBlockCard` in its collapsed state.
  const STICKY_CARD_STEP = 68;

  // Auto-collapse expanded blocks once they are fully above the content
  // viewport. Using direct scroll position checks is more reliable than
  // IntersectionObserver here because cards are inside a nested scroll area.
  useEffect(() => {
    const scroller = scrollRootRef.current;
    if (!scroller) return;
    let frame: number | null = null;

    const evaluate = () => {
      frame = null;
      const nodes = scroller.querySelectorAll<HTMLElement>("[data-expanded-block]");
      if (nodes.length === 0) return;

      const rootTop = scroller.getBoundingClientRect().top;
      const nextCollapsed = new Set(collapsedBlockIdsRef.current);
      let changed = false;

      for (const node of nodes) {
        const blockId = node.getAttribute("data-expanded-block");
        if (!blockId || nextCollapsed.has(blockId)) continue;
        const rect = node.getBoundingClientRect();
        // Collapse once this card has completely moved above the scroll viewport.
        if (rect.bottom < rootTop + 4) {
          nextCollapsed.add(blockId);
          changed = true;
        }
      }

      if (changed) commitCollapsed(nextCollapsed);
    };

    const scheduleEvaluate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(evaluate);
    };

    // Run once in case some blocks are already above the fold.
    scheduleEvaluate();

    scroller.addEventListener("scroll", scheduleEvaluate, { passive: true });
    window.addEventListener("resize", scheduleEvaluate);

    return () => {
      scroller.removeEventListener("scroll", scheduleEvaluate);
      window.removeEventListener("resize", scheduleEvaluate);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [messages, blocks, scrollRootRef]);

  return (
    <div className="relative flex min-h-0 flex-col bg-background">
      <div className="mx-auto flex w-full flex-col gap-3 px-1 pb-40">
          <div className="h-2 shrink-0" />
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            if (message.kind === "text") {
              return (
                <MessageBubble key={message.id} role={message.role}>
                  {message.text}
                </MessageBubble>
              );
            }

            if (message.kind === "exercise-block") {
              const block = blocks[message.blockId];
              if (!block) return null;
              const isCollapsed = collapsedBlockIds.has(block.id);
              const isDeleted = Boolean(block.deleted);
              if (isCollapsed && !isDeleted) {
                const stickyIndex = collapsedStickyOrder.get(block.id) ?? 0;
                return (
                  <div
                    key={message.id}
                    data-exercise-block={block.id}
                    data-collapsed-block={block.id}
                    className="sticky z-20"
                    style={{ top: stickyIndex * STICKY_CARD_STEP }}
                  >
                    <ExerciseBlockCard
                      exercise={block.exercise}
                      sets={block.sets}
                      collapsed
                      sticky
                      onToggle={() => toggleBlockCollapsed(block.id)}
                      onDelete={() => removeBlock(block.id)}
                    />
                  </div>
                );
              }
              if (isDeleted) {
                return (
                  <div key={message.id} data-exercise-block={block.id}>
                    <ExerciseBlockCard
                      exercise={block.exercise}
                      sets={block.sets}
                      collapsed
                      deleted
                      onRestore={() => restoreBlock(block.id)}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={message.id}
                  data-expanded-block={block.id}
                  data-exercise-block={block.id}
                >
                  <ExerciseBlockCard
                    exercise={block.exercise}
                    sets={block.sets}
                    active={block.id === activeBlockId}
                    onToggle={() => toggleBlockCollapsed(block.id)}
                    onDeleteSet={(setId) => removeSetFromBlock(block.id, setId)}
                    onDelete={() => removeBlock(block.id)}
                  />
                </div>
              );
            }

            if (message.kind === "exercise-description") {
              return (
                <div key={message.id}>
                  <ExerciseDescription
                    exercise={message.exercise}
                    mode={message.mode}
                  />
                </div>
              );
            }

            if (message.kind === "exercise-options") {
              // Once an option has been chosen the picker has served its
              // purpose — the selected exercise already appears as its own
              // block in the chat, so hide the picker entirely.
              if (message.resolved) return null;
              // "Switch" suggestions are a just-in-case correction offer for
              // the block we just logged. Once the user sends anything else
              // they've clearly moved on, so stop surfacing the offer.
              if (message.boundBlockId && !isLastMessage) {
                return null;
              }
              return (
                <MessageBubble key={message.id} role="assistant">
                  <ExerciseOptions
                    options={message.options}
                    sets={message.pendingSets}
                    variant={message.boundBlockId ? "switch" : "pick"}
                    onSelect={(exercise) =>
                      handleSelectExerciseOption(message.id, exercise)
                    }
                  />
                </MessageBubble>
              );
            }

            if (message.kind === "camera-image") {
              return (
                <MessageBubble key={message.id} role="user">
                  <img
                    src={message.imageUrl}
                    alt="Captured workout set"
                    className="max-h-64 w-full rounded-xl object-cover"
                  />
                </MessageBubble>
              );
            }

            if (message.kind === "candidates") {
              return (
                <MessageBubble key={message.id} role="assistant">
                  {message.resolved ? (
                    <span className="text-sm text-muted-foreground">
                      Logged from camera.
                    </span>
                  ) : (
                    <CameraCandidates
                      candidates={message.candidates}
                      onConfirm={(candidate) =>
                        handleConfirmCandidate(message.id, candidate)
                      }
                    />
                  )}
                </MessageBubble>
              );
            }

            return null;
          })}

          {chatMutation.isPending || cameraBusy ? (
            <MessageBubble role="assistant" className="pt-0.5">
              <AssistantTypingDots />
            </MessageBubble>
          ) : null}

          {!hasAnyBlock && !hasUserMessage && recentWorkouts.length > 0 ? (
            <RecentWorkoutSuggestions
              workouts={recentWorkouts}
              onSelect={handleDuplicateWorkout}
              disabled={duplicatingRef.current}
            />
          ) : null}
      </div>

      <footer
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex w-full flex-col gap-1.5 px-1">
          {hasAnyChip ? (
            <>
              {rpeChips.length > 0 && activeExerciseOneRmKg !== null ? (
                <p className="px-1 text-[11px] leading-snug text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {activeExercise?.name ?? "This lift"}
                  </span>{" "}
                  · estimated{" "}
                  <span className="font-medium text-foreground/80">
                    {Math.round(
                      lastWeightUnit === "lb"
                        ? activeExerciseOneRmKg / 0.45359237
                        : activeExerciseOneRmKg,
                    )}
                    {lastWeightUnit} 1RM
                  </span>{" "}
                  · reps × weight suggestions at ~8/10 effort (2 RIR).
                </p>
              ) : null}
              <SuggestionChips chips={[...basicChips, ...rpeChips]} />
            </>
          ) : null}
          <Composer
            onSubmit={handleChatSubmit}
            cameraTrigger={cameraTrigger}
            disabled={false}
            isLoading={cameraBusy}
          />
        </div>
      </footer>
    </div>
  );
}
