/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API routes for coding agent analytics.
 * Provides unified access to Claude Code, Kiro, and Codex session data.
 */

import { Router, Request, Response } from 'express';
import { codingAgentRegistry } from '../services/codingAgents';

const router = Router();

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
 */
router.get('/api/coding-agents/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await codingAgentRegistry.getCombinedStats();
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
 */
router.get('/api/coding-agents/sessions', async (req: Request, res: Response) => {
  try {
    let sessions = await codingAgentRegistry.getAllSessions();

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
 */
router.get('/api/coding-agents/costs', async (_req: Request, res: Response) => {
  try {
    const costs = await codingAgentRegistry.getCostAnalytics();
    res.json(costs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/activity
 * Returns activity data (streaks, heatmap, hourly/dow patterns).
 */
router.get('/api/coding-agents/activity', async (_req: Request, res: Response) => {
  try {
    const activity = await codingAgentRegistry.getActivityData();
    res.json(activity);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/coding-agents/tools
 * Returns tool usage analytics across all agents.
 */
router.get('/api/coding-agents/tools', async (_req: Request, res: Response) => {
  try {
    const tools = await codingAgentRegistry.getToolsAnalytics();
    res.json(tools);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
