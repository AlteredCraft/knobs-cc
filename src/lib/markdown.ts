// Catalog descriptions (env-vars.json especially) come straight from
// the upstream docs and embed `[text](/en/...)` site-relative links.
// They resolve against the docs root the env-vars sync script pulls
// from.
const DOCS_BASE = "https://code.claude.com/docs";

export function resolveDocsUrl(url: string): string {
  if (url.startsWith("/")) return DOCS_BASE + url;
  return url;
}
