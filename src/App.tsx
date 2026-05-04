import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import type { SettingsSnapshot } from "@/types";

function App() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<SettingsSnapshot>("read_settings_layers");
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
