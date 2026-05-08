import { describe, expect, test } from "vitest";
import { parseInlineMarkdown } from "./markdown";

describe("parseInlineMarkdown", () => {
  test("returns a single text token when there are no links", () => {
    expect(parseInlineMarkdown("plain prose")).toEqual([
      { kind: "text", value: "plain prose" },
    ]);
  });

  test("emits empty array for an empty string", () => {
    expect(parseInlineMarkdown("")).toEqual([]);
  });

  test("extracts an absolute link and surrounding text", () => {
    const tokens = parseInlineMarkdown(
      "before [docs](https://example.com/x) after",
    );
    expect(tokens).toEqual([
      { kind: "text", value: "before " },
      { kind: "link", text: "docs", href: "https://example.com/x" },
      { kind: "text", value: " after" },
    ]);
  });

  test("resolves site-relative URLs against the docs root", () => {
    const tokens = parseInlineMarkdown(
      "see [Amazon Bedrock](/en/amazon-bedrock#service-tiers)",
    );
    expect(tokens).toEqual([
      { kind: "text", value: "see " },
      {
        kind: "link",
        text: "Amazon Bedrock",
        href: "https://code.claude.com/docs/en/amazon-bedrock#service-tiers",
      },
    ]);
  });

  test("handles multiple links in one description", () => {
    const tokens = parseInlineMarkdown(
      "Use [LLM gateway](/en/llm-gateway). See [Amazon Bedrock](/en/amazon-bedrock)",
    );
    expect(tokens).toHaveLength(4);
    expect(tokens[1]).toEqual({
      kind: "link",
      text: "LLM gateway",
      href: "https://code.claude.com/docs/en/llm-gateway",
    });
    expect(tokens[3]).toEqual({
      kind: "link",
      text: "Amazon Bedrock",
      href: "https://code.claude.com/docs/en/amazon-bedrock",
    });
  });

  test("returns the text unchanged when brackets aren't a link", () => {
    expect(parseInlineMarkdown("array of [number]")).toEqual([
      { kind: "text", value: "array of [number]" },
    ]);
  });
});
