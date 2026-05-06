import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import { loadCatalog } from "@/lib/catalog";
import type { SettingsSnapshot } from "@/types";

// Coalesce window for `settings-changed` bursts. Editors typically write a
// settings file as a tempfile rename — that's two events back-to-back, plus
// the occasional follow-up. 250ms is short enough to feel live and long
// enough to absorb the rename pair without a double-fetch.
const REFRESH_DEBOUNCE_MS = 250;

function App() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Catalog is idempotent after first load — the await is a no-op on
      // refresh. Pair it with the snapshot read so a cold start doesn't
      // race the inspector against an unloaded catalog.
      const [, next] = await Promise.all([
        loadCatalog(),
        invoke<SettingsSnapshot>("read_settings_layers"),
      ]);
      setSnapshot(next);
      setError(null);
    } catch (e) {
      // On the initial read we have no snapshot to fall back to, so surface
      // the error UI. Once a snapshot is present, keep it on screen — a
      // failed refresh shouldn't blow away usable state.
      setSnapshot((prev) => {
        if (!prev) setError(String(e));
        return prev;
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates from the Rust file watcher (Phase 7). We re-fetch the whole
  // snapshot on any settings-changed event — same code path as a manual
  // refresh, no state diffing needed.
  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen("settings-changed", () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refresh();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      void unlisten.then((u) => u());
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  if (error) {
    return (
      <main className="flex h-screen items-center justify-center bg-bg-0 px-6">
        <div className="max-w-prose">
          <h1 className="mb-2 font-mono text-[14px] font-semibold text-fg-1">
            knobs.cc
          </h1>
          <p className="font-mono text-[11px] text-err">
            Unable to read settings. Check the app logs and try again.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-sm border border-line-strong bg-bg-1 p-3 font-mono text-[10.5px] text-fg-3">
            {error}
          </pre>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="flex h-screen items-center justify-center bg-bg-0">
        <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">
          reading settings…
        </span>
      </main>
    );
  }

  return <InspectorShell snapshot={snapshot} onRefresh={() => void refresh()} />;
}

export default App;
