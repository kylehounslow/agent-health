/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unified types for coding agent analytics.
 * All agent readers normalize their data into these common types
 * so the frontend can render them uniformly.
 */

// ─── Common Session ──────────────────────────────────────────────────────────

export interface AgentSession {
  agent: AgentKind;
  session_id: string;
  project_path: string;
  start_time: string;
  duration_minutes: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_counts: Record<string, number>;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  first_prompt: string;
  estimated_cost: number;
  uses_mcp: boolean;
  model?: string;
}

export type AgentKind = 'claude-code' | 'kiro' | 'codex';

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface AgentStats {
  agent: AgentKind;
  totalSessions: number;
  totalCost: number;
  totalCacheSavings: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  activeDays: number;
  avgSessionMinutes: number;
  dailyActivity: DailyActivity[];
}

export interface CombinedStats {
  agents: AgentStats[];
  dailyActivity: DailyActivity[];
  totalCost: number;
  totalSessions: number;
  totalTokens: number;
}

// ─── Costs ───────────────────────────────────────────────────────────────────

export interface ModelCostBreakdown {
  agent: AgentKind;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  estimated_cost: number;
  cache_savings: number;
}

export interface ProjectCost {
  agent: AgentKind;
  project_path: string;
  display_name: string;
  estimated_cost: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CostAnalytics {
  total_cost: number;
  total_savings: number;
  models: ModelCostBreakdown[];
  by_project: ProjectCost[];
}

// ─── Activity ────────────────────────────────────────────────────────────────

export interface ActivityData {
  daily_activity: DailyActivity[];
  hour_counts: Array<{ hour: number; count: number }>;
  dow_counts: Array<{ day: string; count: number }>;
  streaks: { current: number; longest: number };
  total_active_days: number;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ToolSummary {
  agent: AgentKind;
  name: string;
  category: string;
  total_calls: number;
  session_count: number;
}

export interface ToolsAnalytics {
  tools: ToolSummary[];
  total_tool_calls: number;
}

// ─── Reader Interface ────────────────────────────────────────────────────────

export interface CodingAgentReader {
  readonly agentName: AgentKind;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  getSessions(): Promise<AgentSession[]>;
  getStats(): Promise<AgentStats>;
}
