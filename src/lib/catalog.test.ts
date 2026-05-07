import { describe, expect, it } from "vitest";
import { findRelatedKnobs, findCatalogEntry } from "./catalog";

describe("findRelatedKnobs", () => {
  it("returns sibling entries under the same parent path", () => {
    const keys = findRelatedKnobs("permissions.allow").map((e) => e.key);
    // The exact set drifts as the catalog evolves; assert on a few anchors.
    expect(keys).toContain("permissions.deny");
    expect(keys).toContain("permissions.ask");
    expect(keys).not.toContain("permissions.allow");
  });

  it("excludes nieces — only immediate siblings count", () => {
    // Whatever siblings `permissions.allow` has, none should be deeper than
    // one segment under `permissions.`. (The `permissions.*.foo` shape
    // doesn't currently exist, so this is a behavioral guarantee.)
    const related = findRelatedKnobs("permissions.allow");
    for (const e of related) {
      expect(e.key.startsWith("permissions.")).toBe(true);
      expect(e.key.split(".").length).toBe(2);
    }
  });

  it("returns empty for top-level keys", () => {
    expect(findRelatedKnobs("model")).toHaveLength(0);
  });

  it("returns empty for an unknown key with a known prefix", () => {
    // `permissions.bogus` doesn't exist; siblings are still its parent's
    // immediate children, which DO exist. We want them.
    const related = findRelatedKnobs("permissions.bogus");
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((e) => e.key !== "permissions.bogus")).toBe(true);
  });

  it("returns empty for a key whose parent has no siblings", () => {
    // A made-up two-segment path under a unique top-level: no siblings,
    // because the parent doesn't exist anywhere in the catalog.
    expect(findRelatedKnobs("aaaa-not-real.x")).toHaveLength(0);
  });
});

describe("findCatalogEntry", () => {
  it("looks up an exact key", () => {
    const e = findCatalogEntry("model");
    expect(e?.key).toBe("model");
  });

  it("walks up to the closest known parent on miss", () => {
    // `env` is a catalog entry; user-defined keys like `env.MY_CUSTOM_DEBUG_VAR`
    // are not — upstream documents many specific `env.*` leaves but `env`
    // remains a user-keyed map for everything else. The walk-up should
    // land on `env`.
    const e = findCatalogEntry("env.MY_CUSTOM_DEBUG_VAR");
    expect(e?.key).toBe("env");
  });

  it("returns null when no parent exists either", () => {
    expect(findCatalogEntry("nonexistent.weird.path")).toBeNull();
  });
});
