// Build the row model for the EnvVarsPanel — one row per cataloged env
// var, joining shell-set values with `settings.json` `env.*`
// contributions (per layer). The panel's primary purpose is answering
// "what env vars from the upstream catalog is Claude Code seeing right
// now, and where did each value come from?".
//
// This is orthogonal to the inspector's `env` precedence layer, which
// projects 8 mapped env vars onto settings keys. Here every cataloged
// env var is in scope (220 at time of writing), regardless of whether
// it has a settings-key equivalent.

import { invoke } from "@tauri-apps/api/core";
import type { EnvVarEntry } from "./catalog";
import type { LayerRead, LayerSource, SettingsSnapshot } from "@/types";
import { LAYERS_IN_PRECEDENCE_ORDER } from "@/types";

/** Source that contributed a value for a given env var. */
export type EnvVarSource = "shell" | LayerSource;

export interface EnvVarContributor {
  /** "shell" = process env; otherwise a settings layer that has `env.<NAME>`. */
  source: EnvVarSource;
  value: string;
  /** File path for settings layers; null for shell. */
  path: string | null;
}

export interface EnvVarRow {
  name: string;
  /** Catalog `purpose` prose (markdown). Empty for non-catalog rows. */
  purpose: string;
  /** Catalog default; null when not documented. */
  default: string | null;
  /** All contributors in precedence order (shell first if set). */
  contributors: EnvVarContributor[];
  /** Effective value & winning source; null when nothing set anywhere. */
  effective: { value: string; source: EnvVarSource } | null;
  /** True when the name pattern-matches as secret-bearing. */
  isSensitive: boolean;
  /**
   * True when the user set this `env.<NAME>` in `settings.json` but
   * the name isn't documented in the upstream env-vars catalog. These
   * rows live at the top of the panel as a separate group — they're
   * the highest-signal entries (explicit user intent that's invisible
   * everywhere else) and lack the `purpose` prose other rows carry.
   */
  isNonCatalog: boolean;
}

/**
 * Heuristic: env-var names containing key/token/secret/password (case-
 * insensitive) hold values worth masking by default in a UI users may
 * screenshare. Click-to-reveal recovers the value when the user wants
 * to sanity-check it. We deliberately keep this list short — broader
 * patterns (e.g. AUTH) would mask URLs and other non-secret strings.
 */
const SENSITIVE_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

/**
 * Mask the middle of a value, showing the last 4 chars (or the whole
 * string when ≤8 chars — masking a short value reveals nothing useful
 * and confuses sanity-checks). Used by the panel for the masked view;
 * fully revealed via click.
 */
export function maskValue(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  const tail = value.slice(-4);
  return `${"•".repeat(8)} ${tail}`;
}

/**
 * Pull the `env.<NAME>` value out of a layer's raw settings tree. Returns
 * null when the layer didn't set this var, when raw isn't an object, or
 * when the value isn't a string (env values are always strings — a
 * non-string under `env.<NAME>` is a settings.json bug).
 */
function envValueFromLayer(layer: LayerRead, name: string): string | null {
  if (layer.status !== "ok") return null;
  if (typeof layer.raw !== "object" || layer.raw === null) return null;
  const env = (layer.raw as Record<string, unknown>).env;
  if (typeof env !== "object" || env === null) return null;
  const v = (env as Record<string, unknown>)[name];
  return typeof v === "string" ? v : null;
}

/**
 * Build one EnvVarRow per catalog entry. Caller supplies the catalog
 * (so this stays pure / testable without hydrating the global) and the
 * snapshot of layers + the shell-env map from `read_shell_env_vars`.
 *
 * Precedence for the effective value: shell wins over settings.json. This
 * matches Claude Code's documented behavior — vars set in the shell are
 * exported into the process before settings.json is read, and settings'
 * `env` is *injected into* the launched process, not vice versa. The two
 * routes converge on the same process-env, with shell taking priority
 * when both are set on the same name.
 */
export function buildEnvVarRows(
  catalog: readonly EnvVarEntry[],
  snapshot: SettingsSnapshot,
  shellEnv: Readonly<Record<string, string>>,
): EnvVarRow[] {
  const layersByName = new Map(
    snapshot.layers.map((l) => [l.source, l] as const),
  );

  const buildContributors = (name: string): EnvVarContributor[] => {
    const contributors: EnvVarContributor[] = [];
    const shellValue = shellEnv[name];
    if (shellValue !== undefined) {
      contributors.push({ source: "shell", value: shellValue, path: null });
    }
    for (const source of LAYERS_IN_PRECEDENCE_ORDER) {
      const layer = layersByName.get(source);
      if (!layer) continue;
      const v = envValueFromLayer(layer, name);
      if (v !== null) {
        contributors.push({ source, value: v, path: layer.path });
      }
    }
    return contributors;
  };

  const catalogNames = new Set(catalog.map((e) => e.name));

  // Catalog rows — one per documented env var, set or unset.
  const catalogRows: EnvVarRow[] = catalog.map((entry) => {
    const contributors = buildContributors(entry.name);
    return {
      name: entry.name,
      purpose: entry.purpose,
      default: entry.default,
      contributors,
      effective: contributors[0]
        ? { value: contributors[0].value, source: contributors[0].source }
        : null,
      isSensitive: isSensitiveName(entry.name),
      isNonCatalog: false,
    };
  });

  // Non-catalog rows — names users set under `env.<NAME>` in settings.json
  // that aren't in the upstream catalog. We deliberately ignore non-
  // catalog names from the *shell* (a user's shell carries hundreds of
  // unrelated vars: PATH, HOME, etc.) and surface only what was explicit
  // user-intent in settings.json.
  const nonCatalogNames = new Set<string>();
  for (const layer of snapshot.layers) {
    if (layer.status !== "ok") continue;
    if (typeof layer.raw !== "object" || layer.raw === null) continue;
    const env = (layer.raw as Record<string, unknown>).env;
    if (typeof env !== "object" || env === null) continue;
    for (const [name, value] of Object.entries(env)) {
      if (catalogNames.has(name)) continue;
      if (typeof value !== "string") continue;
      nonCatalogNames.add(name);
    }
  }

  const nonCatalogRows: EnvVarRow[] = [...nonCatalogNames]
    .sort()
    .map((name) => {
      const contributors = buildContributors(name);
      return {
        name,
        purpose: "",
        default: null,
        contributors,
        effective: contributors[0]
          ? { value: contributors[0].value, source: contributors[0].source }
          : null,
        isSensitive: isSensitiveName(name),
        isNonCatalog: true,
      };
    });

  // Non-catalog first — they're the highest-signal entries: explicit
  // user intent that wouldn't show up anywhere else in the app.
  return [...nonCatalogRows, ...catalogRows];
}

// ---- Filter / search --------------------------------------------------------

export type EnvVarChip = "all" | "set" | "shell" | "settings" | "unset";

export function applyEnvVarChip(
  rows: EnvVarRow[],
  chip: EnvVarChip,
): EnvVarRow[] {
  switch (chip) {
    case "all":
      return rows;
    case "set":
      return rows.filter((r) => r.contributors.length > 0);
    case "shell":
      return rows.filter((r) =>
        r.contributors.some((c) => c.source === "shell"),
      );
    case "settings":
      return rows.filter((r) =>
        r.contributors.some((c) => c.source !== "shell"),
      );
    case "unset":
      return rows.filter((r) => r.contributors.length === 0);
  }
}

/** Substring match on name OR purpose prose. Lowercased on both sides. */
export function applyEnvVarFilter(
  rows: EnvVarRow[],
  query: string,
): EnvVarRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.purpose.toLowerCase().includes(q),
  );
}

export function envVarChipCounts(rows: EnvVarRow[]): Record<EnvVarChip, number> {
  const counts: Record<EnvVarChip, number> = {
    all: rows.length,
    set: 0,
    shell: 0,
    settings: 0,
    unset: 0,
  };
  for (const r of rows) {
    if (r.contributors.length === 0) {
      counts.unset += 1;
      continue;
    }
    counts.set += 1;
    if (r.contributors.some((c) => c.source === "shell")) counts.shell += 1;
    if (r.contributors.some((c) => c.source !== "shell")) counts.settings += 1;
  }
  return counts;
}

// ---- IPC --------------------------------------------------------------------

/**
 * Fetch the current shell env, filtered to catalog names. Wraps the
 * Tauri command so callers don't import `invoke` directly. Errors
 * propagate — App.tsx's existing snapshot error UI handles the cold
 * start; subsequent failures route through the in-app error log via
 * the panel's load handler.
 */
export async function readShellEnvVars(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("read_shell_env_vars");
}
