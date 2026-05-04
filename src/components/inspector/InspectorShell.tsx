import { useEffect, useMemo, useState } from "react";
import type { SettingsSnapshot } from "@/types";
import { buildRows } from "@/lib/rows";
import { KeyDrawer } from "./KeyDrawer";
import { PrecedenceRail } from "./PrecedenceRail";
import { SettingsList } from "./SettingsList";
import { Topbar } from "./Topbar";

export function InspectorShell({ snapshot }: { snapshot: SettingsSnapshot }) {
  const [activeKeyPath, setActiveKeyPath] = useState<string | null>(null);

  const activeRow = useMemo(() => {
    if (!activeKeyPath) return null;
    return buildRows(snapshot).find((r) => r.keyPath === activeKeyPath) ?? null;
  }, [snapshot, activeKeyPath]);

  // Esc closes the drawer; the rest of the keyboard model lands in 4d.
  useEffect(() => {
    if (!activeKeyPath) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveKeyPath(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeKeyPath]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0 text-fg-1">
      <Topbar snapshot={snapshot} />

      <div className="flex flex-1 overflow-hidden">
        <PrecedenceRail
          snapshot={snapshot}
          activeWinner={activeRow?.winner ?? null}
        />
        <SettingsList
          snapshot={snapshot}
          activeKeyPath={activeKeyPath}
          onSelect={setActiveKeyPath}
        />
        {activeRow ? (
          <KeyDrawer
            row={activeRow}
            snapshot={snapshot}
            onClose={() => setActiveKeyPath(null)}
          />
        ) : (
          <DrawerPlaceholder />
        )}
      </div>
    </div>
  );
}

function DrawerPlaceholder() {
  return (
    <aside className="flex w-[440px] shrink-0 flex-col items-center justify-center border-l border-line bg-bg-1 px-6">
      <div className="max-w-xs text-center">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
          select a key
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-fg-2">
          Click a row in the settings list to open its detail here — every
          layer&apos;s contribution, winner highlighted, shadowed values
          struck through. Esc closes.
        </p>
      </div>
    </aside>
  );
}
