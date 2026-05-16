import { cn } from "@/lib/utils";
import { formatValue, formatValueForKey } from "@/lib/format";
import type { Row } from "@/lib/rows";
import { PresenceIndicator } from "./PresenceIndicator";
import { SourceBadge } from "./SourceBadge";

const VALUE_KIND_CLASS: Record<
  ReturnType<typeof formatValue>["kind"],
  string
> = {
  string: "text-fg-2",
  number: "text-fg-2",
  boolean: "text-fg-2",
  null: "text-fg-3 italic",
  array: "text-info",
  object: "text-fg-3",
  unset: "text-fg-4 italic",
};

export function SettingsRow({
  row,
  index,
  selected,
  cursor,
  onSelect,
  gridTemplate,
}: {
  row: Row;
  index: number;
  selected?: boolean;
  cursor?: boolean;
  onSelect?: () => void;
  /** Shared grid-template-columns string from SettingsList so rows stay
   * aligned with the resizable header. */
  gridTemplate: string;
}) {
  const formatted = formatValueForKey(row.keyPath, row.value);

  return (
    <div
      role="button"
      tabIndex={0}
      data-row-key={row.keyPath}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      style={{ gridTemplateColumns: gridTemplate }}
      className={cn(
        "grid h-[30px] cursor-pointer items-center gap-x-3 border-b border-line px-3.5 text-[12px]",
        row.state === "unset" && "opacity-45",
        selected
          ? "bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]"
          : cursor
            ? "bg-bg-1 shadow-[inset_2px_0_0_var(--color-line-strong)]"
            : "hover:bg-bg-1",
      )}
    >
      <span className="font-mono text-[10px] text-fg-4">
        {String(index + 1).padStart(2, "0")}
      </span>

      <span className="truncate font-mono text-[12px] text-fg-1" title={row.keyPath}>
        {row.namespace ? (
          <span className="text-fg-3">{row.namespace}.</span>
        ) : null}
        {row.leaf}
      </span>

      <span
        className={cn(
          "truncate font-mono text-[11.5px]",
          VALUE_KIND_CLASS[formatted.kind],
        )}
        title={formatted.text}
      >
        {formatted.text}
      </span>

      <span>
        {row.winner ? (
          <SourceBadge source={row.winner} />
        ) : (
          <span
            className="inline-flex items-center rounded-[2px] border border-line-strong bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-fg-3"
            title="Array-merged across layers — see drawer for per-element sources"
          >
            merged
          </span>
        )}
      </span>

      <PresenceIndicator
        contributors={row.contributors}
        winner={row.contributors.length > 0 ? row.winner : null}
      />

      <span
        className={cn(
          "font-mono text-[10px]",
          selected ? "text-accent" : "text-fg-4",
        )}
      >
        ›
      </span>
    </div>
  );
}
