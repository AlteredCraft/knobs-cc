import { cn } from "@/lib/utils";
import { formatValue } from "@/lib/format";
import type { Row } from "@/lib/rows";
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
}: {
  row: Row;
  snapshot: SettingsSnapshot;
  onClose: () => void;
}) {
  const formatted = formatValue(row.value);
  const description = row.catalog?.description?.split("\n")[0] ?? null;
  const isArrayMerged = row.state === "array-merged";

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
      <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-fg-3">
        <span>{typeText}</span>
        <span className="text-fg-4">·</span>
        <span>{describeShape(row)}</span>
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
          {description}
        </p>
      )}
    </div>
  );
}

function EffectiveBlock({
  row,
  formatted,
}: {
  row: Row;
  formatted: ReturnType<typeof formatValue>;
}) {
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
    </div>
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
        <br />
        <span className="text-fg-4">
          inventory.md · related knobs in Phase 5
        </span>
      </div>
    </div>
  );
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
