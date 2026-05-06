"use client";

import type {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  Ref,
} from "react";
import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import {
  ChevronDown,
  ChevronUp,
  CopyPlus,
  GripVertical,
  HelpCircle,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EffortFeel, ExerciseRecord } from "@/lib/types/workout";
import { ExerciseGuideSheet } from "@/components/workout/exercise-guide-sheet";

export type BlockSet = {
  id: string;
  dbId?: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
  source: "manual" | "camera" | "chat";
  /** Warmup rows from chat / prescription; drives softer row styling. */
  isWarmup?: boolean;
  rpe?: number | null;
  rir?: number | null;
  feel?: EffortFeel | null;
};

export type SetFieldsCommit = {
  reps: number | null;
  weight: number | null;
  weightUnit: "kg" | "lb";
};

function formatRepsDraft(reps: number | null) {
  return reps === null ? "" : String(reps);
}

function formatWeightDraft(weight: number | null) {
  return weight === null ? "" : String(weight);
}

function parseRepsInput(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "invalid";
  return n;
}

function parseWeightInput(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  return n;
}

function SetRowFieldsEditor({
  set,
  onCommit,
}: {
  set: BlockSet;
  onCommit: (fields: SetFieldsCommit) => Promise<boolean>;
}) {
  const [repsDraft, setRepsDraft] = useState(() => formatRepsDraft(set.reps));
  const [weightDraft, setWeightDraft] = useState(() =>
    formatWeightDraft(set.weight),
  );

  const syncFromSet = useCallback(() => {
    setRepsDraft(formatRepsDraft(set.reps));
    setWeightDraft(formatWeightDraft(set.weight));
  }, [set.reps, set.weight]);

  useEffect(() => {
    syncFromSet();
  }, [set.id, syncFromSet]);

  const commitNow = useCallback(async () => {
    const r = parseRepsInput(repsDraft);
    const w = parseWeightInput(weightDraft);
    if (r === "invalid" || w === "invalid") {
      toast.error("Use a whole number for reps and a number for weight.");
      syncFromSet();
      return false;
    }
    if (r === null && w === null) {
      toast.error("Enter at least reps or weight.");
      syncFromSet();
      return false;
    }
    const ok = await onCommit({
      reps: r,
      weight: w,
      weightUnit: set.weightUnit,
    });
    if (!ok) syncFromSet();
    return ok;
  }, [onCommit, repsDraft, set.weightUnit, syncFromSet, weightDraft]);

  const onFieldsKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitNow();
    }
  };

  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 sm:gap-x-2">
      <span className="inline-flex min-w-0 items-center gap-1">
        <Input
          data-field="reps"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Set ${set.setNumber} reps`}
          className="h-7 w-11 shrink-0 px-1 text-center text-sm tabular-nums md:w-12"
          value={repsDraft}
          onChange={(e) => setRepsDraft(e.target.value)}
          onBlur={() => void commitNow()}
          onKeyDown={onFieldsKeyDown}
        />
        <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
          reps
        </span>
      </span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Input
          data-field="weight"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={`Set ${set.setNumber} weight in ${set.weightUnit}`}
          className="h-7 w-14 shrink-0 px-1 text-center text-sm tabular-nums md:w-16"
          value={weightDraft}
          onChange={(e) => setWeightDraft(e.target.value)}
          onBlur={() => void commitNow()}
          onKeyDown={onFieldsKeyDown}
        />
        <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
          {set.weightUnit}
        </span>
      </span>
    </span>
  );
}

function formatRpeLabel(rpe: number | null | undefined): string | null {
  if (rpe === null || rpe === undefined) return null;
  const value = Number.isInteger(rpe) ? String(rpe) : rpe.toFixed(1);
  return `RPE ${value}`;
}

function feelBadgeClass(feel: EffortFeel): string {
  switch (feel) {
    case "easy":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "medium":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "hard":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
}

type ExerciseBlockCardProps = {
  exercise: ExerciseRecord;
  sets: BlockSet[];
  active?: boolean;
  collapsed?: boolean;
  /** Set when the card sits in the sticky exercise header stack (collapsed rows). */
  sticky?: boolean;
  onToggle?: () => void;
  onDeleteSet?: (setId: string) => void;
  /** Appends a new set with the same reps, weight, and effort as this row. */
  onDuplicateSet?: (setId: string) => void;
  onDelete?: () => void;
  deleted?: boolean;
  onRestore?: () => void;
  /**
   * Shown as a border-separated footer inside the card (e.g. rep/weight
   * suggestion chips for the active exercise in the workout chat).
   */
  suggestionsFooter?: ReactNode;
  /** When set, set rows become editable; commits call back with parsed numbers. */
  onCommitSetRow?: (setId: string, fields: SetFieldsCommit) => Promise<boolean>;
  /** With 2+ sets, shows a drag handle per row and persists order via this callback. */
  onReorderSets?: (activeSetId: string, overSetId: string) => void;
};

function formatRepRange(sets: BlockSet[]): string {
  const reps = sets
    .map((set) => set.reps)
    .filter((value): value is number => value !== null);
  if (reps.length === 0) return "– reps";
  const min = Math.min(...reps);
  const max = Math.max(...reps);
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

function formatWeightRange(sets: BlockSet[]): string {
  const weights = sets
    .map((set) => set.weight)
    .filter((value): value is number => value !== null);
  if (weights.length === 0) return "";
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const unit = sets.find((set) => set.weight !== null)?.weightUnit ?? "kg";
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

type ExerciseBlockSetRowSharedProps = {
  set: BlockSet;
  index: number;
  editableRows: boolean;
  showSetDuplicate: boolean;
  showSetDelete: boolean;
  onDuplicateSet?: (setId: string) => void;
  onDeleteSet?: (setId: string) => void;
  onCommitSetRow?: (setId: string, fields: SetFieldsCommit) => Promise<boolean>;
};

function ExerciseBlockSetRow({
  set,
  index,
  editableRows,
  showSetDuplicate,
  showSetDelete,
  onDuplicateSet,
  onDeleteSet,
  onCommitSetRow,
  rowRef,
  rowStyle,
  isDragging,
  dragHandle,
}: ExerciseBlockSetRowSharedProps & {
  rowRef?: Ref<HTMLLIElement>;
  rowStyle?: CSSProperties;
  isDragging?: boolean;
  dragHandle?: ReactNode;
}) {
  const rpeLabel = formatRpeLabel(set.rpe);
  const hasEffort =
    rpeLabel !== null ||
    (set.rir !== null && set.rir !== undefined) ||
    Boolean(set.feel);

  return (
    <li
      ref={rowRef}
      style={rowStyle}
      className={cn(
        "flex flex-col",
        isDragging &&
          "relative z-[2] opacity-90 ring-2 ring-primary/35 ring-offset-2 ring-offset-background rounded-xl",
      )}
      data-set-row
      data-weight-unit={set.weightUnit}
    >
      {index > 0 ? (
        <div
          className="mx-4 h-px shrink-0 bg-border/70 dark:bg-border/50"
          aria-hidden
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-3 px-4 py-2.5 text-sm tabular-nums",
          set.isWarmup &&
            "bg-muted/40 text-muted-foreground dark:bg-muted/25",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {set.setNumber}
          </span>
          {editableRows ? (
            <SetRowFieldsEditor
              set={set}
              onCommit={(fields) => onCommitSetRow!(set.id, fields)}
            />
          ) : (
            <>
              {/* Explicit space so row textContent isn’t e.g. "15reps" from "1"+"5"+"reps". */}
              {" "}
              <span className="inline-flex min-w-0 items-baseline gap-1">
                <span className="text-foreground tabular-nums">
                  {set.reps !== null ? set.reps : "–"}
                </span>
                <span className="text-sm text-muted-foreground">reps</span>
              </span>
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <span className="inline-flex min-w-0 items-baseline gap-1">
                <span className="text-foreground tabular-nums">
                  {set.weight !== null ? set.weight : "–"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {set.weightUnit}
                </span>
              </span>
            </>
          )}
          {hasEffort ? (
            <span className="flex flex-wrap items-center gap-1">
              {rpeLabel ? (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {rpeLabel}
                </span>
              ) : null}
              {set.rir !== null && set.rir !== undefined ? (
                <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                  {`${set.rir} RIR`}
                </span>
              ) : null}
              {set.feel ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    feelBadgeClass(set.feel),
                  )}
                >
                  {set.feel}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {showSetDuplicate ||
        (showSetDelete && onDeleteSet) ||
        dragHandle ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5">
            {showSetDuplicate && onDuplicateSet ? (
              <button
                type="button"
                onClick={() => onDuplicateSet(set.id)}
                disabled={set.reps === null && set.weight === null}
                title="Duplicate this set"
                aria-label={`Duplicate set ${set.setNumber}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CopyPlus className="h-4 w-4" />
              </button>
            ) : null}
            {showSetDelete && onDeleteSet ? (
              <button
                type="button"
                onClick={() => onDeleteSet(set.id)}
                aria-label={`Delete set ${set.setNumber}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
            {dragHandle}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function SortableExerciseSetRow(props: ExerciseBlockSetRowSharedProps) {
  const { set } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: set.id });

  const rowStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ExerciseBlockSetRow
      {...props}
      rowRef={setNodeRef}
      rowStyle={rowStyle}
      isDragging={isDragging}
      dragHandle={
        <button
          type="button"
          className={cn(
            "touch-none inline-flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
            isDragging && "bg-muted/60 text-foreground",
          )}
          aria-label={`Drag to reorder set ${set.setNumber}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      }
    />
  );
}

function ExerciseBlockSetsList({
  sets,
  editableRows,
  showSetDuplicate,
  showSetDelete,
  onDuplicateSet,
  onDeleteSet,
  onCommitSetRow,
  onReorderSets,
}: Omit<ExerciseBlockSetRowSharedProps, "set" | "index"> & {
  sets: BlockSet[];
  onReorderSets?: (activeSetId: string, overSetId: string) => void;
}) {
  const reorderEnabled = Boolean(onReorderSets) && sets.length > 1;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      onReorderSets?.(String(active.id), String(over.id));
    },
    [onReorderSets],
  );

  const rowShared: Omit<
    ExerciseBlockSetRowSharedProps,
    "set" | "index"
  > = {
    editableRows,
    showSetDuplicate,
    showSetDelete,
    onDuplicateSet,
    onDeleteSet,
    onCommitSetRow,
  };

  if (!reorderEnabled) {
    return (
      <ul className="flex flex-col">
        {sets.map((set, index) => (
          <ExerciseBlockSetRow
            key={set.id}
            set={set}
            index={index}
            {...rowShared}
          />
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={sets.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col">
          {sets.map((set, index) => (
            <SortableExerciseSetRow
              key={set.id}
              set={set}
              index={index}
              {...rowShared}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export function ExerciseBlockCard({
  exercise,
  sets,
  active,
  collapsed,
  sticky,
  onToggle,
  onDeleteSet,
  onDuplicateSet,
  onDelete,
  deleted,
  onRestore,
  suggestionsFooter,
  onCommitSetRow,
  onReorderSets,
}: ExerciseBlockCardProps) {
  const summaryParts: string[] = [];
  if (deleted) {
    summaryParts.push("Deleted");
  } else {
    summaryParts.push(`${sets.length} ${sets.length === 1 ? "set" : "sets"}`);
    const reps = formatRepRange(sets);
    if (reps !== "– reps") summaryParts.push(reps);
    const weight = formatWeightRange(sets);
    if (weight) summaryParts.push(weight);
  }

  const ChevronIcon = collapsed ? ChevronDown : ChevronUp;
  const showGuide = !deleted && Boolean(exercise.guide);
  const showDelete = !deleted && Boolean(onDelete);
  const showSetDelete = !deleted && Boolean(onDeleteSet);
  const showSetDuplicate = !deleted && Boolean(onDuplicateSet);
  const editableRows = !deleted && Boolean(onCommitSetRow);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl shadow-sm transition-shadow",
        deleted && "border border-dashed bg-muted/30 shadow-none",
        !deleted &&
          (active && !collapsed
            ? "border-2 border-primary/50 bg-card"
            : "border border-border bg-card"),
        sticky && !deleted && "shadow-md",
      )}
      data-block-card
      data-deleted={deleted ? "true" : undefined}
    >
      <div
        className={cn(
          "flex w-full items-center gap-1 pr-4 transition-colors",
          collapsed
            ? cn(
                "border-b border-b-transparent",
                deleted ? "bg-transparent" : "bg-card",
              )
            : active && !deleted
              ? "border-b border-primary/25 bg-transparent"
              : "border-b border-border bg-card",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors",
            onToggle ? "cursor-pointer hover:bg-muted/70" : "cursor-default",
          )}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? `Expand ${exercise.name}` : `Collapse ${exercise.name}`
          }
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card",
              deleted && "opacity-50",
            )}
          >
            <ExerciseIconImage
              src={exercise.iconPath}
              width={36}
              height={36}
              className="h-9 w-9"
              unoptimized
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                deleted && "text-muted-foreground line-through",
              )}
            >
              {exercise.name}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {exercise.category ?? "Exercise"} · {summaryParts.join(" · ")}
            </span>
          </div>
          {onToggle ? (
            <ChevronIcon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </button>
        {showGuide ? (
          <ExerciseGuideSheet
            exercise={exercise}
            trigger={
              <button
                type="button"
                aria-label={`How to do ${exercise.name}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            }
          />
        ) : null}
        {showDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${exercise.name}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        {deleted && onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            aria-label={`Restore ${exercise.name}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        sets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No sets yet. Send reps or weight in the chat to add one.
          </div>
        ) : (
          <ExerciseBlockSetsList
            sets={sets}
            editableRows={editableRows}
            showSetDuplicate={showSetDuplicate}
            showSetDelete={showSetDelete}
            onDuplicateSet={onDuplicateSet}
            onDeleteSet={onDeleteSet}
            onCommitSetRow={onCommitSetRow}
            onReorderSets={onReorderSets}
          />
        )
      ) : null}

      {!collapsed && suggestionsFooter ? (
        <div
          className={cn(
            "flex min-h-0 min-w-0 items-center border-t px-1 py-1.5",
            !deleted && (active
              ? "border-primary/20 bg-card"
              : "border-border/70 bg-card"),
          )}
        >
          {suggestionsFooter}
        </div>
      ) : null}
    </div>
  );
}
