import { describe, expect, test } from "vitest";

import { isRegistryPath } from "./WaterfallRow";

describe("isRegistryPath", () => {
  test.each([
    ["HKLM\\SOFTWARE\\Policies\\ClaudeCode\\Settings"],
    ["HKCU\\SOFTWARE\\Policies\\ClaudeCode\\Settings"],
    ["HKCR\\Software\\Foo"],
    ["HKU\\.DEFAULT\\Software"],
    ["HKCC\\System\\CurrentControlSet"],
  ])("recognises %s as a registry path", (path) => {
    expect(isRegistryPath(path)).toBe(true);
  });

  test.each([
    ["/Users/sam/.claude/settings.json"],
    ["/Library/Managed Preferences/com.anthropic.claudecode.plist"],
    ["C:\\Users\\sam\\.claude\\settings.json"],
    ["/etc/claude-code/managed-settings.json"],
    [""],
    // A leading "HKLM" with no backslash isn't a registry path — could be
    // something else entirely; the trailing `\\` is what makes it unambiguous.
    ["HKLM-not-actually-a-hive"],
  ])("does not flag %s as registry", (path) => {
    expect(isRegistryPath(path)).toBe(false);
  });
});
