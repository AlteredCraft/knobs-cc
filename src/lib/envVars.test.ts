import { describe, expect, it } from "vitest";
import {
  applyEnvVarChip,
  applyEnvVarFilter,
  buildEnvVarRows,
  envVarChipCounts,
  isSensitiveName,
  maskValue,
} from "./envVars";
import type { EnvVarEntry } from "./catalog";
import type { SettingsSnapshot } from "@/types";

const catalog: EnvVarEntry[] = [
  {
    name: "ANTHROPIC_API_KEY",
    purpose: "API key sent as `X-Api-Key` header.",
    default: null,
  },
  {
    name: "CLAUDE_CODE_OAUTH_TOKEN",
    purpose: "OAuth token used for authentication.",
    default: null,
  },
  {
    name: "CLAUDE_CODE_DEBUG_LOG_LEVEL",
    purpose: "Verbosity of the in-process debug log.",
    default: "info",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    purpose: "Override the default API endpoint.",
    default: null,
  },
];

function makeSnapshot(layers: SettingsSnapshot["layers"]): SettingsSnapshot {
  return {
    layers,
    effective: {},
    project_root: null,
    diagnostics: [],
    managed_mcp: { source: "managed", path: null, status: "missing", raw: null, error: null },
  };
}

describe("isSensitiveName", () => {
  it.each([
    ["ANTHROPIC_API_KEY", true],
    ["CLAUDE_CODE_OAUTH_TOKEN", true],
    ["MY_SECRET", true],
    ["DB_PASSWORD", true],
    ["api_key", true],
    ["ANTHROPIC_BASE_URL", false],
    ["CLAUDE_CODE_DEBUG_LOG_LEVEL", false],
    ["HOME", false],
  ])("%s → %s", (name, expected) => {
    expect(isSensitiveName(name)).toBe(expected);
  });
});

describe("maskValue", () => {
  it("masks long values showing the last 4 chars", () => {
    expect(maskValue("sk-ant-1234567890abcd")).toBe("•••••••• abcd");
  });

  it("fully masks short values", () => {
    expect(maskValue("short")).toBe("•••••");
  });

  it("renders at least four dots for very short values", () => {
    expect(maskValue("ab")).toBe("••••");
    expect(maskValue("")).toBe("••••");
  });
});

describe("buildEnvVarRows", () => {
  it("returns one row per catalog entry, unset by default", () => {
    const rows = buildEnvVarRows(catalog, makeSnapshot([]), {});
    expect(rows).toHaveLength(catalog.length);
    expect(rows.every((r) => r.contributors.length === 0)).toBe(true);
    expect(rows.every((r) => r.effective === null)).toBe(true);
  });

  it("flags sensitive names independent of value presence", () => {
    const rows = buildEnvVarRows(catalog, makeSnapshot([]), {});
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("ANTHROPIC_API_KEY")?.isSensitive).toBe(true);
    expect(byName.get("ANTHROPIC_BASE_URL")?.isSensitive).toBe(false);
  });

  it("records a shell contributor when the var is in process env", () => {
    const rows = buildEnvVarRows(catalog, makeSnapshot([]), {
      ANTHROPIC_API_KEY: "sk-test-001",
    });
    const row = rows.find((r) => r.name === "ANTHROPIC_API_KEY")!;
    expect(row.contributors).toEqual([
      { source: "shell", value: "sk-test-001", path: null },
    ]);
    expect(row.effective).toEqual({ value: "sk-test-001", source: "shell" });
  });

  it("records settings.json `env.<NAME>` contributors per layer", () => {
    const snap = makeSnapshot([
      {
        source: "user",
        path: "/home/u/.claude/settings.json",
        status: "ok",
        raw: { env: { ANTHROPIC_BASE_URL: "https://proxy.example.com" } },
        error: null,
      },
    ]);
    const rows = buildEnvVarRows(catalog, snap, {});
    const row = rows.find((r) => r.name === "ANTHROPIC_BASE_URL")!;
    expect(row.contributors).toEqual([
      {
        source: "user",
        value: "https://proxy.example.com",
        path: "/home/u/.claude/settings.json",
      },
    ]);
    expect(row.effective).toEqual({
      value: "https://proxy.example.com",
      source: "user",
    });
  });

  it("shell wins when both shell and settings.json supply a value", () => {
    const snap = makeSnapshot([
      {
        source: "user",
        path: "/u/.claude/settings.json",
        status: "ok",
        raw: { env: { ANTHROPIC_API_KEY: "from-settings" } },
        error: null,
      },
    ]);
    const rows = buildEnvVarRows(catalog, snap, {
      ANTHROPIC_API_KEY: "from-shell",
    });
    const row = rows.find((r) => r.name === "ANTHROPIC_API_KEY")!;
    expect(row.effective).toEqual({ value: "from-shell", source: "shell" });
    // Both sources surface as contributors so the user can see the
    // shadowed settings value too.
    expect(row.contributors).toHaveLength(2);
    expect(row.contributors[0].source).toBe("shell");
    expect(row.contributors[1].source).toBe("user");
  });

  it("orders settings contributors by precedence (managed > project > user)", () => {
    const snap = makeSnapshot([
      {
        source: "user",
        path: "/u",
        status: "ok",
        raw: { env: { ANTHROPIC_BASE_URL: "user" } },
        error: null,
      },
      {
        source: "managed",
        path: "/m",
        status: "ok",
        raw: { env: { ANTHROPIC_BASE_URL: "managed" } },
        error: null,
      },
      {
        source: "project",
        path: "/p",
        status: "ok",
        raw: { env: { ANTHROPIC_BASE_URL: "project" } },
        error: null,
      },
    ]);
    const rows = buildEnvVarRows(catalog, snap, {});
    const row = rows.find((r) => r.name === "ANTHROPIC_BASE_URL")!;
    expect(row.contributors.map((c) => c.source)).toEqual([
      "managed",
      "project",
      "user",
    ]);
    expect(row.effective?.source).toBe("managed");
  });

  it("ignores layers in error/missing status", () => {
    const snap = makeSnapshot([
      {
        source: "user",
        path: "/u",
        status: "error",
        raw: null,
        error: "parse failed",
      },
      {
        source: "project",
        path: "/p",
        status: "missing",
        raw: null,
        error: null,
      },
    ]);
    const rows = buildEnvVarRows(catalog, snap, {});
    expect(rows.every((r) => r.contributors.length === 0)).toBe(true);
  });

  it("ignores non-string env values (settings.json bug, not a contributor)", () => {
    const snap = makeSnapshot([
      {
        source: "user",
        path: "/u",
        status: "ok",
        raw: { env: { ANTHROPIC_API_KEY: 123 } },
        error: null,
      },
    ]);
    const rows = buildEnvVarRows(catalog, snap, {});
    expect(
      rows.find((r) => r.name === "ANTHROPIC_API_KEY")?.contributors,
    ).toHaveLength(0);
  });
});

describe("filtering", () => {
  const rows = buildEnvVarRows(
    catalog,
    makeSnapshot([
      {
        source: "user",
        path: "/u",
        status: "ok",
        raw: { env: { ANTHROPIC_BASE_URL: "https://proxy" } },
        error: null,
      },
    ]),
    { ANTHROPIC_API_KEY: "sk-test" },
  );

  it("counts source-wise", () => {
    const c = envVarChipCounts(rows);
    expect(c.all).toBe(catalog.length);
    expect(c.shell).toBe(1);
    expect(c.settings).toBe(1);
    expect(c.set).toBe(2);
    expect(c.unset).toBe(catalog.length - 2);
  });

  it("filters chip-wise", () => {
    expect(applyEnvVarChip(rows, "shell")).toHaveLength(1);
    expect(applyEnvVarChip(rows, "settings")).toHaveLength(1);
    expect(applyEnvVarChip(rows, "set")).toHaveLength(2);
    expect(applyEnvVarChip(rows, "unset")).toHaveLength(catalog.length - 2);
    expect(applyEnvVarChip(rows, "all")).toHaveLength(catalog.length);
  });

  it("matches name and purpose substrings, case-insensitive", () => {
    expect(applyEnvVarFilter(rows, "API_KEY")).toHaveLength(1);
    expect(applyEnvVarFilter(rows, "x-api-key")).toHaveLength(1);
    expect(applyEnvVarFilter(rows, "endpoint")).toHaveLength(1); // matches purpose of BASE_URL
    expect(applyEnvVarFilter(rows, "")).toHaveLength(catalog.length);
  });
});
