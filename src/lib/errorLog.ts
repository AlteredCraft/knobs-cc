// In-memory error log for surfacing UI/runtime failures inside the app
// instead of relying on the WebView devtools console. Read-only by design:
// no persistence, no network. Mirrors every report to `console.error` so
// devtools workflows still work for anyone who prefers that.

const MAX_ENTRIES = 50;

export type ErrorEntry = {
  id: number;
  timestamp: number;
  message: string;
  detail?: string;
  source?: string;
};

export type ReportInput = {
  message: string;
  detail?: unknown;
  source?: string;
};

type Listener = () => void;

let entries: ErrorEntry[] = [];
let nextId = 1;
let lastSeenId = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function reportError(input: ReportInput): ErrorEntry {
  const entry: ErrorEntry = {
    id: nextId++,
    timestamp: Date.now(),
    message: input.message,
    detail: input.detail === undefined ? undefined : formatDetail(input.detail),
    source: input.source,
  };
  // Newest first. Cap length so a runaway loop can't pin memory.
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  // Mirror to devtools — reportError is the new primary surface but the
  // console is still where many people will look first.
  console.error(`[${entry.source ?? "error"}] ${entry.message}`, input.detail);
  notify();
  return entry;
}

export function getEntries(): readonly ErrorEntry[] {
  return entries;
}

export function getUnseenCount(): number {
  let count = 0;
  for (const e of entries) {
    if (e.id > lastSeenId) count += 1;
  }
  return count;
}

export function markAllSeen(): void {
  if (entries.length === 0) return;
  // entries[0] is newest because we prepend on report.
  const newestId = entries[0].id;
  if (newestId === lastSeenId) return;
  lastSeenId = newestId;
  notify();
}

export function clearErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Bridges window-level events into the log so unhandled rejections and
// uncaught errors don't slip through to the devtools console only.
export function installGlobalHandlers(): () => void {
  const onError = (e: ErrorEvent) => {
    reportError({
      message: e.message || "Uncaught error",
      detail: e.error ?? { filename: e.filename, lineno: e.lineno, colno: e.colno },
      source: "window.onerror",
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    reportError({
      message: stringifyMessage(e.reason) ?? "Unhandled promise rejection",
      detail: e.reason,
      source: "unhandledrejection",
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

// Test-only seam — the module's state is module-global so unit tests need
// a way to start clean. Not exported via index, only consumed by *.test.ts.
export function _resetForTesting(): void {
  entries = [];
  nextId = 1;
  lastSeenId = 0;
  listeners.clear();
}

function stringifyMessage(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "message" in (value as object)) {
    const m = (value as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

function formatDetail(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
