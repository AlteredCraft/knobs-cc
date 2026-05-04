import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import type { SettingsSnapshot } from "@/types";

function App() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SettingsSnapshot>("read_settings_layers")
      .then(setSnapshot)
      .catch((e) => setError(String(e)));
  }, []);

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

  return <InspectorShell snapshot={snapshot} />;
}

export default App;
