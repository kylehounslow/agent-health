<!--
  * Copyright OpenSearch Contributors
  * SPDX-License-Identifier: Apache-2.0
-->

# RFC 001: Coding Agent Analytics

| Field        | Value                                      |
|--------------|--------------------------------------------|
| **Status**   | Implemented (Phase 1)                      |
| **Author**   | Anirudha Jadhav                            |
| **Created**  | 2026-04-06                                 |
| **PR**       | anirudha/agent-health#1                    |

## Summary

Add a unified analytics dashboard to Agent Health that reads local session data from coding agents — **Claude Code**, **Kiro**, and **Codex CLI** — and provides cross-agent usage metrics, cost estimation, activity patterns, and tool analytics. This transforms Agent Health from a pure evaluation framework into a complete agentic observability platform.

## Motivation

### Problem

Developers using AI coding agents lack visibility into their usage patterns:

1. **No cross-agent view** — Each agent stores data in its own format in its own directory. There's no way to see combined usage across Claude Code, Kiro, and Codex CLI.
2. **No cost visibility** — Token usage is buried in JSONL files and SQLite databases. Developers can't easily answer "how much am I spending on AI coding?"
3. **No usage patterns** — Activity heatmaps, streaks, peak hours, and tool preferences require manual log parsing.
4. **No tool comparison** — Understanding which tools different agents use, how often, and for what purposes requires reading raw session data.

### Prior Art

- **[cc-lens](https://github.com/Arindam200/cc-lens)** (MIT) — Claude Code-specific analytics dashboard. Rich feature set but limited to a single agent and runs as a standalone Next.js app.
- **[openSVM/vibedev](https://github.com/openSVM/vibedev)** — Rust CLI/TUI for AI coding assistant usage across 15+ tools. Broad but shallow; no web dashboard.

### Why Agent Health

Agent Health already has:
- An Express server with API routes
- React frontend with recharts and shadcn/ui
- A connector system for different agent protocols
- Trace visualization for OTel spans
- Benchmark/evaluation infrastructure

Adding coding agent analytics is a natural extension — developers can now see both **how well agents perform** (existing benchmarks) and **how agents are actually used** (new analytics).

## Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Local Filesystem                          │
│                                                                  │
│  ~/.claude/                ~/.kiro/              ~/.codex/       │
│  └── projects/             └── sessions/cli/     └── sessions/  │
│      └── <slug>/               ├── <id>.jsonl        └── YYYY/  │
│          └── <id>.jsonl        └── <id>.json             └── DD/│
│                                                          └── rollout-*.jsonl
└──────────────┬────────────────────┬──────────────────┬──────────┘
               │                    │                  │
               ▼                    ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Coding Agent Readers                          │
│                                                                  │
│  ┌─────────────────┐ ┌─────────────┐ ┌────────────────────────┐ │
│  │ ClaudeCodeReader │ │ KiroReader  │ │     CodexReader        │ │
│  │ JSONL parser     │ │ JSONL+JSON  │ │ Rollout JSONL parser   │ │
│  │ Full tokens      │ │ Partial tkn │ │ No tokens (runtime)    │ │
│  └────────┬─────────┘ └─────┬───────┘ └──────────┬─────────────┘ │
│           │                 │                    │                │
│           ▼                 ▼                    ▼                │
│   ┌─────────────────────────────────────────────────────┐       │
│   │           CodingAgentReader Interface                │       │
│   │ isAvailable() → bool                                │       │
│   │ getSessions() → AgentSession[]                      │       │
│   │ getStats()    → AgentStats                          │       │
│   └─────────────────────────┬───────────────────────────┘       │
│                             │                                    │
│   ┌─────────────────────────▼───────────────────────────┐       │
│   │           CodingAgentRegistry                        │       │
│   │ getAvailableReaders() — auto-detect installed agents │       │
│   │ getAllSessions()      — merge + sort across agents   │       │
│   │ getCombinedStats()    — aggregate metrics            │       │
│   │ getCostAnalytics()    — cross-agent cost breakdown   │       │
│   │ getActivityData()     — streaks, heatmap, patterns   │       │
│   │ getToolsAnalytics()   — tool usage rankings          │       │
│   └─────────────────────────┬───────────────────────────┘       │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express API Routes                           │
│                                                                  │
│  GET /api/coding-agents/available — detected agents              │
│  GET /api/coding-agents/stats     — combined metrics             │
│  GET /api/coding-agents/sessions  — all sessions (?agent=&limit=)│
│  GET /api/coding-agents/costs     — cost analytics               │
│  GET /api/coding-agents/activity  — streaks, heatmap, patterns   │
│  GET /api/coding-agents/tools     — tool usage rankings          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     React Frontend                               │
│                                                                  │
│  /coding-agents (tabbed dashboard)                               │
│  ├── Overview  — stat cards, agent pie chart, daily activity     │
│  ├── Sessions  — filterable table with agent badges              │
│  ├── Costs     — model breakdown, project costs                  │
│  ├── Activity  — streaks, hourly/DOW charts, heatmap             │
│  └── Tools     — category chart, top tools table                 │
└─────────────────────────────────────────────────────────────────┘
```

### Reader Plugin Interface

```typescript
interface CodingAgentReader {
  readonly agentName: AgentKind;       // 'claude-code' | 'kiro' | 'codex'
  readonly displayName: string;        // 'Claude Code' | 'Kiro' | 'Codex CLI'
  isAvailable(): Promise<boolean>;     // Check if data dir exists
  getSessions(): Promise<AgentSession[]>;
  getStats(): Promise<AgentStats>;
}
```

All readers normalize their output to a common `AgentSession` type:

```typescript
interface AgentSession {
  agent: AgentKind;
  session_id: string;
  project_path: string;
  start_time: string;
  duration_minutes: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_counts: Record<string, number>;
  input_tokens: number;           // 0 if unavailable
  output_tokens: number;          // 0 if unavailable
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  first_prompt: string;
  estimated_cost: number;         // 0 if tokens unavailable
  uses_mcp: boolean;
  model?: string;
}
```

### Data Sources Per Agent

| Data Source | Claude Code | Kiro | Codex CLI |
|-------------|-------------|------|-----------|
| **Location** | `~/.claude/projects/<slug>/<id>.jsonl` | `~/.kiro/sessions/cli/<id>.jsonl` + `<id>.json` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| **Format** | JSONL (one object per event) | JSONL (transcript) + JSON (per-turn metadata) | JSONL (timestamped items) |
| **Session ID** | Filename (UUID) | Filename (UUID) | Embedded in rollout filename |
| **Timestamps** | `timestamp` field on each event | `timestamp` field | `timestamp` field |
| **User messages** | `type: "user"` events | `role: "user"` lines | `item.type: "message", item.role: "user"` |
| **Assistant messages** | `type: "assistant"` events | `role: "assistant"` lines | `item.type: "message", item.role: "assistant"` |
| **Token usage** | `message.usage.{input_tokens, output_tokens, cache_*}` | Companion `.json` file has `turns[].{input_token_count, output_token_count}` | Runtime-only (`ThreadTokenUsageUpdatedNotification`) — **not persisted** |
| **Tool invocations** | `content[].type === "tool_use"` with `name` field | `content[].toolName` + optional `serverName` for MCP | `item.type === "EventMsg"` or `"function_call"` |
| **Cost estimation** | Full (input + output + cache write + cache read) | Partial (input + output, no cache breakdown) | **Unavailable** (no token counts in rollout files) |
| **Project path** | `cwd` field in early JSONL lines | `cwd` field | `item.working_directory` in SessionMeta |
| **MCP tools** | Prefix `mcp__<server>__<tool>` | `serverName` + `toolName` fields | Not applicable |
| **Model info** | `message.model` on assistant turns | Not in JSONL (available in SQLite) | `item.model` in SessionMeta |
| **Stats cache** | `~/.claude/stats-cache.json` (pre-aggregated) | None | None |

### Pricing Engine

Multi-vendor pricing with fuzzy model matching:

```typescript
const PRICING: Record<string, ModelPricing> = {
  // Claude models
  'claude-opus-4-6':                { input: $15/1M, output: $75/1M, cacheWrite: $18.75/1M, cacheRead: $1.50/1M },
  'claude-sonnet-4-6':              { input: $3/1M,  output: $15/1M, cacheWrite: $3.75/1M,  cacheRead: $0.30/1M },
  'claude-haiku-4-5':               { input: $0.80/1M, output: $4/1M, cacheWrite: $1/1M,   cacheRead: $0.08/1M },
  // Bedrock (Kiro)
  'us.anthropic.claude-sonnet-4-6': { input: $3/1M,  output: $15/1M, ... },
  // OpenAI (Codex)
  'o3':                             { input: $2/1M,  output: $8/1M,  cacheWrite: $0, cacheRead: $0 },
  'o4-mini':                        { input: $1.10/1M, output: $4.40/1M, ... },
  'gpt-4.1':                        { input: $2/1M,  output: $8/1M,  ... },
};
```

Fallback: if model not found, fuzzy-match on prefix, then default to `claude-sonnet-4-6`.

### Tool Categorization

Unified categories across all agents:

| Category | Claude Code Tools | Kiro Tools | Codex Tools |
|----------|------------------|------------|-------------|
| File I/O | Read, Write, Edit, Glob, Grep, NotebookEdit | readFile, writeFile, editFile, listFiles, searchFiles | read_file, write_file, list_directory |
| Shell | Bash | executeCommand | shell |
| Agent | Task*, Agent | — | — |
| Web | WebSearch, WebFetch | — | — |
| Planning | EnterPlanMode, ExitPlanMode, AskUserQuestion | — | — |
| Todo | TodoWrite | — | — |
| Skills | Skill, ToolSearch | — | — |
| MCP | `mcp__*` prefix | `mcp_<server>__<tool>` | — |
| Other | Everything else | Everything else | Everything else |

### Auto-Detection

The registry checks for directory existence at startup:

```
~/.claude/projects/  → Claude Code detected
~/.kiro/sessions/cli/ → Kiro detected
~/.codex/sessions/   → Codex CLI detected
```

No configuration required for defaults. Optional override in `agent-health.config.ts`:

```typescript
export default {
  codingAgents: {
    claudeCode: { enabled: true, dataDir: "~/.claude" },
    kiro: { enabled: true, dataDir: "~/.kiro" },
    codex: { enabled: true, dataDir: "~/.codex" },
  }
};
```

## Implementation Plan

### Phase 1: Core Infrastructure + Claude Code (Implemented)

**Status: Complete** — PR anirudha/agent-health#1

- [x] `CodingAgentReader` interface and common types
- [x] `CodingAgentRegistry` with auto-detection
- [x] Claude Code reader (ported from cc-lens)
- [x] Kiro reader (JSONL + JSON metadata)
- [x] Codex CLI reader (rollout JSONL)
- [x] Pricing engine (Claude, Bedrock, OpenAI models)
- [x] Tool categorization across all agents
- [x] 6 Express API routes
- [x] React tabbed dashboard (Overview, Sessions, Costs, Activity, Tools)
- [x] Sidebar navigation entry

### Phase 2: Enhanced Readers & Session Replay

- [ ] **Claude Code stats-cache integration** — Merge `~/.claude/stats-cache.json` pre-aggregated data with JSONL-derived data for faster initial load
- [ ] **Session replay** — Turn-by-turn conversation view with token-per-turn visualization (port cc-lens `replay-parser.ts`)
- [ ] **Kiro SQLite integration** — Read `devdata.sqlite` for more accurate token counts and historical data going back further than CLI sessions
- [ ] **Codex SQLite state DB** — Read thread metadata (model, working directory, timestamps) for richer session info
- [ ] **Facets integration** — Read Claude Code's `~/.claude/usage-data/facets/` for goal categorization, satisfaction analysis, and session type classification

### Phase 3: Cross-Agent Comparison & Insights

- [ ] **Side-by-side comparison page** — Compare agent performance on the same project (token efficiency, tool preferences, session length)
- [ ] **Cost trends over time** — Stacked area chart showing daily/weekly cost by agent and model
- [ ] **Project-level analytics** — Drill into a specific project to see all agent sessions, costs, and tool usage for that repo
- [ ] **Export/import** — Export analytics data as JSON/CSV for sharing or archival

### Phase 4: Advanced Analytics

- [ ] **Prompt pattern analysis** — Categorize first prompts (bug fix, feature, refactor, question) and correlate with session characteristics
- [ ] **Cache efficiency dashboard** — Detailed Claude Code cache hit rates, savings over time, and optimization suggestions
- [ ] **MCP server analytics** — Which MCP servers are used, how often, by which agents, and error rates
- [ ] **Memory & plans viewer** — Port cc-lens Memory and Plans tabs for Claude Code data
- [ ] **Historical trends** — Week-over-week and month-over-month comparisons

### Phase 5: Extensibility

- [ ] **Reader SDK** — Document how to create custom readers for new agents (Cursor, Windsurf, Aider, Continue, etc.)
- [ ] **CLI integration** — `npx @opensearch-project/agent-health coding-agents stats` for headless analytics
- [ ] **Webhook/export** — Push analytics data to external systems (Prometheus, Grafana, OpenSearch)
- [ ] **Config file override** — Allow custom data directories for non-standard agent installations

## Data Flow

```
                              ┌────────────────────┐
                              │  Browser (React)    │
                              │                     │
                              │  GET /api/coding-   │
                              │  agents/stats       │
                              └─────────┬───────────┘
                                        │ HTTP
                                        ▼
                              ┌────────────────────┐
                              │  Express Server     │
                              │  (port 4001)        │
                              │                     │
                              │  codingAgentsRoutes │
                              └─────────┬───────────┘
                                        │
                                        ▼
                              ┌────────────────────┐
                              │  Registry           │
                              │                     │
                              │  1. Check which     │
                              │     agents exist    │
                              │  2. Call readers    │
                              │  3. Merge results   │
                              └───┬─────┬─────┬────┘
                                  │     │     │
                   ┌──────────────┘     │     └──────────────┐
                   ▼                    ▼                    ▼
           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
           │ ClaudeCode   │   │ Kiro         │   │ Codex        │
           │ Reader       │   │ Reader       │   │ Reader       │
           │              │   │              │   │              │
           │ fs.readFile  │   │ fs.readFile  │   │ fs.readFile  │
           │ JSON.parse   │   │ JSON.parse   │   │ JSON.parse   │
           └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                  │                  │                   │
                  ▼                  ▼                   ▼
           ~/.claude/          ~/.kiro/           ~/.codex/
           projects/           sessions/cli/      sessions/
           <slug>/*.jsonl      *.jsonl + *.json   YYYY/MM/DD/*.jsonl
```

## Security Considerations

1. **Read-only access** — Readers only read from agent data directories. No writes, no deletions.
2. **Local data only** — All data stays on the local machine. No network calls to agent APIs.
3. **No credential exposure** — Session JSONL files may contain prompts and code snippets. The API routes serve this data only to `localhost`.
4. **First prompt truncation** — Session first prompts are truncated to 500 characters to limit exposure of potentially sensitive content.
5. **Path traversal** — Agent data directories are hardcoded to `~/.claude/`, `~/.kiro/`, `~/.codex/` — not user-controllable in Phase 1 (config override planned for Phase 5).

## Performance Considerations

1. **Lazy tab loading** — Frontend only fetches data for the active tab. Overview and stats load on mount; sessions, costs, activity, and tools load on tab switch.
2. **File I/O bound** — Readers parse JSONL files synchronously line-by-line. For users with thousands of sessions, this could take seconds. Phase 2 should add caching or incremental parsing.
3. **No caching** — API responses are not cached in Phase 1. Each request re-reads the filesystem. This is acceptable for local usage but should be addressed with in-memory caching + file watcher invalidation.
4. **Session limit** — The sessions endpoint defaults to 100 sessions (configurable via `?limit=`) to avoid loading thousands of sessions into the browser.

## Alternatives Considered

### Embed cc-lens as iframe

**Rejected.** Would require users to run two servers (agent-health on 4001, cc-lens on 3000). Poor integration, no cross-agent view, and breaks the single-server principle.

### Import cc-lens as a dependency

**Rejected.** cc-lens is a Next.js app, not a library. Its code is tightly coupled to Next.js API routes and React Server Components. Porting the core logic (reader, parser, pricing) is cleaner.

### Read agent data from browser via File System Access API

**Rejected.** The File System Access API requires user permission per directory and doesn't work in all browsers. Server-side filesystem reading is more reliable and consistent with agent-health's server-mediated architecture.

### Use agent APIs instead of local files

**Rejected.** Claude Code, Kiro, and Codex CLI don't expose usage analytics APIs. Local file reading is the only way to access historical session data.

## Open Questions

1. **Caching strategy** — Should we implement LRU in-memory caching with file modification time checks, or is filesystem read performance acceptable for typical usage (~100-1000 sessions)?
2. **Incremental updates** — Should readers track which files have been processed and only parse new sessions, or re-scan everything on each request?
3. **Agent comparison scoring** — How should we compare agents that have different data availability? Codex has no token counts, so cost comparisons are inherently unfair.
4. **Privacy controls** — Should we add options to redact first prompts or limit which projects appear in analytics?
5. **Agent detection frequency** — Should the registry re-check for newly installed agents on each request, or only at server startup?

## References

- [cc-lens](https://github.com/Arindam200/cc-lens) — Claude Code analytics dashboard (MIT license, data format reference)
- [OpenAI Codex CLI](https://github.com/openai/codex) — Codex CLI source (rollout file format)
- [Agent Health Architecture](./ARCHITECTURE.md) — Server-mediated access principle
- [Agent Health Connectors](./CONNECTORS.md) — Existing connector system for agent protocols
