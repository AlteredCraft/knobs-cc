import type { LayerSource } from "@/types";
import { cn } from "@/lib/utils";

export const SOURCE_BADGE_LABEL: Record<LayerSource, string> = {
  managed: "MGD",
  cli: "CLI",
  env: "ENV",
  project_local: "P.LOCAL",
  project: "PROJ",
  user: "USER",
  default: "DEFAULT",
};

// Per-source colour treatments. The colour tokens are defined in src/index.css.
// We avoid Tailwind utility names like `text-src-managed` because the bg and
// border tints here are partial-alpha derivatives of the same source colour.
const SOURCE_STYLE: Record<LayerSource, string> = {
  managed:
    "text-[#d4585b] bg-[rgba(212,88,91,0.08)] border-[rgba(212,88,91,0.25)]",
  cli: "text-fg-3 bg-bg-3 border-line-strong",
  env: "text-[#6aa3d4] bg-[rgba(106,163,212,0.08)] border-[rgba(106,163,212,0.22)]",
  project_local:
    "text-[#ffd07a] bg-[rgba(255,182,39,0.05)] border-[rgba(255,182,39,0.18)]",
  project:
    "text-[#ffb627] bg-[rgba(255,182,39,0.08)] border-[rgba(255,182,39,0.25)]",
  user: "text-[#aab3bf] bg-[rgba(170,179,191,0.06)] border-[rgba(170,179,191,0.18)]",
  default: "text-fg-3 bg-transparent border-transparent",
};

export function SourceBadge({
  source,
  className,
}: {
  source: LayerSource;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5",
        "font-mono text-[10px] font-semibold uppercase tracking-[0.05em]",
        SOURCE_STYLE[source],
        className,
      )}
    >
      {SOURCE_BADGE_LABEL[source]}
    </span>
  );
}
