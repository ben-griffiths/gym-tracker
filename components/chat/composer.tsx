"use client";

import {
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { ArrowUp, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  applyWorkoutChatSuggestionAtCaret,
  type WorkoutChatSuggestionItem,
} from "@/lib/workout-chat/suggest";

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
  onComposerActivity?: (detail: { text: string; caret: number }) => void;
  /** Predictive chips (workout chat) — shown above the field, max ~6. */
  suggestions?: WorkoutChatSuggestionItem[];
  onSuggestionsDismiss?: () => void;
  onImeCompositionChange?: (active: boolean) => void;
};

export function Composer({
  onSubmit,
  cameraTrigger,
  disabled,
  isLoading,
  placeholder = "Log a set, e.g. bench 5x5 at 100kg",
  text: textProp,
  onComposerActivity,
  suggestions = [],
  onSuggestionsDismiss,
  onImeCompositionChange,
}: ComposerProps) {
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [internalText, setInternalText] = useState("");
  const [busy, setBusy] = useState(false);
  const controlled = textProp !== undefined;
  const text = controlled ? textProp : internalText;
  const formLocked = Boolean(disabled || busy || isLoading);
  const showSendSpinner = busy || Boolean(isLoading);
  const suggestionLive = suggestions.length > 0 ? suggestions : [];

  function emitActivity(nextText: string, el: HTMLInputElement | null) {
    if (!onComposerActivity || !controlled) return;
    const caret = el?.selectionStart ?? nextText.length;
    onComposerActivity({ text: nextText, caret });
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    const next = el.value;
    if (controlled) {
      emitActivity(next, el);
    } else {
      setInternalText(next);
    }
  }

  function syncCaretFromInput() {
    const el = inputRef.current;
    if (!el || !controlled || !onComposerActivity) return;
    emitActivity(el.value, el);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy || disabled || isLoading) return;

    setBusy(true);
    try {
      await onSubmit(text.trim());
      if (controlled && onComposerActivity) {
        onComposerActivity({ text: "", caret: 0 });
      } else {
        setInternalText("");
      }
      onSuggestionsDismiss?.();
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(
    sourceEl: HTMLInputElement | null,
    item: WorkoutChatSuggestionItem,
  ) {
    if (formLocked) return;
    if (sourceEl?.dataset.composing === "1") return;
    const el = sourceEl ?? inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const { nextValue, nextCaret } = applyWorkoutChatSuggestionAtCaret(
      text,
      caret,
      item,
    );
    if (controlled && onComposerActivity) {
      onComposerActivity({ text: nextValue, caret: nextCaret });
    } else {
      setInternalText(nextValue);
    }
    const target = el ?? inputRef.current;
    queueMicrotask(() => {
      target?.focus();
      target?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function applyFirstSuggestion(sourceEl: HTMLInputElement | null) {
    const first = suggestionLive[0];
    if (!first) return;
    applySuggestion(sourceEl, first);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (suggestionLive.length > 0) {
        event.preventDefault();
        onSuggestionsDismiss?.();
      }
      return;
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
      applyFirstSuggestion(event.currentTarget);
    }
  }

  const cameraButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={formLocked}
      className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-background"
      aria-label="Open camera"
    >
      <Camera className="h-5 w-5" />
    </Button>
  );

  const strip = suggestionLive.length > 0 && (
    <div
      className={cn(
        "flex w-full min-w-0 flex-wrap gap-1.5 sm:flex-nowrap sm:overflow-x-auto sm:pb-0.5",
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
          disabled={formLocked}
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

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <span id={hintId} className="sr-only">
        {suggestionLive.length > 0
          ? `${suggestionLive.length} suggestion${suggestionLive.length === 1 ? "" : "s"}. Tab inserts the first.`
          : ""}
      </span>
      {strip}
      <form
        onSubmit={handleSubmit}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-full border border-border/80 bg-card p-1.5 pl-2 shadow-md shadow-black/5",
          "transition-colors focus-within:bg-card",
        )}
        aria-describedby={suggestionLive.length > 0 ? hintId : undefined}
      >
        {cameraTrigger(cameraButton)}
        <input
          ref={inputRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={syncCaretFromInput}
          onClick={syncCaretFromInput}
          onKeyUp={syncCaretFromInput}
          placeholder={placeholder}
          disabled={formLocked}
          autoComplete="off"
          enterKeyHint="send"
          aria-autocomplete="list"
          onCompositionStart={(event: CompositionEvent<HTMLInputElement>) => {
            onImeCompositionChange?.(true);
            event.currentTarget.dataset.composing = "1";
          }}
          onCompositionEnd={(event: CompositionEvent<HTMLInputElement>) => {
            delete event.currentTarget.dataset.composing;
            onImeCompositionChange?.(false);
          }}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70"
        />
        <Button
          type="submit"
          size="icon"
          disabled={formLocked || !text.trim()}
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
