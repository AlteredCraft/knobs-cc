import { Fragment, useEffect, useRef } from "react";
import { LAYERS_IN_PRECEDENCE_ORDER, type LayerSource } from "@/types";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openPath";
import { PresenceIndicator } from "./PresenceIndicator";
import { SourceBadge } from "./SourceBadge";

const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string; note?: string }> = [
  { keys: ["⌘K", "Ctrl+K"], action: "Focus the filter input", note: "Works anywhere" },
  { keys: ["/"], action: "Focus the filter input", note: "When not typing" },
  { keys: ["J", "↓"], action: "Move cursor down" },
  { keys: ["K", "↑"], action: "Move cursor up" },
  { keys: ["↵"], action: "Toggle the detail drawer for the cursor row" },
  { keys: ["R"], action: "Re-read all settings layers" },
  { keys: ["⌘/", "Ctrl+/"], action: "Open or close this help view" },
  { keys: ["Esc"], action: "Close drawer or help; clear filter; blur input" },
  { keys: ["⌘+", "Ctrl++"], action: "Zoom in", note: "Also ⌘=" },
  { keys: ["⌘-", "Ctrl+-"], action: "Zoom out" },
  { keys: ["⌘0", "Ctrl+0"], action: "Reset zoom" },
];

const LAYER_DESCRIPTIONS: Record<LayerSource, string> = {
  managed:
    "Enterprise / MDM-deployed policy. Highest precedence — designed for admins to pin settings users can't override.",
  cli: "Flags on the attached `claude` process's argv (e.g. --model, --permission-mode). Documented mappings live in `catalog/cli-settings-map.json`.",
  env: "Process environment variables that override settings keys (e.g. ANTHROPIC_MODEL → `model`). Mapping table at `catalog/env-settings-map.json` — env-only vars without a settings equivalent aren't surfaced here.",
  project_local:
    "`<project>/.claude/settings.local.json` — your machine's overrides for this project, gitignored by convention.",
  project: "`<project>/.claude/settings.json` — committed, team-shared project settings.",
  user: "`~/.claude/settings.json` — your personal defaults across every session.",
  default: "Catalog defaults compiled into Claude Code. The fallback when no layer set the value.",
};

const PRESENCE_LEGEND: ReadonlyArray<{
  contributors: LayerSource[];
  winner: LayerSource | null;
  label: string;
  description: string;
}> = [
  {
    contributors: [],
    winner: null,
    label: "absent",
    description: "Layer didn't contribute.",
  },
  {
    contributors: ["user"],
    winner: "user",
    label: "winner",
    description: "Layer contributed and won.",
  },
  {
    contributors: ["user", "project"],
    winner: "project",
    label: "shadowed",
    description: "Layer contributed but a higher-precedence layer shadowed it.",
  },
  {
    contributors: ["user", "project"],
    winner: null,
    label: "array-merged",
    description:
      "Multiple layers contributed elements (e.g. permissions.allow); no single winner.",
  },
];

export function HelpView({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="knobs.cc inspector help"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg-0/95 backdrop-blur-sm"
    >
      <header className="flex h-[38px] shrink-0 items-center border-b border-line-strong bg-bg-1 px-4">
        <span className="font-mono text-[12.5px] font-semibold tracking-tight text-fg-1">
          knobs.cc
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          help
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-sm border border-line-strong px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1"
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
        <div className="mx-auto max-w-5xl px-8 pt-10">
          <p className="rounded-sm border border-line-strong bg-bg-1 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg-2">
            🤖 <span className="font-semibold text-fg-1">Disclaimer.</span>{" "}
            This is a true vibe-coded app experiment. I don't look too closely
            at the code. Use the app as I do — for exploratory purposes, to
            poke at Claude Code's configuration surface — not as a production
            tool.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-x-10 gap-y-8 px-8 pb-10 pt-8 lg:grid-cols-2">
          <KeyboardSection />
          <PrecedenceSection />
          <SourceBadgeSection />
          <PresenceSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="mb-4 border-b border-line-strong pb-1.5 font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-fg-1">
        {title}
      </h2>
      {children}
    </section>
  );
}

function KeyboardSection() {
  return (
    <Section title="Keyboard">
      <ul className="space-y-1.5">
        {SHORTCUTS.map((s) => (
          <li
            key={s.action + s.keys.join("|")}
            className="grid grid-cols-[140px_1fr] items-baseline gap-x-4"
          >
            <span className="flex flex-wrap gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span className="font-mono text-[12px] leading-snug text-fg-2">
              {s.action}
              {s.note && (
                <span className="ml-2 text-[10.5px] text-fg-4">{s.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PrecedenceSection() {
  return (
    <Section title="Layer precedence (high → low)">
      <ol className="space-y-2.5">
        {LAYERS_IN_PRECEDENCE_ORDER.map((src, i) => (
          <li key={src} className="grid grid-cols-[24px_88px_1fr] items-baseline gap-x-3">
            <span className="font-mono text-[10px] text-fg-4">
              {String(i + 1).padStart(2, "0")}
            </span>
            <SourceBadge source={src} />
            <p className="font-mono text-[11.5px] leading-snug text-fg-2">
              {LAYER_DESCRIPTIONS[src]}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 font-mono text-[11px] leading-relaxed text-fg-3">
        Scalar and object fields follow last-wins precedence. Array-valued
        fields (e.g. <code className="text-fg-2">permissions.allow</code>) are
        concatenated and deduplicated across all layers.
      </p>
    </Section>
  );
}

function SourceBadgeSection() {
  return (
    <Section title="Source badges">
      <div className="grid grid-cols-[88px_1fr] items-baseline gap-x-4 gap-y-1.5">
        {LAYERS_IN_PRECEDENCE_ORDER.map((src) => (
          <Fragment key={src}>
            <SourceBadge source={src} />
            <span className="font-mono text-[11px] text-fg-3">
              {SHORT_BADGE_NOTE[src]}
            </span>
          </Fragment>
        ))}
      </div>
    </Section>
  );
}

function PresenceSection() {
  return (
    <Section title="Presence indicator">
      <p className="mb-3 font-mono text-[11px] leading-relaxed text-fg-3">
        The <code className="text-fg-2">M·C·E·PL·P·U·D</code> column on every
        row encodes which layers contributed to that key, in precedence order.
        At a glance:
      </p>
      <ul className="space-y-2">
        {PRESENCE_LEGEND.map((entry) => (
          <li
            key={entry.label}
            className="grid grid-cols-[80px_1fr] items-center gap-x-4"
          >
            <PresenceIndicator
              contributors={entry.contributors}
              winner={entry.winner}
            />
            <span className="font-mono text-[11.5px] leading-snug text-fg-2">
              <span className="mr-2 uppercase tracking-wider text-fg-3">
                {entry.label}
              </span>
              {entry.description}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="About" className="lg:col-span-2">
      <div className="grid gap-6 lg:grid-cols-2">
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          <AboutLabel>What it does.</AboutLabel> knobs.cc inspects Claude
          Code's configuration: what knobs exist, what you've set, and which
          layer wins. Every row in the centre pane is a key. Every column
          tells you where its value came from.
        </p>
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          <AboutLabel>Grounding.</AboutLabel> Pick a session from the topbar
          pill to ground the inspector against a running{" "}
          <code className="text-fg-1">claude</code> process — that resolves
          the cli, env, and project layers against the session. If no claude
          is running, pick a project directory instead and the file-based
          layers resolve against that.
        </p>
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          <AboutLabel>Env vars.</AboutLabel> The{" "}
          <span className="text-fg-1">env vars</span> pill in the topbar opens
          a separate panel — the single source of truth for environment
          variables, cross-referencing the catalog against the attached
          process's environ, your shell, and any{" "}
          <code className="text-fg-1">env</code> block in settings.
        </p>
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          <AboutLabel>Read-only, but live.</AboutLabel> v1 has no write path —
          you can't edit settings through the app. But every file-based layer
          in the rail and drawer click-throughs to the underlying file in
          your editor. Save there, and the file watchers pick it up and the
          inspector refreshes. Press{" "}
          <code className="text-fg-1">R</code> to force a re-read.
        </p>
      </div>

      <div className="mt-6">
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          <AboutLabel>Catalog sync.</AboutLabel> The reference data driving
          every row — defaults, types, descriptions, env-var mappings — is
          generated from upstream Anthropic docs and JSON Schema. A weekly
          GitHub Action re-runs the sync scripts and opens a rolling PR when
          upstream drifts.
        </p>
        <pre className="mt-3 inline-block rounded-sm border border-line-strong bg-bg-1 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-fg-3">
{`anthropic docs ──► scripts/sync-*.js ──► catalog/*.json ──► inspector
                   (weekly cron · PR on drift)`}
        </pre>

        <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-fg-2">
          Eight sync targets, each with its own parse — upstream gives us
          different inputs in different shapes. Three are wired into the UI
          today; the other five round-trip through{" "}
          <code className="text-fg-1">read_catalog</code> but lack a UI
          consumer (tracked individually, umbrella{" "}
          <ExternalLink href="https://github.com/AlteredCraft/knobs-cc/issues/10">
            #10
          </ExternalLink>
          ):
        </p>
        <CatalogSyncTable />

        <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-fg-2">
          Two more files are <span className="text-fg-1">hand-maintained</span>{" "}
          — upstream doesn't expose these mappings as structured metadata,
          so we curate them and the regular sync scripts leave them alone:
        </p>
        <ul className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-fg-3">
          <li>
            <code className="text-fg-2">catalog/env-settings-map.json</code> —
            env var → settings key (feeds the <code>env</code> layer)
          </li>
          <li>
            <code className="text-fg-2">catalog/cli-settings-map.json</code> —
            cli flag → settings key (feeds the <code>cli</code> layer)
          </li>
        </ul>

        <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-fg-2">
          The human-readable index of every config surface lives in{" "}
          <code className="text-fg-1">spec/inventory.md</code>.
        </p>
      </div>

      <p className="mt-6 font-mono text-[10.5px] uppercase tracking-wider text-fg-4">
        Altered Craft · concept phase
      </p>
    </Section>
  );
}

function AboutLabel({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-fg-1">{children}</span>;
}

type CatalogStatus =
  | { kind: "wired"; note: string }
  | { kind: "unwired"; issueUrl: string };

const CATALOG_SOURCES: ReadonlyArray<{
  out: string;
  src: string;
  srcUrl: string | null;
  docsUrl: string;
  method: string;
  status: CatalogStatus;
}> = [
  {
    out: "settings.json",
    src: "schemastore JSON Schema",
    srcUrl: "https://json.schemastore.org/claude-code-settings.json",
    docsUrl: "https://code.claude.com/docs/en/settings",
    method:
      "Only structured upstream source. Flatten nested schemas to dotted keys; allowlist consumed fields.",
    status: { kind: "wired", note: "inspector rows + drawer" },
  },
  {
    out: "env-vars.json",
    src: "env-vars.md",
    srcUrl: "https://code.claude.com/docs/en/env-vars.md",
    docsUrl: "https://code.claude.com/docs/en/env-vars",
    method:
      "2-col table; defaults extracted from prose via regex (no dedicated column upstream).",
    status: { kind: "wired", note: "env vars panel + drawer cross-ref" },
  },
  {
    out: "hooks.json",
    src: "hooks.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/hooks",
    method:
      "Most complex parse: lifecycle table + handler-field tables + per-event input/output tables and JSON examples.",
    status: { kind: "wired", note: "drawer cross-ref + details modal" },
  },
  {
    out: "sub-agents.json",
    src: "sub-agents.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/sub-agents",
    method: "Single frontmatter-fields table from sub-agent definition files.",
    status: {
      kind: "unwired",
      issueUrl: "https://github.com/AlteredCraft/knobs-cc/issues/19",
    },
  },
  {
    out: "mcp.json",
    src: "mcp.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/mcp",
    method: "Single installation-scopes table (Local / Project / User).",
    status: {
      kind: "unwired",
      issueUrl: "https://github.com/AlteredCraft/knobs-cc/issues/18",
    },
  },
  {
    out: "permissions.json",
    src: "permissions.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/permissions",
    method:
      "Single permission-modes table (default / acceptEdits / plan / auto / dontAsk / bypassPermissions).",
    status: { kind: "wired", note: "drawer annotation for defaultMode" },
  },
  {
    out: "keybindings.json",
    src: "keybindings.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/keybindings",
    method: "Single contexts table; per-context action tables deferred.",
    status: {
      kind: "unwired",
      issueUrl: "https://github.com/AlteredCraft/knobs-cc/issues/20",
    },
  },
  {
    out: "cli-reference.json",
    src: "cli-reference.md",
    srcUrl: null,
    docsUrl: "https://code.claude.com/docs/en/cli-reference",
    method: "Two parallel 3-col tables: CLI commands and CLI flags.",
    status: {
      kind: "unwired",
      issueUrl: "https://github.com/AlteredCraft/knobs-cc/issues/21",
    },
  },
];

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openExternalUrl(href);
      }}
      className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </a>
  );
}

function CatalogSyncTable() {
  return (
    <div className="mt-3 overflow-x-auto rounded-sm border border-line-strong bg-bg-1">
      <table className="w-full border-collapse font-mono text-[10.5px] leading-relaxed">
        <thead>
          <tr className="border-b border-line-strong text-left text-fg-3">
            <th className="px-3 py-1.5 font-normal uppercase tracking-wider">
              Catalog file
            </th>
            <th className="px-3 py-1.5 font-normal uppercase tracking-wider">
              Upstream
            </th>
            <th className="px-3 py-1.5 font-normal uppercase tracking-wider">
              Src URL
            </th>
            <th className="px-3 py-1.5 font-normal uppercase tracking-wider">
              Method
            </th>
            <th className="px-3 py-1.5 font-normal uppercase tracking-wider">
              UI status
            </th>
          </tr>
        </thead>
        <tbody>
          {CATALOG_SOURCES.map((row, i) => (
            <tr
              key={row.out}
              className={cn(
                "align-top",
                i < CATALOG_SOURCES.length - 1 && "border-b border-line",
              )}
            >
              <td className="px-3 py-1.5 text-fg-2 whitespace-nowrap">
                <code>{row.out}</code>
              </td>
              <td className="px-3 py-1.5 text-fg-3 whitespace-nowrap">
                <code>{row.src}</code>
              </td>
              <td className="px-3 py-1.5 text-fg-3">
                {row.srcUrl ? (
                  <ExternalLink href={row.srcUrl}>{row.srcUrl}</ExternalLink>
                ) : (
                  <span className="text-fg-4">n/a</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-fg-3">
                {row.method}{" "}
                <ExternalLink href={row.docsUrl}>docs ↗</ExternalLink>
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap">
                {row.status.kind === "wired" ? (
                  <span className="text-ok">
                    ✓ wired
                    <span className="ml-1 text-fg-4">
                      ({row.status.note})
                    </span>
                  </span>
                ) : (
                  <span className="text-warn">
                    ✗ unwired{" "}
                    <ExternalLink href={row.status.issueUrl}>
                      track ↗
                    </ExternalLink>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded-[3px] border px-1.5",
        "border-line-strong bg-bg-2 font-mono text-[10.5px] text-fg-1",
        "shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]",
      )}
    >
      {children}
    </kbd>
  );
}

const SHORT_BADGE_NOTE: Record<LayerSource, string> = {
  managed: "Enterprise / MDM policy",
  cli: "CLI flags · from attached process argv",
  env: "Process env (mapped vars)",
  project_local: ".claude/settings.local.json",
  project: ".claude/settings.json",
  user: "~/.claude/settings.json",
  default: "Catalog default (compiled-in)",
};
