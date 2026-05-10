import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SettingsSnapshot } from "@/types";
import { buildRows } from "@/lib/rows";
import { EnvVarsPanel } from "./EnvVarsPanel";
import { ErrorPanel } from "./ErrorPanel";
import { HelpView } from "./HelpView";
import { KeyDrawer } from "./KeyDrawer";
import { PrecedenceRail } from "./PrecedenceRail";
import { SettingsList, type SettingsListHandle } from "./SettingsList";
import { Topbar } from "./Topbar";

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  return (el as HTMLElement).isContentEditable;
}

export function InspectorShell({
  snapshot,
  onRefresh,
}: {
  snapshot: SettingsSnapshot;
  onRefresh?: () => void;
}) {
  const [activeKeyPath, setActiveKeyPath] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [envVarsOpen, setEnvVarsOpen] = useState(false);
  const listRef = useRef<SettingsListHandle>(null);

  const activeRow = useMemo(() => {
    if (!activeKeyPath) return null;
    return buildRows(snapshot).find((r) => r.keyPath === activeKeyPath) ?? null;
  }, [snapshot, activeKeyPath]);

  // Click and ↵ both toggle the drawer for a row — clicking an open row
  // closes it, mirroring ↵'s "toggle drawer for the focused row" semantics.
  const handleSelect = useCallback((keyPath: string) => {
    setActiveKeyPath((cur) => (cur === keyPath ? null : keyPath));
  }, []);

  // Drawer-originated navigation (related-knobs click). Set the active key
  // and move the list's cursor to match — otherwise the list's
  // cursor-follow effect would immediately call onSelect with the old
  // cursor position and drag the drawer back.
  const handleNavigate = useCallback((keyPath: string) => {
    setActiveKeyPath(keyPath);
    listRef.current?.setCursor(keyPath);
  }, []);

  const closeDrawer = useCallback(() => setActiveKeyPath(null), []);

  // Global keyboard model — see inspector-ui.md "Interaction model".
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // SettingsRow handles Enter/Space on its focused row and calls
      // preventDefault — bail so we don't double-fire.
      if (e.defaultPrevented) return;

      const inInput = isTextInput(document.activeElement);

      // Help is a modal layer — only ?, Esc handle. Everything else falls
      // through to the browser default. We don't want J/K to "navigate"
      // the inspector behind the help, or ⌘K to focus a filter the user
      // can't see.
      if (helpOpen) {
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      // Errors panel is the same shape — modal layer, Esc closes.
      if (errorsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setErrorsOpen(false);
        }
        return;
      }

      // Env vars panel — same shape. The panel handles its own `/`
      // shortcut for the filter while open; Esc closes.
      if (envVarsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setEnvVarsOpen(false);
        }
        return;
      }

      // ⌘K / Ctrl+K — focus filter from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        listRef.current?.focusFilter();
        return;
      }

      // Modifier-bearing keys beyond ⌘K aren't part of our model — let
      // the platform/browser handle them (copy/paste, devtools, etc.).
      // Shift is allowed through because `?` is Shift+/.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Esc closes the drawer if it's open. If no drawer and we're inside
      // a text input, blur it. Otherwise nothing.
      if (e.key === "Escape") {
        if (activeKeyPath) {
          e.preventDefault();
          closeDrawer();
        } else if (inInput) {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }

      // Enter activates the cursor row (toggle its drawer). Buttons handle
      // Enter natively — let them.
      if (e.key === "Enter") {
        if (document.activeElement?.tagName === "BUTTON") return;
        e.preventDefault();
        listRef.current?.activateCursor();
        return;
      }

      // The remaining shortcuts are letter/symbol keys — skip them while
      // the user is typing in a text input.
      if (inInput) return;

      switch (e.key) {
        case "?":
          e.preventDefault();
          setHelpOpen(true);
          return;
        case "/":
          e.preventDefault();
          listRef.current?.focusFilter();
          return;
        case "j":
        case "J":
        case "ArrowDown":
          e.preventDefault();
          listRef.current?.moveCursor(1);
          return;
        case "k":
        case "K":
        case "ArrowUp":
          e.preventDefault();
          listRef.current?.moveCursor(-1);
          return;
        case "r":
        case "R":
          if (onRefresh) {
            e.preventDefault();
            onRefresh();
          }
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeKeyPath, closeDrawer, envVarsOpen, errorsOpen, helpOpen, onRefresh]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0 text-fg-1">
      <Topbar
        snapshot={snapshot}
        onRefresh={onRefresh}
        onHelp={() => setHelpOpen(true)}
        onShowErrors={() => setErrorsOpen(true)}
        onShowEnvVars={() => setEnvVarsOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <PrecedenceRail
          snapshot={snapshot}
          activeWinner={activeRow?.winner ?? null}
        />
        <SettingsList
          ref={listRef}
          snapshot={snapshot}
          activeKeyPath={activeKeyPath}
          onSelect={handleSelect}
          onShowEnvVars={() => setEnvVarsOpen(true)}
        />
        {activeRow && (
          <KeyDrawer
            row={activeRow}
            snapshot={snapshot}
            onClose={closeDrawer}
            onSelect={handleNavigate}
          />
        )}
      </div>

      {helpOpen && <HelpView onClose={() => setHelpOpen(false)} />}
      {errorsOpen && <ErrorPanel onClose={() => setErrorsOpen(false)} />}
      {envVarsOpen && (
        <EnvVarsPanel
          snapshot={snapshot}
          onClose={() => setEnvVarsOpen(false)}
        />
      )}
    </div>
  );
}

