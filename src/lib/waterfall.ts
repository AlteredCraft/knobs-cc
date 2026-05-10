// Per-layer view of a single key. The drawer's waterfall renders one of
// these for every layer in precedence order — including layers that didn't
// contribute, because the absence is itself information ("env didn't
// override this even though it could have"). See inspector-ui.md:117-124.

import {
  LAYERS_IN_PRECEDENCE_ORDER,
  type LayerRead,
  type LayerSource,
  type SettingsSnapshot,
} from "@/types";
import { lookupRaw } from "./presence";
import type { Row } from "./rows";

export type WaterfallState =
  /** This layer supplied the effective value. */
  | "winner"
  /** This layer had a value but lost to a higher-precedence one. */
  | "shadowed"
  /** This layer was read successfully but did not set this key. */
  | "absent"
  /** The layer's source file is missing on disk. */
  | "missing-file"
  /** The layer's file exists but failed to parse. */
  | "error"
  /** The layer can't be inspected from outside the running claude process. */
  | "not-inspectable";

export interface WaterfallEntry {
  source: LayerSource;
  state: WaterfallState;
  /** Value at the keyPath in this layer; undefined if not set. */
  value: unknown;
  /** Path text to show under set rows (file path or empty-state copy). */
  path: string | null;
  /** Italic copy shown in the value cell when state is not winner/shadowed. */
  emptyText: string | null;
}

const ABSENT_PER_LAYER_TEXT: Partial<Record<LayerSource, string>> = {
  managed: "— no policy —",
  cli: "— not inspectable —",
  env: "— not set —",
  default: "— no catalog default —",
};

export function buildWaterfall(
  snapshot: SettingsSnapshot,
  row: Row,
): WaterfallEntry[] {
  const layersByKey = new Map(
    snapshot.layers.map((l) => [l.source, l] as const),
  );

  return LAYERS_IN_PRECEDENCE_ORDER.map((source) =>
    buildEntry(source, row, layersByKey.get(source)),
  );
}

function buildEntry(
  source: LayerSource,
  row: Row,
  layer: LayerRead | undefined,
): WaterfallEntry {
  // Production backend always emits managed (Phase 2) and env (Phase 3b),
  // so this synth fallback only fires for cli (never inspectable) and
  // default (catalog-derived). It still runs for managed/env in unit tests
  // that hand-craft a thinner snapshot.
  if (!layer) {
    return buildSynthesizedEntry(source, row);
  }

  // Real layers — file-based, may be missing or unparseable.
  if (layer.status === "missing") {
    return {
      source,
      state: "missing-file",
      value: undefined,
      path: layer.path,
      emptyText: "— file not present —",
    };
  }

  if (layer.status === "error") {
    return {
      source,
      state: "error",
      value: undefined,
      path: layer.path,
      emptyText: layer.error ?? "— parse error —",
    };
  }

  const v = lookupRaw(layer.raw, row.keyPath);
  if (v === undefined) {
    return {
      source,
      state: "absent",
      value: undefined,
      path: layer.path,
      emptyText: "— not set —",
    };
  }

  return {
    source,
    state: source === row.winner ? "winner" : "shadowed",
    value: v,
    path: layer.path,
    emptyText: null,
  };
}

function buildSynthesizedEntry(source: LayerSource, row: Row): WaterfallEntry {
  if (source === "managed" || source === "cli") {
    return {
      source,
      state: "not-inspectable",
      value: undefined,
      path: null,
      emptyText: ABSENT_PER_LAYER_TEXT[source] ?? "—",
    };
  }

  // env is a real layer now (Phase 3b) — when it doesn't appear in
  // snapshot.layers, that's a backend-side gap, not the synthesized
  // "absent" we used in Phase 1. Fall through to the default branch.

  // default — wins iff nobody else supplied a value (state === "unset").
  if (row.state === "unset") {
    return {
      source,
      state: "winner",
      value: row.value,
      path: "catalog (compiled-in)",
      emptyText: null,
    };
  }

  // Default has a catalog-declared value but is shadowed by a real layer.
  if (row.catalog && "default" in row.catalog) {
    return {
      source,
      state: "shadowed",
      value: row.catalog.default,
      path: "catalog (compiled-in)",
      emptyText: null,
    };
  }

  return {
    source,
    state: "absent",
    value: undefined,
    path: "catalog (compiled-in)",
    emptyText: ABSENT_PER_LAYER_TEXT.default ?? "—",
  };
}
