import { LAYERS_IN_PRECEDENCE_ORDER, type LayerSource } from "@/types";
import { cn } from "@/lib/utils";
import { SOURCE_BADGE_LABEL } from "./SourceBadge";

type CellState = "absent" | "set" | "shadowed" | "winner";

const CELL_CLASS: Record<CellState, string> = {
  absent: "border border-line-strong bg-transparent",
  set: "border border-fg-3 bg-fg-3",
  shadowed: "border border-fg-4 bg-fg-4",
  winner: "border border-accent bg-accent shadow-[0_0_4px_var(--color-accent-ring)]",
};

export function PresenceIndicator({
  contributors,
  winner,
  className,
}: {
  contributors: LayerSource[];
  winner: LayerSource | null;
  className?: string;
}) {
  const set = new Set(contributors);
  return (
    <span className={cn("inline-flex gap-[2px]", className)}>
      {LAYERS_IN_PRECEDENCE_ORDER.map((layer) => {
        const state: CellState = !set.has(layer)
          ? "absent"
          : layer === winner
            ? "winner"
            : "shadowed";
        return (
          <span
            key={layer}
            title={`${SOURCE_BADGE_LABEL[layer]} · ${state}`}
            className={cn("h-2.5 w-1.5 rounded-[1px]", CELL_CLASS[state])}
          />
        );
      })}
    </span>
  );
}
