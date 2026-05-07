import { useSyncExternalStore } from "react";
import { LAYERS_IN_PRECEDENCE_ORDER, type SettingsSnapshot } from "@/types";
import { describeMcpPolicy } from "@/lib/managedMcp";
import { openInEditor } from "@/lib/openPath";
import { getEntries, getUnseenCount, subscribe } from "@/lib/errorLog";
import { StatusDot } from "./StatusDot";

export function Topbar({
  snapshot,
  onRefresh,
  onHelp,
  onShowErrors,
}: {
  snapshot: SettingsSnapshot;
  onRefresh?: () => void;
  onHelp?: () => void;
  onShowErrors?: () => void;
}) {
  const errorEntries = useSyncExternalStore(subscribe, getEntries);
  const unseenErrors = useSyncExternalStore(subscribe, getUnseenCount);
  const okLayers = snapshot.layers.filter((l) => l.status === "ok").length;
  const totalLayers = LAYERS_IN_PRECEDENCE_ORDER.length;
  const diagnosticCount = snapshot.diagnostics.length;
  const mcpPolicy = describeMcpPolicy(snapshot.managed_mcp);

  return (
    <header
      className="flex h-[38px] shrink-0 items-center border-b border-line-strong px-4"
      style={{ background: "linear-gradient(180deg, #15181f 0%, #11141a 100%)" }}
    >
      <div className="flex items-center gap-2">
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="6.5" stroke="#ffb627" strokeWidth="1.2" />
          <circle cx="9" cy="9" r="1.5" fill="#ffb627" />
          <line x1="9" y1="2" x2="9" y2="0.5" stroke="#ffb627" strokeWidth="1.2" />
        </svg>
        <span className="font-mono text-[12.5px] font-semibold tracking-tight">
          knobs.cc
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          inspector
        </span>
      </div>

      <div className="mx-4 h-4 w-px bg-line-strong" />

      <div className="flex items-center gap-2 font-mono text-[11px] text-fg-3">
        <span>cwd</span>
        <span className="text-fg-1">{snapshot.project_root ?? "(unresolved)"}</span>
      </div>

      <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-fg-2">
        <span className="flex items-center gap-1.5">
          <StatusDot variant={okLayers > 0 ? "ok" : "empty"} />
          {okLayers}/{totalLayers} layers
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot variant={diagnosticCount > 0 ? "warn" : "empty"} />
          {diagnosticCount} {diagnosticCount === 1 ? "diagnostic" : "diagnostics"}
        </span>
        {errorEntries.length > 0 && onShowErrors && (
          <ErrorsPill
            count={errorEntries.length}
            unseen={unseenErrors}
            onClick={onShowErrors}
          />
        )}
        {mcpPolicy && (
          <button
            type="button"
            onClick={() =>
              mcpPolicy.path && void openInEditor(mcpPolicy.path)
            }
            disabled={!mcpPolicy.path}
            title={
              mcpPolicy.state === "error" && mcpPolicy.errorText
                ? `${mcpPolicy.path ?? "(no path)"}\n${mcpPolicy.errorText}`
                : mcpPolicy.path
                  ? `Open ${mcpPolicy.path} in your default editor`
                  : "managed-mcp.json (no path)"
            }
            className="flex items-center gap-1.5 rounded-sm border border-line-strong px-2 py-1 hover:border-accent hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line-strong disabled:hover:text-fg-2"
          >
            <StatusDot variant={mcpPolicy.state === "ok" ? "ok" : "err"} />
            {mcpPolicy.label}
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={!onRefresh}
          className="ml-2 rounded-sm border border-line-strong px-2 py-1 uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line-strong disabled:hover:text-fg-2"
          title="Re-read all layers (R)"
        >
          ↻ refresh
        </button>
        {onHelp && (
          <button
            type="button"
            onClick={onHelp}
            className="rounded-sm border border-line-strong px-2 py-1 uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1"
            title="Help — keyboard shortcuts, layer legend (?)"
          >
            ?
          </button>
        )}
      </div>
    </header>
  );
}

function ErrorsPill({
  count,
  unseen,
  onClick,
}: {
  count: number;
  unseen: number;
  onClick: () => void;
}) {
  const label = `${count} ${count === 1 ? "error" : "errors"}`;
  const title =
    unseen > 0
      ? `${unseen} new — click to open the error log`
      : "Open the error log";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 hover:text-fg-1 ${
        unseen > 0
          ? "border-err text-err shadow-[0_0_8px_rgba(212,88,91,0.35)] hover:border-err"
          : "border-line-strong text-fg-2 hover:border-accent"
      }`}
    >
      <StatusDot variant="err" />
      {label}
      {unseen > 0 && (
        <span className="font-mono text-[9.5px] uppercase tracking-wider">
          ·new
        </span>
      )}
    </button>
  );
}