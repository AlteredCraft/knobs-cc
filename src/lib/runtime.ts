/**
 * Attach-mode wire layer. Wraps `invoke("read_runtime_layer")` so callers
 * don't import `invoke` directly and so the test seam stays clean.
 *
 * Spec: `spec/attach-mode.md`. Closes #11 (cli + env runtime introspection)
 * and #12 (project grounded in a real session).
 */
import { invoke } from "@tauri-apps/api/core";
import type { ClaudeProcess, RuntimeSnapshot, SessionGrounding } from "@/types";

export async function readRuntimeLayer(): Promise<RuntimeSnapshot> {
  return invoke<RuntimeSnapshot>("read_runtime_layer");
}

/**
 * Decide the grounding state from a fresh runtime snapshot + the
 * previously-selected pid (if any) + the previously-picked project root.
 *
 * Behavior:
 * - Platform not supported (Windows v1) → unsupported state; the path
 *   picker remains available.
 * - Zero claude processes → no-claude state; carry the previously-picked
 *   root forward so the inspector stays grounded after a process exits.
 * - Exactly one claude process → auto-attach.
 * - The previously-selected pid is still in the list → keep it (don't yank
 *   the user's attachment when a second claude appears).
 * - Otherwise (the prior pid is gone, or none was set and there are 2+) →
 *   fall back to no-claude state so the user can pick explicitly. Carries
 *   the prior process's cwd as a hint via the picked root *if* there's a
 *   sensible one — but the spec leaves this open; we default to null to
 *   keep behavior predictable.
 */
export function deriveSessionGrounding(
  snap: RuntimeSnapshot,
  priorPid: number | null,
  pickedRoot: string | null,
): SessionGrounding {
  if (snap.platform_status === "unsupported") {
    return { kind: "unsupported" };
  }
  if (snap.platform_status === "error") {
    // We treat sysinfo error the same as zero processes: the path picker is
    // still useful, and a misleading "attached" state would be worse.
    return { kind: "no-claude", pickedRoot };
  }
  const procs = snap.processes;
  if (procs.length === 0) {
    return { kind: "no-claude", pickedRoot };
  }
  if (priorPid !== null) {
    const stillThere = procs.find((p) => p.pid === priorPid);
    if (stillThere) {
      return { kind: "attached", pid: stillThere.pid, process: stillThere };
    }
  }
  if (procs.length === 1) {
    return { kind: "attached", pid: procs[0].pid, process: procs[0] };
  }
  // 2+ processes and either no prior selection or prior is gone — the user
  // needs to pick. We park in no-claude state so the picker UI opens and
  // nothing is auto-grounded. (no-claude is a slight misnomer for this
  // case; UX copy distinguishes "no claude detected" vs "pick a session
  // from N running" — see SessionPill.)
  return { kind: "no-claude", pickedRoot };
}

/**
 * What to pass to `read_settings_layers` given a grounding state.
 * Returns the args object so the caller can spread it into invoke().
 */
export function groundingToInvokeArgs(
  grounding: SessionGrounding,
): { attached_pid?: number; project_root_override?: string } {
  switch (grounding.kind) {
    case "attached":
      return { attached_pid: grounding.pid };
    case "no-claude":
      if (grounding.pickedRoot) {
        return { project_root_override: grounding.pickedRoot };
      }
      return {};
    case "loading":
    case "unsupported":
      return {};
  }
}

/** Compact `~/Projects/foo` style render for a cwd path. */
export function tildify(path: string, home: string | null): string {
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`;
  }
  return path;
}

/** Short label for a process: "PID 4172 · ~/Projects/foo". */
export function shortLabel(p: ClaudeProcess, home: string | null): string {
  return `PID ${p.pid} · ${tildify(p.cwd, home)}`;
}
