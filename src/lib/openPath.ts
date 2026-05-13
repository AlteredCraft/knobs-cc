import {
  openPath as openWithSystem,
  openUrl as openUrlWithSystem,
} from "@tauri-apps/plugin-opener";
import { open as openSystemDialog } from "@tauri-apps/plugin-dialog";
import { reportError } from "./errorLog";

/**
 * Open the native folder picker. Returns the absolute path of the
 * directory the user selected, or null if they cancelled. Routes
 * errors to the in-app error log; never throws.
 *
 * Used by attach mode's path-picker fallback (spec/attach-mode.md).
 */
export async function pickProjectDirectory(): Promise<string | null> {
  try {
    const selected = await openSystemDialog({
      directory: true,
      multiple: false,
      title: "Pick a project directory to ground the inspector",
    });
    if (typeof selected === "string") return selected;
    return null;
  } catch (e) {
    reportError({
      message: "Couldn't open the folder picker",
      detail: e,
      source: "pickProjectDirectory",
    });
    return null;
  }
}

// Thin wrapper so callers don't import the plugin directly. The opener
// plugin uses the OS file association — for `.json` that's whatever the
// user has set as default (VS Code, JetBrains, TextEdit, etc.). Line
// targeting (`:7`) is not supported by `openPath` and is deferred.
//
// Failures route to the in-app error log (Topbar errors pill → panel)
// instead of only the WebView devtools console — silent click failures
// were costly to diagnose.
export async function openInEditor(path: string): Promise<void> {
  try {
    await openWithSystem(path);
  } catch (e) {
    reportError({
      message: `Couldn't open ${path}`,
      detail: e,
      source: "openInEditor",
    });
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openUrlWithSystem(url);
  } catch (e) {
    reportError({
      message: `Couldn't open ${url}`,
      detail: e,
      source: "openExternalUrl",
    });
  }
}
