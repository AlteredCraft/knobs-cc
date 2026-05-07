import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  clearErrors,
  getEntries,
  markAllSeen,
  subscribe,
  type ErrorEntry,
} from "@/lib/errorLog";

export function ErrorPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const entries = useSyncExternalStore(subscribe, getEntries);

  // Opening the panel acknowledges everything currently shown — the topbar
  // pill drops back to a neutral state. New reports while the panel is open
  // are still visible, just not flagged as "unseen" once you close & reopen.
  useEffect(() => {
    markAllSeen();
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="knobs.cc inspector errors"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg-0/95 backdrop-blur-sm"
    >
      <header className="flex h-[38px] shrink-0 items-center border-b border-line-strong bg-bg-1 px-4">
        <span className="font-mono text-[12.5px] font-semibold tracking-tight text-fg-1">
          knobs.cc
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          errors
        </span>
        {entries.length > 0 && (
          <span className="ml-2 font-mono text-[10.5px] text-fg-3">
            {entries.length} recent
          </span>
        )}
        <button
          type="button"
          onClick={() => clearErrors()}
          disabled={entries.length === 0}
          className="ml-auto rounded-sm border border-line-strong px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:text-fg-2"
        >
          clear
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded-sm border border-line-strong px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1"
          autoFocus
        >
          esc · close
        </button>
      </header>

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="scrollbar flex-1 overflow-auto outline-none"
      >
        <div className="mx-auto max-w-4xl px-8 py-10">
          {entries.length === 0 ? <EmptyState /> : <EntryList entries={entries} />}
          <Footnote />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
        no recent errors
      </div>
      <p className="max-w-md font-mono text-[12px] leading-relaxed text-fg-2">
        Runtime errors from the inspector — failed file opens, unhandled
        promise rejections, uncaught exceptions — will appear here. Config
        diagnostics live separately, in the topbar pill.
      </p>
    </div>
  );
}

function EntryList({ entries }: { entries: readonly ErrorEntry[] }) {
  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

function EntryRow({ entry }: { entry: ErrorEntry }) {
  return (
    <li className="rounded-sm border border-line-strong bg-bg-1">
      <div className="flex flex-wrap items-baseline gap-3 border-b border-line px-3 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-err">
          {entry.source ?? "error"}
        </span>
        <span className="font-mono text-[12px] text-fg-1">{entry.message}</span>
        <span className="ml-auto font-mono text-[10px] text-fg-4">
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>
      {entry.detail && (
        <pre className="scrollbar overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-snug text-fg-3">
          {entry.detail}
        </pre>
      )}
    </li>
  );
}

function Footnote() {
  return (
    <p className="mt-8 font-mono text-[10.5px] leading-relaxed text-fg-4">
      Up to 50 most-recent entries kept in memory. Cleared on app restart.
      Mirrored to the WebView devtools console for anyone debugging there.
    </p>
  );
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
