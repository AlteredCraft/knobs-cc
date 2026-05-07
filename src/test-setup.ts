// Vitest doesn't have a Tauri runtime, so the production `loadCatalog()`
// path (which calls `invoke()`) wouldn't resolve. Hydrate the catalog
// from the same JSON files the Rust backend embeds at compile time, so
// every test sees the real shape without round-tripping through IPC.

import settings from "../catalog/settings.json";
import envVars from "../catalog/env-vars.json";
import hooks from "../catalog/hooks.json";
import subAgents from "../catalog/sub-agents.json";
import mcp from "../catalog/mcp.json";
import permissions from "../catalog/permissions.json";
import { hydrateCatalogForTesting, type CatalogsWire } from "@/lib/catalog";

const catalogs: CatalogsWire = {
  settings: settings as CatalogsWire["settings"],
  env_vars: envVars,
  hooks,
  sub_agents: subAgents,
  mcp,
  permissions,
};

hydrateCatalogForTesting(catalogs);
