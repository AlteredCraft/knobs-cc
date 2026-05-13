# Settings display — UI mocks

Three throwaway HTML mocks exploring distinct directions for the Phase 4
settings UI. Each commits to its own visual identity rather than shipping
three flavours of the same dashboard.

```sh
open mocks/01-inspector.html
open mocks/02-stack-view.html
open mocks/03-goals.html
```

All three render the same realistic snapshot:
- 5 of 7 layers active (managed and cli are absent in this fixture —
  no MDM policy, no attached claude with mapped flags)
- 12 set keys, 2 env vars, 3 shadowed values, 4 array-merged fields
- The same `model` shadowing example: project (`opus-4-7`) wins over user (`sonnet-4-6`)
- The same `permissions.allow` array-merge across user + project + project_local

These are concept-phase mocks; the shipped Inspector resolves the cli +
env + project layers against a session picked via the topbar (see
[`../spec/attach-mode.md`](../spec/attach-mode.md)). The mocks predate
that surface and don't render it.

No build step. No JS framework. Tailwind via CDN. Fonts from Google.

---

## 01 — Inspector (3-pane)

**Aesthetic:** Bloomberg terminal × Chrome DevTools. Dense monospace, single
amber accent, zero ornament. Information per pixel matters.

**Layout:**
- Left rail: precedence stack with status dots, file paths, key counts
- Center: settings table with effective value, source badge, and a 7-square
  *presence indicator* showing which layers contributed (winner gets the amber
  cell, shadowed cells dim, missing cells outlined)
- Right drawer: vertical waterfall of every layer's contribution to the
  selected key, winner highlighted, shadowed entries struck through
- Footer: keyboard hints

**Best for:** the power-user view — fast scanning, full precedence transparency,
keyboard navigation. This is what Phase 4 should converge on if the audience is
"engineers debugging a config."

**Inspiration:** k9s, btop, Datadog APM, Chrome DevTools Computed panel.

---

## 02 — Stack View (typeset documentary)

**Aesthetic:** A reference document. Cream paper, oxblood accent, serif display
(Instrument Serif), serif body (Newsreader), monospace values (JetBrains Mono).
Calm, restful, opinionated by typography rather than color.

**Layout:**
- Editorial masthead with volume/issue framing
- Horizontal "seven layers" strip showing layer presence
- Numbered entries (i, ii, iii, …) as expandable specimens
- Expanded entries reveal the layer waterfall inline; the winning row gets a
  green stamp and the shadowed rows are struck through
- Array-merged fields show per-element provenance with no shadowing
- Marginalia (oxblood callout) flags spec deviations like the deferred
  array-merge semantics

**Best for:** browsing your config like a reference book. Slower to scan than
the Inspector but vastly more pleasant to read; well suited to documentation
mode or a "view in browser" web export of the inventory.

**Inspiration:** Stripe docs, NYT typography, ANSI man pages re-imagined.

---

## 03 — Goals (opinionated cards)

**Aesthetic:** Confident dark UI with personality. Three goal cards, each
carrying its own hue (cool blue for speed, gold for cost, warm red for safety).
Geist + Geist Mono. The emoji are large and earned — they're the anchor of each
card.

**Layout:**
- Hero with snapshot strip (a per-layer presence bar)
- Three goal cards: "Make Claude faster ⚡", "Reduce token usage 💰", "Stay safe 🛡"
- Each card lists the relevant knobs with their current values, provenance
  chips, and a one-line *hint* explaining why each knob matters for that goal
- Below the cards: a layer-health strip (7 cells) showing which layers are
  contributing
- Diagnostics ribbon and a footer pointing to other goals (Quality, Privacy,
  Hooks) plus a "Browse all 47 knobs" CTA that would route to the Inspector

**Best for:** the *first-run* experience. Frames the inventory in terms of
*what the user is trying to accomplish* — directly executes on the design-notes
"Ideas..." section. Most brand-forward of the three; biggest editorial cost
because somebody has to curate which knobs belong to which goal.

**Inspiration:** Linear settings, Things 3, Arc browser preferences.

---

## Recommendation

Treat the Inspector and the Goals view as the two real candidates. They serve
different users:

- **Inspector** is the answer to "I know what I'm looking for, get out of my way."
- **Goals** is the answer to "I just installed knobs.cc — what do I do with this?"

The Stack View is gorgeous but probably belongs as the static `knobs.cc/`
landing-page rendering of `inventory.md` rather than as an in-app tab — it's
the design-notes "live inventory" idea, not the desktop UX.

A practical Phase 4 split: ship the Inspector as the default app view, build
the Goals card system as a `?goal=speed` deep-link target and the empty-state
screen, and use the Stack View aesthetic on the public site.

---

## Framework recommendation

Picking a UI kit for the Tauri app, evaluated against the constraints that
actually matter here:

| Framework | Aesthetic ceiling | Accessibility | Theming control | Bundle | Verdict |
|---|---|---|---|---|---|
| **shadcn/ui + Tailwind** | High | Excellent (Radix primitives) | Total | N/A — copy-paste | Strong |
| Radix Themes | Medium-High | Excellent | Constrained to their system | Small | Solid but generic |
| Mantine | Medium | Good | Heavy override needed | Large | Overkill |
| Plain Tailwind | Whatever you build | DIY | Total | Smallest | Too much yak-shaving |

**Recommendation: shadcn/ui + Tailwind.**

It isn't a runtime dependency — components are vendored as source into your
repo, which means you own them, can edit them freely, and the whole
"shadcn aesthetic" doesn't follow you around once you've restyled the
primitives. For a precision-instrument tool like knobs.cc, that ownership
matters: the difference between the Inspector mock and a generic dashboard is
mostly typography, spacing, and one-off component decisions, all of which are
trivial to layer onto shadcn but tedious to fight against in Mantine. Radix
under the hood gives you keyboard navigation, focus management, and ARIA
correctness for free — non-negotiable in a desktop tool full of lists,
drawers, and dialogs. Bundle size is irrelevant because Tauri ships the system
webview, but tree-shakeability is still nice and shadcn wins there too.

The two pieces I'd add on top: `cmdk` for ⌘K command palette (the
Inspector mock implies it), and `lucide-react` for icons (Radix doesn't ship
its own).

If shadcn feels like too much component work for a v1, **Radix Themes** is
the safer fallback — accessible, polished, fast to adopt. The cost is that
the result will look like every other Radix Themes app, which fights against
the "instrument, not dashboard" goal.
