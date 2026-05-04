import { describe, expect, it } from "vitest";
import { flattenEffective } from "./flatten";

describe("flattenEffective", () => {
  it("emits a row for a single top-level provenance leaf", () => {
    const out = flattenEffective({
      model: { value: "opus", source: "user" },
    });
    expect(out).toEqual([
      { keyPath: "model", value: "opus", winner: "user" },
    ]);
  });

  it("walks nested objects and joins paths with dots", () => {
    const out = flattenEffective({
      permissions: {
        defaultMode: { value: "ask", source: "project" },
        allow: { value: ["a", "b"], source: "user" },
      },
    });
    expect(out).toContainEqual({
      keyPath: "permissions.defaultMode",
      value: "ask",
      winner: "project",
    });
    expect(out).toContainEqual({
      keyPath: "permissions.allow",
      value: ["a", "b"],
      winner: "user",
    });
    expect(out).toHaveLength(2);
  });

  it("treats arrays at the leaf as the value, not as a tree to walk", () => {
    const out = flattenEffective({
      list: { value: [1, 2, 3], source: "project_local" },
    });
    expect(out).toEqual([
      { keyPath: "list", value: [1, 2, 3], winner: "project_local" },
    ]);
  });

  it("returns an empty array for an empty effective tree", () => {
    expect(flattenEffective({})).toEqual([]);
  });

  it("preserves null leaf values", () => {
    const out = flattenEffective({
      apiKeyHelper: { value: null, source: "user" },
    });
    expect(out).toEqual([
      { keyPath: "apiKeyHelper", value: null, winner: "user" },
    ]);
  });
});
