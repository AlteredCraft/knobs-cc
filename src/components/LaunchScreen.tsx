/**
 * The cold-start chooser. Sits between app boot and the Inspector — every
 * launch asks the user to explicitly pick how knobs.cc should ground the
 * inspection, instead of silently defaulting to knobs.cc's own launch
 * directory (which was the v1 behavior and quietly lied about cli / env /
 * project layers).
 *
 * Two options:
 *  - A · Live — attach to a running claude process. Reads its argv,
 *    environ, cwd so every layer reflects what that session sees.
 *  - B · What-if — pick a project root and resolve project /
 *    project_local against it. cli stays greyed (no argv to read).
 *
 * Empty-state policy: the attach card always renders, even when no
 * processes are detected — so users discover the affordance for next time.
 * Disabled with educational copy.
 */
import { useEffect, useMemo, useRef } from "react";
import type {
  ClaudeProcess,
  LayerSource,
  RuntimeSnapshot,
} from "@/types";
import { shortLabel, tildify } from "@/lib/runtime";
import { openExternalUrl } from "@/lib/openPath";
import { StatusDot } from "./inspector/StatusDot";

export interface LaunchScreenProps {
  runtimeSnapshot: RuntimeSnapshot | null;
  onAttach: (pid: number) => void;
  /** Opens the native folder picker and, on success, completes launch. */
  onPickRoot: () => void;
  /** User-initiated rescan of the process list. */
  onRescan: () => void;
}

export function LaunchScreen({
  runtimeSnapshot,
  onAttach,
  onPickRoot,
  onRescan,
}: LaunchScreenProps) {
  const loading = runtimeSnapshot === null;
  const platform = runtimeSnapshot?.platform_status ?? "ok";
  const unsupported = platform === "unsupported";
  const processes = useMemo(
    () => runtimeSnapshot?.processes ?? [],
    [runtimeSnapshot],
  );
  const home = processes[0]?.environ.HOME ?? null;

  // R rescans from anywhere on the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        onRescan();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRescan]);

  // Single attached session is the obviously-right primary action; otherwise
  // the directory picker is the most useful starting button.
  const attachIsPrimary = !loading && !unsupported && processes.length === 1;

  return (
    <main className="grid-bg flex h-screen flex-col overflow-auto bg-bg-0 text-fg-1">
      <Header />
      <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col px-10 py-10">
        <Primer />
        <div className="mt-10 grid flex-1 grid-cols-1 gap-6 md:grid-cols-2">
          <AttachCard
            loading={loading}
            unsupported={unsupported}
            processes={processes}
            home={home}
            onAttach={onAttach}
            onRescan={onRescan}
            autoFocusPrimary={attachIsPrimary}
          />
          <SimulateCard
            onPickRoot={onPickRoot}
            autoFocusPrimary={!attachIsPrimary}
          />
        </div>
        <Footer onRescan={onRescan} loading={loading} />
      </div>
    </main>
  );
}

function Header() {
  return (
    <header
      className="flex h-[38px] shrink-0 items-center border-b border-line-strong px-4"
      style={{ background: "linear-gradient(180deg, #15181f 0%, #11141a 100%)" }}
    >
      <div className="flex items-center gap-2">
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="6.5" stroke="#ffb627" strokeWidth="1.2" />
          <circle cx="9" cy="9" r="1.5" fill="#ffb627" />
          <line x1="9" y1="2" x2="9" y2="0.5" stroke="#ffb627" strokeWidth="1.2" />
        </svg>
        <span className="font-mono text-[12.5px] font-semibold tracking-tight">
          knobs.cc
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          inspector · choose session
        </span>
      </div>
    </header>
  );
}

function Primer() {
  return (
    <section className="max-w-[760px]">
      <h1 className="font-mono text-[22px] font-semibold leading-tight text-fg-1">
        Which claude session do you want to inspect?
      </h1>
      <p className="mt-4 max-w-[640px] font-sans text-[13.5px] leading-relaxed text-fg-2">
        Claude Code resolves configuration from six layers. Three of them
        depend on the context of the current claude process:
      </p>
      <ul className="mt-3 max-w-[640px] space-y-1.5 font-sans text-[13px] leading-relaxed text-fg-2">
        <li className="flex items-baseline gap-2">
          <InlineLayerChip source="cli" />
          <span className="text-fg-3">
            — the flags claude was launched with (e.g.{" "}
            <code className="font-mono text-fg-2">--model</code>,{" "}
            <code className="font-mono text-fg-2">--permission-mode</code>).
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <InlineLayerChip source="env" />
          <span className="text-fg-3">
            — environment variables claude inherited (e.g.{" "}
            <code className="font-mono text-fg-2">ANTHROPIC_API_KEY</code>,{" "}
            <code className="font-mono text-fg-2">CLAUDE_CODE_*</code>).
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="whitespace-nowrap">
            <InlineLayerChip source="project_local" />
            <span className="mx-1 text-fg-4">/</span>
            <InlineLayerChip source="project" />
          </span>
          <span className="text-fg-3">
            — the <code className="font-mono text-fg-2">.claude/</code>{" "}
            settings inside whichever project the session is running in.
          </span>
        </li>
      </ul>
    </section>
  );
}

// -- Attach card ---------------------------------------------------------

export type AttachState =
  | "loading"
  | "unsupported"
  | "empty"
  | "single"
  | "multi";

/**
 * Exported for tests. The launch-screen attach card has five visual states
 * driven by the runtime snapshot. Centralizing the decision keeps the
 * branches above readable and gives us a single place to lock the behavior
 * down with unit tests.
 */
export function deriveAttachState(
  snapshot: RuntimeSnapshot | null,
): AttachState {
  if (snapshot === null) return "loading";
  if (snapshot.platform_status === "unsupported") return "unsupported";
  const count = snapshot.processes.length;
  if (count === 0) return "empty";
  if (count === 1) return "single";
  return "multi";
}

function AttachCard({
  loading,
  unsupported,
  processes,
  home,
  onAttach,
  onRescan,
  autoFocusPrimary,
}: {
  loading: boolean;
  unsupported: boolean;
  processes: ClaudeProcess[];
  home: string | null;
  onAttach: (pid: number) => void;
  onRescan: () => void;
  autoFocusPrimary: boolean;
}) {
  // Keep `state` derived locally so the JSX doesn't have to reach for the
  // snapshot — but mirror deriveAttachState's branches exactly. If you
  // change the logic here, also update deriveAttachState + its tests.
  const count = processes.length;
  const state: AttachState = loading
    ? "loading"
    : unsupported
      ? "unsupported"
      : count === 0
        ? "empty"
        : count === 1
          ? "single"
          : "multi";

  const disabled = state === "loading" || state === "unsupported" || state === "empty";
  const tone = state === "single" || state === "multi" ? "primary" : "muted";

  return (
    <Card
      optionKind="Live option"
      title="Attach to a running claude session"
      statusDot={attachDotFor(state)}
      statusLabel={attachStatusLabel(state, count)}
      disabled={disabled}
      tone={tone}
    >
      <p className="font-sans text-[12.5px] leading-relaxed text-fg-2">
        Reads argv, environ, and cwd from a live claude process. Every
        layer in the precedence stack resolves against that exact session.
      </p>

      <GroundsRail kind="attach" active={!disabled} />

      <div className="mt-5 flex-1">
        {state === "loading" && (
          <Placeholder>
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-4">
              scanning for claude processes…
            </span>
          </Placeholder>
        )}

        {state === "unsupported" && (
          <Placeholder>
            <div className="font-mono text-[11px] leading-relaxed text-fg-3">
              Attach mode isn't supported on this platform yet. Use{" "}
              <span className="text-fg-2">Option B</span> on the right — the
              what-if path works everywhere.
            </div>
          </Placeholder>
        )}

        {state === "empty" && (
          <Placeholder>
            <div className="font-mono text-[11px] leading-relaxed text-fg-3">
              No claude processes detected.
              <br />
              Start a session with <code className="text-fg-2">claude</code> in
              any terminal, then{" "}
              <button
                type="button"
                onClick={onRescan}
                className="text-link underline-offset-2 hover:underline"
              >
                rescan
              </button>
              .
            </div>
          </Placeholder>
        )}

        {state === "single" && (
          <SingleProcessRow
            process={processes[0]}
            home={home}
            onAttach={onAttach}
            autoFocus={autoFocusPrimary}
          />
        )}

        {state === "multi" && (
          <MultiProcessList
            processes={processes}
            home={home}
            onAttach={onAttach}
            autoFocusFirst={autoFocusPrimary}
          />
        )}
      </div>
    </Card>
  );
}

function attachDotFor(state: AttachState): "ok" | "warn" | "empty" {
  switch (state) {
    case "single":
    case "multi":
      return "ok";
    case "unsupported":
      return "warn";
    case "loading":
    case "empty":
      return "empty";
  }
}

function attachStatusLabel(state: AttachState, count: number): string {
  switch (state) {
    case "loading":
      return "scanning…";
    case "unsupported":
      return "unsupported on this platform";
    case "empty":
      return "no sessions detected";
    case "single":
      return "1 session ready";
    case "multi":
      return `${count} sessions running`;
  }
}

// -- Simulate card -------------------------------------------------------

function SimulateCard({
  onPickRoot,
  autoFocusPrimary,
}: {
  onPickRoot: () => void;
  autoFocusPrimary: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (autoFocusPrimary) ref.current?.focus();
  }, [autoFocusPrimary]);

  return (
    <Card
      optionKind="What-if option"
      title="What if claude runs here?"
      statusDot="empty"
      statusLabel="No live session needed"
      tone="muted"
    >
      <p className="font-sans text-[12.5px] leading-relaxed text-fg-2">
        Pick a project root. knobs.cc resolves the{" "}
        <InlineLayerChip source="project" /> and{" "}
        <InlineLayerChip source="project_local" /> layers against it —
        useful for asking{" "}
        <span className="text-fg-1">
          "what would happen if I ran{" "}
          <code className="font-mono text-fg-1">claude</code> here?"
        </span>
      </p>

      <GroundsRail kind="simulate" active />

      <div className="mt-5 flex-1">
        <button
          ref={ref}
          type="button"
          onClick={onPickRoot}
          className="group flex w-full items-center justify-between rounded-sm border border-line-strong bg-bg-2 px-4 py-3 text-left transition-colors hover:border-accent hover:bg-bg-3 focus:border-accent focus:bg-bg-3 focus:outline-none"
        >
          <div className="min-w-0">
            <div className="font-mono text-[12.5px] text-fg-1">
              Choose a directory…
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-fg-4">
              Opens the native folder picker
            </div>
          </div>
          <span className="font-mono text-[14px] text-fg-3 transition-colors group-hover:text-accent">
            ↗
          </span>
        </button>

        <div className="mt-4 space-y-1 font-mono text-[10.5px] leading-relaxed text-fg-4">
          <div className="corner-tag mb-1.5">Caveats</div>
          <div>
            · <InlineLayerChip source="cli" /> stays greyed — no process to
            read argv from.
          </div>
          <div>
            · <InlineLayerChip source="env" /> shows knobs.cc's own
            environment, an approximation of what claude would inherit.
          </div>
        </div>
      </div>
    </Card>
  );
}

// -- Shared bits ---------------------------------------------------------

function Card({
  optionKind,
  title,
  statusDot,
  statusLabel,
  disabled,
  tone,
  children,
}: {
  optionKind: string;
  title: string;
  statusDot: "ok" | "warn" | "err" | "empty";
  statusLabel: string;
  disabled?: boolean;
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-h-[440px] flex-col rounded-sm border bg-bg-1 p-6 ${
        tone === "primary"
          ? "border-line-strong shadow-[0_0_0_1px_var(--color-accent-soft),0_18px_40px_-24px_rgba(255,182,39,0.25)]"
          : "border-line"
      } ${disabled ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between border-b border-line pb-4">
        <span
          className="font-mono text-[26px] font-bold uppercase leading-none tracking-[0.06em]"
          style={{ color: "var(--color-accent)" }}
        >
          {optionKind}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-fg-3">
          <StatusDot variant={statusDot} />
          {statusLabel}
        </span>
      </div>
      <h2 className="mt-4 font-mono text-[16px] font-semibold tracking-tight text-fg-1">
        {title}
      </h2>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center rounded-sm border border-dashed border-line-strong bg-bg-0/40 px-4 py-6 text-center">
      {children}
    </div>
  );
}

function SingleProcessRow({
  process,
  home,
  onAttach,
  autoFocus,
}: {
  process: ClaudeProcess;
  home: string | null;
  onAttach: (pid: number) => void;
  autoFocus: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className="rounded-sm border border-line-strong bg-bg-2 p-4">
      <ProcessMeta process={process} home={home} />
      <button
        ref={ref}
        type="button"
        onClick={() => onAttach(process.pid)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-sm border border-accent bg-accent-soft px-3 py-2 font-mono text-[12px] font-medium uppercase tracking-wider text-accent transition-colors hover:bg-[rgba(255,182,39,0.16)] focus:outline-none focus:ring-1 focus:ring-accent-ring"
      >
        Attach to this session
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

function MultiProcessList({
  processes,
  home,
  onAttach,
  autoFocusFirst,
}: {
  processes: ClaudeProcess[];
  home: string | null;
  onAttach: (pid: number) => void;
  autoFocusFirst: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (autoFocusFirst) ref.current?.focus();
  }, [autoFocusFirst]);
  return (
    <div className="space-y-2">
      <div className="corner-tag mb-1">Pick one</div>
      <ul className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1 scrollbar">
        {processes.map((p, i) => (
          <li key={p.pid}>
            <button
              ref={i === 0 ? ref : undefined}
              type="button"
              onClick={() => onAttach(p.pid)}
              className="w-full rounded-sm border border-line-strong bg-bg-2 px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-bg-3 focus:border-accent focus:bg-bg-3 focus:outline-none"
            >
              <ProcessMeta process={p} home={home} compact />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProcessMeta({
  process,
  home,
  compact = false,
}: {
  process: ClaudeProcess;
  home: string | null;
  compact?: boolean;
}) {
  const flags = countCliFlags(process.argv);
  return (
    <div>
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-fg-1">PID {process.pid}</span>
        {!compact && (
          <span className="rounded-sm border border-line-strong px-1 text-[9.5px] uppercase tracking-wider text-fg-3">
            live
          </span>
        )}
      </div>
      <div
        className="mt-1 truncate font-mono text-[12px] text-fg-2"
        title={process.cwd}
      >
        {tildify(process.cwd, home)}
      </div>
      <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] text-fg-4">
        <span>started {relativeTime(process.started_at)}</span>
        <span>·</span>
        <span>
          {flags === 0
            ? "no cli flags"
            : `${flags} cli flag${flags === 1 ? "" : "s"}`}
        </span>
      </div>
      {compact && (
        <div className="mt-1 truncate font-mono text-[10px] text-fg-4">
          {shortLabel(process, home)}
        </div>
      )}
    </div>
  );
}

// Approximate flag count for the card chip — anything in argv after the
// binary path that starts with `-`. Exact catalog mapping is the cli
// layer's job; this is just a "how much state will I see?" hint.
function countCliFlags(argv: string[]): number {
  return argv.slice(1).filter((a) => a.startsWith("-")).length;
}

function relativeTime(epochSecs: number): string {
  if (!epochSecs) return "just now";
  const now = Date.now() / 1000;
  const delta = Math.max(0, now - epochSecs);
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86400)}d ago`;
}

// "Grounds" rail — six chips reflecting which layers each mode can
// faithfully attribute to the user's claude session. Mirrors
// `ungroundedLayersFor` in PrecedenceRail.tsx so we don't drift.
function GroundsRail({
  kind,
  active,
}: {
  kind: "attach" | "simulate";
  active: boolean;
}) {
  const ungrounded: ReadonlySet<LayerSource> =
    kind === "attach" ? new Set() : new Set<LayerSource>(["cli"]);

  const layers: LayerSource[] = [
    "managed",
    "cli",
    "env",
    "project_local",
    "project",
    "user",
  ];

  return (
    <div className="mt-5">
      <div className="corner-tag mb-2">Grounds</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {layers.map((source) => (
          <LayerChip
            key={source}
            source={source}
            dim={!active || ungrounded.has(source)}
            struck={active && ungrounded.has(source)}
          />
        ))}
      </div>
    </div>
  );
}

function LayerChip({
  source,
  dim = false,
  struck = false,
}: {
  source: LayerSource;
  dim?: boolean;
  struck?: boolean;
}) {
  const color = SOURCE_COLOR[source];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-[2px] font-mono text-[10.5px] ${
        dim ? "opacity-50" : ""
      }`}
      style={{
        borderColor: dim ? "var(--color-line)" : `${color}55`,
        color: dim ? "var(--color-fg-4)" : color,
        textDecoration: struck ? "line-through" : undefined,
      }}
    >
      <span
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: dim ? "var(--color-fg-4)" : color }}
      />
      {source}
    </span>
  );
}

// Inline variant used in body copy — same visual treatment, but tightened
// so it sits inside a sentence cleanly.
function InlineLayerChip({ source }: { source: LayerSource }) {
  const color = SOURCE_COLOR[source];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-1 py-0 font-mono text-[11.5px] align-baseline"
      style={{
        borderColor: `${color}55`,
        color,
      }}
    >
      {source}
    </span>
  );
}

const SOURCE_COLOR: Record<LayerSource, string> = {
  managed: "#d4585b",
  cli: "#98a0ac",
  env: "#6aa3d4",
  project_local: "#ffd07a",
  project: "#ffb627",
  user: "#aab3bf",
  default: "#7c828d",
};

function Footer({
  onRescan,
  loading,
}: {
  onRescan: () => void;
  loading: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-line pt-4 font-mono text-[11px] text-fg-3">
      <button
        type="button"
        onClick={onRescan}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-60"
        title="Re-read the process list (R)"
      >
        ↻ rescan processes
      </button>
      <button
        type="button"
        onClick={() =>
          void openExternalUrl(
            "https://github.com/AlteredCraft/knobs-cc/blob/main/spec/attach-mode.md",
          )
        }
        className="text-link underline-offset-2 hover:underline"
      >
        Why grounding matters →
      </button>
    </div>
  );
}
