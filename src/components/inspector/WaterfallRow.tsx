import { cn } from "@/lib/utils";
import { formatValue } from "@/lib/format";
import { openInEditor } from "@/lib/openPath";
import type { WaterfallEntry } from "@/lib/waterfall";
import { StatusDot } from "./StatusDot";
import { SOURCE_BADGE_LABEL } from "./SourceBadge";

const DOT_BY_STATE: Record<WaterfallEntry["state"], "ok" | "warn" | "err" | "empty"> = {
  winner: "ok",
  shadowed: "ok",
  absent: "empty",
  "missing-file": "empty",
  error: "err",
  "not-inspectable": "empty",
};

export function WaterfallRow({ entry }: { entry: WaterfallEntry }) {
  const formatted = entry.value === undefined ? null : formatValue(entry.value);

  const isWinner = entry.state === "winner";
  const isShadowed = entry.state === "shadowed";

  return (
    <div className="border-l-2 border-transparent">
      <div
        className={cn(
          "grid items-baseline gap-2.5 px-3 py-2",
          "grid-cols-[18px_80px_1fr_100px]",
          isWinner && "border-l-2 border-accent bg-accent-soft -ml-[2px]",
          isShadowed && "opacity-55",
        )}
      >
        <StatusDot
          variant={DOT_BY_STATE[entry.state]}
          className={cn(
            "mt-1",
            isWinner && "shadow-[0_0_6px_var(--color-accent-ring)]",
            isWinner && "border-accent !bg-accent",
          )}
        />
        <span
          className={cn(
            "font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-2",
            isWinner && "text-accent",
          )}
        >
          {SOURCE_BADGE_LABEL[entry.source].toLowerCase()}
        </span>
        <span
          className={cn(
            "font-mono text-[12px]",
            formatted ? "text-fg-1" : "text-fg-4 italic",
            isWinner && "text-accent",
            isShadowed && "line-through decoration-fg-4",
          )}
          title={formatted?.text ?? entry.emptyText ?? undefined}
        >
          {formatted ? formatted.text : entry.emptyText}
        </span>
        <span className="text-right font-mono text-[10px] text-fg-3">
          {metaLabel(entry)}
        </span>
      </div>

      {entry.path && entry.value !== undefined && (
        <PathNote path={entry.path} dimmed={isShadowed} />
      )}
    </div>
  );
}

function PathNote({ path, dimmed }: { path: string; dimmed: boolean }) {
  return (
    <div className={cn("px-5 pb-1.5 -mt-1", dimmed && "opacity-55")}>
      <button
        type="button"
        onClick={() => void openInEditor(path)}
        title={`Open ${path} in your default editor`}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 text-left",
          "font-mono text-[10px] text-fg-3",
          "hover:text-fg-1 hover:underline focus:text-fg-1 focus:underline focus:outline-none",
        )}
      >
        <span className="opacity-50">↳</span>
        <span className="truncate">{path}</span>
      </button>
    </div>
  );
}

function metaLabel(entry: WaterfallEntry): string {
  switch (entry.state) {
    case "winner":
      return "⏵ winner";
    case "shadowed":
      return "shadowed";
    case "absent":
      return "—";
    case "missing-file":
      return "missing";
    case "error":
      return "error";
    case "not-inspectable":
      return "∅";
  }
}
