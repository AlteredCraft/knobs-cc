import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Phase 1 of spec/settings-display.md: vertical-slice smoke test that the IPC,
// types, and path resolution all line up. The list/badge UI lands in Phase 4.

type LayerSource =
  | "managed"
  | "cli"
  | "env"
  | "project_local"
  | "project"
  | "user"
  | "default";

type LayerStatus = "ok" | "missing" | "error";

interface LayerRead {
  source: LayerSource;
  path: string | null;
  status: LayerStatus;
  raw: unknown | null;
  error: string | null;
}

interface Diagnostic {
  level: "warn" | "error";
  message: string;
}

interface SettingsSnapshot {
  layers: LayerRead[];
  effective: unknown;
  project_root: string | null;
  diagnostics: Diagnostic[];
}

const SOURCE_LABEL: Record<LayerSource, string> = {
  managed: "Managed",
  cli: "CLI flags",
  env: "Environment",
  project_local: "Project (local)",
  project: "Project",
  user: "User",
  default: "Default",
};

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
      <main className="container">
        <h1>knobs.cc</h1>
        <p style={{ color: "crimson" }}>Failed to read settings: {error}</p>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="container">
        <h1>knobs.cc</h1>
        <p>Reading settings…</p>
      </main>
    );
  }

  return (
    <main className="container" style={{ textAlign: "left", maxWidth: 920 }}>
      <h1>knobs.cc</h1>
      <p style={{ opacity: 0.7 }}>
        Phase 1 snapshot — local file-based layers only. Managed sources, env
        vars, and array-merge are deferred per spec/settings-display.md.
      </p>

      <h2>Project root</h2>
      <p>
        <code>{snapshot.project_root ?? "(unresolved)"}</code>
      </p>

      <h2>Layers</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>Source</th>
            <th style={cell}>Status</th>
            <th style={cell}>Path</th>
            <th style={cell}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.layers.map((l) => (
            <tr key={l.source}>
              <td style={cell}>{SOURCE_LABEL[l.source]}</td>
              <td style={cell}>{l.status}</td>
              <td style={cell}>
                <code>{l.path ?? "—"}</code>
              </td>
              <td style={cell}>{l.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {snapshot.diagnostics.length > 0 && (
        <>
          <h2>Diagnostics</h2>
          <ul>
            {snapshot.diagnostics.map((d, i) => (
              <li key={i}>
                <strong>{d.level}:</strong> {d.message}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Effective settings (with provenance)</h2>
      <pre style={pre}>{JSON.stringify(snapshot.effective, null, 2)}</pre>

      <h2>Raw layer contents</h2>
      {snapshot.layers.map((l) => (
        <details key={l.source} style={{ marginBottom: 8 }}>
          <summary>
            {SOURCE_LABEL[l.source]} — {l.status}
          </summary>
          <pre style={pre}>
            {l.raw === null ? "(no content)" : JSON.stringify(l.raw, null, 2)}
          </pre>
        </details>
      ))}
    </main>
  );
}

const cell: CSSProperties = {
  border: "1px solid #ccc",
  padding: "4px 8px",
  textAlign: "left",
  verticalAlign: "top",
};

const pre: CSSProperties = {
  background: "#f5f5f5",
  padding: 12,
  borderRadius: 4,
  overflowX: "auto",
  fontSize: 12,
};

export default App;
