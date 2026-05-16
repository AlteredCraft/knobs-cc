import { describe, expect, test } from "vitest";

import {
  formatHooksValue,
  parseMatcherGroups,
  summarizeMatcherGroup,
} from "./hooks";

describe("parseMatcherGroups", () => {
  test("parses a well-formed PreToolUse-shaped value", () => {
    const groups = parseMatcherGroups([
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "echo hi", timeout: 5 },
          { type: "http", url: "https://example.com/hook" },
        ],
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matcher).toBe("Bash");
    expect(groups[0].handlers).toHaveLength(2);
    expect(groups[0].handlers[0]).toMatchObject({
      type: "command",
      implPreview: "echo hi",
    });
    expect(groups[0].handlers[1]).toMatchObject({
      type: "http",
      implPreview: "https://example.com/hook",
    });
  });

  test("returns null matcher when the field is missing or empty", () => {
    const groups = parseMatcherGroups([
      { hooks: [{ type: "command", command: "x" }] },
      { matcher: "", hooks: [{ type: "command", command: "y" }] },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].matcher).toBeNull();
    expect(groups[1].matcher).toBeNull();
  });

  test("treats missing or non-array `hooks` field as empty handlers", () => {
    const groups = parseMatcherGroups([
      { matcher: "Bash" },
      { matcher: "Edit", hooks: "not-an-array" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].handlers).toEqual([]);
    expect(groups[1].handlers).toEqual([]);
  });

  test("skips non-object entries in the matcher-group array", () => {
    // A typo in the user's JSON should not drop everything after it.
    const groups = parseMatcherGroups([
      "garbage",
      null,
      42,
      { matcher: "Bash", hooks: [{ type: "command", command: "valid" }] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].matcher).toBe("Bash");
  });

  test("skips non-object handler entries", () => {
    const groups = parseMatcherGroups([
      {
        matcher: "Bash",
        hooks: ["string-handler", null, { type: "command", command: "ok" }],
      },
    ]);
    expect(groups[0].handlers).toHaveLength(1);
    expect(groups[0].handlers[0].type).toBe("command");
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["object root", { matcher: "Bash" }],
    ["string root", "hooks-as-string"],
    ["number root", 42],
  ])("returns [] for non-array root (%s)", (_label, value) => {
    expect(parseMatcherGroups(value)).toEqual([]);
  });

  test("assigns 'unknown' type when the handler has no type field", () => {
    const groups = parseMatcherGroups([
      { matcher: "x", hooks: [{ command: "echo no-type" }] },
    ]);
    expect(groups[0].handlers[0].type).toBe("unknown");
    // The fallback picks the first string field that isn't `type`.
    expect(groups[0].handlers[0].implPreview).toBe("echo no-type");
  });

  test("mcp_tool handler combines server and tool fields", () => {
    const groups = parseMatcherGroups([
      {
        matcher: "x",
        hooks: [{ type: "mcp_tool", server: "myserver", tool: "mytool" }],
      },
    ]);
    expect(groups[0].handlers[0].implPreview).toBe("myserver::mytool");
  });

  test("mcp_tool handler falls back to bare tool when server is missing", () => {
    const groups = parseMatcherGroups([
      { matcher: "x", hooks: [{ type: "mcp_tool", tool: "solo" }] },
    ]);
    expect(groups[0].handlers[0].implPreview).toBe("solo");
  });

  test("prompt and agent handlers use the prompt field", () => {
    const groups = parseMatcherGroups([
      { matcher: "x", hooks: [{ type: "prompt", prompt: "be helpful" }] },
      { matcher: "y", hooks: [{ type: "agent", prompt: "review this PR" }] },
    ]);
    expect(groups[0].handlers[0].implPreview).toBe("be helpful");
    expect(groups[1].handlers[0].implPreview).toBe("review this PR");
  });

  test("preserves the raw entry for modal use", () => {
    const value = [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "x", timeout: 7 }],
        // Extra field upstream might add; should round-trip through `raw`.
        custom_field: "preserved",
      },
    ];
    const groups = parseMatcherGroups(value);
    expect(groups[0].raw).toEqual(value[0]);
    expect(groups[0].handlers[0].raw).toEqual({
      type: "command",
      command: "x",
      timeout: 7,
    });
  });
});

describe("formatHooksValue", () => {
  test.each([
    ["0 groups (unset)", undefined, "no matcher groups"],
    ["0 groups (empty array)", [], "no matcher groups"],
  ])("returns 'no matcher groups' for %s", (_label, value, expected) => {
    expect(formatHooksValue(value)).toBe(expected);
  });

  test("singular for 1 group, plural for >1", () => {
    const one = [{ matcher: "Bash", hooks: [{ type: "command", command: "a" }] }];
    const two = [
      { matcher: "Bash", hooks: [{ type: "command", command: "a" }] },
      { matcher: "Edit", hooks: [{ type: "command", command: "b" }] },
    ];
    expect(formatHooksValue(one)).toBe("1 matcher group · command");
    expect(formatHooksValue(two)).toBe("2 matcher groups · command");
  });

  test("lists distinct handler types in first-appearance order", () => {
    const value = [
      {
        matcher: "Bash",
        hooks: [
          { type: "http", url: "x" },
          { type: "command", command: "y" },
          { type: "http", url: "z" }, // duplicate type — collapses
        ],
      },
    ];
    expect(formatHooksValue(value)).toBe("1 matcher group · http, command");
  });

  test("returns just the count when groups have no handlers", () => {
    const value = [{ matcher: "Bash" }, { matcher: "Edit" }];
    expect(formatHooksValue(value)).toBe("2 matcher groups");
  });
});

describe("summarizeMatcherGroup", () => {
  test("returns the count + sole type", () => {
    const [group] = parseMatcherGroups([
      { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
    ]);
    expect(summarizeMatcherGroup(group)).toBe("1 command");
  });

  test("joins multiple distinct types", () => {
    const [group] = parseMatcherGroups([
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "x" },
          { type: "http", url: "y" },
        ],
      },
    ]);
    expect(summarizeMatcherGroup(group)).toBe("2 command, http");
  });

  test("'no handlers' for an empty handler list", () => {
    const [group] = parseMatcherGroups([{ matcher: "Bash" }]);
    expect(summarizeMatcherGroup(group)).toBe("no handlers");
  });
});
