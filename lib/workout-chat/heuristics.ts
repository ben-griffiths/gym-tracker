/**
 * If the user is correcting the *number* of sets (e.g. "actually it should
 * be just 5 sets"), return the count they want. Must not fire for bare
 * "5 reps" without a set-count phrase.
 */
export function tryParseSetCountTrimRequest(message: string): number | null {
  const t = message.trim();
  if (!/set|sets/i.test(t)) return null;
  const mJust =
    /\b(?:just|only|exactly)\s+(\d{1,2})\s*sets?\b/i.exec(t) ??
    /\b(\d{1,2})\s*sets?\s*(?:only|total|in total|max)\b/i.exec(t);
  if (mJust) {
    const n = Number(mJust[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
  }
  const mShould = /\bshould\s+be\s+(\d{1,2})\s*sets?\b/i.exec(t);
  if (mShould) {
    const n = Number(mShould[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
  }
  const mWant = /\b(?:meant|want|need|have)\s+(\d{1,2})\s*sets?\b/i.exec(t);
  if (mWant) {
    const n = Number(mWant[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
  }
  return null;
}
