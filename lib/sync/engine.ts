/**
 * Sync orchestrator. Drains the outbox to /api/sync/push, then pulls fresh
 * rows from /api/sync/pull and merges them into Dexie. Triggered on:
 *   - first mount
 *   - `online` event
 *   - `visibilitychange` to visible
 *   - manual `kick()` after every local mutation
 *   - 30 s timer while the tab is open
 */

import { mergeRow } from "./mergers";
import {
  pullResponseSchema,
  pushResponseSchema,
  ROW_SCHEMAS,
} from "./schemas";
import { getLocalDb, nowIso } from "./db";
import type {
  OutboxEntry,
  ServerRow,
  SyncRow,
  SyncTable,
} from "./types";

const PULL_LIMIT = 500;
const PERIODIC_MS = 30_000;

type Listener = (state: SyncState) => void;

export type SyncState = {
  status: "idle" | "syncing" | "error" | "offline";
  pendingMutations: number;
  lastError: string | null;
  lastSyncedAt: string | null;
};

let state: SyncState = {
  status: "idle",
  pendingMutations: 0,
  lastError: null,
  lastSyncedAt: null,
};
const listeners = new Set<Listener>();

function emit(next: Partial<SyncState>) {
  state = { ...state, ...next };
  for (const l of listeners) l(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

let inflight: Promise<void> | null = null;
let pendingKick = false;

/**
 * Push the outbox to the server and wait for completion. Used by lib/api.ts
 * mutations when the device is online so that callers (legacy GET endpoints)
 * see fresh data on the next read. Silently no-ops when offline.
 */
export async function flushOutboxOnce(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    // Pull first so unique-key remaps land before we try to push.
    await pullChanges();
    await drainOutbox();
    const pending = await getLocalDb().outbox.count();
    emit({ pendingMutations: pending });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ status: "error", lastError: message });
  }
}

export function kickSync(): Promise<void> {
  if (inflight) {
    pendingKick = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      do {
        pendingKick = false;
        await runOnce();
      } while (pendingKick);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function runOnce(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    emit({ status: "offline" });
    return;
  }
  emit({ status: "syncing", lastError: null });
  try {
    // Pull first: it's read-only, can't fail mid-state, and may rewrite
    // outbox payloads (id remap on slug/name conflict) so the subsequent
    // push doesn't 403/409 on stale FKs.
    await pullChanges();
    await drainOutbox();
    const pending = await getLocalDb().outbox.count();
    emit({
      status: "idle",
      pendingMutations: pending,
      lastSyncedAt: nowIso(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ status: "error", lastError: message });
  }
}

async function drainOutbox(): Promise<void> {
  const db = getLocalDb();
  while (true) {
    const batch = await db.outbox.orderBy("queued_at").limit(50).toArray();
    if (batch.length === 0) return;

    const response = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: batch.map((m) => ({
          table: m.table,
          op: m.op,
          row_id: m.row_id,
          client_updated_at: m.client_updated_at,
          payload: m.payload,
        })),
      }),
    });

    if (response.status === 401) {
      throw new Error("Not signed in");
    }
    if (!response.ok) {
      throw new Error(`Push failed: ${response.status}`);
    }
    const json = await response.json();
    const parsed = pushResponseSchema.parse(json);

    await db.transaction(
      "rw",
      [db.outbox, db.workout_groups, db.workout_sessions, db.exercises, db.session_exercises, db.set_entries],
      async () => {
        const ids = batch.map((m) => m.id!).filter((id): id is number => id != null);
        await db.outbox.bulkDelete(ids);

        for (let i = 0; i < parsed.results.length; i++) {
          const r = parsed.results[i]!;
          const sent = batch[i];
          const serverId = r.server_row.id as string;
          if (sent && sent.row_id !== serverId) {
            await remapId(r.table, sent.row_id, serverId);
          }
          await applyServerRow(r.table, r.server_row as ServerRow);
        }
      },
    );
  }
}

/**
 * The server adopted an existing row's id (unique-key conflict on slug/name).
 * Rewrite our local row + any FK references + any pending outbox payloads.
 */
async function remapId(
  table: SyncTable,
  oldId: string,
  newId: string,
): Promise<void> {
  const db = getLocalDb();
  const store = db.table(table) as unknown as {
    get(id: string): Promise<SyncRow | undefined>;
    delete(id: string): Promise<void>;
  };
  const local = await store.get(oldId);
  if (local) await store.delete(oldId);

  if (table === "workout_groups") {
    const dependents = await db.workout_sessions
      .where("workout_group_id")
      .equals(oldId)
      .toArray();
    for (const dep of dependents) {
      await db.workout_sessions.put({ ...dep, workout_group_id: newId });
    }
  } else if (table === "exercises") {
    const dependents = await db.session_exercises
      .where("exercise_id")
      .equals(oldId)
      .toArray();
    for (const dep of dependents) {
      await db.session_exercises.put({ ...dep, exercise_id: newId });
    }
  }

  // Rewrite any pending outbox entries that reference the old id.
  const pending = await db.outbox.toArray();
  for (const entry of pending) {
    if (entry.row_id === oldId) {
      entry.row_id = newId;
      (entry.payload as Record<string, unknown>).id = newId;
      await db.outbox.put(entry);
      continue;
    }
    const payload = entry.payload as Record<string, unknown>;
    let dirty = false;
    if (table === "workout_groups" && payload.workout_group_id === oldId) {
      payload.workout_group_id = newId;
      dirty = true;
    }
    if (table === "exercises" && payload.exercise_id === oldId) {
      payload.exercise_id = newId;
      dirty = true;
    }
    if (dirty) await db.outbox.put(entry);
  }
}

/**
 * Detect a stale local row that shares this server row's unique key
 * (slug for workout_groups, name for exercises) but has a different id.
 * Such rows arise when an earlier push of the local row failed and a
 * subsequent pull brought back the server's canonical version. Remap the
 * stale id to the server id so dependent FKs (workout_sessions,
 * session_exercises, outbox payloads) line up.
 */
async function reconcileUniqueKey(
  table: SyncTable,
  serverRow: ServerRow,
): Promise<void> {
  const db = getLocalDb();
  if (table === "workout_groups") {
    const slug = (serverRow as unknown as { slug?: string }).slug;
    if (!slug) return;
    const userId = (serverRow as unknown as { user_id: string }).user_id;
    const dupes = await db.workout_groups
      .where("[user_id+slug]")
      .equals([userId, slug])
      .toArray();
    for (const d of dupes) {
      if (d.id !== serverRow.id) {
        await remapId("workout_groups", d.id, serverRow.id);
      }
    }
  } else if (table === "exercises") {
    const name = (serverRow as unknown as { name?: string }).name;
    if (!name) return;
    const userId = (serverRow as unknown as { user_id: string }).user_id;
    const dupes = await db.exercises
      .where("user_id")
      .equals(userId)
      .filter((e) => e.name.toLowerCase() === name.toLowerCase())
      .toArray();
    for (const d of dupes) {
      if (d.id !== serverRow.id) {
        await remapId("exercises", d.id, serverRow.id);
      }
    }
  }
}

/**
 * Walk Dexie for workout_groups / exercises that share a unique key
 * (slug / case-insensitive name). When multiple rows match, pick the
 * server-confirmed one (server_updated_at != null) as canonical and
 * remap the rest. Runs once on engine start to repair state left over
 * from earlier failed-push flows that pre-dated reconcileUniqueKey.
 */
export async function dedupeLocal(): Promise<void> {
  const db = getLocalDb();

  const groups = await db.workout_groups.toArray();
  const groupsBySlug = new Map<string, typeof groups>();
  for (const g of groups) {
    const key = `${g.user_id} ${g.slug}`;
    const list = groupsBySlug.get(key) ?? [];
    list.push(g);
    groupsBySlug.set(key, list);
  }
  for (const dupes of groupsBySlug.values()) {
    if (dupes.length < 2) continue;
    const canonical =
      dupes.find((d) => d.server_updated_at != null) ?? dupes[0];
    for (const d of dupes) {
      if (d.id !== canonical.id) {
        await remapId("workout_groups", d.id, canonical.id);
      }
    }
  }

  const exercises = await db.exercises.toArray();
  const byName = new Map<string, typeof exercises>();
  for (const e of exercises) {
    const key = `${e.user_id} ${e.name.toLowerCase()}`;
    const list = byName.get(key) ?? [];
    list.push(e);
    byName.set(key, list);
  }
  for (const dupes of byName.values()) {
    if (dupes.length < 2) continue;
    const canonical =
      dupes.find((d) => d.server_updated_at != null) ?? dupes[0];
    for (const d of dupes) {
      if (d.id !== canonical.id) {
        await remapId("exercises", d.id, canonical.id);
      }
    }
  }
}

async function pullChanges(): Promise<void> {
  const db = getLocalDb();
  const meta = await db.sync_meta.get("default");
  let cursor = meta?.cursor ?? null;

  while (true) {
    const url = new URL("/api/sync/pull", window.location.origin);
    if (cursor) url.searchParams.set("since", cursor);
    url.searchParams.set("limit", String(PULL_LIMIT));

    const response = await fetch(url.toString(), { method: "GET" });
    if (response.status === 401) throw new Error("Not signed in");
    if (!response.ok) throw new Error(`Pull failed: ${response.status}`);

    const json = await response.json();
    const parsed = pullResponseSchema.parse(json);

    await db.transaction(
      "rw",
      [db.workout_groups, db.workout_sessions, db.exercises, db.session_exercises, db.set_entries, db.sync_meta, db.outbox],
      async () => {
        for (const [table, rows] of Object.entries(parsed.rows) as Array<
          [SyncTable, ServerRow[]]
        >) {
          for (const row of rows) {
            if (table === "workout_groups" || table === "exercises") {
              await reconcileUniqueKey(table, row);
            }
            await applyServerRow(table, row);
          }
        }
        await db.sync_meta.put({
          id: "default",
          cursor: parsed.next_cursor ?? cursor,
          last_pull_at: nowIso(),
        });
      },
    );

    cursor = parsed.next_cursor ?? cursor;
    if (!parsed.has_more) return;
  }
}

async function applyServerRow(
  table: SyncTable,
  serverRow: ServerRow,
): Promise<void> {
  const db = getLocalDb();
  const store = db.table(table) as unknown as {
    get(id: string): Promise<SyncRow | undefined>;
    put(row: SyncRow): Promise<unknown>;
  };
  const local = await store.get(serverRow.id);
  const merged = mergeRow(table, local, serverRow);
  const localDirty = local?.dirty === 1 ? local : null;
  const serverWon = !localDirty || JSON.stringify(merged) === JSON.stringify(serverRow);
  const next: SyncRow = {
    ...merged,
    server_updated_at: serverRow.updated_at,
    local_updated_at: localDirty ? local!.local_updated_at : serverRow.updated_at,
    dirty: serverWon ? 0 : 1,
  } as SyncRow;
  await store.put(next);
}

let started = false;
let timerId: ReturnType<typeof setInterval> | null = null;

export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("online", () => kickSync());
  window.addEventListener("focus", () => kickSync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kickSync();
  });
  timerId = setInterval(() => kickSync(), PERIODIC_MS);

  // One-time sweep at boot to repair duplicate-key rows left over from
  // failed-push flows. Then run the normal pull/push cycle.
  void (async () => {
    try {
      await dedupeLocal();
    } catch (err) {
      console.warn("dedupeLocal failed", err);
    }
    void kickSync();
  })();
}

export function stopSyncEngine(): void {
  if (timerId != null) {
    clearInterval(timerId);
    timerId = null;
  }
  started = false;
}

/**
 * Append an outbox mutation. Callers should already have updated the local
 * row in the same transaction; pass that transaction in via `runInTx` so the
 * write is atomic with the row update. If `runInTx` is omitted we open our
 * own short transaction.
 */
export async function enqueueMutation(entry: Omit<OutboxEntry, "id" | "attempts" | "queued_at">): Promise<void> {
  const db = getLocalDb();
  await db.outbox.add({
    ...entry,
    attempts: 0,
    queued_at: nowIso(),
  });
  const pending = await db.outbox.count();
  emit({ pendingMutations: pending });
}

/** Test-only: reset module state. */
export function __resetEngineForTests() {
  state = {
    status: "idle",
    pendingMutations: 0,
    lastError: null,
    lastSyncedAt: null,
  };
  listeners.clear();
  inflight = null;
  pendingKick = false;
  started = false;
  if (timerId != null) {
    clearInterval(timerId);
    timerId = null;
  }
}

// Expose for tests / debugging.
export const _internal = {
  applyServerRow,
  drainOutbox,
  pullChanges,
  ROW_SCHEMAS,
};
