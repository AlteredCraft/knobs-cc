import { describe, expect, test } from "vitest";
import { resolveDocsUrl } from "./markdown";

describe("resolveDocsUrl", () => {
  test("rewrites site-relative paths against the docs root", () => {
    expect(resolveDocsUrl("/en/amazon-bedrock#service-tiers")).toBe(
      "https://code.claude.com/docs/en/amazon-bedrock#service-tiers",
    );
  });

  test("leaves absolute URLs untouched", () => {
    expect(resolveDocsUrl("https://example.com/x")).toBe(
      "https://example.com/x",
    );
  });

  test("leaves protocol-less, non-rooted strings untouched", () => {
    expect(resolveDocsUrl("mailto:foo@example.com")).toBe(
      "mailto:foo@example.com",
    );
  });
});
