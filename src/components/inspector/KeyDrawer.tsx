import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  findEnvVar,
  findPermissionMode,
  findRelatedKnobs,
  type CatalogEntry,
} from "@/lib/catalog";
import { formatValue } from "@/lib/format";
import { parseInlineMarkdown } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openPath";
import { buildRows, type Row } from "@/lib/rows";
import { buildWaterfall } from "@/lib/waterfall";
import type { ArrayMergedElement } from "@/lib/flatten";
import type { SettingsSnapshot } from "@/types";
import { SourceBadge } from "./SourceBadge";
import { StatusDot } from "./StatusDot";
import { WaterfallRow } from "./WaterfallRow";

export function KeyDrawer({
  row,
  snapshot,
  onClose,
  onSelect,
}: {
  row: Row;
  snapshot: SettingsSnapshot;
  onClose: () => void;
  /** Click-through from the related-knobs section navigates the drawer. */
  onSelect: (keyPath: string) => void;
}) {
  const formatted = formatValue(row.value);
  const description = resolveDescription(row);
  const isArrayMerged = row.state === "array-merged";

  // Look up siblings via the catalog and join with current row state so the
  // section can show set-vs-unset hints. Memoized on snapshot/row so we
  // don't rerun the join on incidental rerenders.
  const related = useMemo(() => {
    const entries = findRelatedKnobs(row.keyPath);
    if (entries.length === 0) return [];
    const rowsByKey = new Map(buildRows(snapshot).map((r) => [r.keyPath, r]));
    return entries.map((entry) => ({
      entry,
      row: rowsByKey.get(entry.key) ?? null,
    }));
  }, [snapshot, row.keyPath]);

  return (
    <aside className="flex w-[440px] shrink-0 flex-col overflow-hidden border-l border-line bg-bg-1">
      <DrawerHeader row={row} description={description} onClose={onClose} />
      <EffectiveBlock row={row} formatted={formatted} />

      <div className="scrollbar flex-1 overflow-auto">
        {isArrayMerged ? (
          <ElementList elements={row.elements ?? []} />
        ) : (
          <Waterfall row={row} snapshot={snapshot} />
        )}

        <RelatedKnobs items={related} onSelect={onSelect} />
        <CatalogFooter row={row} />
      </div>
    </aside>
  );
}

function Waterfall({ row, snapshot }: { row: Row; snapshot: SettingsSnapshot }) {
  const entries = buildWaterfall(snapshot, row);
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="corner-tag">Layer Waterfall</span>
        <span className="font-mono text-[9.5px] text-fg-4">↓ HIGH PRECEDENCE</span>
      </div>
      {entries.map((e) => (
        <WaterfallRow key={e.source} entry={e} />
      ))}
    </>
  );
}

function ElementList({ elements }: { elements: ArrayMergedElement[] }) {
  if (elements.length === 0) {
    return (
      <div className="px-5 pt-4 pb-3 font-mono text-[11px] text-fg-3">
        No elements contributed by any layer.
      </div>
    );
  }
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="corner-tag">Elements ({elements.length})</span>
        <span className="font-mono text-[9.5px] text-fg-4">
          first contributor wins
        </span>
      </div>
      <div className="space-y-0.5 px-3 pb-2">
        {elements.map((el, i) => {
          const formatted = formatValue(el.value);
          return (
            <div
              key={`${el.source}-${i}`}
              className={cn(
                "grid items-center gap-2.5 rounded-sm px-2.5 py-1.5",
                "grid-cols-[28px_1fr_72px]",
              )}
            >
              <span className="font-mono text-[10px] text-fg-4">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "truncate font-mono text-[12px] text-fg-1",
                  formatted.kind === "string" && "text-fg-1",
                )}
                title={formatted.text}
              >
                {formatted.text}
              </span>
              <span className="justify-self-end">
                <SourceBadge source={el.source} />
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DrawerHeader({
  row,
  description,
  onClose,
}: {
  row: Row;
  description: string | null;
  onClose: () => void;
}) {
  const typeText = row.catalog?.type ?? "unknown";
  const isShadowed = row.state === "shadowed";
  // Most catalog entries don't declare a default; show only when present.
  // For unset rows the effective value IS the default, so the inline copy
  // would be redundant — the EffectiveBlock already shows it.
  const showDefault =
    row.catalog && "default" in row.catalog && row.state !== "unset";
  const defaultText = showDefault
    ? formatValue(row.catalog!.default).text
    : null;

  return (
    <div className="border-b border-line px-5 pt-5 pb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="corner-tag">Detail</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="font-mono text-xs text-fg-3 hover:text-fg-1"
        >
          ×
        </button>
      </div>
      <h2
        className="font-mono text-[18px] font-semibold tracking-tight text-fg-1"
        title={row.keyPath}
      >
        {row.namespace ? <span className="text-fg-3">{row.namespace}.</span> : null}
        {row.leaf}
      </h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-fg-3">
        <span>{typeText}</span>
        <span className="text-fg-4">·</span>
        <span>{describeShape(row)}</span>
        {defaultText !== null && (
          <>
            <span className="text-fg-4">·</span>
            <span title="Catalog default — what Claude Code uses if nobody sets this">
              default: <span className="text-fg-2">{defaultText}</span>
            </span>
          </>
        )}
        {isShadowed && (
          <>
            <span className="text-fg-4">·</span>
            <span className="flex items-center gap-1 text-warn">
              <ShadowingGlyph />
              shadowing
            </span>
          </>
        )}
      </div>
      {description && (
        <p className="mt-3 max-w-prose text-[12.5px] leading-relaxed text-fg-2">
          <InlineMarkdown source={description} />
        </p>
      )}
    </div>
  );
}

function InlineMarkdown({ source }: { source: string }) {
  const tokens = useMemo(() => parseInlineMarkdown(source), [source]);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.kind === "link" ? (
          <a
            key={i}
            href={tok.href}
            onClick={(e) => {
              e.preventDefault();
              void openExternalUrl(tok.href);
            }}
            className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {tok.text}
          </a>
        ) : (
          <span key={i}>{tok.value}</span>
        ),
      )}
    </>
  );
}

function EffectiveBlock({
  row,
  formatted,
}: {
  row: Row;
  formatted: ReturnType<typeof formatValue>;
}) {
  const annotation = resolveValueAnnotation(row);
  return (
    <div className="border-b border-line px-5 py-4">
      <span className="corner-tag mb-2 block">Effective</span>
      <div className="flex items-center gap-3 rounded-sm border border-line-strong bg-bg-0 p-3">
        <StatusDot
          variant={row.state === "unset" ? "empty" : "ok"}
          className={
            row.state !== "unset"
              ? "shadow-[0_0_6px_var(--color-accent-ring)]"
              : undefined
          }
        />
        <span
          className={cn(
            "truncate font-mono text-[14px] font-semibold",
            row.state === "unset" ? "text-fg-3" : "text-accent",
          )}
          title={formatted.text}
        >
          {formatted.text}
        </span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.05em] text-fg-3">
          {row.winner ? (
            <>
              <SourceBadge source={row.winner} />
              <span>wins</span>
            </>
          ) : (
            <span>merged across {row.contributors.length} layers</span>
          )}
        </span>
      </div>
      {annotation ? (
        <div
          className="mt-2 flex gap-2 pl-3 text-[11.5px] leading-snug text-fg-3"
          data-testid="value-annotation"
        >
          <span aria-hidden className="text-fg-4">→</span>
          <span>{annotation}</span>
        </div>
      ) : null}
    </div>
  );
}

interface RelatedItem {
  entry: CatalogEntry;
  row: Row | null;
}

function RelatedKnobs({
  items,
  onSelect,
}: {
  items: RelatedItem[];
  onSelect: (keyPath: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="corner-tag">Related ({items.length})</span>
        <span className="font-mono text-[9.5px] text-fg-4">siblings</span>
      </div>
      <div className="space-y-0.5 px-3 pb-2">
        {items.map(({ entry, row }) => {
          const winner = row?.winner ?? null;
          const isSet = row?.state === "set" || row?.state === "shadowed" || row?.state === "array-merged";
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => onSelect(entry.key)}
              className={cn(
                "grid w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5",
                "grid-cols-[1fr_72px] text-left",
                "hover:bg-bg-2 focus:bg-bg-2 focus:outline-none",
              )}
              title={entry.key}
            >
              <span className="min-w-0 truncate font-mono text-[12px] text-fg-1">
                <span className="text-fg-3">{prefixOf(entry.key)}</span>
                {leafOf(entry.key)}
              </span>
              <span className="justify-self-end">
                {winner ? (
                  <SourceBadge source={winner} />
                ) : (
                  <span
                    className={cn(
                      "inline-block rounded-[2px] border px-1.5 py-0.5",
                      "font-mono text-[10px] uppercase tracking-[0.05em]",
                      isSet
                        ? "text-fg-3 border-line-strong"
                        : "text-fg-4 border-line",
                    )}
                  >
                    unset
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function CatalogFooter({ row }: { row: Row }) {
  if (!row.catalog) {
    return (
      <div className="mx-5 mt-4 border-t border-line px-0 pt-3 pb-5">
        <span className="corner-tag mb-2 block">Catalog</span>
        <div className="font-mono text-[10.5px] leading-relaxed text-fg-3">
          not in the catalog (set under a parent key)
        </div>
      </div>
    );
  }
  return (
    <div className="mx-5 mt-4 border-t border-line px-0 pt-3 pb-5">
      <span className="corner-tag mb-2 block">Catalog</span>
      <div className="font-mono text-[10.5px] leading-relaxed text-fg-3">
        {row.catalog.key}
        {row.catalog.type ? ` · ${row.catalog.type}` : ""}
      </div>
    </div>
  );
}

function prefixOf(keyPath: string): string {
  const dot = keyPath.lastIndexOf(".");
  return dot < 0 ? "" : `${keyPath.slice(0, dot)}.`;
}

function leafOf(keyPath: string): string {
  const dot = keyPath.lastIndexOf(".");
  return dot < 0 ? keyPath : keyPath.slice(dot + 1);
}

/**
 * Extract the env-var name from an `env.<VAR>` row's keyPath. Returns
 * null when the path isn't an immediate child of `env`, when the leaf
 * isn't a valid POSIX-style env identifier (upper-case ASCII +
 * underscore + digits, not leading-digit), or when the namespace prefix
 * is anything other than literal `env`. Case-sensitive on purpose:
 * matching `env.lower_case` would feed false catalog hits to the
 * drawer.
 */
export function envVarNameFromKeyPath(keyPath: string): string | null {
  const m = /^env\.([A-Z_][A-Z0-9_]*)$/.exec(keyPath);
  return m ? m[1] : null;
}

/**
 * Resolve the description prose shown in the drawer header. For
 * `env.<VAR>` rows whose var is documented upstream, prefer the
 * env-vars catalog's purpose over the generic parent-`env` description
 * the settings catalog walk-up returns. Falls back to the settings
 * catalog description otherwise; truncates to the first line so the
 * header band stays a single paragraph.
 */
export function resolveDescription(row: Row): string | null {
  const envVar = envVarNameFromKeyPath(row.keyPath);
  if (envVar) {
    const entry = findEnvVar(envVar);
    if (entry) return entry.purpose.split("\n")[0];
  }
  return row.catalog?.description?.split("\n")[0] ?? null;
}

/**
 * Resolve a value-conditional annotation rendered under the EFFECTIVE
 * block — explains what the current value *does* without conflating it
 * with the description of the knob itself.
 *
 * Currently fires only for `permissions.defaultMode` rows whose
 * effective value matches a cataloged mode (the 6 documented modes,
 * not the experimental `delegate` enum value). Returns null for
 * undocumented values, non-string values, and any other keyPath, so
 * the drawer renders nothing rather than mislead.
 */
export function resolveValueAnnotation(row: Row): string | null {
  if (row.keyPath === "permissions.defaultMode" && typeof row.value === "string") {
    const mode = findPermissionMode(row.value);
    if (mode) return mode.description;
  }
  return null;
}

function describeShape(row: Row): string {
  if (row.state === "array-merged") return "array (merged)";
  if (Array.isArray(row.value)) return "array (last-wins)";
  if (row.value !== null && typeof row.value === "object") return "object (last-wins)";
  return "scalar (last-wins)";
}

function ShadowingGlyph() {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" fill="currentColor" aria-hidden>
      <path d="M4.5 0L9 8H0z" />
    </svg>
  );
}
