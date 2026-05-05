import { Fragment, useEffect, useRef } from "react";
import { LAYERS_IN_PRECEDENCE_ORDER, type LayerSource } from "@/types";
import { cn } from "@/lib/utils";
import { PresenceIndicator } from "./PresenceIndicator";
import { SourceBadge } from "./SourceBadge";

const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string; note?: string }> = [
  { keys: ["⌘K", "Ctrl+K"], action: "Focus the filter input", note: "Works anywhere" },
  { keys: ["/"], action: "Focus the filter input", note: "When not typing" },
  { keys: ["J", "↓"], action: "Move cursor down" },
  { keys: ["K", "↑"], action: "Move cursor up" },
  { keys: ["↵"], action: "Toggle the detail drawer for the cursor row" },
  { keys: ["R"], action: "Re-read all settings layers" },
  { keys: ["?"], action: "Open or close this help view" },
  { keys: ["Esc"], action: "Close drawer or help; clear filter; blur input" },
];

const LAYER_DESCRIPTIONS: Record<LayerSource, string> = {
  managed:
    "Enterprise / MDM-deployed policy. Highest precedence — designed for admins to pin settings users can't override.",
  cli: "Flags on the running `claude` process (e.g. --model, --mcp-config). Not inspectable from a sibling app in v1.",
  env: "Environment variables (e.g. ANTHROPIC_MODEL, CLAUDE_CODE_USE_BEDROCK).",
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
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-x-10 gap-y-8 px-8 py-10 lg:grid-cols-2">
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
      <h2 className="corner-tag mb-3">{title}</h2>
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
          knobs.cc inspects Claude Code's configuration: what knobs exist, what
          you've set, and which layer wins. Every row in the centre pane is a
          key. Every column tells you where its value came from.
        </p>
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
          v1 is read-only — there is no write path and no way to edit settings
          through the app. The full catalog of config surfaces lives in{" "}
          <code className="text-fg-1">spec/inventory.md</code>.
        </p>
      </div>
      <p className="mt-4 font-mono text-[10.5px] uppercase tracking-wider text-fg-4">
        Altered Craft · concept phase
      </p>
    </Section>
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
  cli: "CLI flags · not inspectable in v1",
  env: "Environment variables",
  project_local: ".claude/settings.local.json",
  project: ".claude/settings.json",
  user: "~/.claude/settings.json",
  default: "Catalog default (compiled-in)",
};
