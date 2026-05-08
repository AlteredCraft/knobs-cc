import { describe, expect, test } from "vitest";

import {
  envVarNameFromKeyPath,
  resolveDescription,
  resolveValueAnnotation,
} from "./KeyDrawer";
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

  test("keeps the generic settings catalog description for permissions.defaultMode regardless of value", () => {
    // The mode-specific prose moved out of the header — it's value-
    // conditional and belongs under the EFFECTIVE block. The header
    // describes the knob itself, not its current value.
    const row = rowWithKey("permissions.defaultMode", {
      value: "acceptEdits",
      catalog: {
        key: "permissions.defaultMode",
        description: "Default permission mode.\nGeneric multi-line prose.",
      },
    });
    expect(resolveDescription(row)).toBe("Default permission mode.");
  });
});

describe("resolveValueAnnotation", () => {
  test("returns the cataloged mode description for permissions.defaultMode when the value is documented", () => {
    // The annotation surfaces what the current *value* does, not what
    // the knob does. Anchor on `acceptEdits` — its prose is stable.
    const row = rowWithKey("permissions.defaultMode", { value: "acceptEdits" });
    const anno = resolveValueAnnotation(row);
    expect(anno).not.toBeNull();
    expect(anno).toMatch(/edits/i);
  });

  test("returns null for permissions.defaultMode when the value is undocumented", () => {
    // `delegate` is in the JSON Schema enum but not in the upstream
    // permissions docs. Don't render an annotation — the alternative is
    // misleading prose.
    const row = rowWithKey("permissions.defaultMode", { value: "delegate" });
    expect(resolveValueAnnotation(row)).toBeNull();
  });

  test("fires for unset permissions.defaultMode rows whose value is the catalog default", () => {
    // Unset rows carry value from `catalog.default` (see rows.ts). The
    // unset case is the common state for new users; the annotation
    // should still help them understand what the default actually does.
    const row = rowWithKey("permissions.defaultMode", {
      value: "default",
      state: "unset",
      catalog: { key: "permissions.defaultMode", default: "default" },
    });
    const anno = resolveValueAnnotation(row);
    expect(anno).not.toBeNull();
    expect(anno!.length).toBeGreaterThan(0);
  });

  test("returns null for non-string values without throwing", () => {
    // Defensive: malformed settings.json could put a non-string here.
    const row = rowWithKey("permissions.defaultMode", { value: 42 as unknown });
    expect(resolveValueAnnotation(row)).toBeNull();
  });

  test("returns null for any other keyPath", () => {
    // Only permissions.defaultMode joins to permissions.modes today.
    // Other permissions.* rows (allow / deny / ask / ...) and unrelated
    // rows must not get an annotation.
    expect(
      resolveValueAnnotation(rowWithKey("permissions.allow", { value: ["Bash"] })),
    ).toBeNull();
    expect(
      resolveValueAnnotation(rowWithKey("model", { value: "claude-sonnet-4-6" })),
    ).toBeNull();
    expect(
      resolveValueAnnotation(rowWithKey("env.ANTHROPIC_API_KEY", { value: "sk-x" })),
    ).toBeNull();
  });

  test("preserves the full multi-line description (no first-line truncation)", () => {
    // The annotation lives in a block of its own under EFFECTIVE, not
    // a single-line header band. Keep the full prose so the user sees
    // qualifiers like 'Currently a research preview' that follow on
    // later lines if upstream ever adds them.
    const row = rowWithKey("permissions.defaultMode", { value: "auto" });
    const anno = resolveValueAnnotation(row);
    // Real catalog prose for `auto` includes a second clause that the
    // header would have truncated; assert structurally — the prose drifts.
    expect(anno).not.toBeNull();
    expect(anno!.length).toBeGreaterThan(40);
  });
});
