import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { InspectorShell } from "@/components/inspector/InspectorShell";
import { LaunchScreen } from "@/components/LaunchScreen";
import { loadCatalog } from "@/lib/catalog";
import { installGlobalHandlers } from "@/lib/errorLog";
import { pickProjectDirectory } from "@/lib/openPath";
import { installZoomShortcuts } from "@/lib/zoom";
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
  // The launch screen is the front door on every cold start. Flips true
  // once the user explicitly picks a grounding (attach or directory) and
  // back to false if they return via the SessionPill.
  const [launchComplete, setLaunchComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grounding: SessionGrounding = useMemo(() => {
    if (runtimeSnapshot === null) return { kind: "loading" };
    return deriveSessionGrounding(runtimeSnapshot, selectedPid, pickedRoot);
  }, [runtimeSnapshot, selectedPid, pickedRoot]);

  // Pull just the catalog + runtime — used for the launch screen and for
  // the rescan affordance. Doesn't touch settings; that's gated on
  // launchComplete so we don't read settings against the wrong (unset)
  // grounding before the user has chosen one.
  const refreshRuntime = useCallback(async () => {
    try {
      const [, runtime] = await Promise.all([loadCatalog(), readRuntimeLayer()]);
      setRuntimeSnapshot(runtime);
      setError(null);
      return runtime;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  // Full refresh — runtime + settings, reading settings against the
  // current grounding. Only callable once the user has chosen a session.
  const refreshAll = useCallback(async () => {
    try {
      const runtime = await refreshRuntime();
      if (!runtime) return;
      const g = deriveSessionGrounding(runtime, selectedPid, pickedRoot);
      const args = groundingToInvokeArgs(g);
      const next = await invoke<SettingsSnapshot>("read_settings_layers", args);
      setSnapshot(next);
      setError(null);
    } catch (e) {
      setSnapshot((prev) => {
        if (!prev) setError(String(e));
        return prev;
      });
    }
  }, [refreshRuntime, selectedPid, pickedRoot]);

  // Cold-start: just runtime. Settings load on grounding-choice.
  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  // Once the user has picked a grounding, fetch / refetch settings. This
  // also handles in-app session switches via the SessionPill — changing
  // `selectedPid` or `pickedRoot` while in the Inspector re-fires this.
  useEffect(() => {
    if (!launchComplete) return;
    void refreshAll();
  }, [launchComplete, refreshAll]);

  useEffect(() => installGlobalHandlers(), []);
  useEffect(() => installZoomShortcuts(), []);

  // Live updates from the Rust file watcher. Only relevant once we're in
  // the Inspector — the launch screen doesn't render settings.
  useEffect(() => {
    if (!launchComplete) return;
    let timer: number | undefined;
    const unlisten = listen("settings-changed", () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refreshAll();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      void unlisten.then((u) => u());
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [launchComplete, refreshAll]);

  // Window-focus refresh — common UX expectation when the user alt-tabs
  // back from a terminal where they just started/stopped claude. On the
  // launch screen we only need to rescan processes; in the Inspector we
  // do the full settings read too.
  useEffect(() => {
    const onFocus = () => {
      if (launchComplete) void refreshAll();
      else void refreshRuntime();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [launchComplete, refreshAll, refreshRuntime]);

  // LaunchScreen choices --------------------------------------------------

  const onAttachFromLaunch = useCallback((pid: number) => {
    setSelectedPid(pid);
    setPickedRoot(null);
    setLaunchComplete(true);
  }, []);

  const onPickRootFromLaunch = useCallback(async () => {
    const selected = await pickProjectDirectory();
    if (selected !== null) {
      setPickedRoot(selected);
      setSelectedPid(null);
      setLaunchComplete(true);
    }
  }, []);

  // In-app session switching (SessionPill) -------------------------------

  const onAttach = useCallback((pid: number) => {
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

  const onBackToLaunch = useCallback(() => {
    setSelectedPid(null);
    setPickedRoot(null);
    setSnapshot(null);
    setLaunchComplete(false);
  }, []);

  if (error && !runtimeSnapshot) {
    return (
      <main className="flex h-screen items-center justify-center bg-bg-0 px-6">
        <div className="max-w-prose">
          <h1 className="mb-2 font-mono text-[14px] font-semibold text-fg-1">
            knobs.cc
          </h1>
          <p className="font-mono text-[11px] text-err">
            Unable to start. Check the app logs and try again.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-sm border border-line-strong bg-bg-1 p-3 font-mono text-[10.5px] text-fg-3">
            {error}
          </pre>
        </div>
      </main>
    );
  }

  if (!launchComplete) {
    return (
      <LaunchScreen
        runtimeSnapshot={runtimeSnapshot}
        onAttach={onAttachFromLaunch}
        onPickRoot={onPickRootFromLaunch}
        onRescan={() => void refreshRuntime()}
      />
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
      onBackToLaunch={onBackToLaunch}
      onRefresh={() => void refreshAll()}
    />
  );
}

export default App;
