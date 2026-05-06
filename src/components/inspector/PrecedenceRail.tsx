import {
  LAYERS_IN_PRECEDENCE_ORDER,
  type Diagnostic,
  type LayerRead,
  type LayerSource,
  type SettingsSnapshot,
} from "@/types";
import { buildRows } from "@/lib/rows";
import { LayerRow, type RailRow } from "./LayerRow";

// Top-level key count for a layer's parsed JSON. The mock's example numbers
// (env=2, proj=8, user=12) read as set-keys at the top level; we mirror that
// rather than walk to leaves.
function countTopLevelKeys(raw: unknown): number {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return 0;
  return Object.keys(raw as Record<string, unknown>).length;
}

// Empty-state copy for absent or uninspectable layers — verbatim from
// inspector-ui.md:131-135.
const ABSENT_DETAIL: Partial<Record<LayerSource, string>> = {
  managed: "no MDM policy detected",
  cli: "not inspectable from sibling proc",
  env: "no mapped env vars set",
  default: "catalog (compiled-in)",
};

function buildRow(
  source: LayerSource,
  layer: LayerRead | undefined,
  defaultCount: number,
): RailRow {
  // Layers the backend doesn't read in Phase 1 fall through to synthesized rows.
  if (!layer) {
    return {
      source,
      dot: source === "default" ? "ok" : "empty",
      detail: ABSENT_DETAIL[source] ?? "—",
      count: source === "default" ? defaultCount : null,
      disabled: source === "managed" || source === "cli",
    };
  }

  if (layer.status === "error") {
    return {
      source,
      dot: "err",
      detail: layer.error ?? "parse error",
      detailIsError: true,
      count: null,
    };
  }

  if (layer.status === "missing") {
    // `managed` is missing when no policy is shipped to this machine — the
    // user-friendly copy (per inspector-ui.md:135) reads better than the
    // raw managed dir path.
    return {
      source,
      dot: "empty",
      detail: source === "managed" ? ABSENT_DETAIL.managed! : layer.path ?? "—",
      count: null,
    };
  }

  // env is a real layer with no file path. The detail describes what was
  // read; an empty raw object reads as "no mapped vars are set" rather
  // than "—" (the file-layer fallback).
  if (source === "env") {
    const setCount = countTopLevelKeys(layer.raw);
    return {
      source,
      dot: setCount > 0 ? "ok" : "empty",
      detail: setCount > 0 ? "process environment" : "no mapped env vars set",
      count: setCount,
    };
  }

  return {
    source,
    dot: "ok",
    detail: layer.path ?? "—",
    count: countTopLevelKeys(layer.raw),
  };
}

export function PrecedenceRail({
  snapshot,
  activeWinner,
}: {
  snapshot: SettingsSnapshot;
  activeWinner?: LayerSource | null;
}) {
  const byKey = new Map(snapshot.layers.map((l) => [l.source, l] as const));
  const defaultCount = buildRows(snapshot).filter((r) => r.state === "unset").length;
  const rows = LAYERS_IN_PRECEDENCE_ORDER.map((src) =>
    buildRow(src, byKey.get(src), defaultCount),
  );

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-line bg-bg-1">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="corner-tag">Precedence Stack</span>
        <span className="font-mono text-[9.5px] text-fg-4">↓ HI → LO</span>
      </div>

      <div className="px-2">
        {rows.map((row) => (
          <LayerRow
            key={row.source}
            row={row}
            active={row.source === activeWinner}
          />
        ))}
      </div>

      <DiagnosticsDock diagnostics={snapshot.diagnostics} />
    </aside>
  );
}

function DiagnosticsDock({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <div className="mt-auto border-t border-line px-4 py-3">
      <span className="corner-tag mb-2 block">
        Diagnostics · {diagnostics.length}
      </span>
      {diagnostics.length === 0 ? (
        <span className="font-mono text-[10.5px] text-fg-4">none</span>
      ) : (
        <div className="space-y-2">
          {diagnostics.map((d, i) => (
            <div key={i} className="font-mono text-[10.5px] leading-snug">
              <span
                className={
                  d.level === "error"
                    ? "text-err uppercase tracking-wider"
                    : "text-warn uppercase tracking-wider"
                }
              >
                {d.level}
              </span>
              <span className="block text-fg-2">{d.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
