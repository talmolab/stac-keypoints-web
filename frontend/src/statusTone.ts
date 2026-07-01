// Severity classification for the toolbar status chip.
//
// The chip historically rendered every `ikStatus` message in success-green, so
// a blocked export ("Export blocked: 2 error(s)") or a load failure looked
// identical to a successful save. This maps a message to a tone so the chip can
// signal genuine failures (error) and preconditions / cancellations (warn)
// distinctly from success and in-progress text (ok).
//
// Classification is by keyword rather than a threaded severity flag so the ~25
// existing `setIkStatus(...)` call sites don't all have to change. Unmatched
// messages default to "ok" — the historical green — so success and progress
// text is unaffected. The test pins the real messages the app emits.

export type StatusTone = "error" | "warn" | "ok";

// A word-boundary on `error` avoids matching the "err" in "...err 3.2mm"
// (a successful refit result).
const ERROR_RE = /\berror\b|blocked|failed/i;

// Preconditions ("...first"), cancellations, recoverable fallbacks, and
// export-with-warnings — the action didn't complete as a clean success, but
// it isn't a hard error either.
const WARN_RE =
  /cancel|warning|don't match|produced no|no usable|no frames|\bfirst\b|references mesh|falling back/i;

export function statusTone(message: string | null | undefined): StatusTone {
  if (!message) return "ok";
  if (ERROR_RE.test(message)) return "error";
  if (WARN_RE.test(message)) return "warn";
  return "ok";
}
