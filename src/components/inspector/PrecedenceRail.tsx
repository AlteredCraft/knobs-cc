import {
  LAYERS_IN_PRECEDENCE_ORDER,
  type Diagnostic,
  type LayerRead,
  type LayerSource,
  type SessionGrounding,
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
  // cli's missing-state copy depends on grounding: when not attached, the
  // honest message is "no attached claude." When attached but argv had no
  // mapped flags, the rail renders the layer as Ok with count 0 (see env's
  // empty-raw branch for the precedent).
  cli: "no attached claude (argv unavailable)",
  env: "no mapped env vars set",
  default: "catalog (compiled-in)",
};

// Fallback copy when a file-based layer is `missing` and we have no path to
// display — i.e. HOME / cwd couldn't be resolved at all. Better than "—":
// tells the user *why* the layer is absent. Snapshot diagnostics carry the
// same information at the bottom of the rail; this just stops the row
// itself from being uninformative.
function unreachableLayerDetail(source: LayerSource): string {
  switch (source) {
    case "user":
      return "$HOME not set";
    case "project":
    case "project_local":
      return "no project root";
    default:
      return "—";
  }
}

/** Which layers should be greyed in the rail for the current grounding. */
function ungroundedLayersFor(
  grounding: SessionGrounding,
): ReadonlySet<LayerSource> {
  switch (grounding.kind) {
    case "attached":
      // Attached → cli, env, project, project_local all grounded against
      // the live process. No row needs to be greyed for ungrounding.
      return new Set();
    case "no-claude":
      if (grounding.pickedRoot) {
        // Path picker → project files grounded against the picked dir;
        // cli still has no process to read argv from.
        return new Set<LayerSource>(["cli"]);
      }
      // No grounding source at all: cli + project files all ungrounded.
      return new Set<LayerSource>(["cli", "project", "project_local"]);
    case "unsupported":
    case "loading":
      return new Set<LayerSource>(["cli", "project", "project_local"]);
  }
}

function buildRow(
  source: LayerSource,
  layer: LayerRead | undefined,
  defaultCount: number,
  ungrounded: ReadonlySet<LayerSource>,
): RailRow {
  // Tack `disabled: true` onto every ungrounded row so the greyout applies
  // regardless of which status branch the layer hits (ok / missing / error
  // / not-read). Wrapping here avoids drift if a future branch forgets the
  // field — which is exactly how #12 slipped past first review.
  const row = buildRowCore(source, layer, defaultCount);
  if (ungrounded.has(source)) {
    row.disabled = true;
    if (source === "project" || source === "project_local") {
      row.detail = "knobs.cc's launch dir, not your claude session";
      row.detailIsError = false;
    }
  }
  return row;
}

function buildRowCore(
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
      disabled: source === "managed",
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
    if (source === "managed") {
      return {
        source,
        dot: "empty",
        detail: ABSENT_DETAIL.managed!,
        count: null,
      };
    }
    return {
      source,
      dot: "empty",
      detail: layer.path ?? unreachableLayerDetail(source),
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

  // cli is a real layer when attached. Mirror env's pattern — describe the
  // source rather than show "—" for an empty raw. (When unattached the
  // layer status is Missing, handled above.)
  if (source === "cli") {
    const setCount = countTopLevelKeys(layer.raw);
    return {
      source,
      dot: setCount > 0 ? "ok" : "empty",
      detail: setCount > 0 ? "process argv" : "no mapped flags in argv",
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
  grounding,
  activeWinner,
}: {
  snapshot: SettingsSnapshot;
  grounding: SessionGrounding;
  activeWinner?: LayerSource | null;
}) {
  const byKey = new Map(snapshot.layers.map((l) => [l.source, l] as const));
  const defaultCount = buildRows(snapshot).filter((r) => r.state === "unset").length;
  const ungrounded = ungroundedLayersFor(grounding);
  const rows = LAYERS_IN_PRECEDENCE_ORDER.map((src) =>
    buildRow(src, byKey.get(src), defaultCount, ungrounded),
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

      <DiagnosticsDock diagnostics={collectDiagnostics(snapshot)} />
    </aside>
  );
}

// Snapshot diagnostics + per-layer errors. Layer errors already render in
// the rail row, but a user scanning the dock for "what's wrong" should see
// them counted here too — otherwise the dock reads "Diagnostics · 0" while
// a row above flashes red.
function collectDiagnostics(snapshot: SettingsSnapshot): Diagnostic[] {
  const fromLayers: Diagnostic[] = snapshot.layers
    .filter((l) => l.status === "error" && l.error)
    .map((l) => ({
      level: "error",
      message: `${l.source}: ${l.error}`,
    }));
  return [...snapshot.diagnostics, ...fromLayers];
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
