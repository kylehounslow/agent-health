/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registry that auto-detects available coding agents and provides
 * unified access to their data through the CodingAgentReader interface.
 */

import type {
  CodingAgentReader,
  AgentKind,
  AgentSession,
  CombinedStats,
  DailyActivity,
  CostAnalytics,
  ProjectCost,
  ModelCostBreakdown,
  ActivityData,
  ToolsAnalytics,
  ToolSummary,
  EfficiencyAnalytics,
} from './types';
import { categorizeTool } from './toolCategories';
import { generateInsights } from './insights';
import { ClaudeCodeReader } from './readers/claudeCode';
import { KiroReader } from './readers/kiro';
import { CodexReader } from './readers/codex';

class CodingAgentRegistry {
  private readers: CodingAgentReader[] = [
    new ClaudeCodeReader(),
    new KiroReader(),
    new CodexReader(),
  ];

  /** Get all readers whose data directories exist on this machine */
  async getAvailableReaders(): Promise<CodingAgentReader[]> {
    const checks = await Promise.all(
      this.readers.map(async r => ({ reader: r, available: await r.isAvailable() }))
    );
    return checks.filter(c => c.available).map(c => c.reader);
  }

  /** Get reader by agent name */
  getReader(agent: AgentKind): CodingAgentReader | undefined {
    return this.readers.find(r => r.agentName === agent);
  }

  /** Get all sessions from all available agents, merged and sorted */
  async getAllSessions(): Promise<AgentSession[]> {
    const readers = await this.getAvailableReaders();
    const allSessions = await Promise.all(readers.map(r => r.getSessions()));
    return allSessions.flat().sort((a, b) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
  }

  /** Get combined stats from all available agents */
  async getCombinedStats(): Promise<CombinedStats> {
    const readers = await this.getAvailableReaders();
    const allStats = await Promise.all(readers.map(r => r.getStats()));

    // Merge daily activity across agents
    const dailyMap = new Map<string, DailyActivity>();
    for (const stats of allStats) {
      for (const d of stats.dailyActivity) {
        const existing = dailyMap.get(d.date) ?? { date: d.date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
        existing.messageCount += d.messageCount;
        existing.sessionCount += d.sessionCount;
        existing.toolCallCount += d.toolCallCount;
        dailyMap.set(d.date, existing);
      }
    }
    const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    const efficiency = this.computeEfficiency(allStats);
    const insights = generateInsights(allStats, efficiency);

    return {
      agents: allStats,
      dailyActivity,
      totalCost: allStats.reduce((s, a) => s + a.totalCost, 0),
      totalSessions: allStats.reduce((s, a) => s + a.totalSessions, 0),
      totalTokens: allStats.reduce((s, a) => s + a.totalInputTokens + a.totalOutputTokens, 0),
      insights,
    };
  }

  /** Get cost analytics across all agents */
  async getCostAnalytics(): Promise<CostAnalytics> {
    const sessions = await this.getAllSessions();

    // Group by agent+model for model breakdown
    const modelMap = new Map<string, ModelCostBreakdown>();
    for (const s of sessions) {
      const modelKey = `${s.agent}:${s.model ?? 'default'}`;
      const existing = modelMap.get(modelKey) ?? {
        agent: s.agent,
        model: s.model ?? 'default',
        input_tokens: 0,
        output_tokens: 0,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        estimated_cost: 0,
        cache_savings: 0,
      };
      existing.input_tokens += s.input_tokens;
      existing.output_tokens += s.output_tokens;
      existing.cache_write_tokens += s.cache_creation_input_tokens;
      existing.cache_read_tokens += s.cache_read_input_tokens;
      existing.estimated_cost += s.estimated_cost;
      modelMap.set(modelKey, existing);
    }

    // Group by project
    const projectMap = new Map<string, ProjectCost>();
    for (const s of sessions) {
      const key = `${s.agent}:${s.project_path}`;
      const existing = projectMap.get(key) ?? {
        agent: s.agent,
        project_path: s.project_path,
        display_name: s.project_path.split('/').pop() || s.project_path,
        estimated_cost: 0,
        input_tokens: 0,
        output_tokens: 0,
      };
      existing.estimated_cost += s.estimated_cost;
      existing.input_tokens += s.input_tokens;
      existing.output_tokens += s.output_tokens;
      projectMap.set(key, existing);
    }

    const models = Array.from(modelMap.values()).sort((a, b) => b.estimated_cost - a.estimated_cost);
    const by_project = Array.from(projectMap.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost)
      .slice(0, 20);

    return {
      total_cost: models.reduce((s, m) => s + m.estimated_cost, 0),
      total_savings: models.reduce((s, m) => s + m.cache_savings, 0),
      models,
      by_project,
    };
  }

  /** Get activity data (streaks, day-of-week, hourly) */
  async getActivityData(): Promise<ActivityData> {
    const sessions = await this.getAllSessions();

    const activeDates = new Set<string>();
    const dowCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun=0..Sat=6
    const hourCounts = new Array(24).fill(0);

    for (const s of sessions) {
      if (!s.start_time) continue;
      const d = new Date(s.start_time);
      if (isNaN(d.getTime())) continue;
      activeDates.add(s.start_time.slice(0, 10));
      dowCounts[d.getDay()]++;
      hourCounts[d.getHours()]++;
    }

    // Compute streaks
    const sorted = [...activeDates].sort();
    let longest = sorted.length > 0 ? 1 : 0;
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diff = (curr.getTime() - prev.getTime()) / 86_400_000;
      if (diff === 1) {
        streak++;
        if (streak > longest) longest = streak;
      } else {
        streak = 1;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    let current = 0;
    const d = new Date(today);
    while (activeDates.has(d.toISOString().slice(0, 10))) {
      current++;
      d.setDate(d.getDate() - 1);
    }

    // Build daily activity from sessions
    const dailyMap = new Map<string, DailyActivity>();
    for (const s of sessions) {
      const date = s.start_time.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const existing = dailyMap.get(date) ?? { date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
      existing.messageCount += s.user_message_count + s.assistant_message_count;
      existing.sessionCount += 1;
      existing.toolCallCount += Object.values(s.tool_counts).reduce((a, b) => a + b, 0);
      dailyMap.set(date, existing);
    }

    return {
      daily_activity: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      hour_counts: hourCounts.map((count, hour) => ({ hour, count })),
      dow_counts: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => ({ day, count: dowCounts[i] })),
      streaks: { current, longest },
      total_active_days: activeDates.size,
    };
  }

  /** Get tool usage analytics (with error counts and success rates) */
  async getToolsAnalytics(): Promise<ToolsAnalytics> {
    const sessions = await this.getAllSessions();

    const toolMap = new Map<string, { total: number; errors: number; sessions: Set<string>; agent: AgentKind }>();
    for (const s of sessions) {
      for (const [tool, count] of Object.entries(s.tool_counts)) {
        const key = `${s.agent}:${tool}`;
        const existing = toolMap.get(key) ?? { total: 0, errors: 0, sessions: new Set(), agent: s.agent };
        existing.total += count;
        existing.errors += s.tool_error_counts[tool] ?? 0;
        existing.sessions.add(s.session_id);
        toolMap.set(key, existing);
      }
    }

    let totalToolErrors = 0;
    const tools: ToolSummary[] = Array.from(toolMap.entries())
      .map(([key, data]) => {
        const name = key.split(':').slice(1).join(':');
        totalToolErrors += data.errors;
        return {
          agent: data.agent,
          name,
          category: categorizeTool(name),
          total_calls: data.total,
          session_count: data.sessions.size,
          error_count: data.errors,
          success_rate: data.total > 0 ? (data.total - data.errors) / data.total : 1,
        };
      })
      .sort((a, b) => b.total_calls - a.total_calls);

    return {
      tools,
      total_tool_calls: tools.reduce((s, t) => s + t.total_calls, 0),
      total_tool_errors: totalToolErrors,
    };
  }

  /** Get efficiency analytics for cross-agent comparison */
  async getEfficiencyAnalytics(): Promise<EfficiencyAnalytics> {
    const readers = await this.getAvailableReaders();
    const allStats = await Promise.all(readers.map(r => r.getStats()));
    return this.computeEfficiency(allStats);
  }

  /** Internal: compute efficiency from pre-fetched stats */
  private computeEfficiency(allStats: import('./types').AgentStats[]): EfficiencyAnalytics {
    const agents = allStats.map(s => ({
      agent: s.agent,
      toolSuccessRate: s.toolSuccessRate,
      completedSessions: s.completedSessions,
      totalSessions: s.totalSessions,
      completionRate: s.totalSessions > 0 ? s.completedSessions / s.totalSessions : 0,
      costPerCompletion: s.costPerCompletion,
      totalToolErrors: s.totalToolErrors,
      totalToolCalls: s.totalToolCalls,
    }));

    const totalCalls = agents.reduce((s, a) => s + a.totalToolCalls, 0);
    const totalErrors = agents.reduce((s, a) => s + a.totalToolErrors, 0);
    const totalSessions = agents.reduce((s, a) => s + a.totalSessions, 0);
    const totalCompleted = agents.reduce((s, a) => s + a.completedSessions, 0);
    const totalCostForCompleted = allStats
      .filter(s => s.completedSessions > 0)
      .reduce((sum, s) => sum + s.totalCost, 0);

    return {
      agents,
      combined: {
        toolSuccessRate: totalCalls > 0 ? (totalCalls - totalErrors) / totalCalls : 1,
        completionRate: totalSessions > 0 ? totalCompleted / totalSessions : 0,
        avgCostPerCompletion: totalCompleted > 0 ? totalCostForCompleted / totalCompleted : 0,
      },
    };
  }
}

export const codingAgentRegistry = new CodingAgentRegistry();
