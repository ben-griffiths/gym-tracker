# WebLLM in gym-tracker — deep dive

This document explains **how on-device inference is wired** in this repo: stack, lifecycle, guards, chat API usage, workout integration, logging, diagnostics, and operational toggles. It is derived from the current codebase (`lib/webllm/**`, `components/webllm/**`, workout chat, and the workout page).

---

## What problem WebLLM solves here

**Workout chat** (lift names, sets, reps, warmups, exercise switches) runs **entirely in the browser**. There is **no `/api/chat`** route for that flow. The model (`@mlc-ai/web-llm`) runs via **WebGPU**, loads weights from MLC’s CDN / cache, and responds through an **OpenAI-compatible** `engine.chat.completions.create` surface.

The app **does not** rely on the model to emit perfect structured data. For workouts, the model outputs a **small XML patch** (`<edit>...</edit>`); TypeScript **sanitizes and applies** that patch to the current workout XML, then runs the merged document through **repair/sanitize** and maps it to UI state (`ChatSetSuggestion`). That keeps tiny models (here: **Llama 3.2 1B Instruct**) from having to copy whole XML documents reliably.

---

## Stack overview

| Layer | Technology | Role |
|--------|------------|------|
| Package | `@mlc-ai/web-llm` | Engine, prebuilt app config, worker handler |
| Runtime | **WebGPU** (`navigator.gpu`) | GPU kernels for inference |
| Engine modes | `WebWorkerMLCEngine` (preferred) or `MLCEngine` (main thread) | See `lib/webllm/engine-loader.ts` |
| Worker | `lib/webllm/workers/mlc.worker.ts` | Lazy `WebWorkerMLCEngineHandler` (parity with upstream web-llm-chat) |
| Model ID | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | Pinned in `lib/webllm/config.ts` |
| React | `WebllmProvider` + `useWebllm()` | Load state, engine ref, `ensureEngineForChat` |
| UI shell | `WebllmInstallOverlay` | Full-screen loading / error + retry |

---

## Model and chat configuration

**File:** [`lib/webllm/config.ts`](../lib/webllm/config.ts)

- **`WEBLLM_MODEL_ID`** is fixed to **`Llama-3.2-1B-Instruct-q4f32_1-MLC`**.
- Comments note this checkpoint is **not** in MLC’s tool-calling model list, so **`tools` / `tool_choice`** completions are not the supported path; the app uses **plain chat completions** and **string XML** instead.
- **`resolveWebLLMChatOptions()`** returns optional **`ChatOptions`** for **low-resource clients** (mobile UA, Save-Data, slow Network Information API, or low `deviceMemory`):
  - **Production:** `context_window_size: 1024` (smaller KV cache → less WebGPU memory pressure, helpful on cold first load e.g. new Vercel origin).
  - **Development:** `context_window_size: 2048`.
- Desktop / unconstrained clients get **`undefined`** chat options (MLC defaults apply).

**File:** [`lib/webllm/capability.ts`](../lib/webllm/capability.ts)

- **`isWebGPUSupported()`** — requires `navigator.gpu` to exist (coarse gate).
- **`prefersLowResourceWebLLM()`** — drives the context window override above.
- **`requiresIOSPWAInstallForWebLLM()`** — currently always **`false`** (the 1B model fits typical iOS Cache API limits; the `WebllmLoadStatus` branch `"requires_pwa_install"` is kept for structural/UI compatibility if a larger model returns later).

---

## Engine creation: worker first, main-thread fallback

**File:** [`lib/webllm/engine-loader.ts`](../lib/webllm/engine-loader.ts)

The loader follows the same sequence as **web-llm-chat**: construct engine → `setInitProgressCallback` → **`await reload(modelId, chatOpts)`** (not the older `CreateWebWorkerMLCEngine` helpers).

1. **Engine config**
   - Spreads `webllm.prebuiltAppConfig`.
   - Sets **`useIndexedDBCache: false`** (cache strategy aligned with this app’s needs).
   - Sets **`logLevel: "WARN"`** to reduce noise.

2. **Worker path (default)**
   - Unless disabled, creates `new Worker(new URL("./workers/mlc.worker.ts", import.meta.url), { type: "module" })`.
   - Instantiates **`WebWorkerMLCEngine`** with that worker and config.
   - On failure: **terminates** the worker and falls through to main-thread engine.

3. **Main-thread fallback**
   - **`new MLCEngine(engineConfig)`**, same callback + **`reload`**.

4. **Kill switch**
   - **`NEXT_PUBLIC_WEBLLM_SKIP_WORKER=1`** (or `true`) **forces** main-thread **`MLCEngine`** only — useful when production `/_next/static/...` worker or wasm chunks misbehave while dev works.

---

## Worker implementation

**File:** [`lib/webllm/workers/mlc.worker.ts`](../lib/webllm/workers/mlc.worker.ts)

- Imports **`WebWorkerMLCEngineHandler`** from `@mlc-ai/web-llm`.
- Defers handler construction until the **first** `message` event (lazy activation).
- Colocated next to `engine-loader.ts` so **`import.meta.url`** resolves under **webpack** production builds.

---

## Provider lifecycle and load status

**File:** [`components/webllm/webllm-provider.tsx`](../components/webllm/webllm-provider.tsx)

### Hydration-safe initial state

The provider **always** starts with `status: "idle"` on the first render so **SSR HTML matches** the first client paint. **`useLayoutEffect`** then applies **`readInitialState()`**, which consults:

- **`consumeLoadCrashIfAny()`** — see crash gate below.
- **`isAutoloadSkipped()`** — user/gate skipped autoload.
- **`isWebGPUSupported()`**.
- **`requiresIOSPWAInstallForWebLLM()`** (currently false).

### `WebllmLoadStatus` values

| Status | Meaning |
|--------|---------|
| `idle` | Ready to start load (after mount) |
| `loading` | Download / compile / reload in progress |
| `ready` | Engine reference held; chat may run |
| `unsupported` | No WebGPU |
| `error` | Load failed after retries (or crash gate message) |
| `awaiting_tap` | Reserved path for tap-to-start (provider notes; autoload is still eager from `idle` when gates allow) |
| `requires_pwa_install` | iOS quota / install messaging (currently unused while gate returns false) |

### Eager autoload

After **`clientReady`**, if status is **`idle`**, WebGPU is available, and autoload is not skipped, the provider calls **`runLoadWithAutoRetry()`** which:

- Runs **`runLoad`** up to **3** times with **linear backoff** (1.5s, 3s) on failure.
- Bumps a **generation** `loadGenRef` so stale async completions **unload** the engine instead of clobbering a newer load.

### `runLoad` sequence (high level)

1. Gate WebGPU / PWA if applicable.
2. **`setTrackedStatus("loading")`**, clear errors.
3. **Dynamic import** `@mlc-ai/web-llm`.
4. **`resolveWebLLMModelId()`**, **`resolveWebLLMChatOptions()`**.
5. **`bootstrapWebLLMStorage()`** — `navigator.storage.persisted()` + **`persist()`** + `estimate()` (runs **before** the `@mlc-ai/web-llm` import so durable storage is requested ahead of Cache Storage fills). On mobile-only, an extra **`useEffect`** also primes persistence at mount when WebGPU is available.
6. **`webllmLogEnvironmentDebug`**.
7. **`setInflightBeforeEngineCreate()`** — session markers for crash detection.
8. **`loadPreferredWebllmEngine({ ..., initProgressCallback })`**:
   - Progress updates → **`recordLastWebllmInitProgress`** (sessionStorage), **`classifyWebllmInitProgressPhase`**, **`webllmDiagProgress`**, **`webllmLogProgress`** (throttled), React `setProgress`.
9. **`clearInflightAfterEngineCreate()`** in `finally` when the current generation still owns the load.
10. If generation stale → **`engine.unload()`**, abort.
11. On success: **`allowAutoloadAgain()`**, store engine in **`engineRef`**, **`status = "ready"`**, **`webllmDiagOnLoadEnd("ready")`**.

### Unload on unmount

The autoload `useEffect` cleanup increments **generation** and calls **`engine.unload()`** on the ref to avoid leaks when navigating away.

### `ensureEngineForChat`

Serialized via **`ensureChainRef`** so concurrent callers share one chain:

- Returns **`null`** if unsupported, hard error, `awaiting_tap`, or `requires_pwa_install`.
- If **`idle`**, kicks **`runLoad(gen)`** and returns the engine if successful.
- If **`loading`**, **waits** on a promise queue (**`loadWaitersRef`**) flushed in `runLoad`’s `finally`.
- If **`ready`**, returns **`engineRef.current`**.

This is what the **workout page** uses before running chat (see below).

### Playwright override

If **`window.__PLAYWRIGHT_FORCE_PARSER_CHAT__ === true`**, **`chatSendBlocked`** is forced **false** so E2E can exercise UI without a loaded engine (parser-only paths).

---

## Crash gate and session storage

**File:** [`lib/webllm/load-session.ts`](../lib/webllm/load-session.ts)

WebGPU / tab **hard kills** during engine creation may **not** run JS cleanup. The app sets **`sessionStorage["gym.webllm.inflight"] = "1"`** *synchronously* before `CreateMLCEngine`, and clears it when the await completes.

- On next load, **`consumeLoadCrashIfAny()`** sees `inflight === "1"`, sets **`gym.webllm.skip_autoload`**, and returns a user-facing **`WEBLLM_LOAD_GATE_MESSAGE`** so the app **does not** auto-enter another load loop.
- **`allowAutoloadAgain()`** clears skip + inflight (retry, explicit user action).

This is separate from **GPU OOM** during inference — it targets **navigation / reload** after a mid-load kill.

---

## Storage bootstrap

**File:** [`lib/webllm/storage-bootstrap.ts`](../lib/webllm/storage-bootstrap.ts)

Before the WebLLM module loads, the app attempts:

- **`navigator.storage.persisted()`** — read-only probe for an already durable bucket (when supported).
- **`navigator.storage.persist()`** — best-effort request for persistent storage (helps eviction under pressure; does not fix GPU OOM).
- **`navigator.storage.estimate()`** — usage / quota in MB for logs and diagnostics payloads.

Models are cached by WebLLM in the **Cache API** (`useIndexedDBCache: false`); MLC’s types note IndexedDB as an alternative with different eviction tradeoffs.

### Persistence (mobile)

Safari iOS / Chrome Android only **best-effort** keep large Cache Storage entries; `persist()` nudges eligible origins toward durable quota but cannot override private browsing, uninstall, explicit “Clear site data”, or aggressive low-disk eviction. Installing the site as a Home Screen app often improves longevity on iOS. **Forever** in practice means **until** the OS or user clears browsing data—not guaranteed across weeks on a full device.

---

## Init progress: phases and last-line capture

**File:** [`lib/webllm/init-progress.ts`](../lib/webllm/init-progress.ts)

- **`classifyWebllmInitProgressPhase(text)`** maps MLC progress strings into coarse buckets: `fetch_cache`, `compile_gpu`, `weight_load`, `finalize`, `unknown` (heuristic / version-sensitive).
- **`recordLastWebllmInitProgress`** writes the **latest** full report to **sessionStorage** on every callback so a **silent tab kill** still leaves a trace of the last line for diagnostics.

---

## Client logging

**File:** [`lib/webllm/client-log.ts`](../lib/webllm/client-log.ts)

Goals:

- Verbose **`[webllm]`** logs **on by default** in development and for typical production users diagnosing Mobile Safari (**Develop → device**).
- **Silence:** `localStorage.setItem("gym.webllm.log", "0")` + reload, or **`NEXT_PUBLIC_WEBLLM_LOG=0`** at build time, or **`1`** to force on.

Important helpers:

- **`webllmLog`** — structured event + data; respects verbose unless **`force: true`**.
- **`webllmLogProgress`** — **throttled** init lines so Safari consoles stay readable.
- **`webllmLogRawWorkoutXml`** — **`console.warn`** with **full XML string** inline (objects collapse poorly on mobile).
- **`webllmLogChatCompletionsRequestFull`** — dumps **exact** `chat.completions.create` args as JSON plus system/user excerpts (workout chat uses **`omitPayloadLog`** on the actual call when the turn already logged the same payload).

**Error formatting:** **`formatWebllmLoadError`** produces short summary + multi-line detail for the overlay “Show details” panel.

---

## Diagnostics upload (optional)

**File:** [`lib/webllm/diagnostics.ts`](../lib/webllm/diagnostics.ts)

- Records **throttled** progress samples in **`localStorage`** keyed **`gym.webllm.diag_v1`** (load id, model id, context window, entries).
- On **suspected tab crash** (inflight mismatch on boot) or **JS load errors**, can **POST** anonymized JSON to the app’s ingest route.

**File:** [`app/api/webllm-log/route.ts`](../app/api/webllm-log/route.ts)

- **`POST /api/webllm-log`** validates **`source: "gym-webllm"`, `version: 1`**, allowed `reason` values, size cap (~65KB).
- Optional **`NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET`** — require header **`x-webllm-log-secret`**.
- Logs a compact line in production; can log full JSON in dev or when **`WEBLLM_LOG_VERBOSE=1`**.

---

## Chat API wrapper

**File:** [`lib/webllm/chat-text.ts`](../lib/webllm/chat-text.ts)

- **`chatCompletionText({ engine, messages, maxTokens, temperature?, stop?, omitPayloadLog? })`**
  - Calls **`engine.chat.completions.create`** with **`stream: false`**, passes **`stop`** if provided.
  - Reads **`choices[0].message.content`**, **trims**.
  - On throw: returns **empty string** (callers handle failure).
- **`chatText`** — thin wrapper with single system + user pair.

Workout chat uses **`chatCompletionText`** with **`temperature: 0`**, **`max_tokens: 128`**, **`stop: ["</edit>"]`** (see workout section).

---

## Workout chat: how the LLM is invoked

**Files:**

- [`lib/workout-chat/workout-chat-turn.ts`](../lib/workout-chat/workout-chat-turn.ts) — **`runXmlWorkoutChat`**, **`runWorkoutChatDraft`**
- [`lib/workout-chat/workout-edit-xml.ts`](../lib/workout-chat/workout-edit-xml.ts) — extract / sanitize / apply patches
- [`lib/workout-chat/workout-xml.ts`](../lib/workout-chat/workout-xml.ts) — previous XML from context, sanitize merged workout, **`workoutXmlToSuggestion`**

### End-to-end flow

1. **Input:** user message + **`ChatContextSnapshot`** (active block, sets, etc.).
2. **Short-circuit:** greetings / chat-only messages → **`emptyChatSuggestion`** (no LLM).
3. **Context XML:** **`buildCleanPreviousWorkoutXml`** produces a canonical **`<workout exercise="...">`** with **repaired** rows so the model sees stable **`n`**, kinds, units.
4. **Hints:** **`extractExerciseQueryFromMessage`**, **`rankExercisesForQuery`**, **`buildOrderedExerciseSlugHints`**, **`buildAllowedExerciseSlugs`** — current exercise first, then ranked candidates.
5. **Prompt:** large **SYSTEM** string defining **only** `<edit>...</edit>` output (insert/update/delete/set-exercise/noop), partial-data rules, and bad examples (no full `<workout>`).
6. **Few-shot:** two multi-turn examples (e.g. add warmups → `insert`; change last set reps → `update`).
7. **User block:** labeled sections **`CURRENT_XML`**, **`ALLOWED_EXERCISE_SLUGS`**, **`USER_REQUEST`**.
8. **Inference:** **`chatCompletionText`** with **128** max tokens, **stop at `</edit>`**; if output contains `<edit` but not closing tag, append **`</edit>`**.
9. **Parse pipeline:**
   - **`extractEditXml`** (strip fences, first edit, close truncated roots).
   - **`sanitizeEditXml`** (schema only: allowed tags, capped insert counts, validated slugs/targets).
   - **`applyWorkoutEditXml`** merges patch into previous rows (generic XML ops, **no** phrase regex parsing).
   - **`sanitizeWorkoutXml`** on merged full workout (allowlist exercise, row constraints).
   - Guard: need at least one **`<s`** in sanitized output (same spirit as before).
   - **`workoutXmlToSuggestion`** with **`fullRepair: false`** to preserve partial rows from the merged edit path where appropriate; repair still normalizes/clamps internally for UI.

### Why `<edit>` patches

The pinned **1B** model struggled to return **full updated `<workout>`** documents (repetition, dropped rows). The patch design asks the model for a **short** operation; TypeScript **copies** existing rows and applies changes **deterministically**.

### Logging labels (workout turn)

Typical sequence in console / ingest-friendly events:

1. **`workout-chat: full LLM request (before engine invoke)`** — full create args.
2. **`workout-chat: llm raw edit xml`**
3. **`workout-chat: sanitized edit xml`**
4. **`workout-chat: merged workout xml`**
5. **`workout-chat: sanitized workout xml`**

---

## Workout page integration

**File:** [`app/workout/page.tsx`](../app/workout/page.tsx)

- Imports **`useWebllm`**.
- **`chatMutation`** (React Query):
  1. **`await webllm.ensureEngineForChat()`** (fallback **`getEngine()`**).
  2. If no engine → **`emptyChatSuggestion`** with message explaining the on-device model must finish loading.
  3. Dynamic import **`runWorkoutChatDraft(engine, { message, context })`**.
  4. Returns **`ChatSetSuggestion`** for the chat-flow state machine.

There is **no server round trip** for the LLM inference itself; optional **`/api/webllm-log`** is **telemetry only**.

---

## Global providers and overlay

**File:** [`components/providers.tsx`](../components/providers.tsx)

- Wraps the app with **`WebllmProvider`** and renders **`WebllmInstallOverlay`** as a sibling under the provider so any route can access context (workout page is the primary consumer).

**File:** [`components/webllm/webllm-install-overlay.tsx`](../components/webllm/webllm-install-overlay.tsx)

- Visible when **`status === "loading"`** or **`"error"`**.
- Shows **retry** after failures; explains **3 automatic attempts** + user **Try again**.
- Progress bar driven by **`InitProgress.progress`** (0–1).

---

## Environment variables (reference)

| Variable | Effect |
|----------|--------|
| `NEXT_PUBLIC_WEBLLM_SKIP_WORKER` | `1` / `true` → main-thread `MLCEngine` only |
| `NEXT_PUBLIC_WEBLLM_LOG` | `0` / `1` — coarse client log enable/disable |
| `NEXT_PUBLIC_WEBLLM_LOG_INGEST_SECRET` | Optional secret for `POST /api/webllm-log` |
| `WEBLLM_LOG_VERBOSE` | Server: log full diag JSON |
| `NODE_ENV` | Production → smaller `context_window_size` on mobile-like clients |

---

## E2E and testing

- **`tests/e2e/chat-webllm.test.ts`** — exercises chat with Playwright; can use **`__PLAYWRIGHT_FORCE_PARSER_CHAT__`** to bypass engine requirement where wired.
- **Unit tests:** [`tests/unit/workout-edit-xml.test.ts`](../tests/unit/workout-edit-xml.test.ts) for patch extract/sanitize/apply; [`tests/unit/workout-xml-sanitize.test.ts`](../tests/unit/workout-xml-sanitize.test.ts) for merged workout sanitization.

---

## Mental model summary

1. **Browser-only inference** via MLC WebLLM + WebGPU, optionally in a **dedicated worker**.
2. **One pinned small instruct model**; **tool calling** is not the integration path.
3. **Provider** handles **download/compile**, **retries**, **crash gates**, and **engine lifecycle**.
4. **Workout chat** = few-shot **`chat.completions.create`** → **XML edit patch** → **safe apply** → **sanitize** → **suggestion** → existing **chat-flow** actions.
5. **Observability** is intentionally **client-heavy** (console + optional diag POST) because failures often happen on **user devices**, not the server.

For XML vocabulary and repair behavior, see **[`docs/workout-chat-xml.md`](workout-chat-xml.md)** and **[`.cursor/rules/chat-agent.mdc`](../.cursor/rules/chat-agent.mdc)**.
