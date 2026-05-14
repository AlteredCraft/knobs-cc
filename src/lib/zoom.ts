// Global zoom controls — ⌘/Ctrl + +/- to step, ⌘/Ctrl + 0 to reset.
// Applies a CSS `zoom` on <html>, which scales everything proportionally
// in WebKit and Chromium/WebView2 (both Tauri targets). We avoid Tauri's
// native webview.setZoom() to keep the change client-side.

const ZOOM_KEY = "knobs:zoom";
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1.0;

function clamp(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
}

function readZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw === null) return ZOOM_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

function writeZoom(z: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    // localStorage unavailable — non-fatal, just won't persist.
  }
}

function applyZoom(z: number): void {
  // `zoom` is missing from CSSStyleDeclaration in older TS lib targets.
  (document.documentElement.style as CSSStyleDeclaration & {
    zoom: string;
  }).zoom = String(z);
}

export function installZoomShortcuts(): () => void {
  let zoom = readZoom();
  applyZoom(zoom);

  const set = (next: number) => {
    zoom = clamp(next);
    writeZoom(zoom);
    applyZoom(zoom);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.altKey) return;

    // `e.key` reflects the post-modifier character. Shift+= produces "+",
    // so we cover both unshifted and shifted "zoom in" with one branch.
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      set(zoom + ZOOM_STEP);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      set(zoom - ZOOM_STEP);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      set(ZOOM_DEFAULT);
      return;
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
