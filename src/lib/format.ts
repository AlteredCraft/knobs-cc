// Display formatting for effective values in the centre pane. The list cell
// is small and gets text-overflow:ellipsis from CSS, so we don't truncate
// strings here — only summarise containers.

import { formatHooksValue } from "./hooks";

export interface FormattedValue {
  /** What to render. */
  text: string;
  /** Tags the row's value cell so it can pick up a colour treatment. */
  kind: "string" | "number" | "boolean" | "null" | "array" | "object" | "unset";
}

/**
 * KeyPath-aware formatter. For rows whose path encodes structured
 * data the generic `formatValue` can't summarise usefully (today: a
 * `hooks.<EventName>` matcher-group array), substitute a domain-
 * specific preview. Everything else falls through to the generic
 * formatter unchanged. Used by every surface that renders a row's
 * effective value (settings list, drawer header, waterfall) so the
 * preview stays consistent.
 */
export function formatValueForKey(
  keyPath: string,
  value: unknown,
): FormattedValue {
  if (isHookEventKey(keyPath) && Array.isArray(value)) {
    return { text: formatHooksValue(value), kind: "array" };
  }
  return formatValue(value);
}

function isHookEventKey(keyPath: string): boolean {
  // PascalCase leaf under literal `hooks` — same shape as
  // `hookEventNameFromKeyPath` in KeyDrawer, kept inline to avoid a
  // back-edge from lib → components.
  return /^hooks\.[A-Z][A-Za-z0-9]*$/.test(keyPath);
}

export function formatValue(value: unknown): FormattedValue {
  if (value === undefined) {
    return { text: "— unset —", kind: "unset" };
  }
  if (value === null) {
    return { text: "null", kind: "null" };
  }
  if (typeof value === "string") {
    return { text: JSON.stringify(value), kind: "string" };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), kind: typeof value === "number" ? "number" : "boolean" };
  }
  if (Array.isArray(value)) {
    const previewElements = value.slice(0, 3).map((v) => previewLeaf(v));
    const ellipsis = value.length > 3 ? ", …" : "";
    return {
      text: `[${value.length}] ${previewElements.join(", ")}${ellipsis}`,
      kind: "array",
    };
  }
  if (typeof value === "object") {
    const keyCount = Object.keys(value as object).length;
    return {
      text: keyCount === 0 ? "{}" : `{${keyCount} key${keyCount === 1 ? "" : "s"}}`,
      kind: "object",
    };
  }
  return { text: String(value), kind: "string" };
}

function previewLeaf(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}
