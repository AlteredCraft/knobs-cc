import type { SettingsSnapshot } from "@/types";
import { PrecedenceRail } from "./PrecedenceRail";
import { SettingsList } from "./SettingsList";
import { Topbar } from "./Topbar";

export function InspectorShell({ snapshot }: { snapshot: SettingsSnapshot }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0 text-fg-1">
      <Topbar snapshot={snapshot} />

      <div className="flex flex-1 overflow-hidden">
        <PrecedenceRail snapshot={snapshot} />
        <SettingsList snapshot={snapshot} />
        <DrawerPlaceholder />
      </div>
    </div>
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
