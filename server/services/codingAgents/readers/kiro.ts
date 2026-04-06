/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kiro reader — parses ~/.kiro/sessions/cli/ JSONL session files
 * and the companion JSON metadata files for token counts and timestamps.
 *
 * Kiro JSONL uses a versioned format with `kind` discriminator:
 *   - kind: "Prompt"            → user message
 *   - kind: "AssistantMessage"  → assistant response
 *   - kind: "ToolResults"       → tool execution results
 *
 * Timestamps and token counts come from the companion .json metadata file,
 * not from the JSONL itself.
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
  let userCount = 0;
  let assistantCount = 0;
  const toolCounts: Record<string, number> = {};
  const toolErrorCounts: Record<string, number> = {};
  const toolUseIdToName: Record<string, string> = {};
  let totalToolErrors = 0;
  let firstPrompt = '';
  let hasMcp = false;
  let lastMessageKind = '';

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const obj: AnyObj = JSON.parse(line);
        const kind = obj.kind as string;
        const data = obj.data;
        if (!data) continue;

        // ── User prompt ─────────────────────────────────────────────
        if (kind === 'Prompt') {
          userCount++;
          lastMessageKind = 'Prompt';
          if (Array.isArray(data.content) && !firstPrompt) {
            const textBlock = data.content.find((c: AnyObj) => c.kind === 'text');
            if (textBlock?.data) {
              let promptText = textBlock.data as string;
              // Skip session naming agent prompts (internal Kiro mechanism)
              if (promptText.startsWith('You are a session naming agent')) {
                userCount--; // don't count this as a real user message
              } else {
                // Strip session context preamble if present
                const marker = '[CURRENT USER REQUEST';
                const idx = promptText.indexOf(marker);
                if (idx >= 0) {
                  const afterMarker = promptText.indexOf('\n', idx);
                  if (afterMarker >= 0) promptText = promptText.slice(afterMarker + 1).trim();
                }
                // Strip trailing options marker
                const optIdx = promptText.indexOf('\n(If presenting choices');
                if (optIdx >= 0) promptText = promptText.slice(0, optIdx).trim();
                if (promptText) firstPrompt = promptText.slice(0, 500);
              }
            }
          }
          // Check for tool result errors embedded in prompt content
          if (Array.isArray(data.content)) {
            for (const c of data.content) {
              if ((c.kind === 'toolResult' || c.type === 'tool_result') && c.data?.isError === true) {
                const toolName = toolUseIdToName[c.data?.toolUseId] ?? 'unknown';
                toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
                totalToolErrors++;
              }
            }
          }
        }

        // ── Assistant message ───────────────────────────────────────
        if (kind === 'AssistantMessage') {
          assistantCount++;
          lastMessageKind = 'AssistantMessage';
          if (Array.isArray(data.content)) {
            for (const c of data.content) {
              if (c.kind === 'toolUse' && c.data) {
                const toolData = c.data;
                const serverName = toolData.serverName;
                const toolName = serverName
                  ? `mcp_${serverName}__${toolData.name}`
                  : (toolData.name ?? 'unknown');
                toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
                if (toolData.toolUseId) toolUseIdToName[toolData.toolUseId] = toolName;
                if (serverName) hasMcp = true;
              }
            }
          }
        }

        // ── Standalone ToolResults ──────────────────────────────────
        if (kind === 'ToolResults' && data.content) {
          for (const c of (Array.isArray(data.content) ? data.content : [])) {
            if (c.kind === 'toolResult' && c.data) {
              const rd = c.data;
              if (rd.isError === true) {
                const toolName = toolUseIdToName[rd.toolUseId] ?? 'unknown';
                toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
                totalToolErrors++;
              }
            }
          }
          // Also check the results map form — this has richer metadata including serverName
          if (data.results) {
            for (const [id, result] of Object.entries(data.results as Record<string, AnyObj>)) {
              // Detect MCP server name from the tool metadata
              const toolMeta = result?.tool;
              if (toolMeta?.kind?.Mcp?.serverName) {
                const serverName = toolMeta.kind.Mcp.serverName;
                const rawName = toolMeta.kind.Mcp.toolName ?? toolUseIdToName[id];
                if (rawName && !toolUseIdToName[id]?.startsWith('mcp_')) {
                  const mcpName = `mcp_${serverName}__${rawName}`;
                  // Remap: subtract from old name, add to mcp name
                  const oldName = toolUseIdToName[id] ?? rawName;
                  if (toolCounts[oldName]) {
                    toolCounts[oldName]--;
                    if (toolCounts[oldName] <= 0) delete toolCounts[oldName];
                  }
                  toolCounts[mcpName] = (toolCounts[mcpName] ?? 0) + 1;
                  toolUseIdToName[id] = mcpName;
                  hasMcp = true;
                }
              }
              if (result?.isError === true || (result?.result && !result.result.Success)) {
                const toolName = toolUseIdToName[id] ?? 'unknown';
                toolErrorCounts[toolName] = (toolErrorCounts[toolName] ?? 0) + 1;
                totalToolErrors++;
              }
            }
          }
        }
      } catch { /* skip malformed */ }
    }
  } catch {
    return null;
  }

  // ── Metadata from companion JSON ────────────────────────────────────────
  const meta = await readSessionMetaJson(sessionId);
  if (!meta) return null;

  const startTime = meta.created_at as string;
  const lastTime = meta.updated_at as string;
  if (!startTime) return null;

  const projectPath = (meta.cwd as string) || 'unknown';

  let inputTokens = 0;
  let outputTokens = 0;
  const sessionState = meta.session_state;
  if (sessionState?.conversation_metadata?.user_turn_metadatas) {
    for (const turn of sessionState.conversation_metadata.user_turn_metadatas) {
      inputTokens += turn.input_token_count ?? 0;
      outputTokens += turn.output_token_count ?? 0;
    }
  }
  // Also check top-level turns array (alternate format)
  if (meta.turns && Array.isArray(meta.turns)) {
    for (const turn of meta.turns) {
      inputTokens += turn.input_token_count ?? 0;
      outputTokens += turn.output_token_count ?? 0;
    }
  }

  const start = new Date(startTime).getTime();
  const end = lastTime ? new Date(lastTime).getTime() : start;
  const durationMinutes = (end - start) / 60_000;
  const cost = estimateCost('us.anthropic.claude-sonnet-4-6-v1', inputTokens, outputTokens);

  // Check if last assistant message has text content for completion detection
  const sessionCompleted = lastMessageKind === 'AssistantMessage';

  return {
    agent: 'kiro',
    session_id: sessionId,
    project_path: projectPath,
    start_time: startTime,
    duration_minutes: durationMinutes,
    user_message_count: userCount,
    assistant_message_count: assistantCount,
    tool_counts: toolCounts,
    tool_error_counts: toolErrorCounts,
    total_tool_errors: totalToolErrors,
    session_completed: sessionCompleted,
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
