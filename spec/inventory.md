# Claude Code configuration inventory

A working catalog of every user-facing "knob" Claude Code exposes — settings files, environment variables, permissions, hooks, slash commands (as a config surface), MCP servers, plugins, skills, subagents, memory, keybindings, CLI flags that shadow settings, IDE integrations.

This file is the data model knobs.cc will render. It's also the public contribution surface — corrections and additions are welcome as issues or PRs.

## Scope

**In scope:** everything that ends up in a file on disk, an env var, or a persisted setting — plus commands that are a *path to* that configuration (e.g. `/config`, `/statusline`, `claude mcp add`, `--model`).

**Out of scope:** operational / session commands with no configuration side-effect — `claude -p "<query>"`, `claude -c`, `claude -r`, `/clear`, `/compact`, `/help`, `/bug`, `/review`, `/init`, `/resume`, `/ide` (the connect action; the setting that governs auto-connect *is* in scope), `--append-system-prompt`, and similar.

If you're not sure whether a knob belongs: does it read or write a config file / setting / env var / persistent state? If yes, in. If it only changes the current session's transient behaviour, out.

All entries have been cross-checked against live docs as of 2026-04-27. Known gaps remain (especially §3 env vars, §5.1 hook events) — not yet canonical. The canonicalization backlog and the `[!verify]`-convention decision are tracked in [`roadmap.md`](./roadmap.md).

**Primary reference:** [`code.claude.com/docs/en/`](https://code.claude.com/docs/en/) (mirrored at `docs.anthropic.com/en/docs/claude-code/`).

---

## 1. Settings files

JSON files that Claude Code reads on startup and merges by precedence. Two distinct user-level files exist — `settings.json` (declarative config) and `~/.claude.json` (global-config sibling that holds a handful of IDE-bridge toggles).

### User scope

| Path | Holds |
| --- | --- |
| `~/.claude/settings.json` | User-level settings (applies to every session). |
| `~/.claude.json` | `autoConnectIde`, `autoInstallIdeExtension`, `externalEditorContext`. Pre-v2.1.119 also held `autoScrollEnabled` / `editorMode` / `showTurnDuration` / `teammateMode` / `terminalProgressBarEnabled`. Also where user-scope MCP servers are stored. |

### Project scope

| Path | Holds |
| --- | --- |
| `<project>/.claude/settings.json` | Project-level settings, team-shared, committed. |
| `<project>/.claude/settings.local.json` | Project-level settings, personal, gitignored. |
| `<project>/.mcp.json` | Project-level MCP servers. |

### Managed / enterprise scope

Admins can pin settings through any of these channels. **Only one managed source applies at a time** — tiers do not merge across types — but within the file-based tier, `managed-settings.d/*.json` drop-in files are merged with `managed-settings.json` alphabetically.

| OS | File-based | Other |
| --- | --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json`, `…/managed-settings.d/`, `…/managed-mcp.json` | `com.anthropic.claudecode` plist (managed preferences domain) |
| Linux / WSL | `/etc/claude-code/managed-settings.json`, `…/managed-settings.d/`, `…/managed-mcp.json` | — |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json`, `…\managed-settings.d\`, `…\managed-mcp.json` | `HKLM\SOFTWARE\Policies\ClaudeCode` (`Settings` value as JSON), `HKCU\SOFTWARE\Policies\ClaudeCode` (lowest-priority managed tier) |

**Managed-tier precedence (one source wins):** server-managed (Anthropic) > MDM/OS policies (plist, registry) > file-based (drop-in + base file, merged) > HKCU registry.

### Precedence (highest wins)

```
Managed  >  CLI flags  >  .claude/settings.local.json  >  .claude/settings.json  >  ~/.claude/settings.json
```

**Array merging:** array-valued settings (e.g., `permissions.allow`, `sandbox.filesystem.allowWrite`, `additionalDirectories`) are **concatenated + deduplicated across scopes**, not replaced. Scalar and object fields follow normal last-wins precedence.

**Validation & backups:** `/status` surfaces configuration errors and their origin. Claude Code timestamps backups of settings files and keeps the five most recent.

**Docs:** <https://code.claude.com/docs/en/settings>

---

## 2. Top-level settings fields

Every documented top-level key for `settings.json`, verified against `code.claude.com/docs/en/settings.md`. Fields marked **(managed only)** take effect only in a managed-settings source. All are optional.

### 2.1 Core behaviour

| Field | Type | Purpose |
| --- | --- | --- |
| `$schema` | string | URL of the JSON schema (for editor validation). |
| `agent` | string | Run the main thread as the named subagent. |
| `model` | string | Default model ID (e.g. `claude-sonnet-4-6`). |
| `modelOverrides` | object | Map Anthropic model IDs to provider-specific IDs (Bedrock ARNs, Vertex IDs). |
| `availableModels` | array&lt;string&gt; | Restrict which models the picker shows. |
| `effortLevel` | string | `"low"` / `"medium"` / `"high"` / `"xhigh"`. |
| `alwaysThinkingEnabled` | boolean | Enable extended thinking by default. |
| `showThinkingSummaries` | boolean | Show thinking summaries in transcript. |
| `outputStyle` | string | Output-style name that adjusts the system prompt (e.g. `"Explanatory"`). |
| `env` | object | Env vars injected into every session. |
| `defaultShell` | string | `"bash"` or `"powershell"` for `!` commands. |
| `apiKeyHelper` | string | Path to a script that prints the API key to stdout. |
| `includeGitInstructions` | boolean | Include git workflow guidance in the system prompt. |
| `respectGitignore` | boolean | Whether the `@` file picker honors `.gitignore`. |
| `cleanupPeriodDays` | number | Age cutoff for session-file deletion (default 30). |
| `minimumVersion` | string | Floor version for auto-updates (e.g. `"2.1.100"`). |
| `autoUpdatesChannel` | string | `"stable"` or `"latest"`. |
| `companyAnnouncements` | array&lt;string&gt; | Announcements shown at startup. |
| `attribution` | object | `{commit, pr}` — customize git commit/PR attribution. |
| `plansDirectory` | string | Where plan files are stored (default `~/.claude/plans`). |

### 2.2 UI / rendering

| Field | Type | Purpose |
| --- | --- | --- |
| `tui` | string | `"fullscreen"` or `"default"`. |
| `editorMode` | string | `"normal"` or `"vim"` for the prompt input. |
| `viewMode` | string | `"default"` / `"verbose"` / `"focus"`. |
| `language` | string | Preferred response language (e.g. `"japanese"`). |
| `autoScrollEnabled` | boolean | Follow new output in fullscreen renderer. |
| `prefersReducedMotion` | boolean | Reduce/disable UI animations. |
| `terminalProgressBarEnabled` | boolean | Show terminal progress bar. |
| `showTurnDuration` | boolean | Show turn-duration messages. |
| `showClearContextOnPlanAccept` | boolean | Surface "clear context" option on plan accept. |
| `awaySummaryEnabled` | boolean | Recap when returning after an absence. |
| `spinnerTipsEnabled` | boolean | Show tips in the spinner. |
| `spinnerTipsOverride` | object | `{tips: [], excludeDefault: bool}`. |
| `spinnerVerbs` | object | `{mode: "replace" \| "append", verbs: []}`. |
| `voice` | object | `{enabled, mode, autoSubmit}` — voice dictation. |
| `teammateMode` | string | `"auto"` / `"in-process"` / `"tmux"` — agent-team display. |
| `prUrlTemplate` | string | URL template with `{*}` substitutions for PR badges. |
| `fileSuggestion` | object | `{type: "command", command: "..."}` — custom `@` autocomplete script. |

### 2.3 Permissions, hooks, MCP, plugins, status line

| Field | Type | Purpose |
| --- | --- | --- |
| `permissions` | object | Allow / deny / ask / default mode / additional dirs. See §4. |
| `hooks` | object | Event-driven automation. See §5. |
| `disableAllHooks` | boolean | Kill-switch for every hook (and custom status line). |
| `allowedHttpHookUrls` | array&lt;string&gt; | URL allowlist (supports `*` wildcards) for HTTP hooks. |
| `httpHookAllowedEnvVars` | array&lt;string&gt; | Env-var allowlist for HTTP hook payloads. |
| `statusLine` | object | `{type: "command", command: "..."}` — see §12. |
| `enabledPlugins` | object | `{"<plugin>@<marketplace>": true \| false}`. |
| `extraKnownMarketplaces` | object | Register additional plugin marketplaces. |
| `enableAllProjectMcpServers` | boolean | Auto-approve every MCP server in project `.mcp.json`. |
| `enabledMcpjsonServers` | array&lt;string&gt; | Approve named MCP servers from `.mcp.json`. |
| `disabledMcpjsonServers` | array&lt;string&gt; | Reject named MCP servers from `.mcp.json`. |

### 2.4 Auto mode, fast mode, memory, sandbox

| Field | Type | Purpose |
| --- | --- | --- |
| `autoMode` | object | `{environment, allow, soft_deny}` — customize the auto-mode classifier. |
| `useAutoModeDuringPlan` | boolean | Use auto-mode semantics in plan mode. |
| `fastModePerSessionOptIn` | boolean | Require opt-in to fast mode each session. |
| `autoMemoryEnabled` | boolean | Enable/disable the auto-memory system. |
| `autoMemoryDirectory` | string | Custom auto-memory storage path. |
| `sandbox` | object | Filesystem + network sandboxing. See §13. |
| `skipWebFetchPreflight` | boolean | Skip sending hostnames to `api.anthropic.com` before fetching. |

### 2.5 Provider / auth / telemetry

| Field | Type | Purpose |
| --- | --- | --- |
| `forceLoginMethod` | string | `"claudeai"` or `"console"`. |
| `forceLoginOrgUUID` | string \| array | Require login to a specific org (or one of a list). Empty array in managed settings fails closed. |
| `awsAuthRefresh` | string | Shell command to refresh `.aws`. |
| `awsCredentialExport` | string | Script that prints AWS creds as JSON. |
| `otelHeadersHelper` | string | Script that produces dynamic OpenTelemetry headers. |
| `feedbackSurveyRate` | number | 0-1 probability of post-session survey. |

### 2.6 Worktrees / SSH

| Field | Type | Purpose |
| --- | --- | --- |
| `worktree` | object | `{symlinkDirectories, sparsePaths}` — worktree management. |
| `sshConfigs` | array | Desktop SSH connection definitions. |
| `disableDeepLinkRegistration` | string | `"disable"` — prevent `claude-cli://` handler registration. |

### 2.7 Managed-only

All of these are ignored outside a managed-settings source.

| Field | Type | Purpose |
| --- | --- | --- |
| `allowedChannelPlugins` | array | `[{marketplace, plugin}]` allowlist. |
| `allowedMcpServers` | array | `[{serverName}]` allowlist for MCP. |
| `allowManagedHooksOnly` | boolean | Only managed/SDK/force-enabled plugin hooks fire. |
| `allowManagedMcpServersOnly` | boolean | Only managed MCP servers apply. |
| `allowManagedPermissionRulesOnly` | boolean | Only managed permission rules apply. |
| `blockedMarketplaces` | array | Marketplace denylist. |
| `channelsEnabled` | boolean | Enable channels for Team/Enterprise. |
| `deniedMcpServers` | array | MCP denylist (overrides allowlist). |
| `disableAutoMode` | string | `"disable"` to forbid auto mode. |
| `disableSkillShellExecution` | boolean | Forbid inline shell in skills. |
| `forceRemoteSettingsRefresh` | boolean | Block startup until remote settings refresh succeeds. |
| `pluginTrustMessage` | string | Custom text appended to plugin trust warning. |
| `strictKnownMarketplaces` | array | Marketplace allowlist. |
| `wslInheritsWindowsSettings` | boolean | WSL reads Windows managed-settings chain. |

### 2.8 Deprecated

- `includeCoAuthoredBy` (boolean) — superseded by `attribution`.
- `voiceEnabled` (boolean) — **DEPRECATED**; use `voice.enabled`.

### 2.9 Fields the Phase 1 research listed that are NOT in the settings doc

Removed from the inventory on verification: `theme`, `preferredNotifChannel`, `remoteControlAtStartup`, `skipAutoPermissionPrompt`, top-level `mcpServers`, `claudeMdExcludes`.

**Docs:** <https://code.claude.com/docs/en/settings>

---

## 3. Environment variables

Claude Code reads many env vars. They override settings files except for managed settings.

### 3.1 Authentication

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Direct Anthropic API key (bypasses Claude subscription auth). |
| `ANTHROPIC_AUTH_TOKEN` | Custom `Authorization` header value. |
| `ANTHROPIC_CUSTOM_HEADERS` | Extra HTTP headers for API requests. |

`ANTHROPIC_OAUTH_TOKEN` — not found under this name in published docs. The documented OAuth token env var is `CLAUDE_CODE_OAUTH_TOKEN` (plus `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` and `CLAUDE_CODE_OAUTH_SCOPES`).

### 3.2 Endpoints / providers

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_BASE_URL` | Override API endpoint (proxy, gateway, self-hosted). |
| `CLAUDE_CODE_USE_BEDROCK` | Route through AWS Bedrock. |
| `CLAUDE_CODE_USE_VERTEX` | Route through Google Vertex AI. |
| `ANTHROPIC_BEDROCK_BASE_URL` | Override Bedrock endpoint. |
| `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` | Override Bedrock Mantle endpoint. |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Full base URL for the Microsoft Foundry resource. |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Microsoft Foundry resource name. |
| `ANTHROPIC_VERTEX_BASE_URL` | Override Vertex endpoint. |
| `ANTHROPIC_VERTEX_PROJECT_ID` | GCP project ID for Vertex AI. |
| `AWS_REGION` / `CLOUD_ML_REGION` | Region for Bedrock / Vertex. |

### 3.3 Model selection

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_MODEL` | Default model for sessions. |
| `ANTHROPIC_SMALL_FAST_MODEL` | Model used for lightweight background tasks. |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model used when spawning subagents. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | Additional custom model ID for the model picker. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | Display name for the custom model entry. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION` | Description for the custom model entry. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES` | Capabilities override for the custom model entry. |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Pin the Sonnet-class model ID. |
| `ANTHROPIC_DEFAULT_SONNET_MODEL_NAME` | Display name for the pinned Sonnet model. |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Pin the Opus-class model ID. |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` | Display name for the pinned Opus model. |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Pin the Haiku-class model ID. |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME` | Display name for the pinned Haiku model. |

### 3.4 Feature toggles

| Variable | Purpose |
| --- | --- |
| `DISABLE_TELEMETRY` | Disable Statsig telemetry. |
| `DISABLE_ERROR_REPORTING` | Disable Sentry-style error reporting. |
| `DISABLE_AUTOUPDATER` | Disable background auto-update checks. |
| `DISABLE_FEEDBACK_COMMAND` | Hide the `/feedback` command (legacy alias `DISABLE_BUG_COMMAND` still works). |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Master kill-switch for telemetry + updates + reporting. |
| `CLAUDE_CODE_DISABLE_THINKING` | Disable extended thinking. |
| `CLAUDE_CODE_DISABLE_FAST_MODE` | Disable fast mode. |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Disable all background task functionality. |
| `CLAUDE_CODE_DISABLE_CRON` | Disable scheduled tasks. |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS` | Prevent loading any CLAUDE.md files. |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable auto memory. |
| `CLAUDE_CODE_DISABLE_ATTACHMENTS` | Disable attachment processing. |
| `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` | Disable file checkpointing. |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | Disable 1M context window support. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | Strip Anthropic beta headers from API requests. |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | Disable adaptive reasoning (Opus 4.6 / Sonnet 4.6). |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | Remove built-in git workflow instructions. |

### 3.5 Timeouts

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_TIMEOUT_MS` | 600000 (10 min) | API request timeout. |
| `BASH_DEFAULT_TIMEOUT_MS` | 120000 (2 min) | Default Bash-tool timeout. |
| `BASH_MAX_TIMEOUT_MS` | 600000 (10 min) | Ceiling on user-requested Bash timeouts. |
| `MCP_TIMEOUT` | 30000 (30 s) | MCP server startup timeout. |
| `MCP_TOOL_TIMEOUT` | 100000000 (~28 h) | Per-tool-call MCP timeout. |

### 3.6 Shell / tooling

| Variable | Purpose |
| --- | --- |
| `CLAUDE_CODE_SHELL` | Shell to invoke for Bash-tool commands. |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | Force `cwd` to project root for every Bash call. |
| `MAX_THINKING_TOKENS` | Cap extended-thinking budget. |

| `CLAUDE_CODE_DEBUG_LOGS_DIR` | Override the debug log file path. |
| `CLAUDE_CODE_DEBUG_LOG_LEVEL` | Minimum severity for debug logs (`verbose`/`debug`/`info`/`warn`/`error`). |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | Load CLAUDE.md from `--add-dir` directories. |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | Max characters for skill descriptions in context (default ~1% of context window, fallback 8000). |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | Enable the PowerShell tool on Windows. |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | Scrub environment variables for subprocess tools. |
| `CLAUDE_CODE_SIMPLE` | Enable minimal mode (no hooks/skills/plugins/MCP/memory discovery). |
| `CLAUDE_CODE_NEW_INIT` | Enable interactive multi-phase `/init` flow. |
| `CLAUDE_CODE_ENABLE_TASKS` | Enable experimental agent-task features. |
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Explicitly enable telemetry. |
| `CLAUDE_CODE_SKIP_PROMPT_HISTORY` | Disable transcript writes entirely. |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | Set `false` to disable claude.ai MCP servers. |
| `ENABLE_TOOL_SEARCH` | Control MCP tool-search behaviour (`true`/`auto`/`false`). |
| `ANTHROPIC_BETAS` | Comma-separated beta header values to include in API requests. |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | Percentage of context capacity (1-100) that triggers auto-compaction. |
| `CLAUDE_CONFIG_DIR` | Override the default `~/.claude` configuration directory. |
| `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` | Prefix for auto-generated remote-control session names (default: hostname). |
| `OTEL_*` | OpenTelemetry exporter variables (`OTEL_METRICS_EXPORTER`, `OTEL_TRACES_EXPORTER`, etc.).

**Docs:** <https://code.claude.com/docs/en/env-vars>

---

## 4. Permissions

Lives under `settings.json` → `permissions`. Every field in this block is verified against the settings doc.

| Field | Type | Purpose |
| --- | --- | --- |
| `allow` | array&lt;string&gt; | Tool-call patterns auto-approved. |
| `deny` | array&lt;string&gt; | Patterns blocked outright. |
| `ask` | array&lt;string&gt; | Patterns that always prompt, even in auto mode. |
| `defaultMode` | string | Startup permission mode — see below. |
| `disableBypassPermissionsMode` | string | Set to `"disable"` to prevent entering `bypassPermissions`. |
| `skipDangerousModePermissionPrompt` | boolean | Skip the confirmation before entering bypass mode (ignored in project-scope settings). |
| `additionalDirectories` | array&lt;string&gt; | Extra working directories for file access. |

### 4.1 `defaultMode` values (all six are documented)

| Value | Semantics |
| --- | --- |
| `default` | Standard mode — prompt on unknowns. |
| `acceptEdits` | Auto-accept file edits. |
| `plan` | Plan mode; no writes. |
| `auto` | Auto mode — the classifier decides. |
| `dontAsk` | No permission prompts (deprecated naming — prefer `bypassPermissions`). |
| `bypassPermissions` | Skip all permission checks (≡ `--dangerously-skip-permissions`). |

### 4.2 Rule syntax

`Tool` or `Tool(pattern)`. Patterns support `*` wildcards; `**` for recursive directory matching.

```
Bash                              # all Bash calls
Bash(npm run *)                   # prefix match
Read(./.env)                      # single file
Read(./secrets/**)                # subtree
Edit(./src/**)                    # subtree
WebFetch                          # all fetches
WebFetch(domain:example.com)      # domain match
MCP(server_name:memory)           # MCP tool scoped to server
Agent(subagent_name)              # subagent invocation
```

**Evaluation order:** `deny` → `ask` → `allow`; first match wins within each bucket. `deny` cannot be overridden.

### 4.3 Not real (reported by research, absent from doc)

- `mcpPermissions` — not a documented field. Use `MCP(server_name:*)` entries inside `allow`/`deny`/`ask` instead.

**Docs:** <https://code.claude.com/docs/en/settings>, <https://code.claude.com/docs/en/iam>

---

## 5. Hooks

Event-driven shell commands / prompts / HTTP calls / MCP tool invocations / subagents. Configured under `hooks` in any settings layer, in plugin `hooks/hooks.json`, or in skill/agent frontmatter.

### 5.1 Events

| Event | Cadence |
| --- | --- |
| `SessionStart` | Once per session (fresh or resumed) |
| `SessionEnd` | Once per session |
| `UserPromptSubmit` | Every user turn |
| `Stop` | End of every Claude turn |
| `SubagentStop` | End of every subagent turn |
| `PreToolUse` | Before each tool call (can block) |
| `PostToolUse` | After each tool call |
| `Notification` | When Claude emits a system notification |
| `PreCompact` | Before context compaction runs |

All four additional events confirmed in current docs: `StopFailure` (on turn-ending API errors), `PostToolUseFailure` (after tool failure), `PermissionRequest` (on permission dialog display), `PermissionDenied` (on auto-mode classifier denial).

### 5.2 Handler types

| Type | Contract |
| --- | --- |
| `command` | Shell command; receives event JSON on stdin, may write to stderr to influence the session. |
| `prompt` | String sent to Claude for a yes/no evaluation. |

All three handler types confirmed: `http` (POSTs JSON to a URL), `mcp_tool` (calls a tool on an MCP server), `agent` (spawns a subagent for evaluation). All documented in the hooks reference.

### 5.3 Config structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

`matcher` takes a tool name or regex. Matcher semantics differ by event — not all events expose a tool name.

**Docs:** <https://code.claude.com/docs/en/hooks>

---

## 6. Slash commands & skills (as extension points)

Built-in slash commands themselves are mostly out of scope — they're operational. What *is* in scope: the locations and file formats users use to **author** their own slash commands and skills. Those directories are a config surface.

### 6.1 Slash commands (legacy-ish)

| Location | Invocation |
| --- | --- |
| `~/.claude/commands/<name>.md` | `/<name>` (user-level) |
| `<project>/.claude/commands/<name>.md` | `/<name>` (project-level) |
| Plugin `commands/` | `/<plugin>:<name>` |

A slash-command file is Markdown with optional YAML frontmatter. The file body becomes the prompt body.

### 6.2 Skills (recommended form)

| Location | Invocation |
| --- | --- |
| `~/.claude/skills/<name>/SKILL.md` | `/<name>` |
| `<project>/.claude/skills/<name>/SKILL.md` | `/<name>` |
| Plugin `skills/<name>/SKILL.md` | `/<plugin>:<name>` |

A skill is a directory with `SKILL.md` plus optional helper files (templates, scripts, examples). Progressive disclosure: only `SKILL.md` loads eagerly; other files load on demand.

**Common frontmatter fields:**

```yaml
---
name: my-skill
description: "What this skill does and when to use it"
allowed-tools: "Read, Bash(npm *)"
argument-hint: "[target] [--flag]"
---
```

All frontmatter fields confirmed against current skills docs: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`.

**Docs:** <https://code.claude.com/docs/en/skills>, <https://code.claude.com/docs/en/slash-commands>

---

## 7. Subagents

Markdown files that define reusable specialist agents. Claude invokes them via the `Task` tool based on their descriptions.

| Location | Scope |
| --- | --- |
| `~/.claude/agents/<name>.md` | User |
| `<project>/.claude/agents/<name>.md` | Project |
| Plugin `agents/<name>.md` | Plugin |

**Frontmatter:**

```yaml
---
name: code-reviewer
description: "Use proactively after code changes to review quality"
tools: Read, Grep, Bash
model: sonnet
color: blue
---
```

All fields confirmed in current subagents docs: `maxTurns` (max agentic turns), `mcpServers` (inline/server-ref MCP servers), `hooks` (lifecycle hooks), `background` (auto-background), `isolation` (worktree isolation), `skills` (preloaded skills). Also confirmed: `memory` (persistent memory scope), `effort`, `permissionMode`, `color`, `initialPrompt`.

**Docs:** <https://code.claude.com/docs/en/sub-agents>

---

## 8. Plugins

A plugin is a directory that bundles commands / skills / agents / hooks / MCP server configs for easy installation. Installing or enabling a plugin is itself a config change (it mutates `enabledPlugins`).

**Config-management paths:** `/plugin install <name>@<marketplace>` / `/plugin uninstall` / `/plugin` (enable-disable UI).

**Layout:**

```
my-plugin/
├── .claude-plugin/plugin.json    # manifest (optional with auto-discovery)
├── commands/
├── agents/
├── skills/
├── hooks/hooks.json
├── .mcp.json
└── README.md
```

**Manifest (`plugin.json`):**

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "...",
  "author": { "name": "...", "email": "...", "url": "..." },
  "homepage": "...",
  "repository": "...",
  "license": "MIT",
  "keywords": ["..."]
}
```

**Runtime placeholder:** `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's install directory — use it in hook commands, MCP configs, etc.

**Settings toggles:**

- `enabledPlugins`: `{"<plugin>@<marketplace>": true}` — enable/disable without uninstalling. Setting to `false` in **managed** settings blocks installation at every scope.
- `extraKnownMarketplaces`: register custom marketplaces (see source types below).
- `strictKnownMarketplaces` **(managed only)**: allowlist of approved marketplace sources.
- `blockedMarketplaces` **(managed only)**: denylist, enforced before download.
- `allowedChannelPlugins` **(managed only)**: allowlist for channel-pushed plugins.

**Plugin source types** (used in `marketplace.json` to specify where each plugin is fetched from):

| Source | Fields | Notes |
| --- | --- | --- |
| Relative path | `"./path/to/plugin"` (string) | Local directory within the marketplace repo. Must start with `./`. |
| `github` | `repo`, optional `ref?`, `sha?` | GitHub repository in `owner/repo` format. |
| `url` | `url`, optional `ref?`, `sha?` | Git URL source (e.g. `https://gitlab.com/team/plugin.git`). |
| `git-subdir` | `url`, `path`, optional `ref?`, `sha?` | Subdirectory within a git repo; sparse-cloned to minimize bandwidth. |
| `npm` | `package`, optional `version?`, `registry?` | Installed via `npm install`. Supports scoped packages. |

Note: `hostPattern` and `pathPattern` are **marketplace-source** restriction types for `strictKnownMarketplaces` / `blockedMarketplaces`, not plugin source types.

**Docs:** <https://code.claude.com/docs/en/plugins>, <https://code.claude.com/docs/en/plugin-marketplaces>

---

## 9. MCP servers

Model Context Protocol servers expose tools / resources / prompts to Claude.

### 9.1 Where configured

| Location | Scope |
| --- | --- |
| `<project>/.mcp.json` | Project (team-shared, committed) |
| `~/.claude.json` (under `mcpServers` / `projects[*].mcpServers`) | User |
| Plugin `.mcp.json` | Plugin |
| `managed-mcp.json` (macOS/Linux/Windows managed paths) | Enterprise |

**Note:** top-level `mcpServers` is **not** a documented field of `settings.json`. User/project MCP config lives in `~/.claude.json` and `.mcp.json` respectively. Settings.json governs MCP via the fields listed in §9.5.

### 9.2 Connection types

| Type | Use case |
| --- | --- |
| `stdio` | Local CLI binaries / npm packages launched as subprocesses. |
| `sse` | Server-sent events streams. |
| `http` | Plain HTTP(S) endpoints. |

Confirmed: stdio, sse, and http are the documented MCP transport types.

### 9.3 Example

```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}
```

### 9.4 CLI management (config-management paths)

Subcommands that read or mutate MCP config on disk:

- `claude mcp list` — show resolved MCP config.
- `claude mcp add <name> [--scope local|project|user] -- <command> [args...]` — writes to `~/.claude.json` (local/project/user scope) or `.mcp.json` (project scope). `local` is the default scope.
- `claude mcp remove <name>` — delete entry.

### 9.5 Settings.json fields that gate MCP

| Field | Scope | Purpose |
| --- | --- | --- |
| `enableAllProjectMcpServers` | any | Auto-approve everything in project `.mcp.json`. |
| `enabledMcpjsonServers` | any | Approve named servers from `.mcp.json`. |
| `disabledMcpjsonServers` | any | Reject named servers from `.mcp.json`. |
| `allowedMcpServers` | managed | `[{serverName}]` allowlist. |
| `deniedMcpServers` | managed | `[{serverName}]` denylist (wins over allowlist). |
| `allowManagedMcpServersOnly` | managed | Only managed MCP servers take effect. |

**Docs:** <https://code.claude.com/docs/en/mcp>

---

## 10. Memory & CLAUDE.md

Markdown files that Claude loads as persistent context.

### 10.1 Files

| Path | Scope |
| --- | --- |
| Managed `CLAUDE.md` | Enterprise-wide |
| `~/.claude/CLAUDE.md` | User |
| `<project>/CLAUDE.md` | Project (team-shared, committed) |
| `<project>/CLAUDE.local.md` | Project (personal, gitignored) |
| Nested `CLAUDE.md` anywhere under the project | Loads on-demand when Claude enters that subtree |

**Precedence (highest wins):** Managed > local > project > user.

### 10.2 Features

- **Imports:** `@path/to/file.md` — up to 5 levels deep.
- **Comments:** HTML comments `<!-- ... -->` are stripped before loading.
- **Size target:** < 200 lines for strong adherence.

### 10.3 Project rules

`<project>/.claude/rules/*.md` — scoped markdown rules, optionally path-gated:

```yaml
---
paths: ["src/**/*.ts"]
---
```

Rules directory (`.claude/rules/*.md`) and `paths` frontmatter confirmed in current memory docs. Rules without `paths` load unconditionally; rules with `paths` glob patterns load only when Claude works with matching files. Also confirmed: user-level rules at `~/.claude/rules/`.

### 10.4 Auto memory

Persistent memory system that writes to `~/.claude/projects/<slug>/memory/`. Controlled by `autoMemoryEnabled` and `autoMemoryDirectory` settings. The `MEMORY.md` index is always loaded; topic files load on demand.

**Docs:** <https://code.claude.com/docs/en/memory>

---

## 11. Keybindings

Global keyboard shortcuts.

**Path:** `~/.claude/keybindings.json`

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+e": "chat:externalEditor",
        "shift+enter": "chat:newline",
        "ctrl+u": null
      }
    }
  ]
}
```

- **Modifiers:** `ctrl`, `shift`, `alt`, `meta`.
- **Chords:** `ctrl+k ctrl+s` (space-separated).
- **Unbind:** map a binding to `null`.
- **Contexts:** Chat, Global, Autocomplete, Settings, Confirmation, Tabs, Help, Transcript, HistorySearch, Task, ThemePicker, Attachments, Footer, MessageSelector, DiffDialog, ModelPicker, Select, Plugin, Scroll, Doctor.

All 20 contexts confirmed against current keybindings docs: Chat, Global, Autocomplete, Settings, Confirmation, Tabs, Help, Transcript, HistorySearch, Task, ThemePicker, Attachments, Footer, MessageSelector, DiffDialog, ModelPicker, Select, Plugin, Scroll, Doctor.

**Docs:** <https://code.claude.com/docs/en/keybindings>

---

## 12. Statusline

Custom status bar rendered at the bottom of the TUI.

**Config-management path:** `/statusline` slash command (reads/writes the setting).
**Setting:** `statusLine` in `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

Claude pipes a JSON context blob to the command on stdin; stdout becomes the status bar.

**Popular community scripts:** ccstatusline, claude-statusline, claude-powerline.

Full JSON schema confirmed against current docs. Key context fields: `model` (id, display\_name), `workspace` (current\_dir, project\_dir, added\_dirs, git\_worktree), `context_window` (used\_percentage, remaining\_percentage, context\_window\_size, total\_input/output\_tokens, current\_usage), `cost` (total\_cost\_usd, total\_duration\_ms, total\_api\_duration\_ms, total\_lines\_added/removed), `rate_limits` (five\_hour, seven\_day), `session_id`, `session_name`, `transcript_path`, `version`, `output_style`, `vim`, `agent`, `worktree`, `effort`, `thinking`, `exceeds_200k_tokens`.

**Docs:** <https://code.claude.com/docs/en/statusline>

---

## 13. Sandbox

Optional filesystem + network sandboxing for tool subprocesses. Configured under `settings.json` → `sandbox`. Full schema verified against the settings doc.

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker *"],
    "allowUnsandboxedCommands": false,
    "enableWeakerNestedSandbox": false,
    "enableWeakerNetworkIsolation": false,
    "filesystem": {
      "allowRead": ["."],
      "allowWrite": ["/tmp/build", "~/.kube"],
      "denyRead": ["~/.aws/credentials"],
      "denyWrite": ["/etc", "/usr/local/bin"],
      "allowManagedReadPathsOnly": false
    },
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"],
      "deniedDomains": ["sensitive.cloud.example.com"],
      "allowManagedDomainsOnly": false,
      "allowUnixSockets": ["~/.ssh/agent-socket"],
      "allowAllUnixSockets": true,
      "allowLocalBinding": true,
      "allowMachLookup": ["com.apple.coresimulator.*"],
      "httpProxyPort": 8080,
      "socksProxyPort": 8081
    }
  }
}
```

**Path prefix rules inside sandbox config (distinct from permission rules):**

- `/…` — absolute, from filesystem root
- `~/…` — expanded to `$HOME`
- `./…` or bare — project root for project settings, `~/.claude` for user settings

**Docs:** <https://code.claude.com/docs/en/settings>

---

## 14. IDE integrations

### 14.1 VS Code

- Extension: "Claude Code" in the VS Code Marketplace.
- Settings: VS Code `settings.json` namespace.
- `Cmd/Ctrl+Esc` to toggle Claude panel.

### 14.2 JetBrains

- Plugin: "Claude Code" in JetBrains Marketplace.
- `Cmd+Option+K` (macOS) / `Alt+Ctrl+K` (Linux/Win) inserts a file reference.
- `Cmd+Esc` (macOS) / `Ctrl+Esc` (Linux/Win) quick-launch shortcut.

### 14.3 IDE-bridge config in `~/.claude.json`

Distinct from `~/.claude/settings.json`. Holds:

| Field | Purpose |
| --- | --- |
| `autoConnectIde` | Auto-connect to IDE when started from an external terminal. |
| `autoInstallIdeExtension` | Auto-install the VS Code extension on first run. |
| `externalEditorContext` | Prepend the last response as a comment when opening the external editor. |

The `/ide` slash command itself is a runtime *action* (connects current session) and so is out of scope — but `autoConnectIde` is the config that governs whether it auto-fires.

Shortcuts confirmed against current docs: VS Code — `Cmd+Esc` / `Ctrl+Esc` to toggle panel, `Option+K` / `Alt+K` to insert @-mention reference. JetBrains — `Cmd+Option+K` (macOS) / `Alt+Ctrl+K` (Linux/Windows) to insert file reference.

**Docs:** <https://code.claude.com/docs/en/vs-code>, <https://code.claude.com/docs/en/jetbrains>

---

## 15. CLI flags that shadow settings

Only flags that override a settings-file entry are listed here. Session-starting flags (`-p`, `-c`, `-r`) and session-only flags (`--append-system-prompt`) are out of scope per the top-level scope statement.

| Flag | Equivalent setting | Notes |
| --- | --- | --- |
| `--model <name>` | `model` | Per-session override. |
| `--permission-mode <mode>` | `permissions.defaultMode` | Start in plan / acceptEdits / bypassPermissions / auto. |
| `--dangerously-skip-permissions` | `permissions.defaultMode: "bypassPermissions"` | Auto-accept everything. |
| `--add-dir <path>` | `permissions.additionalDirectories` | Repeatable; grants extra read/write. |
| `--allowedTools "<rules>"` | `permissions.allow` | Comma-separated tool patterns. |
| `--disallowedTools "<rules>"` | `permissions.deny` | — |
| `--mcp-config <file>` | `.mcp.json` | Load MCP config from a path. |
| `--settings <file>` | — | Load an additional settings file (either a JSON file path or an inline JSON string) into the merge chain. |
| `--setting-sources <list>` | — | Comma-separated list of settings sources to load (`user`, `project`, `local`). |

`--setting-sources` flag confirmed: comma-separated list of setting sources to load (`user`, `project`, `local`). Example: `--setting-sources user,project`.

**Docs:** <https://code.claude.com/docs/en/cli-reference>

---

## 16. Deprecated & legacy

| Legacy form | Current form | Status |
| --- | --- | --- |
| `.claude/commands/*.md` | `.claude/skills/<name>/SKILL.md` | Commands still work; skills preferred. |
| `AGENTS.md` | Import into `CLAUDE.md` | Not native to Claude Code. |
| Bash-tool `allow` lists | `permissions.allow` with rule syntax | Superseded. |

All three deprecations confirmed: `.claude/commands/*.md` still works but skills are preferred; `AGENTS.md` is not native (import into `CLAUDE.md` with `@AGENTS.md`); legacy Bash-tool `allow` lists were superseded by permission-rule syntax.

---

## Precedence summary

**Settings resolution (highest wins, verified):**

```
Managed settings  >  CLI flags  >  .claude/settings.local.json  >  .claude/settings.json  >  ~/.claude/settings.json
```

Managed-tier chain (only one source wins — tiers do not merge across types):

```
Server-managed (Anthropic)  >  MDM / OS policy (plist, registry)  >  File-based (managed-settings.d/ + managed-settings.json merged)  >  HKCU registry
```

**Array merging across scopes:** array-valued fields (e.g. `permissions.allow`, `additionalDirectories`, `sandbox.filesystem.allowWrite`) are **concatenated + deduplicated** across layers, not replaced. Scalar/object fields follow normal last-wins.

**Memory resolution (highest wins):**

```
Managed CLAUDE.md  >  CLAUDE.local.md (cwd + ancestors)  >  CLAUDE.md (cwd + ancestors)  >  ~/.claude/CLAUDE.md  >  auto-memory MEMORY.md
```

**Permission-rule evaluation:** `deny` → `ask` → `allow`; first match wins within each bucket. `deny` cannot be overridden.

---

## Canonical references

- Settings — <https://code.claude.com/docs/en/settings>
- Environment variables — <https://code.claude.com/docs/en/env-vars>
- Hooks — <https://code.claude.com/docs/en/hooks>
- Slash commands — <https://code.claude.com/docs/en/slash-commands>
- Skills — <https://code.claude.com/docs/en/skills>
- Subagents — <https://code.claude.com/docs/en/sub-agents>
- Plugins — <https://code.claude.com/docs/en/plugins>
- MCP — <https://code.claude.com/docs/en/mcp>
- Memory — <https://code.claude.com/docs/en/memory>
- Keybindings — <https://code.claude.com/docs/en/keybindings>
- Statusline — <https://code.claude.com/docs/en/statusline>
- CLI reference — <https://code.claude.com/docs/en/cli-reference>
- IAM / auth — <https://code.claude.com/docs/en/iam>
- VS Code — <https://code.claude.com/docs/en/vs-code>
- JetBrains — <https://code.claude.com/docs/en/jetbrains>
