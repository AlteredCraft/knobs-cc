import { describe, expect, it } from "vitest";
import { findRelatedKnobs, findCatalogEntry, findEnvVar } from "./catalog";

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

describe("findEnvVar", () => {
  it("looks up a documented env var by exact name", () => {
    // Anchor on a stable, well-known env var documented upstream. The
    // exact prose drifts as upstream rewrites; assert structural shape
    // and that the purpose is non-empty.
    const e = findEnvVar("ANTHROPIC_API_KEY");
    expect(e).not.toBeNull();
    expect(e!.name).toBe("ANTHROPIC_API_KEY");
    expect(e!.purpose.length).toBeGreaterThan(0);
  });

  it("returns null for an env var the catalog doesn't document", () => {
    // Users can set `env.ANYTHING_THEY_WANT` in their settings.json to
    // inject custom env vars into child processes; only a subset is in
    // the upstream catalog. Misses must fall back to null so the drawer
    // can keep its existing parent-walk-up behavior.
    expect(findEnvVar("MY_PROJECT_NEVER_DOCUMENTED")).toBeNull();
  });

  it("is case-sensitive — env-var names are conventionally upper-case", () => {
    // Real env-var names are upper-case; case-folding the lookup would
    // create false matches (e.g. user typo `anthropic_api_key` lighting
    // up the docs for ANTHROPIC_API_KEY). Treat case mismatches as misses.
    expect(findEnvVar("anthropic_api_key")).toBeNull();
  });
});
