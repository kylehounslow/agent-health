/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stateless insights engine — analyses combined stats and efficiency data
 * to produce a prioritised list of actionable insights for the dashboard.
 */

import type { AgentStats, EfficiencyAnalytics, Insight } from './types';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'kiro': 'Kiro',
  'codex': 'Codex CLI',
};

function label(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function cost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function generateInsights(
  agentStats: AgentStats[],
  efficiency: EfficiencyAnalytics,
): Insight[] {
  const insights: Insight[] = [];

  // ── Warnings ──────────────────────────────────────────────────────────────

  // Low tool success rate per agent
  for (const a of efficiency.agents) {
    if (a.totalToolCalls >= 10 && a.toolSuccessRate < 0.90) {
      insights.push({
        type: 'warning',
        title: `${label(a.agent)} tool success rate is ${pct(a.toolSuccessRate)}`,
        description: `${a.totalToolErrors} of ${a.totalToolCalls} tool calls are failing. Check which tools error most in the Tools tab.`,
        agent: a.agent,
        linkTab: 'tools',
      });
    }
  }

  // Low completion rate
  for (const a of efficiency.agents) {
    if (a.totalSessions >= 5 && a.completionRate < 0.60) {
      insights.push({
        type: 'warning',
        title: `${label(a.agent)} session completion rate is ${pct(a.completionRate)}`,
        description: `Only ${a.completedSessions} of ${a.totalSessions} sessions completed. Consider breaking complex tasks into smaller prompts.`,
        agent: a.agent,
        linkTab: 'sessions',
      });
    }
  }

  // ── Tips ───────────────────────────────────────────────────────────────────

  // Cost comparison between agents
  const agentsWithCost = efficiency.agents.filter(a => a.costPerCompletion > 0 && a.completedSessions >= 3);
  if (agentsWithCost.length >= 2) {
    const sorted = [...agentsWithCost].sort((a, b) => a.costPerCompletion - b.costPerCompletion);
    const cheapest = sorted[0];
    const most = sorted[sorted.length - 1];
    if (most.costPerCompletion > cheapest.costPerCompletion * 2) {
      insights.push({
        type: 'tip',
        title: `${label(most.agent)} costs ${cost(most.costPerCompletion)}/completion vs ${cost(cheapest.costPerCompletion)} for ${label(cheapest.agent)}`,
        description: `Consider ${label(cheapest.agent)} for simpler tasks to reduce costs.`,
        linkTab: 'costs',
      });
    }
  }

  // Most-used agent with low completion
  const byUsage = [...efficiency.agents].sort((a, b) => b.totalSessions - a.totalSessions);
  if (byUsage.length > 0 && byUsage[0].totalSessions >= 5 && byUsage[0].completionRate < 0.70) {
    const a = byUsage[0];
    // Avoid duplicate if we already warned about this
    const alreadyWarned = insights.some(i => i.agent === a.agent && i.linkTab === 'sessions');
    if (!alreadyWarned) {
      insights.push({
        type: 'tip',
        title: `You use ${label(a.agent)} most but only ${pct(a.completionRate)} of sessions complete`,
        description: 'Try breaking complex tasks into smaller, focused prompts for better results.',
        agent: a.agent,
        linkTab: 'sessions',
      });
    }
  }

  // Cache utilisation tip for Claude Code
  for (const s of agentStats) {
    if (s.agent === 'claude-code' && s.totalInputTokens > 100_000) {
      const cacheHitRate = s.totalCacheSavings > 0
        ? s.totalCacheSavings / (s.totalCost + s.totalCacheSavings)
        : 0;
      if (cacheHitRate < 0.1 && s.totalSessions >= 5) {
        insights.push({
          type: 'tip',
          title: 'Low cache utilisation in Claude Code',
          description: 'Consider longer sessions to benefit from prompt caching and reduce costs.',
          agent: 'claude-code',
          linkTab: 'costs',
        });
      }
    }
  }

  // ── Info ────────────────────────────────────────────────────────────────────

  // Cache savings highlight
  for (const s of agentStats) {
    if (s.totalCacheSavings > 1) {
      insights.push({
        type: 'info',
        title: `${label(s.agent)} saved ${cost(s.totalCacheSavings)} through prompt caching`,
        description: 'Prompt caching reuses previous context, reducing token costs on long sessions.',
        agent: s.agent,
        linkTab: 'costs',
      });
    }
  }

  // Multi-agent usage
  const active = agentStats.filter(a => a.totalSessions > 0);
  if (active.length >= 2) {
    const names = active.map(a => label(a.agent)).join(', ');
    insights.push({
      type: 'info',
      title: `${active.length} agents detected: ${names}`,
      description: 'Compare efficiency across agents in the Efficiency tab.',
      linkTab: 'efficiency',
    });
  }

  // ── Success ────────────────────────────────────────────────────────────────

  // High tool success rate
  if (efficiency.combined.toolSuccessRate >= 0.95 && efficiency.agents.some(a => a.totalToolCalls >= 20)) {
    insights.push({
      type: 'success',
      title: `Overall tool success rate is ${pct(efficiency.combined.toolSuccessRate)}`,
      description: 'Your agents are executing tools reliably with minimal errors.',
      linkTab: 'tools',
    });
  }

  // High completion rate
  if (efficiency.combined.completionRate >= 0.85 && agentStats.some(a => a.totalSessions >= 10)) {
    insights.push({
      type: 'success',
      title: `${pct(efficiency.combined.completionRate)} session completion rate`,
      description: 'Most sessions complete successfully across your agents.',
      linkTab: 'sessions',
    });
  }

  // ── Prioritise and cap at 5 ──────────────────────────────────────────────

  const priority: Record<Insight['type'], number> = { warning: 0, tip: 1, info: 2, success: 3 };
  insights.sort((a, b) => priority[a.type] - priority[b.type]);
  return insights.slice(0, 5);
}
