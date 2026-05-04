import { describe, expect, it } from "vitest";
import {
  applyChip,
  applyFilter,
  buildRows,
  chipCounts,
  sortRows,
  type Row,
} from "./rows";
import type { LayerRead, SettingsSnapshot } from "@/types";

function ok(source: LayerRead["source"], raw: unknown): LayerRead {
  return { source, path: "/fake/path", status: "ok", raw, error: null };
}

function snapshot(
  layers: LayerRead[],
  effective: unknown,
): SettingsSnapshot {
  return { layers, effective, project_root: "/x", diagnostics: [] };
}

describe("buildRows — set vs shadowed", () => {
  it("flags a row as `set` when only one layer contributed", () => {
    const snap = snapshot(
      [ok("user", { model: "opus" })],
      { model: { value: "opus", source: "user" } },
    );
    const rows = buildRows(snap);
    const model = rows.find((r) => r.keyPath === "model");
    expect(model?.state).toBe("set");
    expect(model?.contributors).toEqual(["user"]);
    expect(model?.winner).toBe("user");
  });

  it("flags a row as `shadowed` when more than one layer contributed", () => {
    const snap = snapshot(
      [
        ok("project", { model: "opus" }),
        ok("user", { model: "sonnet" }),
      ],
      { model: { value: "opus", source: "project" } },
    );
    const rows = buildRows(snap);
    const model = rows.find((r) => r.keyPath === "model");
    expect(model?.state).toBe("shadowed");
    expect(model?.contributors).toEqual(["project", "user"]);
    expect(model?.winner).toBe("project");
  });
});

describe("buildRows — unset rows", () => {
  it("emits unset rows for catalog keys nobody touched", () => {
    const snap = snapshot([], {});
    const rows = buildRows(snap);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every((r) => r.state === "unset")).toBe(true);
  });

  it("does not emit an unset row for a catalog ancestor when a deeper key is set", () => {
    // User sets env.ANTHROPIC_MODEL → catalog `env` (parent) should NOT
    // appear as a separate unset row.
    const snap = snapshot(
      [ok("user", { env: { ANTHROPIC_MODEL: "opus" } })],
      { env: { ANTHROPIC_MODEL: { value: "opus", source: "user" } } },
    );
    const rows = buildRows(snap);
    expect(rows.find((r) => r.keyPath === "env")).toBeUndefined();
    expect(rows.find((r) => r.keyPath === "env.ANTHROPIC_MODEL")?.state).toBe("set");
  });
});

describe("buildRows — namespace split", () => {
  it("splits the last dot off as the leaf", () => {
    const snap = snapshot(
      [ok("user", { permissions: { defaultMode: "ask" } })],
      { permissions: { defaultMode: { value: "ask", source: "user" } } },
    );
    const r = buildRows(snap).find((x) => x.keyPath === "permissions.defaultMode");
    expect(r?.namespace).toBe("permissions");
    expect(r?.leaf).toBe("defaultMode");
  });

  it("leaves the leaf as the whole key when there's no dot", () => {
    const snap = snapshot(
      [ok("user", { model: "opus" })],
      { model: { value: "opus", source: "user" } },
    );
    const r = buildRows(snap).find((x) => x.keyPath === "model");
    expect(r?.namespace).toBeNull();
    expect(r?.leaf).toBe("model");
  });
});

describe("applyChip", () => {
  const fixture: Row[] = [
    row("model", "set", "user"),
    row("theme", "shadowed", "project"),
    row("apiKeyHelper", "unset", "default"),
    row("permissions.allow", "array-merged", "user"),
  ];

  it("`all` returns everything", () => {
    expect(applyChip(fixture, "all")).toHaveLength(4);
  });
  it("`set` returns everything that is not unset (set + shadowed + array-merged)", () => {
    expect(applyChip(fixture, "set").map((r) => r.keyPath)).toEqual([
      "model",
      "theme",
      "permissions.allow",
    ]);
  });
  it("`shadowed` returns only shadowed", () => {
    expect(applyChip(fixture, "shadowed").map((r) => r.keyPath)).toEqual(["theme"]);
  });
  it("`unset` returns only unset", () => {
    expect(applyChip(fixture, "unset").map((r) => r.keyPath)).toEqual(["apiKeyHelper"]);
  });
  it("`array-merged` returns only array-merged", () => {
    expect(applyChip(fixture, "array-merged").map((r) => r.keyPath)).toEqual([
      "permissions.allow",
    ]);
  });
});

describe("applyFilter", () => {
  const rows: Row[] = [
    row("model", "set", "user"),
    row("permissions.allow", "set", "user"),
    row("permissions.deny", "set", "user"),
    row("env.ANTHROPIC_MODEL", "set", "user"),
  ];

  it("returns everything for an empty query", () => {
    expect(applyFilter(rows, "")).toHaveLength(4);
  });

  it("substring matches on the dot path", () => {
    expect(applyFilter(rows, "deny").map((r) => r.keyPath)).toEqual([
      "permissions.deny",
    ]);
  });

  it("a bare namespace prefix matches descendants", () => {
    expect(applyFilter(rows, "permissions").map((r) => r.keyPath)).toEqual([
      "permissions.allow",
      "permissions.deny",
    ]);
  });

  it("trailing .* is treated as the prefix", () => {
    expect(applyFilter(rows, "permissions.*").map((r) => r.keyPath)).toEqual([
      "permissions.allow",
      "permissions.deny",
    ]);
  });

  it("is case-insensitive", () => {
    expect(applyFilter(rows, "ANTHROPIC")).toHaveLength(1);
    expect(applyFilter(rows, "anthropic")).toHaveLength(1);
  });
});

describe("sortRows", () => {
  it("alpha sorts by keyPath", () => {
    const rows: Row[] = [
      row("zeta", "set", "user"),
      row("alpha", "set", "user"),
    ];
    expect(sortRows(rows, "alpha").map((r) => r.keyPath)).toEqual(["alpha", "zeta"]);
  });

  it("precedence sorts by winner's layer position, then alpha", () => {
    const rows: Row[] = [
      row("u1", "set", "user"),
      row("p1", "set", "project"),
      row("u0", "set", "user"),
      row("d1", "unset", "default"),
    ];
    // project is higher precedence than user, which is higher than default
    expect(sortRows(rows, "precedence").map((r) => r.keyPath)).toEqual([
      "p1",
      "u0",
      "u1",
      "d1",
    ]);
  });
});

describe("chipCounts", () => {
  it("counts rows by state — set = anything not unset, so set + unset === all", () => {
    const rows: Row[] = [
      row("a", "set", "user"),
      row("b", "shadowed", "project"),
      row("c", "shadowed", "user"),
      row("d", "unset", "default"),
      row("e", "array-merged", "user"),
    ];
    expect(chipCounts(rows)).toEqual({
      all: 5,
      set: 4, // a + b + c + e
      shadowed: 2,
      "array-merged": 1,
      unset: 1,
    });
  });
});

// ---- helpers ---------------------------------------------------------------

function row(
  keyPath: string,
  state: Row["state"],
  winner: Row["winner"],
): Row {
  return {
    keyPath,
    namespace: keyPath.includes(".") ? keyPath.split(".").slice(0, -1).join(".") : null,
    leaf: keyPath.split(".").pop()!,
    value: undefined,
    winner,
    contributors: state === "shadowed" ? [winner, "user"] : [winner],
    state,
    catalog: null,
  };
}
