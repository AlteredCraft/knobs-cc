import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { getEnvVarCatalog } from "@/lib/catalog";
import { resolveDocsUrl } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openPath";
import {
  applyEnvVarChip,
  applyEnvVarFilter,
  buildEnvVarRows,
  envVarChipCounts,
  maskValue,
  readShellEnvVars,
  type EnvVarChip,
  type EnvVarContributor,
  type EnvVarRow,
  type EnvVarSource,
} from "@/lib/envVars";
import type { SettingsSnapshot } from "@/types";
import { reportError } from "@/lib/errorLog";
import { SourceBadge } from "./SourceBadge";

const CHIP_LABELS: Record<EnvVarChip, string> = {
  all: "all",
  set: "set",
  shell: "shell",
  settings: "settings.json",
  unset: "unset",
};

const CHIPS: EnvVarChip[] = ["all", "set", "shell", "settings", "unset"];

export function EnvVarsPanel({
  snapshot,
  onClose,
}: {
  snapshot: SettingsSnapshot;
  onClose: () => void;
}) {
  const [shellEnv, setShellEnv] = useState<Record<string, string> | null>(null);
  const [filter, setFilter] = useState("");
  const [chip, setChip] = useState<EnvVarChip>("set");
  const [expanded, setExpanded] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Catalog hydration happens at App boot — by the time this panel can
  // open the snapshot is in hand, which means the catalog is too. Grab
  // the full list once.
  const catalog = useMemo(() => getEnvVarCatalog(), []);

  useEffect(() => {
    let cancelled = false;
    void readShellEnvVars()
      .then((env) => {
        if (!cancelled) setShellEnv(env);
      })
      .catch((e) => {
        if (cancelled) return;
        reportError({
          message: "Couldn't read shell environment",
          detail: e,
          source: "EnvVarsPanel",
        });
        // Show the panel with no shell-set rows rather than failing closed —
        // settings.json contributions are still useful on their own.
        setShellEnv({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Slash focuses the search box, mirroring the Inspector's filter shortcut.
  // Escape is handled by the parent (InspectorShell) via the global key
  // handler, which already closes modal layers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const inInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA";
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allRows = useMemo(
    () => (shellEnv ? buildEnvVarRows(catalog, snapshot, shellEnv) : []),
    [catalog, snapshot, shellEnv],
  );

  const counts = useMemo(() => envVarChipCounts(allRows), [allRows]);
  const visibleRows = useMemo(
    () => applyEnvVarFilter(applyEnvVarChip(allRows, chip), filter),
    [allRows, chip, filter],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="knobs.cc env vars"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg-0/95 backdrop-blur-sm"
    >
      <header className="flex h-[38px] shrink-0 items-center border-b border-line-strong bg-bg-1 px-4">
        <span className="font-mono text-[12.5px] font-semibold tracking-tight text-fg-1">
          knobs.cc
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          env vars
        </span>
        <span className="ml-2 font-mono text-[10.5px] text-fg-3">
          {counts.set} of {counts.all} set
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
        <div className="mx-auto max-w-5xl px-8 py-6">
          <Toolbar
            filter={filter}
            onFilterChange={setFilter}
            chip={chip}
            onChipChange={setChip}
            counts={counts}
            filterRef={filterRef}
          />

          {shellEnv === null ? (
            <LoadingState />
          ) : visibleRows.length === 0 ? (
            <EmptyState chip={chip} hasQuery={filter.trim().length > 0} />
          ) : (
            <RowList
              rows={visibleRows}
              expanded={expanded}
              onToggle={(name) =>
                setExpanded((cur) => (cur === name ? null : name))
              }
            />
          )}

          <Footnote />
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  filter,
  onFilterChange,
  chip,
  onChipChange,
  counts,
  filterRef,
}: {
  filter: string;
  onFilterChange: (q: string) => void;
  chip: EnvVarChip;
  onChipChange: (c: EnvVarChip) => void;
  counts: Record<EnvVarChip, number>;
  filterRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        ref={filterRef}
        type="text"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="filter by name or description (/)"
        className="w-72 rounded-sm border border-line-strong bg-bg-1 px-2 py-1 font-mono text-[12px] text-fg-1 placeholder:text-fg-4 focus:border-accent focus:outline-none"
      />
      <div className="ml-2 flex items-center gap-1">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChipChange(c)}
            className={cn(
              "rounded-sm border px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider",
              chip === c
                ? "border-accent text-fg-1"
                : "border-line-strong text-fg-3 hover:border-accent hover:text-fg-1",
            )}
            title={`${CHIP_LABELS[c]} · ${counts[c]}`}
          >
            {CHIP_LABELS[c]} <span className="text-fg-4">{counts[c]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
        reading shell env…
      </span>
    </div>
  );
}

function EmptyState({ chip, hasQuery }: { chip: EnvVarChip; hasQuery: boolean }) {
  const reason = hasQuery
    ? "no env vars match your filter"
    : chip === "shell"
      ? "no cataloged env vars are set in your current shell"
      : chip === "settings"
        ? "no settings.json layer has an `env` block"
        : chip === "set"
          ? "no cataloged env vars are set anywhere"
          : "no env vars to show";
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
        {reason}
      </div>
      <p className="max-w-md font-mono text-[12px] leading-relaxed text-fg-2">
        Try the <code className="rounded-[2px] bg-bg-2 px-1 py-px">all</code>{" "}
        chip to see every cataloged env var, set or not.
      </p>
    </div>
  );
}

function RowList({
  rows,
  expanded,
  onToggle,
}: {
  rows: EnvVarRow[];
  expanded: string | null;
  onToggle: (name: string) => void;
}) {
  // Non-catalog rows come first from the builder; render them in their
  // own group with a header so users see the "user-defined, not in
  // upstream docs" signal once instead of per-row.
  const nonCatalog = rows.filter((r) => r.isNonCatalog);
  const catalog = rows.filter((r) => !r.isNonCatalog);

  return (
    <div className="space-y-4">
      {nonCatalog.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-baseline gap-2 font-mono text-[9.5px] uppercase tracking-[0.05em] text-fg-4">
            <span>non-catalog ({nonCatalog.length})</span>
            <span className="text-fg-4 normal-case tracking-normal">
              · set in your settings.json but not documented upstream
            </span>
          </div>
          <ul className="space-y-1">
            {nonCatalog.map((row) => (
              <RowItem
                key={row.name}
                row={row}
                isExpanded={expanded === row.name}
                onToggle={() => onToggle(row.name)}
              />
            ))}
          </ul>
        </section>
      )}
      {catalog.length > 0 && (
        <section>
          {nonCatalog.length > 0 && (
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.05em] text-fg-4">
              catalog ({catalog.length})
            </div>
          )}
          <ul className="space-y-1">
            {catalog.map((row) => (
              <RowItem
                key={row.name}
                row={row}
                isExpanded={expanded === row.name}
                onToggle={() => onToggle(row.name)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RowItem({
  row,
  isExpanded,
  onToggle,
}: {
  row: EnvVarRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-sm border bg-bg-1",
        isExpanded ? "border-accent" : "border-line-strong",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-2"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-1">
          {row.name}
          {row.isNonCatalog && (
            <span
              className="ml-2 rounded-[2px] border border-warn px-1 py-px font-mono text-[9.5px] uppercase tracking-[0.05em] text-warn"
              title="Set in settings.json but not documented in the upstream env-vars catalog"
            >
              non-catalog
            </span>
          )}
        </span>
        <EffectiveCell row={row} />
      </button>

      {isExpanded && <DetailBlock row={row} />}
    </li>
  );
}

function EffectiveCell({ row }: { row: EnvVarRow }) {
  if (!row.effective) {
    return (
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-4">
        unset
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      <ValueChip value={row.effective.value} sensitive={row.isSensitive} />
      <SourceTag source={row.effective.source} />
    </span>
  );
}

function ValueChip({
  value,
  sensitive,
}: {
  value: string;
  sensitive: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const display = sensitive && !revealed ? maskValue(value) : value;
  if (sensitive) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setRevealed((r) => !r);
        }}
        title={revealed ? "click to mask" : "click to reveal"}
        className={cn(
          "rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px]",
          "max-w-[280px] truncate text-left",
          revealed ? "text-fg-1" : "text-fg-2",
          "hover:border-accent",
        )}
      >
        {display}
      </button>
    );
  }
  return (
    <span
      className="max-w-[280px] truncate rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-1"
      title={value}
    >
      {display}
    </span>
  );
}

function SourceTag({ source }: { source: EnvVarSource }) {
  if (source === "shell") {
    return (
      <span
        className="rounded-[2px] border border-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em] text-accent"
        title="Set in this process's shell environment"
      >
        shell
      </span>
    );
  }
  return <SourceBadge source={source} />;
}

function DetailBlock({ row }: { row: EnvVarRow }) {
  return (
    <div className="border-t border-line px-3 py-3">
      <div className="mb-3 max-w-prose text-[12px] leading-relaxed text-fg-2">
        {row.isNonCatalog ? (
          <p className="m-0 text-fg-3">
            User-defined env var. Not documented in the upstream{" "}
            <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
              env-vars
            </code>{" "}
            catalog — Claude Code reads this from{" "}
            <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
              settings.json
            </code>
            &apos;s{" "}
            <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
              env
            </code>{" "}
            block, but its meaning depends on whoever defined it.
          </p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="m-0">{children}</p>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    if (href) void openExternalUrl(resolveDocsUrl(href));
                  }}
                  className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {children}
                </a>
              ),
              code: ({ children }) => (
                <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
                  {children}
                </code>
              ),
            }}
          >
            {row.purpose}
          </ReactMarkdown>
        )}
      </div>

      {row.default !== null && (
        <div className="mb-2 font-mono text-[10.5px] text-fg-3">
          default: <span className="text-fg-2">{row.default}</span>
        </div>
      )}

      {row.contributors.length > 0 ? (
        <ContributorList row={row} />
      ) : (
        <div className="font-mono text-[10.5px] text-fg-4">
          not set anywhere
        </div>
      )}
    </div>
  );
}

function ContributorList({ row }: { row: EnvVarRow }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg-4">
        contributors ({row.contributors.length}) · first wins
      </div>
      <ul className="space-y-0.5">
        {row.contributors.map((c, i) => (
          <ContributorRow
            key={`${c.source}-${i}`}
            contributor={c}
            sensitive={row.isSensitive}
            isWinner={i === 0}
          />
        ))}
      </ul>
    </div>
  );
}

function ContributorRow({
  contributor,
  sensitive,
  isWinner,
}: {
  contributor: EnvVarContributor;
  sensitive: boolean;
  isWinner: boolean;
}) {
  return (
    <li className="grid grid-cols-[80px_1fr_auto] items-center gap-2 rounded-sm px-1.5 py-1">
      <SourceTag source={contributor.source} />
      <span
        className={cn(
          "min-w-0 truncate font-mono text-[11.5px]",
          isWinner ? "text-fg-1" : "text-fg-3 line-through decoration-fg-4/60",
        )}
        title={contributor.path ?? contributor.value}
      >
        {sensitive ? maskValue(contributor.value) : contributor.value}
      </span>
      {contributor.path && (
        <span
          className="truncate font-mono text-[10px] text-fg-4"
          title={contributor.path}
        >
          {shortenPath(contributor.path)}
        </span>
      )}
    </li>
  );
}

function shortenPath(path: string): string {
  // The full path is in the title attribute; the inline text just needs
  // enough context to disambiguate which layer's file we're pointing at.
  // Show the trailing two segments (`~/.claude/settings.json`) — that's
  // the part users recognize.
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function Footnote() {
  return (
    <p className="mt-8 max-w-prose font-mono text-[10.5px] leading-relaxed text-fg-4">
      Shell values reflect the environment knobs.cc was launched with —
      usually the same env Claude Code would inherit from your shell, but
      Finder/Spotlight launches use LaunchServices' env, which can differ.
      Dotenv files (<code>.env</code>) Claude Code reads at startup are not
      shown here.
    </p>
  );
}

