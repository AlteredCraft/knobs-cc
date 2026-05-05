// The backend's `effective` is a tree where:
//   - Interior nodes are plain objects (key → child).
//   - Leaves are provenance wrappers with one of two shapes:
//       last-wins:  { value, source: LayerSource }
//       array-merged: { value: unknown[], source: null,
//                       elements: { value, source }[] }
// See spec/settings-display.md and src-tauri/src/settings.rs.
//
// This module flattens that tree into [{keyPath, value, winner, elements?}]
// rows for the centre pane.

import type { LayerSource } from "@/types";

export interface ArrayMergedElement {
  value: unknown;
  source: LayerSource;
}

export interface EffectiveLeaf {
  /** Dot-joined key path. */
  keyPath: string;
  /** The effective value at this leaf (already unwrapped). */
  value: unknown;
  /** The layer that produced the winning value, or null for array-merged. */
  winner: LayerSource | null;
  /** Per-element source list; only set on array-merged leaves. */
  elements?: ArrayMergedElement[];
}

interface ProvenanceLeaf {
  value: unknown;
  source: LayerSource | null;
  elements?: ArrayMergedElement[];
}

function isProvenanceLeaf(v: unknown): v is ProvenanceLeaf {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  if (!("value" in obj) || !("source" in obj)) return false;
  // source is either a LayerSource string or null (array-merged leaves).
  return obj.source === null || typeof obj.source === "string";
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
      elements: node.elements,
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
