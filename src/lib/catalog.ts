// The catalog is owned by the Rust side (see `src-tauri/src/catalog.rs`)
// and served via the `read_catalog` Tauri command. The frontend hydrates
// once at boot, then queries through the sync accessors below — keeping
// `rows.ts` and friends synchronous while the data arrives via IPC.
//
// Tests skip the IPC round-trip via `hydrateCatalogForTesting()` (wired
// from the vitest setup file).

import { invoke } from "@tauri-apps/api/core";

export interface CatalogEntry {
  key: string;
  type?: string;
  description?: string;
  enum?: unknown[];
  examples?: unknown[];
  default?: unknown;
  /** May appear on array-typed entries; describes element schema. */
  items?: unknown;
  /** Open-ended — the schema sometimes carries fields we don't model yet. */
  [extra: string]: unknown;
}

export interface SettingsCatalogFile {
  source: string;
  schemaId: string;
  fetchedAt: string;
  count: number;
  settings: CatalogEntry[];
}

export interface CatalogsWire {
  settings: SettingsCatalogFile;
  // Other catalogs are exposed for future Phase 5+ consumers; their shapes
  // aren't modeled yet because nothing in the UI reads them.
  env_vars: unknown;
  hooks: unknown;
  sub_agents: unknown;
  mcp: unknown;
}

export interface CatalogMeta {
  source: string;
  fetchedAt: string;
  totalEntries: number;
  leafCount: number;
}

interface InitializedCatalog {
  full: CatalogEntry[];
  leaf: CatalogEntry[];
  byKey: Map<string, CatalogEntry>;
  meta: CatalogMeta;
}

let _state: InitializedCatalog | null = null;

/**
 * Skip catalog entries that are *containers* — object-typed parents whose
 * children are also catalog entries (e.g. `permissions` exists alongside
 * `permissions.defaultMode`). Containers aren't directly settable, so they
 * shouldn't appear as rows. Object-typed entries with no flattened
 * children stay (e.g. `env`, where the keys are user-defined).
 */
function isContainer(entry: CatalogEntry, all: CatalogEntry[]): boolean {
  if (entry.type !== "object") return false;
  const prefix = `${entry.key}.`;
  return all.some((other) => other.key.startsWith(prefix));
}

function buildState(data: CatalogsWire): InitializedCatalog {
  const full = data.settings.settings;
  const leaf = full.filter((e) => !isContainer(e, full));
  return {
    full,
    leaf,
    byKey: new Map(leaf.map((e) => [e.key, e])),
    meta: {
      source: data.settings.source,
      fetchedAt: data.settings.fetchedAt,
      totalEntries: data.settings.count,
      leafCount: leaf.length,
    },
  };
}

/**
 * Fetch the catalog from the Rust backend. Idempotent: subsequent calls
 * are no-ops once the catalog has loaded. App.tsx awaits this before
 * gating the inspector on a populated catalog.
 */
export async function loadCatalog(): Promise<void> {
  if (_state) return;
  const data = await invoke<CatalogsWire>("read_catalog");
  _state = buildState(data);
}

/** Test-only hook to hydrate without an IPC runtime. Idempotent. */
export function hydrateCatalogForTesting(data: CatalogsWire): void {
  _state = buildState(data);
}

/** Test-only escape hatch for cases that need to assert pre-load behavior. */
export function resetCatalogForTesting(): void {
  _state = null;
}

function requireState(): InitializedCatalog {
  if (!_state) {
    throw new Error("catalog not loaded — call loadCatalog() first");
  }
  return _state;
}

/** Settable catalog entries (containers filtered out). */
export function getCatalog(): readonly CatalogEntry[] {
  return requireState().leaf;
}

export function getCatalogMeta(): CatalogMeta {
  return requireState().meta;
}

/**
 * Sibling catalog entries — same parent dot-path, immediate level only.
 * Top-level keys (no dot) have no siblings under this rule and return [].
 * Used by the drawer's related-knobs section.
 */
export function findRelatedKnobs(keyPath: string): readonly CatalogEntry[] {
  const dot = keyPath.lastIndexOf(".");
  if (dot < 0) return [];
  const prefix = keyPath.slice(0, dot + 1);
  const { full } = requireState();
  return full.filter((e) => {
    if (e.key === keyPath) return false;
    if (!e.key.startsWith(prefix)) return false;
    // Immediate siblings only — exclude nieces/nephews. We want
    // `permissions.deny` next to `permissions.allow` but not
    // `permissions.foo.bar`.
    return !e.key.slice(prefix.length).includes(".");
  });
}

/** Lookup by exact dot-path. Walks up to find the closest parent on miss. */
export function findCatalogEntry(keyPath: string): CatalogEntry | null {
  const { byKey, full } = requireState();
  const exact = byKey.get(keyPath);
  if (exact) return exact;

  // Fallback: the user set a deeper path than the catalog tracks (e.g.
  // `env.ANTHROPIC_MODEL` under the catalog's top-level `env` object).
  // The closest parent's description is more useful than nothing.
  let trimmed = keyPath;
  while (trimmed.includes(".")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf("."));
    const hit = full.find((e) => e.key === trimmed);
    if (hit) return hit;
  }
  return null;
}
