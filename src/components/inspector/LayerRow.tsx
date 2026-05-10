import { cn } from "@/lib/utils";
import type { LayerSource } from "@/types";
import { StatusDot, type DotVariant } from "./StatusDot";

export interface RailRow {
  source: LayerSource;
  dot: DotVariant;
  /** Truncated path, empty-state copy, or parse-error message. */
  detail: string;
  /** Tints `detail` warn-amber when it carries a parse error. */
  detailIsError?: boolean;
  /** Set-key count, or null to render an em-dash. */
  count: number | null;
  /** Layers we can't faithfully attribute to the user's claude session
   * (managed w/o policy, cli per #11, project/project_local per #12). */
  disabled?: boolean;
}

export function LayerRow({
  row,
  active,
}: {
  row: RailRow;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[14px_1fr_auto] items-center gap-2 rounded-sm px-2.5 py-1.5",
        row.disabled && "opacity-45",
        active && "bg-bg-2 shadow-[inset_2px_0_0_var(--color-accent)]",
      )}
    >
      <StatusDot variant={row.dot} />
      <div className="min-w-0">
        <div className="font-mono text-[12px] tracking-[0.02em] text-fg-1">
          {row.source}
        </div>
        <div
          className={cn(
            "truncate font-mono text-[11px]",
            row.detailIsError ? "text-warn" : "text-fg-3",
          )}
          title={row.detail}
        >
          {row.detail}
        </div>
      </div>
      <span className="font-mono text-[11px] tabular-nums text-fg-3">
        {row.count === null ? "—" : row.count}
      </span>
    </div>
  );
}
