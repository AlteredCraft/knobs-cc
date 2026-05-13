/**
 * Session pill — the primary attach affordance in the topbar.
 * See `spec/attach-mode.md` § "UX states".
 *
 * Three states by process count:
 * - 0 processes → "no claude · pick a project ▾" (path picker fallback)
 * - 1 process → auto-attached, pill shows pid + cwd
 * - 2+ processes → "pick session ▾" with the picker
 *
 * Plus two structural states orthogonal to count:
 * - unsupported (Windows v1) — pill is informational + path picker open
 * - loading — pill renders as a low-key "detecting…"
 */
import { useEffect, useRef, useState } from "react";
import type { ClaudeProcess, RuntimeSnapshot, SessionGrounding } from "@/types";
import { shortLabel, tildify } from "@/lib/runtime";
import { StatusDot } from "./StatusDot";

export function SessionPill({
  grounding,
  runtimeSnapshot,
  onAttach,
  onPickRoot,
  onClearRoot,
}: {
  grounding: SessionGrounding;
  runtimeSnapshot: RuntimeSnapshot | null;
  onAttach: (pid: number) => void;
  /** Opens the native folder picker. */
  onPickRoot: () => void;
  /** Clear a previously-picked root and return to "no claude" state. */
  onClearRoot: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const processes = runtimeSnapshot?.processes ?? [];
  const home = homeFromGrounding(grounding, processes);

  const label = labelFor(grounding, processes.length);
  const dotVariant = dotFor(grounding);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={titleFor(grounding, processes.length)}
        className="flex items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 font-mono text-[11px] text-fg-2 hover:border-accent hover:text-fg-1"
      >
        <StatusDot variant={dotVariant} />
        <span className="max-w-[280px] truncate">{label}</span>
        <span className="text-fg-4">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+4px)] z-40 w-[420px] rounded-sm border border-line-strong bg-bg-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
          role="menu"
        >
          {grounding.kind === "unsupported" && (
            <div className="border-b border-line px-3 py-2 font-mono text-[10.5px] text-fg-3">
              Attach mode isn't supported on this platform yet — Windows
              support is deferred until the Unix version proves out. The
              path picker below still works.
            </div>
          )}
          <PickerHeader processes={processes} grounding={grounding} />
          {processes.length > 0 && (
            <ul className="max-h-[300px] overflow-y-auto py-1">
              {processes.map((p) => (
                <ProcessRow
                  key={p.pid}
                  process={p}
                  home={home}
                  selected={
                    grounding.kind === "attached" && grounding.pid === p.pid
                  }
                  onClick={() => {
                    onAttach(p.pid);
                    setOpen(false);
                  }}
                />
              ))}
            </ul>
          )}
          <div className="border-t border-line px-2 py-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onPickRoot();
              }}
              className="block w-full rounded-sm px-2 py-1.5 text-left font-mono text-[11px] text-fg-2 hover:bg-bg-2 hover:text-fg-1"
            >
              Pick a project directory…
            </button>
            {grounding.kind === "no-claude" && grounding.pickedRoot && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onClearRoot();
                }}
                className="block w-full rounded-sm px-2 py-1.5 text-left font-mono text-[11px] text-fg-3 hover:bg-bg-2 hover:text-fg-1"
              >
                Clear picked directory ({tildify(grounding.pickedRoot, home)})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerHeader({
  processes,
  grounding,
}: {
  processes: ClaudeProcess[];
  grounding: SessionGrounding;
}) {
  let msg: string;
  if (grounding.kind === "unsupported") {
    msg = "Unsupported platform";
  } else if (processes.length === 0) {
    msg = "No claude processes detected";
  } else if (processes.length === 1) {
    msg = "1 claude session running";
  } else {
    msg = `${processes.length} claude sessions running`;
  }
  return (
    <div className="border-b border-line px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-4">
      {msg}
    </div>
  );
}

function ProcessRow({
  process,
  home,
  selected,
  onClick,
}: {
  process: ClaudeProcess;
  home: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const argSummary = process.argv.length > 1
    ? ` · argv: ${process.argv.slice(1, 4).join(" ")}${process.argv.length > 4 ? " …" : ""}`
    : "";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`block w-full px-3 py-2 text-left font-mono text-[11px] hover:bg-bg-2 ${
          selected ? "bg-bg-2 text-fg-1" : "text-fg-2"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-fg-3">PID {process.pid}</span>
          {selected && (
            <span className="rounded-sm border border-accent px-1 text-[9.5px] uppercase tracking-wider text-accent">
              attached
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-fg-2">
          {tildify(process.cwd, home)}
        </div>
        {argSummary && (
          <div className="mt-0.5 truncate text-[10px] text-fg-4">{argSummary.slice(3)}</div>
        )}
      </button>
    </li>
  );
}

/**
 * Best-effort HOME extraction. Used for tildifying paths in the pill UI.
 * If we have an attached process, prefer its environ.HOME — that's the
 * exact value resolved at exec time for *that* session. Otherwise fall
 * back to scanning the first available process's environ; if no process
 * is available either, return null and let paths render verbatim.
 */
function homeFromGrounding(
  grounding: SessionGrounding,
  processes: ClaudeProcess[],
): string | null {
  if (grounding.kind === "attached" && grounding.process.environ.HOME) {
    return grounding.process.environ.HOME;
  }
  const first = processes[0];
  return first?.environ.HOME ?? null;
}

function labelFor(grounding: SessionGrounding, count: number): string {
  switch (grounding.kind) {
    case "loading":
      return "detecting…";
    case "unsupported":
      return "attach unsupported";
    case "attached": {
      const home = grounding.process.environ.HOME ?? null;
      return shortLabel(grounding.process, home);
    }
    case "no-claude":
      if (grounding.pickedRoot) {
        // Tildify needs HOME; we don't have it without a process to read
        // from. Show the raw path — predictable beats half-clever.
        return `picked · ${truncatePath(grounding.pickedRoot)}`;
      }
      if (count === 0) return "no claude · pick a project";
      return `pick session (${count} running)`;
  }
}

function titleFor(grounding: SessionGrounding, count: number): string {
  switch (grounding.kind) {
    case "loading":
      return "Detecting running claude processes…";
    case "unsupported":
      return "Attach mode isn't supported on this platform. Use the path picker to ground the inspector against a directory.";
    case "attached":
      return `Inspecting claude PID ${grounding.pid} (cwd: ${grounding.process.cwd}). Click to switch sessions or pick a directory.`;
    case "no-claude":
      if (grounding.pickedRoot) {
        return `Inspecting ${grounding.pickedRoot}. Click to attach to a running claude or pick a different directory.`;
      }
      if (count === 0) {
        return "No claude processes detected. Click to pick a project directory.";
      }
      return `${count} claude processes detected. Click to pick one to inspect.`;
  }
}

function dotFor(grounding: SessionGrounding): "ok" | "warn" | "err" | "empty" {
  switch (grounding.kind) {
    case "attached":
      return "ok";
    case "no-claude":
      return grounding.pickedRoot ? "ok" : "warn";
    case "unsupported":
      return "warn";
    case "loading":
      return "empty";
  }
}

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  const tail = p.slice(p.length - (max - 1));
  return `…${tail}`;
}
