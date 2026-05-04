// The unified row model the centre pane renders. Joins the flattened
// effective tree (set keys) with the catalog (so unset rows appear too).

import type { CatalogEntry } from "./catalog";
import { CATALOG, findCatalogEntry } from "./catalog";
import { flattenEffective } from "./flatten";
import { contributorsForKey } from "./presence";
import {
  LAYERS_IN_PRECEDENCE_ORDER,
  type LayerSource,
  type SettingsSnapshot,
} from "@/types";

export type RowState = "set" | "shadowed" | "unset" | "array-merged";

export interface Row {
  keyPath: string;
  /** Namespace prefix split off so it can be dimmed in the UI. */
  namespace: string | null;
  /** Final segment of the key path. */
  leaf: string;

  /** Effective value, or `undefined` for unset rows. */
  value: unknown;
  /** Winning layer; "default" for unset rows. */
  winner: LayerSource;
  /** Layers that contributed any value (includes winner). */
  contributors: LayerSource[];

  state: RowState;
  catalog: CatalogEntry | null;
}

const PRECEDENCE_INDEX: ReadonlyMap<LayerSource, number> = new Map(
  LAYERS_IN_PRECEDENCE_ORDER.map((s, i) => [s, i] as const),
);

function splitKey(keyPath: string): { namespace: string | null; leaf: string } {
  const dot = keyPath.lastIndexOf(".");
  if (dot < 0) return { namespace: null, leaf: keyPath };
  return {
    namespace: keyPath.slice(0, dot),
    leaf: keyPath.slice(dot + 1),
  };
}

export function buildRows(snapshot: SettingsSnapshot): Row[] {
  const leaves = flattenEffective(snapshot.effective);
  const setPaths = new Set(leaves.map((l) => l.keyPath));

  const setRows: Row[] = leaves.map((leaf) => {
    const contributors = contributorsForKey(snapshot.layers, leaf.keyPath);
    const { namespace, leaf: leafName } = splitKey(leaf.keyPath);
    return {
      keyPath: leaf.keyPath,
      namespace,
      leaf: leafName,
      value: leaf.value,
      winner: leaf.winner,
      contributors,
      state: contributors.length > 1 ? "shadowed" : "set",
      catalog: findCatalogEntry(leaf.keyPath),
    };
  });

  // Unset rows: every catalog entry not covered by a set row. Some catalog
  // keys may overlap with set rows under a parent key (e.g. user sets
  // `env.FOO` but catalog has `env`). Treat any catalog key that is a
  // prefix of a set path as "covered" too — it's not truly unset.
  const setPathsAndAncestors = new Set<string>();
  for (const path of setPaths) {
    let cur = path;
    while (true) {
      setPathsAndAncestors.add(cur);
      const dot = cur.lastIndexOf(".");
      if (dot < 0) break;
      cur = cur.slice(0, dot);
    }
  }

  const unsetRows: Row[] = CATALOG.filter(
    (entry) => !setPathsAndAncestors.has(entry.key),
  ).map((entry) => {
    const { namespace, leaf: leafName } = splitKey(entry.key);
    return {
      keyPath: entry.key,
      namespace,
      leaf: leafName,
      value: entry.default,
      winner: "default",
      contributors: [],
      state: "unset",
      catalog: entry,
    };
  });

  return [...setRows, ...unsetRows];
}

// ---- Filter / sort / chip ---------------------------------------------------

export type ChipFilter = "all" | "set" | "shadowed" | "array-merged" | "unset";
export type SortMode = "precedence" | "alpha";

export function applyChip(rows: Row[], chip: ChipFilter): Row[] {
  switch (chip) {
    case "all":
      return rows;
    case "set":
      // "set" = anything actively configured by some layer (set, shadowed,
      // or array-merged). Mock count semantics: set + unset = all.
      return rows.filter((r) => r.state !== "unset");
    case "shadowed":
      return rows.filter((r) => r.state === "shadowed");
    case "array-merged":
      return rows.filter((r) => r.state === "array-merged");
    case "unset":
      return rows.filter((r) => r.state === "unset");
  }
}

/**
 * Substring match on the dot-path. A trailing `.*` is sugar for prefix
 * match, but a bare segment also matches descendants — `permissions` finds
 * `permissions.allow` etc.
 */
export function applyFilter(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const stripped = q.endsWith(".*") ? q.slice(0, -2) : q;
  return rows.filter((r) => {
    const k = r.keyPath.toLowerCase();
    return k.includes(stripped);
  });
}

export function sortRows(rows: Row[], mode: SortMode): Row[] {
  const copy = [...rows];
  if (mode === "alpha") {
    copy.sort((a, b) => a.keyPath.localeCompare(b.keyPath));
    return copy;
  }
  copy.sort((a, b) => {
    const ai = PRECEDENCE_INDEX.get(a.winner) ?? 99;
    const bi = PRECEDENCE_INDEX.get(b.winner) ?? 99;
    if (ai !== bi) return ai - bi;
    return a.keyPath.localeCompare(b.keyPath);
  });
  return copy;
}

/**
 * Given the visible rows and the current cursor key, return the next cursor
 * key after applying `delta`. Clamps at both ends. Falls back to the first
 * row when the current key isn't in `visible` (e.g. after the filter changed).
 */
export function nextCursorPath(
  visible: Row[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (visible.length === 0) return null;
  const idx = current ? visible.findIndex((r) => r.keyPath === current) : -1;
  if (idx === -1) return visible[0].keyPath;
  const next = idx + delta;
  if (next < 0) return visible[0].keyPath;
  if (next >= visible.length) return visible[visible.length - 1].keyPath;
  return visible[next].keyPath;
}

export function chipCounts(rows: Row[]): Record<ChipFilter, number> {
  const counts: Record<ChipFilter, number> = {
    all: rows.length,
    set: 0,
    shadowed: 0,
    "array-merged": 0,
    unset: 0,
  };
  for (const r of rows) {
    if (r.state !== "unset") counts.set += 1;
    if (r.state === "shadowed") counts.shadowed += 1;
    if (r.state === "array-merged") counts["array-merged"] += 1;
    if (r.state === "unset") counts.unset += 1;
  }
  return counts;
}
