// Catalog descriptions (env-vars.json especially) come straight from the
// upstream docs and embed markdown link syntax — both absolute
// (https://...) and site-relative (/en/...). Relative URLs resolve
// against the docs root the env-vars sync script pulls from.
const DOCS_BASE = "https://code.claude.com/docs";

export type MarkdownToken =
  | { kind: "text"; value: string }
  | { kind: "link"; text: string; href: string };

// Greedy on text, non-greedy on URL: stops at the first `)`. Doesn't
// support escaped brackets or parens inside URLs — neither appears in
// the catalog today, and adding nesting support would require a real
// parser.
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function parseInlineMarkdown(input: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];
  let cursor = 0;
  for (const match of input.matchAll(LINK_RE)) {
    const [full, text, url] = match;
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: "text", value: input.slice(cursor, start) });
    }
    tokens.push({ kind: "link", text, href: resolveUrl(url) });
    cursor = start + full.length;
  }
  if (cursor < input.length) {
    tokens.push({ kind: "text", value: input.slice(cursor) });
  }
  return tokens;
}

function resolveUrl(url: string): string {
  if (url.startsWith("/")) return DOCS_BASE + url;
  return url;
}
