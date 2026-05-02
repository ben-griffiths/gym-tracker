/**
 * Field-level mergers used during pull. The default policy is row-level LWW
 * by `client_updated_at`, but a few fields need richer semantics:
 *
 *   - `exercises.aliases[]`     → union (case-insensitive dedup)
 *   - `workout_sessions.chat_transcript` → merge by message id, LWW per message
 *   - `deleted_at`              → latest non-null wins; resurrect requires a
 *                                 strictly-later non-deleted update.
 */

import type {
  ExerciseRow,
  ServerRow,
  SyncRow,
  SyncTable,
  WorkoutSessionRow,
} from "./types";

/** Compare two ISO timestamps; null is treated as -infinity. */
export function isLater(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a) > Date.parse(b);
}

export function mergeAliases(local: string[], remote: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of [...remote, ...local]) {
    if (!v) continue;
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  return Array.from(seen.values());
}

type TranscriptMessage = { id?: string; updated_at?: string; [k: string]: unknown };
type Transcript = { messages?: TranscriptMessage[]; [k: string]: unknown };

export function mergeTranscript(
  local: unknown,
  remote: unknown,
): unknown {
  const lt = (local && typeof local === "object" ? local : null) as Transcript | null;
  const rt = (remote && typeof remote === "object" ? remote : null) as Transcript | null;
  if (!lt && !rt) return remote ?? local ?? null;
  if (!lt) return remote;
  if (!rt) return local;

  const lm = Array.isArray(lt.messages) ? lt.messages : [];
  const rm = Array.isArray(rt.messages) ? rt.messages : [];

  const byId = new Map<string, TranscriptMessage>();
  const orderedIds: string[] = [];

  const ingest = (list: TranscriptMessage[]) => {
    for (const msg of list) {
      const id = typeof msg.id === "string" ? msg.id : null;
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, msg);
        orderedIds.push(id);
        continue;
      }
      if (isLater(msg.updated_at, existing.updated_at)) {
        byId.set(id, msg);
      }
    }
  };

  ingest(rm);
  ingest(lm);

  const messages = orderedIds.map((id) => byId.get(id)!);
  return { ...rt, ...lt, messages };
}

/**
 * Merge a server row into the corresponding local row. Returns the row that
 * should be written to Dexie. The caller is responsible for updating
 * server_updated_at / dirty fields after this returns.
 */
export function mergeRow<T extends SyncRow>(
  table: SyncTable,
  local: T | undefined,
  remote: ServerRow,
): T {
  if (!local) return remote as unknown as T;

  const localNewer = isLater(local.client_updated_at, remote.client_updated_at);

  if (table === "exercises") {
    const l = local as unknown as ExerciseRow;
    const r = remote as unknown as ExerciseRow;
    const base = (localNewer && local.dirty ? l : r);
    const merged = {
      ...base,
      aliases: mergeAliases(l.aliases ?? [], r.aliases ?? []),
    };
    return mergeDeletedAt(merged as unknown as ExerciseRow, l, r) as unknown as T;
  }

  if (table === "workout_sessions") {
    const l = local as unknown as WorkoutSessionRow;
    const r = remote as unknown as WorkoutSessionRow;
    const base = (localNewer && local.dirty ? l : r);
    const merged = {
      ...base,
      chat_transcript: mergeTranscript(l.chat_transcript, r.chat_transcript),
    };
    return mergeDeletedAt(merged as unknown as WorkoutSessionRow, l, r) as unknown as T;
  }

  // Default: full-row LWW. If local is dirty AND newer, keep local fields.
  const winner = (localNewer && local.dirty ? local : (remote as unknown as T));
  return mergeDeletedAt(
    winner as unknown as { deleted_at: string | null; client_updated_at: string | null },
    local as unknown as { deleted_at: string | null; client_updated_at: string | null },
    remote as unknown as { deleted_at: string | null; client_updated_at: string | null },
  ) as unknown as T;
}

function mergeDeletedAt<T extends { deleted_at: string | null; client_updated_at: string | null }>(
  base: T,
  local: T,
  remote: T,
): T {
  const candidates: Array<{ ts: string | null; deleted: string | null }> = [
    { ts: local.client_updated_at ?? null, deleted: local.deleted_at },
    { ts: remote.client_updated_at ?? null, deleted: remote.deleted_at },
  ];
  candidates.sort((a, b) => {
    if (!a.ts) return 1;
    if (!b.ts) return -1;
    return Date.parse(b.ts) - Date.parse(a.ts);
  });
  return { ...base, deleted_at: candidates[0]?.deleted ?? null };
}
