export type LayerSource =
  | "managed"
  | "cli"
  | "env"
  | "project_local"
  | "project"
  | "user"
  | "default";

export type LayerStatus = "ok" | "missing" | "error";

export interface LayerRead {
  source: LayerSource;
  path: string | null;
  status: LayerStatus;
  raw: unknown | null;
  error: string | null;
}

export interface Diagnostic {
  level: "warn" | "error";
  message: string;
}

export interface SettingsSnapshot {
  layers: LayerRead[];
  effective: unknown;
  project_root: string | null;
  diagnostics: Diagnostic[];
}

export const LAYERS_IN_PRECEDENCE_ORDER: LayerSource[] = [
  "managed",
  "cli",
  "env",
  "project_local",
  "project",
  "user",
  "default",
];

export const SOURCE_LABEL: Record<LayerSource, string> = {
  managed: "managed",
  cli: "cli",
  env: "env",
  project_local: "project_local",
  project: "project",
  user: "user",
  default: "default",
};
