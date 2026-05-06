import { openPath as openWithSystem } from "@tauri-apps/plugin-opener";

// Thin wrapper so callers don't import the plugin directly. The opener
// plugin uses the OS file association — for `.json` that's whatever the
// user has set as default (VS Code, JetBrains, TextEdit, etc.). Line
// targeting (`:7`) is not supported by `openPath` and is deferred.
//
// Errors here are best-effort surfaced to the console — the click is a
// convenience and shouldn't block the inspector's main flow if the OS
// can't resolve a default app for a path.
export async function openInEditor(path: string): Promise<void> {
  try {
    await openWithSystem(path);
  } catch (e) {
    // Don't toast — surfacing a popup on every fail (e.g. a broken default
    // association) would be more annoying than helpful. The error logs
    // are reachable via the dev console for anyone debugging.
    console.error("openInEditor failed", { path, error: e });
  }
}
