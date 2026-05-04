import { describe, expect, it } from "vitest";
import { contributorsForKey, lookupRaw } from "./presence";
import type { LayerRead } from "@/types";

function ok(source: LayerRead["source"], raw: unknown): LayerRead {
  return { source, path: "/fake/path", status: "ok", raw, error: null };
}

describe("lookupRaw", () => {
  it("returns the value at a top-level key", () => {
    expect(lookupRaw({ model: "opus" }, "model")).toBe("opus");
  });
  it("walks nested objects via the dot path", () => {
    expect(
      lookupRaw({ permissions: { defaultMode: "ask" } }, "permissions.defaultMode"),
    ).toBe("ask");
  });
  it("returns undefined when any segment is absent", () => {
    expect(lookupRaw({ permissions: {} }, "permissions.defaultMode")).toBeUndefined();
  });
  it("returns undefined when traversing through a non-object", () => {
    expect(lookupRaw({ permissions: "auto" }, "permissions.defaultMode")).toBeUndefined();
  });
  it("treats arrays as opaque, not traversable", () => {
    expect(lookupRaw({ list: [1, 2] }, "list.0")).toBeUndefined();
  });
});

describe("contributorsForKey", () => {
  it("returns layers that have a value at the key in precedence order", () => {
    const layers: LayerRead[] = [
      ok("project_local", { model: "haiku" }),
      ok("project", { model: "opus" }),
      ok("user", { model: "sonnet" }),
    ];
    expect(contributorsForKey(layers, "model")).toEqual([
      "project_local",
      "project",
      "user",
    ]);
  });

  it("excludes layers that don't set the key", () => {
    const layers: LayerRead[] = [
      ok("project_local", { theme: "dark" }),
      ok("user", { model: "opus" }),
    ];
    expect(contributorsForKey(layers, "model")).toEqual(["user"]);
  });

  it("ignores layers with status !== ok", () => {
    const layers: LayerRead[] = [
      { source: "project", path: "/x", status: "error", raw: null, error: "bad" },
      { source: "user", path: "/y", status: "missing", raw: null, error: null },
      ok("project_local", { model: "haiku" }),
    ];
    expect(contributorsForKey(layers, "model")).toEqual(["project_local"]);
  });
});
