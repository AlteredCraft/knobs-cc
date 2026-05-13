import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import { loadCatalog } from "@/lib/catalog";
import { installGlobalHandlers } from "@/lib/errorLog";
import { pickProjectDirectory } from "@/lib/openPath";
import {
  deriveSessionGrounding,
  groundingToInvokeArgs,
  readRuntimeLayer,
} from "@/lib/runtime";
import type {
  RuntimeSnapshot,
  SessionGrounding,
  SettingsSnapshot,
} from "@/types";

// Coalesce window for `settings-changed` bursts. Editors typically write a
// settings file as a tempfile rename — that's two events back-to-back, plus
// the occasional follow-up. 250ms is short enough to feel live and long
// enough to absorb the rename pair without a double-fetch.
const REFRESH_DEBOUNCE_MS = 250;

function App() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeSnapshot | null>(
    null,
  );
  // Persisted across runtime refreshes so the user's selection survives a
  // rescan of the process list. Cleared if the underlying claude exits —
  // deriveSessionGrounding handles that transition.
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grounding: SessionGrounding = useMemo(() => {
    if (runtimeSnapshot === null) return { kind: "loading" };
    return deriveSessionGrounding(runtimeSnapshot, selectedPid, pickedRoot);
  }, [runtimeSnapshot, selectedPid, pickedRoot]);

  const refresh = useCallback(async () => {
    try {
      // Catalog is idempotent after first load — the await is a no-op on
      // refresh. Pair it with the runtime read so a cold start doesn't
      // race the inspector against an unloaded catalog or unknown
      // grounding state.
      const [, runtime] = await Promise.all([loadCatalog(), readRuntimeLayer()]);
      setRuntimeSnapshot(runtime);
      // Derive grounding from the fresh runtime to pick the right
      // invoke args. Reading prior state here rather than relying on the
      // memoized `grounding` avoids one round-trip of stale state.
      const g = deriveSessionGrounding(runtime, selectedPid, pickedRoot);
      const args = groundingToInvokeArgs(g);
      const next = await invoke<SettingsSnapshot>("read_settings_layers", args);
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
  }, [selectedPid, pickedRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Bridge uncaught errors and unhandled rejections into the in-app log so
  // silent UI failures (e.g. a rejected `openPath` Promise) surface in the
  // Topbar pill instead of only the WebView devtools console.
  useEffect(() => installGlobalHandlers(), []);

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

  // Window-focus refresh per spec/attach-mode.md "Refresh cadence" — common
  // UX expectation when the user alt-tabs back from a terminal where they
  // just started or stopped claude. Browser-level focus event works in the
  // WebView; no Rust-side bridge needed.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const onAttach = useCallback((pid: number) => {
    // Attaching supersedes any previously-picked root — the spec's
    // precedence: attached_pid wins over project_root_override.
    setSelectedPid(pid);
    setPickedRoot(null);
  }, []);

  const onPickRoot = useCallback(async () => {
    const selected = await pickProjectDirectory();
    if (selected !== null) {
      setPickedRoot(selected);
      setSelectedPid(null);
    }
  }, []);

  const onClearRoot = useCallback(() => {
    setPickedRoot(null);
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

  return (
    <InspectorShell
      snapshot={snapshot}
      grounding={grounding}
      runtimeSnapshot={runtimeSnapshot}
      onAttach={onAttach}
      onPickRoot={onPickRoot}
      onClearRoot={onClearRoot}
      onRefresh={() => void refresh()}
    />
  );
}

export default App;
