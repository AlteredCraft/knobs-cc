import { LAYERS_IN_PRECEDENCE_ORDER, type SettingsSnapshot } from "@/types";
import { StatusDot } from "./StatusDot";

export function Topbar({ snapshot }: { snapshot: SettingsSnapshot }) {
  const okLayers = snapshot.layers.filter((l) => l.status === "ok").length;
  const totalLayers = LAYERS_IN_PRECEDENCE_ORDER.length;
  const diagnosticCount = snapshot.diagnostics.length;

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
        <button
          type="button"
          disabled
          className="ml-2 cursor-not-allowed rounded-sm border border-line-strong px-2 py-1 uppercase tracking-wider text-fg-2 opacity-60"
          title="Refresh wiring lands in a later phase"
        >
          ↻ refresh
        </button>
      </div>
    </header>
  );
}
