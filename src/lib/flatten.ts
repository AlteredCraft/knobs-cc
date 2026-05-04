// The backend's `effective` is a tree where:
//   - Interior nodes are plain objects (key → child).
//   - Leaves are { value: unknown, source: LayerSource } provenance wrappers.
// See spec/settings-display.md and src-tauri/src/settings.rs:114.
//
// This module flattens that tree into [{keyPath, value, winner}] rows for
// the centre pane.

import type { LayerSource } from "@/types";

export interface EffectiveLeaf {
  /** Dot-joined key path. */
  keyPath: string;
  /** The effective value at this leaf (already unwrapped). */
  value: unknown;
  /** The layer that produced the winning value. */
  winner: LayerSource;
}

function isProvenanceLeaf(
  v: unknown,
): v is { value: unknown; source: LayerSource } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  return "value" in obj && "source" in obj && typeof obj.source === "string";
}

export function flattenEffective(effective: unknown): EffectiveLeaf[] {
  const out: EffectiveLeaf[] = [];
  walk(effective, [], out);
  return out;
}

function walk(node: unknown, path: string[], out: EffectiveLeaf[]): void {
  if (isProvenanceLeaf(node)) {
    out.push({
      keyPath: path.join("."),
      value: node.value,
      winner: node.source,
    });
    return;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    // Shouldn't happen with the documented shape, but be defensive — an
    // unwrapped scalar at the root just gets emitted as an empty-path row.
    if (path.length > 0) {
      out.push({ keyPath: path.join("."), value: node, winner: "user" });
    }
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walk(v, [...path, k], out);
  }
}
