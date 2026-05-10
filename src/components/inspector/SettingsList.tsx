import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  applyChip,
  applyFilter,
  buildRows,
  chipCounts,
  nextCursorPath,
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
  { id: "array-merged", label: "array-merged" },
  { id: "unset", label: "unset" },
];

export interface SettingsListHandle {
  focusFilter: () => void;
  moveCursor: (delta: 1 | -1) => void;
  activateCursor: () => void;
  /** Jump the logical cursor to a specific key. Used when navigation
   * originates outside the list (e.g. clicking a related knob in the
   * drawer); without this the cursor-follow effect would drag the drawer
   * back to wherever the cursor was. */
  setCursor: (keyPath: string) => void;
}

interface SettingsListProps {
  snapshot: SettingsSnapshot;
  activeKeyPath: string | null;
  onSelect: (keyPath: string) => void;
  /** Click target for the env-vars banner above the column header. */
  onShowEnvVars?: () => void;
}

export const SettingsList = forwardRef<SettingsListHandle, SettingsListProps>(
  function SettingsList(
    { snapshot, activeKeyPath, onSelect, onShowEnvVars },
    ref,
  ) {
    const [query, setQuery] = useState("");
    const [chip, setChip] = useState<ChipFilter>("all");
    const [sort, setSort] = useState<SortMode>("precedence");
    const [cursorKeyPath, setCursorKeyPath] = useState<string | null>(null);

    const filterRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    const rows = useMemo(() => buildRows(snapshot), [snapshot]);
    const counts = useMemo(() => chipCounts(rows), [rows]);
    const visible = useMemo(() => {
      return sortRows(applyFilter(applyChip(rows, chip), query), sort);
    }, [rows, chip, query, sort]);

    // Keep an up-to-date ref for visible rows so the imperative handle's
    // moveCursor closure always reads the latest list, even when called
    // from a window keydown handler bound at mount.
    const visibleRef = useRef(visible);
    useEffect(() => {
      visibleRef.current = visible;
    }, [visible]);

    // Autofocus the filter input on first mount — the inspector is
    // keyboard-first and most sessions begin with filtering.
    useEffect(() => {
      filterRef.current?.focus();
    }, []);

    // If the cursor row is no longer in the visible list (filter/chip/sort
    // changed), reset to the first visible row.
    useEffect(() => {
      if (visible.length === 0) {
        if (cursorKeyPath !== null) setCursorKeyPath(null);
        return;
      }
      if (!cursorKeyPath || !visible.some((r) => r.keyPath === cursorKeyPath)) {
        setCursorKeyPath(visible[0].keyPath);
      }
    }, [visible, cursorKeyPath]);

    // Keep the cursor row scrolled into view. Don't steal DOM focus from the
    // filter input — the cursor is a logical pointer, separate from focus.
    useEffect(() => {
      if (!cursorKeyPath || !bodyRef.current) return;
      const el = bodyRef.current.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(cursorKeyPath)}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }, [cursorKeyPath]);

    // When the drawer is open, it follows the cursor — moving J/K through
    // neighbouring rows updates the drawer in place (inspector-ui.md:151).
    useEffect(() => {
      if (activeKeyPath && cursorKeyPath && cursorKeyPath !== activeKeyPath) {
        onSelect(cursorKeyPath);
      }
    }, [cursorKeyPath, activeKeyPath, onSelect]);

    useImperativeHandle(
      ref,
      () => ({
        focusFilter: () => filterRef.current?.focus(),
        moveCursor: (delta) => {
          setCursorKeyPath((cur) => nextCursorPath(visibleRef.current, cur, delta));
        },
        activateCursor: () => {
          setCursorKeyPath((cur) => {
            if (cur) onSelect(cur);
            return cur;
          });
        },
        setCursor: (keyPath) => setCursorKeyPath(keyPath),
      }),
      [onSelect],
    );

    const handleRowSelect = (keyPath: string) => {
      setCursorKeyPath(keyPath);
      onSelect(keyPath);
    };

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
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc inside the filter clears + blurs without bubbling to
                // the global handler (so it doesn't also try to close the
                // drawer in the same keystroke).
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                  filterRef.current?.blur();
                }
              }}
              placeholder="filter keys… (try permissions.*)"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
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

        {/* Static banner: env vars have their own SSOT panel. Without
            this cue, a user who filters for "env" and gets zero rows
            would assume the inspector forgot env entirely. */}
        {onShowEnvVars && (
          <div className="flex items-center gap-2 border-b border-line bg-bg-1 px-4 py-1.5 font-mono text-[10.5px] leading-snug text-fg-3">
            <span className="uppercase tracking-wider text-fg-4">note</span>
            <span>env vars are inspected in the</span>
            <button
              type="button"
              onClick={onShowEnvVars}
              className="rounded-[2px] border border-line-strong px-1.5 py-px text-fg-2 hover:border-accent hover:text-fg-1"
            >
              env vars panel
            </button>
            <span className="text-fg-4">
              · settings.json env block + your shell + non-catalog names
            </span>
          </div>
        )}

        {/* Header + body share a single horizontal scroll container so the
            column header stays aligned with rows when the pane is narrower
            than the row's intrinsic min width. */}
        <div ref={bodyRef} className="scrollbar flex-1 overflow-auto">
          <div className="min-w-[710px]">
            {/* Column header — sticky so it survives vertical scroll but
                tracks horizontal scroll with the body. */}
            <div
              className={cn(
                "sticky top-0 z-10 grid h-[26px] items-center gap-x-3 border-b border-line-strong bg-bg-1 px-3.5",
                "grid-cols-[32px_minmax(180px,1fr)_320px_86px_76px_16px]",
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

            {visible.length === 0 ? (
              <div className="flex h-32 items-center justify-center font-mono text-[11px] text-fg-3">
                no rows match
              </div>
            ) : (
              visible.map((row, i) => (
                <SettingsRow
                  key={row.keyPath}
                  row={row}
                  index={i}
                  selected={row.keyPath === activeKeyPath}
                  cursor={row.keyPath === cursorKeyPath}
                  onSelect={() => handleRowSelect(row.keyPath)}
                />
              ))
            )}
          </div>
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
          <span className="ml-auto text-fg-4">
            ⌘K filter · J·K / ↑↓ move · ↵ open · R refresh · esc close
          </span>
        </div>
      </section>
    );
  },
);
