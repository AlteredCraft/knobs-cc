// For each effective key, work out which raw layers actually had a value
// at that path. The backend's `effective` only carries the winner's source;
// shadowing detection lives on the frontend by walking each `LayerRead.raw`.

import type { LayerRead, LayerSource } from "@/types";

/** Returns the value at the dot-path, or `undefined` if any segment is missing. */
export function lookupRaw(raw: unknown, keyPath: string): unknown {
  if (raw === null || typeof raw !== "object") return undefined;
  let cur: unknown = raw;
  for (const seg of keyPath.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Layers that supplied any value at this keyPath, in precedence order. */
export function contributorsForKey(
  layers: LayerRead[],
  keyPath: string,
): LayerSource[] {
  const out: LayerSource[] = [];
  for (const layer of layers) {
    if (layer.status !== "ok" || layer.raw === null) continue;
    if (lookupRaw(layer.raw, keyPath) !== undefined) {
      out.push(layer.source);
    }
  }
  return out;
}
