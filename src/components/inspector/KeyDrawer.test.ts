import { describe, expect, test } from "vitest";

import { envVarNameFromKeyPath, resolveDescription } from "./KeyDrawer";
import type { Row } from "@/lib/rows";

function rowWithKey(keyPath: string, partial: Partial<Row> = {}): Row {
  // Minimal row fixture — most drawer logic only reads keyPath + catalog;
  // the rest defaults to "unset, no contributors" which exercises the
  // null-catalog branch coverage.
  return {
    keyPath,
    namespace: null,
    leaf: keyPath,
    value: undefined,
    winner: null,
    contributors: [],
    state: "unset",
    catalog: null,
    ...partial,
  };
}

describe("envVarNameFromKeyPath", () => {
  test.each([
    ["env.ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
    ["env.CLAUDE_CODE_FOO", "CLAUDE_CODE_FOO"],
    ["env.X", "X"],
    ["env._LEADING_UNDERSCORE", "_LEADING_UNDERSCORE"],
    ["env.WITH_DIGITS_42", "WITH_DIGITS_42"],
  ])("extracts the var name from %s", (keyPath, expected) => {
    expect(envVarNameFromKeyPath(keyPath)).toBe(expected);
  });

  test.each([
    // Not under env.* at all — must not match.
    ["model"],
    ["permissions.defaultMode"],
    // Lower-case: env-var convention is upper-case, and matching here
    // would lead to false catalog hits.
    ["env.lowercase"],
    // Three or more segments — env is a flat namespace; nested paths
    // aren't real env-var names.
    ["env.FOO.BAR"],
    // Var name starting with a digit — invalid POSIX env identifier.
    ["env.42_INVALID"],
    // Empty leaf.
    ["env."],
    // Adjacent prefix that isn't `env`.
    ["envoy.X"],
  ])("returns null for %s", (keyPath) => {
    expect(envVarNameFromKeyPath(keyPath)).toBeNull();
  });
});

describe("resolveDescription", () => {
  test("uses the env-var catalog purpose for a documented env.<VAR> row", () => {
    // The test setup hydrates the real env-vars catalog; ANTHROPIC_API_KEY
    // is a stable anchor. Assert structurally — the prose drifts.
    const row = rowWithKey("env.ANTHROPIC_API_KEY", {
      catalog: {
        // The walk-up gives the parent `env` catalog entry. The drawer
        // should ignore this generic prose in favor of the env-var's
        // specific purpose when an env-var match exists.
        key: "env",
        description: "Generic env-object description that should NOT be shown",
      },
    });
    const desc = resolveDescription(row);
    expect(desc).not.toBe("Generic env-object description that should NOT be shown");
    expect(desc).toMatch(/api key/i);
  });

  test("falls back to the catalog description for env vars not in the catalog", () => {
    // Users can set `env.MY_PROJECT_FOO` for arbitrary subprocess env
    // vars that the upstream env-vars catalog doesn't document. The
    // drawer should fall back to the parent `env`'s generic description.
    const row = rowWithKey("env.MY_PROJECT_NEVER_DOCUMENTED", {
      catalog: {
        key: "env",
        description: "Object of environment variables to set in subprocesses",
      },
    });
    expect(resolveDescription(row)).toBe(
      "Object of environment variables to set in subprocesses",
    );
  });

  test("uses the catalog description for non-env rows", () => {
    // The env-var override must not bleed into other namespaces.
    const row = rowWithKey("model", {
      catalog: {
        key: "model",
        description: "The model identifier",
      },
    });
    expect(resolveDescription(row)).toBe("The model identifier");
  });

  test("returns null when no catalog entry and not an env.<VAR> row", () => {
    const row = rowWithKey("totally.unknown.path");
    expect(resolveDescription(row)).toBeNull();
  });

  test("truncates a multi-line catalog description to the first line", () => {
    // Existing behavior: drawer header takes only the first line of
    // the catalog description so it fits in the header band.
    const row = rowWithKey("model", {
      catalog: {
        key: "model",
        description: "First line.\nSecond line that should not appear.",
      },
    });
    expect(resolveDescription(row)).toBe("First line.");
  });

  test("uses the permissions catalog mode description for permissions.defaultMode rows whose value is documented", () => {
    // The permissions catalog has prose richer than the settings
    // schema's mash-up of every mode in one description. When the row's
    // effective value is a cataloged mode, surface that mode's prose.
    const row = rowWithKey("permissions.defaultMode", {
      value: "acceptEdits",
      catalog: {
        key: "permissions.defaultMode",
        description: "Default permission mode.\nGeneric multi-line prose.",
      },
    });
    const desc = resolveDescription(row);
    expect(desc).not.toBe("Default permission mode.");
    expect(desc).toMatch(/edits/i);
  });

  test("falls back to the settings catalog description for permissions.defaultMode when the value is undocumented", () => {
    // `delegate` is in the settings JSON Schema enum but isn't in the
    // upstream permissions docs (experimental agent-team mode). The
    // drawer must fall back to the settings catalog's first line.
    const row = rowWithKey("permissions.defaultMode", {
      value: "delegate",
      catalog: {
        key: "permissions.defaultMode",
        description: "Default permission mode.\nGeneric multi-line prose.",
      },
    });
    expect(resolveDescription(row)).toBe("Default permission mode.");
  });

  test("uses catalog default when permissions.defaultMode row is unset", () => {
    // Unset rows carry their value from `catalog.default` (see rows.ts).
    // The cross-reference must work for the unset case too — that's the
    // common state for new users who haven't customized permissions.
    const row = rowWithKey("permissions.defaultMode", {
      value: "default",
      state: "unset",
      catalog: {
        key: "permissions.defaultMode",
        description: "Default permission mode.\nGeneric prose.",
        default: "default",
      },
    });
    const desc = resolveDescription(row);
    expect(desc).not.toBe("Default permission mode.");
    expect(desc?.length ?? 0).toBeGreaterThan(0);
  });

  test("ignores non-string values on permissions.defaultMode without throwing", () => {
    // Defensive: a malformed settings.json could put a non-string here.
    // The lookup must not crash; fall back to the settings catalog prose.
    const row = rowWithKey("permissions.defaultMode", {
      value: 42 as unknown,
      catalog: {
        key: "permissions.defaultMode",
        description: "Default permission mode.",
      },
    });
    expect(resolveDescription(row)).toBe("Default permission mode.");
  });

  test("permissions catalog override does not bleed into other permissions.* rows", () => {
    // Only `permissions.defaultMode` joins to `permissions.modes`. Other
    // permissions.* rows (allow/deny/ask/...) keep the existing
    // catalog-description behavior.
    const row = rowWithKey("permissions.allow", {
      value: ["Bash"],
      catalog: {
        key: "permissions.allow",
        description: "Tools permitted without prompting",
      },
    });
    expect(resolveDescription(row)).toBe("Tools permitted without prompting");
  });
});
