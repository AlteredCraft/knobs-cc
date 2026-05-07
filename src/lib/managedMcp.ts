import type { LayerRead } from "@/types";

/**
 * What to show in the topbar pill for the managed-mcp.json sibling read.
 *
 * Returns `null` when the file isn't present — the typical user has no
 * admin-shipped MCP policy and shouldn't see a "0 servers" pill cluttering
 * the topbar. The pill only appears when there's actually something to
 * surface (an admin shipped a policy, possibly broken).
 */
export interface McpPolicyDescriptor {
  state: "ok" | "error";
  label: string;
  serverCount: number | null;
  path: string | null;
  errorText: string | null;
}

export function describeMcpPolicy(layer: LayerRead): McpPolicyDescriptor | null {
  if (layer.status === "missing") return null;

  if (layer.status === "error") {
    return {
      state: "error",
      label: "MCP policy · error",
      serverCount: null,
      path: layer.path,
      errorText: layer.error,
    };
  }

  const serverCount = countMcpServers(layer.raw);
  return {
    state: "ok",
    label: serverCount === 1 ? "MCP policy · 1 server" : `MCP policy · ${serverCount} servers`,
    serverCount,
    path: layer.path,
    errorText: null,
  };
}

/**
 * Count keys under `mcpServers` defensively. The shape is documented in
 * inventory.md §B (managed-mcp.json) but admins can ship anything; we
 * tolerate the file existing without that key (count = 0) without throwing.
 */
function countMcpServers(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const obj = raw as Record<string, unknown>;
  const servers = obj.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return 0;
  return Object.keys(servers as Record<string, unknown>).length;
}
