/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kiro reader — parses ~/.kiro/sessions/cli/ JSONL session files
 * and the companion JSON metadata files for token counts.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { CodingAgentReader, AgentSession, AgentStats, DailyActivity } from '../types';
import { estimateCost } from '../pricing';

const KIRO_DIR = path.join(os.homedir(), '.kiro');

function kiroPath(...segments: string[]): string {
  return path.join(KIRO_DIR, ...segments);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

async function listSessionFiles(): Promise<string[]> {
  const dir = kiroPath('sessions', 'cli');
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

async function readSessionMetaJson(sessionId: string): Promise<AnyObj | null> {
  try {
    const raw = await fs.readFile(kiroPath('sessions', 'cli', `${sessionId}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function deriveSessionFromJSONL(filePath: string): Promise<AgentSession | null> {
  const sessionId = path.basename(filePath, '.jsonl');
  let startTime = '';
  let lastTime = '';
  let userCount = 0;
  let assistantCount = 0;
  const toolCounts: Record<string, number> = {};
  const toolErrorCounts: Record<string, number> = {};
  const toolUseIdToName: Record<string, string> = {};
  let totalToolErrors = 0;
  let firstPrompt = '';
  let hasMcp = false;
  let projectPath = '';
  let lastMessageType = '';

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const obj: AnyObj = JSON.parse(line);
        const ts = obj.timestamp as string;
        if (ts) {
          if (!startTime) startTime = ts;
          lastTime = ts;
        }
        if (obj.cwd && !projectPath) projectPath = obj.cwd;

        if (obj.role === 'user') {
          userCount++;
          lastMessageType = 'user';
          if (typeof obj.content === 'string' && !firstPrompt) {
            firstPrompt = obj.content.slice(0, 500);
          } else if (Array.isArray(obj.content)) {
            const text = obj.content.find((c: AnyObj) => c.type === 'text');
            if (text?.text && !firstPrompt) firstPrompt = text.text.slice(0, 500);
            // Check for tool result errors
            for (const c of obj.content) {
              if ((c.type === 'tool_result' || c.kind === 'ToolResults') && (c.is_error === true || c.isError === true)) {
                const toolName = toolUseIdToName[c.tool_use_id ?? c.toolUseId] ?? 'unknown';
                toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
                totalToolErrors++;
              }
            }
          }
        }
        if (obj.role === 'assistant') {
          assistantCount++;
          lastMessageType = 'assistant';
          if (Array.isArray(obj.content)) {
            for (const c of obj.content) {
              if (c.type === 'tool_use' && c.toolName) {
                const name = c.serverName ? `mcp_${c.serverName}__${c.toolName}` : c.toolName;
                toolCounts[name] = (toolCounts[name] ?? 0) + 1;
                if (c.toolUseId) toolUseIdToName[c.toolUseId] = name;
                if (c.id) toolUseIdToName[c.id] = name;
                if (c.serverName) hasMcp = true;
              }
            }
          }
        }
        // Handle standalone ToolResults blocks
        if (obj.kind === 'ToolResults' && obj.data?.results) {
          for (const [id, result] of Object.entries(obj.data.results as Record<string, AnyObj>)) {
            if (result?.isError === true || (result?.result && !result.result.Success)) {
              const toolName = toolUseIdToName[id] ?? 'unknown';
              toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
              totalToolErrors++;
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch {
    return null;
  }

  if (!startTime) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  const meta = await readSessionMetaJson(sessionId);
  if (meta?.turns && Array.isArray(meta.turns)) {
    for (const turn of meta.turns) {
      inputTokens += turn.input_token_count ?? 0;
      outputTokens += turn.output_token_count ?? 0;
    }
  }

  const start = new Date(startTime).getTime();
  const end = lastTime ? new Date(lastTime).getTime() : start;
  const durationMinutes = (end - start) / 60_000;
  const cost = estimateCost('us.anthropic.claude-sonnet-4-6-v1', inputTokens, outputTokens);

  return {
    agent: 'kiro',
    session_id: sessionId,
    project_path: projectPath || 'unknown',
    start_time: startTime,
    duration_minutes: durationMinutes,
    user_message_count: userCount,
    assistant_message_count: assistantCount,
    tool_counts: toolCounts,
    tool_error_counts: toolErrorCounts,
    total_tool_errors: totalToolErrors,
    session_completed: lastMessageType === 'assistant',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    first_prompt: firstPrompt,
    estimated_cost: cost,
    uses_mcp: hasMcp,
  };
}

export class KiroReader implements CodingAgentReader {
  readonly agentName = 'kiro' as const;
  readonly displayName = 'Kiro';

  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(kiroPath('sessions', 'cli'));
      return true;
    } catch {
      return false;
    }
  }

  async getSessions(): Promise<AgentSession[]> {
    const files = await listSessionFiles();
    const results: AgentSession[] = [];
    for (const f of files) {
      const session = await deriveSessionFromJSONL(f);
      if (session) results.push(session);
    }
    return results.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  }

  async getStats(): Promise<AgentStats> {
    const sessions = await this.getSessions();
    const dailyMap = new Map<string, DailyActivity>();

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalToolCalls = 0;
    let totalToolErrors = 0;
    let totalDuration = 0;
    let completedSessions = 0;

    for (const s of sessions) {
      totalCost += s.estimated_cost;
      totalInputTokens += s.input_tokens;
      totalOutputTokens += s.output_tokens;
      totalDuration += s.duration_minutes;
      totalToolErrors += s.total_tool_errors;
      if (s.session_completed) completedSessions++;
      const toolCallCount = Object.values(s.tool_counts).reduce((a, b) => a + b, 0);
      totalToolCalls += toolCallCount;

      const date = s.start_time.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const existing = dailyMap.get(date) ?? { date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
        existing.messageCount += s.user_message_count + s.assistant_message_count;
        existing.sessionCount += 1;
        existing.toolCallCount += toolCallCount;
        dailyMap.set(date, existing);
      }
    }

    const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return {
      agent: 'kiro',
      totalSessions: sessions.length,
      totalCost,
      totalCacheSavings: 0,
      totalInputTokens,
      totalOutputTokens,
      totalToolCalls,
      totalToolErrors,
      toolSuccessRate: totalToolCalls > 0 ? (totalToolCalls - totalToolErrors) / totalToolCalls : 1,
      completedSessions,
      costPerCompletion: completedSessions > 0 ? totalCost / completedSessions : 0,
      activeDays: dailyActivity.length,
      avgSessionMinutes: sessions.length > 0 ? totalDuration / sessions.length : 0,
      dailyActivity,
    };
  }
}
