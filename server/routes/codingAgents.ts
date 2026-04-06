/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API routes for coding agent analytics.
 * Provides unified access to Claude Code, Kiro, and Codex session data.
 *
 * All data endpoints accept optional `from` and `to` query params (YYYY-MM-DD)
 * for date range filtering.
 */

import { Router, Request, Response } from 'express';
import { codingAgentRegistry } from '../services/codingAgents';
import type { DateRange } from '../services/codingAgents/types';

const router = Router();

/** Extract date range from query params */
function parseDateRange(req: Request): DateRange | undefined {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (!from && !to) return undefined;
  return { from, to };
}

/**
 * GET /api/coding-agents/available
 * Returns which coding agents are detected on this machine.
 */
router.get('/api/coding-agents/available', async (_req: Request, res: Response) => {
  try {
    const readers = await codingAgentRegistry.getAvailableReaders();
    res.json({
      agents: readers.map(r => ({
        name: r.agentName,
        displayName: r.displayName,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/stats
 * Returns combined stats from all available coding agents.
 * Query params: from, to (YYYY-MM-DD)
 */
router.get('/api/coding-agents/stats', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    const stats = await codingAgentRegistry.getCombinedStats(range);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/sessions
 * Returns all sessions from all available agents, merged and sorted.
 * Query params:
 *   - agent: filter by agent name (claude-code, kiro, codex)
 *   - limit: max number of sessions to return (default 100)
 *   - from, to: date range (YYYY-MM-DD)
 */
router.get('/api/coding-agents/sessions', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    let sessions = await codingAgentRegistry.getAllSessions(range);

    const agentFilter = req.query.agent as string | undefined;
    if (agentFilter) {
      sessions = sessions.filter(s => s.agent === agentFilter);
    }

    const limit = parseInt(req.query.limit as string) || 100;
    sessions = sessions.slice(0, limit);

    res.json({ sessions, total: sessions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/costs
 * Returns cost analytics across all agents.
 * Query params: from, to (YYYY-MM-DD)
 */
router.get('/api/coding-agents/costs', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    const costs = await codingAgentRegistry.getCostAnalytics(range);
    res.json(costs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/activity
 * Returns activity data (streaks, heatmap, hourly/dow patterns).
 * Query params: from, to (YYYY-MM-DD)
 */
router.get('/api/coding-agents/activity', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    const activity = await codingAgentRegistry.getActivityData(range);
    res.json(activity);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/tools
 * Returns tool usage analytics across all agents.
 * Query params: from, to (YYYY-MM-DD)
 */
router.get('/api/coding-agents/tools', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    const tools = await codingAgentRegistry.getToolsAnalytics(range);
    res.json(tools);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/efficiency
 * Returns per-agent efficiency comparison (tool success, completion, cost/completion).
 * Query params: from, to (YYYY-MM-DD)
 */
router.get('/api/coding-agents/efficiency', async (req: Request, res: Response) => {
  try {
    const range = parseDateRange(req);
    const efficiency = await codingAgentRegistry.getEfficiencyAnalytics(range);
    res.json(efficiency);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
