"use client";

import { ReactNode, useMemo, useState } from "react";
import Image from "next/image";
import { ExerciseIconImage } from "@/components/workout/exercise-icon-image";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CheckCircle2, ExternalLink, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ExerciseGuideStep,
  ExerciseRecord,
} from "@/lib/types/workout";

type ExerciseGuideSheetProps = {
  exercise: ExerciseRecord;
  trigger: ReactNode;
};

// Collapse consecutive steps that share the same source image into a single
// picture + ordered step list. strengthlevel.com produces 2-3 unique pictures
// per exercise, so rendering one picture per step would show the same image
// four or five times in a row.
type StepGroup = {
  imagePath: string | null;
  steps: Array<{ index: number; text: string }>;
};

function groupStepsByImage(steps: ExerciseGuideStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const last = groups[groups.length - 1];
    if (last && last.imagePath === step.imagePath) {
      last.steps.push({ index: i + 1, text: step.text });
    } else {
      groups.push({
        imagePath: step.imagePath,
        steps: [{ index: i + 1, text: step.text }],
      });
    }
  }
  return groups;
}

export function ExerciseGuideSheet({
  exercise,
  trigger,
}: ExerciseGuideSheetProps) {
  const [open, setOpen] = useState(false);
  const guide = exercise.guide;
  const groups = useMemo(
    () => (guide ? groupStepsByImage(guide.steps) : []),
    [guide],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger render={trigger as React.ReactElement} />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/30 transition-opacity duration-200",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
            "supports-backdrop-filter:bg-black/20 supports-backdrop-filter:backdrop-blur-lg",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-3 z-50 flex flex-col overflow-hidden rounded-[28px] bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5",
            "transition duration-200 ease-out",
            "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
          )}
        >
          <div className="flex items-center gap-3 border-b bg-muted/40 p-4 pr-14">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-background">
              <ExerciseIconImage
                src={exercise.iconPath}
                width={40}
                height={40}
                className="h-10 w-10"
                unoptimized
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <DialogPrimitive.Title className="truncate text-base font-semibold">
                {exercise.name} · How to
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                {exercise.category ?? "Exercise guide"}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <XIcon className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
            <div className="space-y-5 px-4 pb-6 pt-4">
              {!guide ? (
                <div className="rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                  No how-to guide available for {exercise.name} yet. Check the{" "}
                  <a
                    className="font-medium underline-offset-2 hover:underline"
                    href={exercise.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    standards page
                  </a>
                  .
                </div>
              ) : (
                <>
                  {guide.intro ? (
                    <p className="text-sm leading-relaxed text-foreground">
                      {guide.intro}
                    </p>
                  ) : null}

                  {guide.formCheck.length > 0 ? (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Form check
                      </h3>
                      <ul className="flex flex-wrap gap-1.5">
                        {guide.formCheck.map((item) => (
                          <li
                            key={item}
                            className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Instructions
                    </h3>
                    <div className="space-y-3">
                      {groups.map((group, groupIndex) => (
                        <div
                          key={`${groupIndex}-${group.imagePath ?? "nopic"}`}
                          className="overflow-hidden rounded-2xl border bg-card"
                        >
                          {group.imagePath ? (
                            <div className="relative h-60 w-full bg-muted sm:h-72">
                              <Image
                                src={group.imagePath}
                                alt={`${exercise.name} position ${groupIndex + 1}`}
                                fill
                                className="object-contain dark:invert"
                                unoptimized
                                sizes="(max-width: 640px) 100vw, 640px"
                              />
                            </div>
                          ) : null}
                          <ol className="divide-y">
                            {group.steps.map((step) => (
                              <li
                                key={step.index}
                                className="flex items-start gap-3 px-4 py-3"
                              >
                                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                                  {step.index}
                                </span>
                                <p className="text-sm leading-relaxed text-foreground">
                                  {step.text}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  </div>

                  <a
                    href={guide.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Full guide on strengthlevel.com
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
