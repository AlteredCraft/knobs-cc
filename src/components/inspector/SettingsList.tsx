import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  applyChip,
  applyFilter,
  buildRows,
  chipCounts,
  sortRows,
  type ChipFilter,
  type SortMode,
} from "@/lib/rows";
import type { SettingsSnapshot } from "@/types";
import { SettingsRow } from "./SettingsRow";

const CHIPS: ReadonlyArray<{ id: ChipFilter; label: string; disabled?: boolean; tooltip?: string }> = [
  { id: "all", label: "all" },
  { id: "set", label: "set" },
  { id: "shadowed", label: "shadowed" },
  {
    id: "array-merged",
    label: "array-merged",
    disabled: true,
    tooltip: "Array-merge semantics land in Phase 3",
  },
  { id: "unset", label: "unset" },
];

export function SettingsList({ snapshot }: { snapshot: SettingsSnapshot }) {
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<ChipFilter>("all");
  const [sort, setSort] = useState<SortMode>("precedence");

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const counts = useMemo(() => chipCounts(rows), [rows]);
  const visible = useMemo(() => {
    return sortRows(applyFilter(applyChip(rows, chip), query), sort);
  }, [rows, chip, query, sort]);

  return (
    <section className="grid-bg flex flex-1 flex-col overflow-hidden bg-bg-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-line bg-bg-0 px-4 py-3">
        <div className="relative max-w-xs flex-1">
          <svg
            className="absolute top-1/2 left-2 -translate-y-1/2 text-fg-3"
            width={14}
            height={14}
            viewBox="0 0 14 14"
            fill="none"
          >
            <circle cx={6} cy={6} r={4} stroke="currentColor" strokeWidth="1.2" />
            <line x1={9} y1={9} x2={12} y2={12} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter keys… (try permissions.*)"
            className={cn(
              "w-full rounded-sm border border-line-strong bg-bg-1 py-1.5 pr-2 pl-7",
              "font-mono text-[12px] text-fg-1 placeholder:text-fg-4",
              "outline-none focus:border-accent focus:ring-1 focus:ring-[var(--color-accent-ring)]",
            )}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {CHIPS.map((c) => {
            const active = chip === c.id;
            const disabled = c.disabled;
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setChip(c.id)}
                title={c.tooltip}
                className={cn(
                  "rounded-sm border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em]",
                  active && !disabled
                    ? "border-accent bg-accent font-semibold text-[#1a1300]"
                    : "border-line-strong bg-bg-2 text-fg-2 hover:text-fg-1 hover:border-[#373c47]",
                  disabled && "cursor-not-allowed opacity-40 hover:text-fg-2 hover:border-line-strong",
                )}
              >
                {c.label}
                <span className="ml-1 opacity-60">{counts[c.id]}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setSort((s) => (s === "precedence" ? "alpha" : "precedence"))}
          className="ml-auto font-mono text-[10.5px] uppercase tracking-wider text-fg-3 hover:text-fg-1"
          title="Toggle sort"
        >
          sort · {sort}
        </button>
      </div>

      {/* Column headers */}
      <div
        className={cn(
          "grid h-[26px] items-center gap-x-3 border-b border-line-strong bg-bg-1 px-3.5",
          "grid-cols-[32px_1fr_320px_86px_76px_16px]",
        )}
      >
        <span />
        <span className="corner-tag">Key</span>
        <span className="corner-tag">Effective Value</span>
        <span className="corner-tag">Source</span>
        <span className="corner-tag" title="Layer presence: M C E PL P U D">
          M·C·E·PL·P·U·D
        </span>
        <span />
      </div>

      {/* Body */}
      <div className="scrollbar flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-fg-3">
            no rows match
          </div>
        ) : (
          visible.map((row, i) => (
            <SettingsRow key={row.keyPath} row={row} index={i} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-4 border-t border-line bg-bg-1 px-4 py-1.5 font-mono text-[10.5px] tracking-wider text-fg-3 uppercase">
        <span>{counts.all} keys</span>
        <span>·</span>
        <span>{counts.set} set</span>
        <span>·</span>
        <span>{counts.shadowed} shadowed</span>
        <span>·</span>
        <span>{counts.unset} unset</span>
        <span className="ml-auto text-fg-4">⌘K filter · J/K nav · ↵ details (4d)</span>
      </div>
    </section>
  );
}
