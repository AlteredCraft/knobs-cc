import { describe, expect, it } from "vitest";
import { buildWaterfall } from "./waterfall";
import type { LayerRead, SettingsSnapshot } from "@/types";
import type { Row } from "./rows";

function ok(source: LayerRead["source"], raw: unknown): LayerRead {
  return { source, path: `/fake/${source}.json`, status: "ok", raw, error: null };
}

function snapshot(layers: LayerRead[]): SettingsSnapshot {
  return { layers, effective: {}, project_root: "/x", diagnostics: [] };
}

function row(partial: Partial<Row> & Pick<Row, "keyPath" | "winner" | "state">): Row {
  return {
    namespace: null,
    leaf: partial.keyPath,
    value: undefined,
    contributors: [],
    catalog: null,
    ...partial,
  };
}

describe("buildWaterfall", () => {
  it("emits exactly 7 entries in precedence order", () => {
    const snap = snapshot([ok("user", { model: "opus" })]);
    const r = row({
      keyPath: "model",
      winner: "user",
      value: "opus",
      state: "set",
      contributors: ["user"],
    });
    const entries = buildWaterfall(snap, r);
    expect(entries.map((e) => e.source)).toEqual([
      "managed",
      "cli",
      "env",
      "project_local",
      "project",
      "user",
      "default",
    ]);
  });

  it("flags the winning layer and tags lower contributors as shadowed", () => {
    const snap = snapshot([
      ok("project", { model: "opus" }),
      ok("user", { model: "sonnet" }),
    ]);
    const r = row({
      keyPath: "model",
      winner: "project",
      value: "opus",
      state: "shadowed",
      contributors: ["project", "user"],
    });
    const entries = buildWaterfall(snap, r);

    const project = entries.find((e) => e.source === "project")!;
    const user = entries.find((e) => e.source === "user")!;
    expect(project.state).toBe("winner");
    expect(project.value).toBe("opus");
    expect(user.state).toBe("shadowed");
    expect(user.value).toBe("sonnet");
  });

  it("marks layers that read ok but didn't set the key as absent", () => {
    const snap = snapshot([ok("user", { theme: "dark" })]);
    const r = row({
      keyPath: "model",
      winner: "default",
      value: undefined,
      state: "unset",
    });
    const user = buildWaterfall(snap, r).find((e) => e.source === "user")!;
    expect(user.state).toBe("absent");
    expect(user.emptyText).toMatch(/not set/);
  });

  it("propagates missing-file and error states from LayerRead", () => {
    const snap: SettingsSnapshot = {
      layers: [
        { source: "user", path: "/u", status: "missing", raw: null, error: null },
        { source: "project", path: "/p", status: "error", raw: null, error: "bad json" },
      ],
      effective: {},
      project_root: "/x",
      diagnostics: [],
    };
    const r = row({ keyPath: "model", winner: "default", value: undefined, state: "unset" });
    const entries = buildWaterfall(snap, r);
    expect(entries.find((e) => e.source === "user")?.state).toBe("missing-file");
    expect(entries.find((e) => e.source === "project")?.state).toBe("error");
    expect(entries.find((e) => e.source === "project")?.emptyText).toBe("bad json");
  });

  it("synthesizes managed and cli as not-inspectable", () => {
    const snap = snapshot([]);
    const r = row({ keyPath: "model", winner: "default", value: undefined, state: "unset" });
    const entries = buildWaterfall(snap, r);
    expect(entries.find((e) => e.source === "managed")?.state).toBe("not-inspectable");
    expect(entries.find((e) => e.source === "cli")?.state).toBe("not-inspectable");
  });

  it("default wins for unset rows and shows the catalog default", () => {
    const r = row({
      keyPath: "cleanupPeriodDays",
      winner: "default",
      value: 30,
      state: "unset",
      catalog: { key: "cleanupPeriodDays", type: "number", default: 30 },
    });
    const entries = buildWaterfall(snapshot([]), r);
    const dflt = entries.find((e) => e.source === "default")!;
    expect(dflt.state).toBe("winner");
    expect(dflt.value).toBe(30);
  });

  it("default is shadowed when a real layer sets the key (and catalog has a default)", () => {
    const snap = snapshot([ok("user", { cleanupPeriodDays: 90 })]);
    const r = row({
      keyPath: "cleanupPeriodDays",
      winner: "user",
      value: 90,
      state: "set",
      contributors: ["user"],
      catalog: { key: "cleanupPeriodDays", type: "number", default: 30 },
    });
    const dflt = buildWaterfall(snap, r).find((e) => e.source === "default")!;
    expect(dflt.state).toBe("shadowed");
    expect(dflt.value).toBe(30);
  });

  it("default is absent when the catalog has no declared default", () => {
    const snap = snapshot([ok("user", { model: "opus" })]);
    const r = row({
      keyPath: "model",
      winner: "user",
      value: "opus",
      state: "set",
      contributors: ["user"],
      catalog: { key: "model", type: "string" },
    });
    const dflt = buildWaterfall(snap, r).find((e) => e.source === "default")!;
    expect(dflt.state).toBe("absent");
  });
});
