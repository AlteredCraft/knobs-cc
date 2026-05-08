import {
  openPath as openWithSystem,
  openUrl as openUrlWithSystem,
} from "@tauri-apps/plugin-opener";
import { reportError } from "./errorLog";

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
