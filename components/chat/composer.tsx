"use client";

import {
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Camera,
  Dumbbell,
  Hash,
  Layers,
  Loader2,
  PersonStanding,
  Repeat,
  Weight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  findComposerTokenSpans,
  type ComposerDecorSegment,
  type ComposerTokenKind,
  segmentComposerLine,
} from "@/lib/workout-chat/composer-tokens";
import {
  applyWorkoutChatSuggestionAtCaret,
  type WorkoutChatSuggestionItem,
} from "@/lib/workout-chat/suggest";

function TokenKindIcon({
  kind,
  className,
}: {
  kind: ComposerTokenKind;
  className?: string;
}) {
  const c = cn("h-3 w-3 shrink-0 text-muted-foreground", className);
  switch (kind) {
    case "weight":
      return <Weight className={c} aria-hidden />;
    case "bodyweight":
      return <PersonStanding className={c} aria-hidden />;
    case "setsReps":
      return <Hash className={c} aria-hidden />;
    case "repsWord":
      return <Repeat className={c} aria-hidden />;
    case "setsWord":
      return <Layers className={c} aria-hidden />;
    case "exercise":
      return <Dumbbell className={c} aria-hidden />;
  }
}

function CaretMarker() {
  return (
    <span
      className="inline-block h-[1.05em] w-px shrink-0 animate-pulse align-middle bg-foreground/90"
      aria-hidden
    />
  );
}

function mirrorNodesWithCaret(
  segments: ComposerDecorSegment[],
  displayCaret: number,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let runningEnd = 0;

  if (displayCaret === 0) {
    nodes.push(<CaretMarker key="caret-0" />);
  }

  for (let idx = 0; idx < segments.length; idx += 1) {
    const seg = segments[idx]!;
    const segStart = runningEnd;
    const segLen = seg.text.length;
    const segEnd = segStart + segLen;
    const inside = displayCaret > segStart && displayCaret < segEnd;

    if (inside) {
      const local = displayCaret - segStart;
      const before = seg.text.slice(0, local);
      const after = seg.text.slice(local);
      if (seg.kind === "plain") {
        nodes.push(
          <span key={`p-${idx}`} className="whitespace-pre">
            {before}
            <CaretMarker />
            {after}
          </span>,
        );
      } else {
        nodes.push(
          <span
            key={`t-${idx}-${seg.token}-${seg.text}`}
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted/45 px-2.5 text-[15px] leading-none text-foreground",
              "ring-1 ring-inset ring-border/45",
            )}
          >
            <TokenKindIcon kind={seg.token} />
            <span className="leading-none">
              {before}
              <CaretMarker />
              {after}
            </span>
          </span>,
        );
      }
    } else if (seg.kind === "plain") {
      nodes.push(
        <span key={`p-${idx}`} className="whitespace-pre">
          {seg.text}
        </span>,
      );
    } else {
      nodes.push(
        <span
          key={`t-${idx}-${seg.token}-${seg.text}`}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted/45 px-2.5 text-[15px] leading-none text-foreground",
            "ring-1 ring-inset ring-border/45",
          )}
        >
          <TokenKindIcon kind={seg.token} />
          <span className="leading-none">{seg.text}</span>
        </span>,
      );
    }

    runningEnd = segEnd;
    if (displayCaret === runningEnd) {
      nodes.push(<CaretMarker key={`caret-end-${runningEnd}`} />);
    }
  }

  return nodes;
}

type ComposerActivitySource = "typing" | "suggestion" | "sync";

type ComposerProps = {
  onSubmit: (message: string) => Promise<void> | void;
  cameraTrigger: (trigger: ReactNode) => ReactNode;
  disabled?: boolean;
  /** Locks the bar and shows the send spinner (e.g. camera / vision in progress). */
  isLoading?: boolean;
  placeholder?: string;
  /** Controlled text — use with `onComposerActivity`. */
  text?: string;
  /** Text/caret updates from the input (controlled mode). */
  onComposerActivity?: (detail: {
    text: string;
    caret: number;
    source?: ComposerActivitySource;
  }) => void;
  /** Predictive chips (workout chat) — shown above the field, max ~6. */
  suggestions?: WorkoutChatSuggestionItem[];
  onSuggestionsDismiss?: () => void;
  onImeCompositionChange?: (active: boolean) => void;
  /** Mirror-layer token pills (workout composer); keeps a native string value + caret. */
  tokenDecorate?: boolean;
};

function tokenSpanForBackspaceDeletion(
  value: string,
  caretBefore: number,
): { start: number; end: number } | null {
  if (caretBefore <= 0) return null;
  const i = caretBefore - 1;
  const spans = findComposerTokenSpans(value);
  for (const s of spans) {
    if (i >= s.start && i < s.end) {
      return { start: s.start, end: s.end };
    }
  }
  return null;
}

export function Composer({
  onSubmit,
  cameraTrigger,
  disabled,
  isLoading,
  placeholder = "Log a set, e.g. bench 5x5 @ 100",
  text: textProp,
  onComposerActivity,
  suggestions = [],
  onSuggestionsDismiss,
  onImeCompositionChange,
  tokenDecorate = false,
}: ComposerProps) {
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const caretRestoreRef = useRef<number | null>(null);
  const [internalText, setInternalText] = useState("");
  const [busy, setBusy] = useState(false);
  const [imeComposing, setImeComposing] = useState(false);
  const [displayCaret, setDisplayCaret] = useState(0);
  const controlled = textProp !== undefined;
  const text = controlled ? textProp : internalText;
  const showMirror = tokenDecorate && !imeComposing;
  const segments = useMemo(
    () => (showMirror ? segmentComposerLine(text) : []),
    [showMirror, text],
  );

  const mirrorFieldClass =
    "px-2 py-2 text-[15px] leading-normal whitespace-pre";

  const inputFieldClass = cn(
    mirrorFieldClass,
    "min-w-0 w-full flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70",
  );

  const inputLocked = Boolean(disabled);
  /** Sending or parent loading: block submit / camera / chips, but leave the field typeable for the next message. */
  const sendFlowLocked = Boolean(disabled || busy || isLoading);
  const showSendSpinner = busy || Boolean(isLoading);
  const suggestionLive = suggestions.length > 0 ? suggestions : [];

  useLayoutEffect(() => {
    if (!showMirror) return;
    const el = inputRef.current;
    if (!el) return;
    let caret = caretRestoreRef.current;
    if (caret !== null) {
      caretRestoreRef.current = null;
    } else {
      caret = el.selectionStart ?? text.length;
    }
    caret = Math.max(0, Math.min(caret, text.length));
    el.setSelectionRange(caret, caret);
    setDisplayCaret(caret);
  }, [text, showMirror]);

  function emitActivity(
    nextText: string,
    el: HTMLInputElement | null,
    source: ComposerActivitySource = "typing",
    caretOverride?: number,
  ) {
    if (!onComposerActivity || !controlled) return;
    const caret =
      caretOverride !== undefined
        ? caretOverride
        : (el?.selectionStart ?? nextText.length);
    onComposerActivity({ text: nextText, caret, source });
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    const next = el.value;
    const caret = Math.max(
      0,
      Math.min(el.selectionStart ?? next.length, next.length),
    );
    caretRestoreRef.current = caret;
    if (showMirror) setDisplayCaret(caret);
    if (controlled) {
      emitActivity(next, el, "typing");
    } else {
      setInternalText(next);
    }
  }

  function syncCaretFromInput() {
    const el = inputRef.current;
    if (!el) return;
    const len = el.value.length;
    const caret = Math.max(0, Math.min(el.selectionStart ?? len, len));
    if (showMirror) setDisplayCaret(caret);
    if (!controlled || !onComposerActivity) return;
    emitActivity(el.value, el, "sync");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || disabled || isLoading) return;

    const toSend = text.trim();
    setBusy(true);
    // Clear immediately so the next message can be typed while `onSubmit` runs.
    if (controlled && onComposerActivity) {
      onComposerActivity({ text: "", caret: 0, source: "typing" });
    } else {
      setInternalText("");
    }
    caretRestoreRef.current = 0;
    setDisplayCaret(0);
    onSuggestionsDismiss?.();

    try {
      await onSubmit(toSend);
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(
    sourceEl: HTMLInputElement | null,
    item: WorkoutChatSuggestionItem,
  ) {
    if (sendFlowLocked) return;
    if (sourceEl?.dataset.composing === "1") return;
    const el = sourceEl ?? inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      text,
      caret,
      item,
    );
    const clamped = Math.max(0, Math.min(nextCaret, nextValue.length));
    caretRestoreRef.current = clamped;
    if (controlled && onComposerActivity) {
      emitActivity(nextValue, el, "suggestion", clamped);
    } else {
      setInternalText(nextValue);
    }
    const target = el ?? inputRef.current;
    queueMicrotask(() => {
      target?.focus();
      target?.setSelectionRange(clamped, clamped);
      setDisplayCaret(clamped);
    });
  }

  function applyFirstSuggestion(sourceEl: HTMLInputElement | null) {
    const first = suggestionLive[0];
    if (!first) return;
    applySuggestion(sourceEl, first);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    if (event.key === "Escape") {
      if (suggestionLive.length > 0) {
        event.preventDefault();
        onSuggestionsDismiss?.();
      }
      return;
    }

    if (
      showMirror &&
      event.key === "Backspace" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      el.dataset.composing !== "1"
    ) {
      const startSel = el.selectionStart ?? 0;
      const endSel = el.selectionEnd ?? 0;
      if (startSel !== endSel) return;

      const cut = tokenSpanForBackspaceDeletion(el.value, startSel);
      if (cut) {
        event.preventDefault();
        const next =
          el.value.slice(0, cut.start) + el.value.slice(cut.end);
        const caret = cut.start;
        caretRestoreRef.current = caret;
        if (showMirror) setDisplayCaret(caret);
        if (controlled && onComposerActivity) {
          emitActivity(next, el, "typing", caret);
        } else {
          setInternalText(next);
          queueMicrotask(() => {
            el.focus();
            el.setSelectionRange(caret, caret);
          });
        }
        return;
      }
    }

    if (
      event.key === "Tab" &&
      suggestionLive.length > 0 &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      applyFirstSuggestion(el);
    }
  }

  const cameraButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={sendFlowLocked}
      className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-background"
      aria-label="Open camera"
    >
      <Camera className="h-5 w-5" />
    </Button>
  );

  const strip = suggestionLive.length > 0 && (
    <div
      className={cn(
        "relative z-[1] flex w-full min-w-0 flex-wrap gap-1.5 rounded-xl border border-border/70 bg-background/95 p-2 shadow-sm backdrop-blur-md sm:flex-nowrap sm:overflow-x-auto",
        "[-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      role="listbox"
      aria-label="Message suggestions"
    >
      {suggestionLive.map((s, i) => (
        <button
          key={`${s.kind}-${s.label}-${i}`}
          type="button"
          role="option"
          disabled={sendFlowLocked}
          onClick={(e) => {
            e.preventDefault();
            applySuggestion(inputRef.current, s);
          }}
          className={cn(
            "shrink-0 touch-manipulation snap-start whitespace-nowrap rounded-full border border-border/80 bg-muted/40 px-3 py-1.5 text-left text-[13px] font-medium text-foreground shadow-sm transition-colors",
            "hover:bg-muted/70 active:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const mirrorSegments =
    showMirror && segments.length > 0 ? (
      <div
        ref={mirrorRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-0 flex min-h-full w-full items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-hidden
      >
        <div
          className={cn(
            mirrorFieldClass,
            "flex h-10 min-w-max touch-none flex-nowrap items-center gap-x-0 leading-normal text-foreground select-none",
          )}
        >
          {mirrorNodesWithCaret(segments, displayCaret)}
        </div>
      </div>
    ) : showMirror ? (
      <div
        ref={mirrorRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-0 flex min-h-full w-full items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        aria-hidden
      >
        <div
          className={cn(
            mirrorFieldClass,
            "flex h-10 min-w-max touch-none flex-nowrap items-center gap-x-0 leading-normal opacity-85 select-none",
          )}
        >
          {mirrorNodesWithCaret([], displayCaret)}
          {!text ? (
            <span className="truncate text-muted-foreground/70">{placeholder}</span>
          ) : null}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <span id={hintId} className="sr-only">
        {suggestionLive.length > 0
          ? `${suggestionLive.length} suggestion${suggestionLive.length === 1 ? "" : "s"}. Tab inserts the first.`
          : ""}
      </span>
      {strip}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 rounded-full border border-border/80 bg-card p-2 pl-2.5 shadow-md shadow-black/5",
          "transition-colors focus-within:bg-card",
        )}
        aria-describedby={suggestionLive.length > 0 ? hintId : undefined}
      >
        {cameraTrigger(cameraButton)}
        <div
          className={cn(
            "relative z-0 min-h-10 min-w-0 flex-1 overflow-hidden",
          )}
        >
          {mirrorSegments}
          <input
            ref={inputRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={syncCaretFromInput}
            onClick={syncCaretFromInput}
            onKeyUp={syncCaretFromInput}
            onScroll={(event) => {
              const mir = mirrorRef.current;
              if (mir) mir.scrollLeft = event.currentTarget.scrollLeft;
            }}
            placeholder={showMirror && text === "" ? "" : placeholder}
            disabled={inputLocked}
            autoComplete="off"
            enterKeyHint="send"
            aria-autocomplete="list"
            onCompositionStart={(event: CompositionEvent<HTMLInputElement>) => {
              setImeComposing(true);
              onImeCompositionChange?.(true);
              event.currentTarget.dataset.composing = "1";
            }}
            onCompositionEnd={(event: CompositionEvent<HTMLInputElement>) => {
              delete event.currentTarget.dataset.composing;
              setImeComposing(false);
              onImeCompositionChange?.(false);
            }}
            className={cn(
              inputFieldClass,
              "relative z-10 min-h-10",
              showMirror && "text-transparent caret-transparent",
            )}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          disabled={sendFlowLocked || !text.trim()}
          className="h-10 w-10 shrink-0 rounded-full disabled:opacity-100"
          aria-label={showSendSpinner ? "Working" : "Send"}
          aria-busy={showSendSpinner}
        >
          {showSendSpinner ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowUp className="h-5 w-5" />
          )}
        </Button>
      </form>
    </div>
  );
}
