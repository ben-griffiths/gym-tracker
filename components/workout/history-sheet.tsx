"use client";

import { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { deleteWorkoutSession } from "@/lib/api";
import {
  computeVolume,
  flattenSets,
  formatDate,
  formatWorkoutTitle,
  groupByExercise,
  type HistoryResponse,
  type HistorySet,
} from "@/lib/workout-history";

type LiveCurrentWorkout = {
  id: string;
  name: string;
  startedAt?: string;
  /** Each set MUST carry `exercise` so `flattenSets` can read the name. */
  sets: HistorySet[];
};

type HistorySheetProps = {
  trigger: ReactNode;
  currentSessionId: string | null;
  /**
   * In-memory snapshot of the current workout's sets. When present, the sheet
   * uses this live data instead of the persisted copy so the session card
   * updates the instant a set is logged or removed — no refetch required.
   */
  liveCurrent?: LiveCurrentWorkout | null;
};

export function HistorySheet({
  trigger,
  currentSessionId,
  liveCurrent,
}: HistorySheetProps) {
  const queryClient = useQueryClient();
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

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteWorkoutSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
    },
    onError: () => toast.error("Could not delete workout"),
  });

  function handleDelete(sessionId: string, sessionName: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${sessionName}? This cannot be undone.`)
    ) {
      return;
    }
    deleteMutation.mutate(sessionId);
  }

  const groups = historyQuery.data?.groups ?? [];
  const persistedSessions = groups
    .flatMap((group) =>
      group.sessions.map((session) => ({ ...session, groupName: group.name })),
    )
    .filter((session) => session.id !== currentSessionId);

  // Live current session (synthesised from in-memory blocks) always renders
  // first and reflects the user's latest edits without waiting for a refetch.
  const liveSession = liveCurrent
    ? {
        id: liveCurrent.id,
        name: liveCurrent.name,
        startedAt: liveCurrent.startedAt,
        sets: liveCurrent.sets,
        groupName: "Today",
        isLive: true,
      }
    : null;

  const sessions = liveSession
    ? [liveSession, ...persistedSessions.map((s) => ({ ...s, isLive: false }))]
    : persistedSessions.map((s) => ({ ...s, isLive: false }));

  return (
    <Sheet>
      <SheetTrigger render={trigger as React.ReactElement} />
      <SheetContent side="right" className="w-full max-w-md p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Workout history
          </SheetTitle>
          <SheetDescription>Previously logged sessions.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 p-4 pb-12">
            {sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No past workouts yet. Log a few sets and they will show up here.
              </div>
            ) : (
              sessions.map((session) => {
                const sets = flattenSets(session);
                const exerciseGroups = groupByExercise(sets);
                const { volume, unit: volumeUnit } = computeVolume(sets);
                return (
                  <section
                    key={session.id}
                    className={
                      session.isLive
                        ? "rounded-2xl border border-primary/30 bg-card p-4 ring-1 ring-primary/20"
                        : "rounded-2xl border bg-card p-4"
                    }
                  >
                    <header className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-2 truncate text-sm font-semibold">
                          {formatWorkoutTitle(session.startedAt, session.name)}
                          {session.isLive ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                              Live
                            </span>
                          ) : null}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {session.isLive && !session.startedAt
                            ? "In progress"
                            : formatDate(session.startedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        <Badge variant="outline">{sets.length} sets</Badge>
                        {volume > 0 ? (
                          <Badge variant="outline">
                            {volume.toLocaleString()} {volumeUnit}
                          </Badge>
                        ) : null}
                        {!session.isLive ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleDelete(session.id, session.name)
                            }
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${session.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </header>
                    <ul className="flex flex-col gap-1.5">
                      {exerciseGroups.length === 0 ? (
                        <li className="text-xs text-muted-foreground">
                          No sets logged.
                        </li>
                      ) : (
                        exerciseGroups.map((group) => (
                          <li
                            key={group.exerciseName}
                            className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm"
                          >
                            <span className="truncate pr-2 font-medium">
                              {group.exerciseName}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {group.summary}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
