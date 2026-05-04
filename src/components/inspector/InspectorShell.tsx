import type { SettingsSnapshot } from "@/types";
import { PrecedenceRail } from "./PrecedenceRail";
import { Topbar } from "./Topbar";

export function InspectorShell({ snapshot }: { snapshot: SettingsSnapshot }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0 text-fg-1">
      <Topbar snapshot={snapshot} />

      <div className="flex flex-1 overflow-hidden">
        <PrecedenceRail snapshot={snapshot} />

        <CenterPlaceholder />
        <DrawerPlaceholder />
      </div>

      <Footer />
    </div>
  );
}

function CenterPlaceholder() {
  return (
    <section className="grid-bg flex flex-1 flex-col items-center justify-center bg-bg-0 px-8">
      <div className="max-w-md text-center">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
          settings list — phase 4b
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-fg-2">
          A flat, searchable list of every catalog key plus the env vars
          and array-merged fields detected in the layers on the left.
          Each row will show effective value, winning source, and a
          7-cell presence indicator.
        </p>
      </div>
    </section>
  );
}

function DrawerPlaceholder() {
  return (
    <aside className="flex w-[440px] shrink-0 flex-col items-center justify-center border-l border-line bg-bg-1 px-6">
      <div className="max-w-xs text-center">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
          detail drawer — phase 4c
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-fg-2">
          Selecting a row in the settings list will open this drawer
          with a per-layer waterfall: every layer&apos;s contribution to
          the key, winner highlighted, shadowed values struck through.
        </p>
      </div>
    </aside>
  );
}

function Footer() {
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-line bg-bg-1 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-3">
      <span>phase 4a · chrome only</span>
      <span className="text-fg-4">·</span>
      <span>static snapshot · no live refresh yet</span>
      <span className="ml-auto text-fg-3">
        list, drawer, ⌘K / J·K / ↵ land in 4b–4d
      </span>
    </footer>
  );
}
