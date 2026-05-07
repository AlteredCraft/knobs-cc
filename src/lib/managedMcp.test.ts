import { describe, expect, test } from "vitest";

import type { LayerRead } from "@/types";
import { describeMcpPolicy } from "./managedMcp";

function layer(partial: Partial<LayerRead>): LayerRead {
  return {
    source: "managed",
    path: null,
    status: "missing",
    raw: null,
    error: null,
    ...partial,
  };
}

describe("describeMcpPolicy", () => {
  test("returns null when no managed mcp file is present", () => {
    expect(describeMcpPolicy(layer({ status: "missing" }))).toBeNull();
  });

  test("ok with multiple servers reports the count plurally", () => {
    const d = describeMcpPolicy(
      layer({
        status: "ok",
        path: "/Library/Application Support/ClaudeCode/managed-mcp.json",
        raw: { mcpServers: { foo: {}, bar: {}, baz: {} } },
      }),
    );
    expect(d).toMatchObject({
      state: "ok",
      label: "MCP policy · 3 servers",
      serverCount: 3,
      errorText: null,
    });
  });

  test("ok with one server uses the singular label", () => {
    const d = describeMcpPolicy(
      layer({
        status: "ok",
        path: "/x.json",
        raw: { mcpServers: { only: { command: "x" } } },
      }),
    );
    expect(d?.label).toBe("MCP policy · 1 server");
    expect(d?.serverCount).toBe(1);
  });

  test("ok without an mcpServers key reports zero, not null", () => {
    // Admin shipped an empty / placeholder file; we treat as ok-with-0 rather
    // than null because the *file* is present and clickable.
    const d = describeMcpPolicy(
      layer({
        status: "ok",
        path: "/x.json",
        raw: { unrelated: true },
      }),
    );
    expect(d?.label).toBe("MCP policy · 0 servers");
    expect(d?.serverCount).toBe(0);
  });

  test.each([
    ["raw is null", null],
    ["raw is array", [{ name: "foo" }]],
    ["mcpServers is array", { mcpServers: [{ name: "foo" }] }],
    ["mcpServers is string", { mcpServers: "not an object" }],
  ])("ok with malformed shape (%s) reports zero defensively", (_label, raw) => {
    const d = describeMcpPolicy(layer({ status: "ok", path: "/x.json", raw }));
    expect(d?.serverCount).toBe(0);
  });

  test("error keeps the error text and a clickable path", () => {
    const d = describeMcpPolicy(
      layer({
        status: "error",
        path: "/x.json",
        raw: null,
        error: "parse error: unexpected token",
      }),
    );
    expect(d).toMatchObject({
      state: "error",
      label: "MCP policy · error",
      serverCount: null,
      path: "/x.json",
      errorText: "parse error: unexpected token",
    });
  });
});
