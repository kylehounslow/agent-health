/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ENV_CONFIG } from '@/lib/config';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
  LineChart, Line, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#f97316',
  'kiro': '#8b5cf6',
  'codex': '#10b981',
};

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'kiro': 'Kiro',
  'codex': 'Codex CLI',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentInfo { name: string; displayName: string }
interface AgentStats {
  agent: string;
  totalSessions: number;
  totalCost: number;
  totalCacheSavings: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalToolErrors: number;
  toolSuccessRate: number;
  completedSessions: number;
  costPerCompletion: number;
  activeDays: number;
  avgSessionMinutes: number;
  dailyActivity: Array<{ date: string; sessionCount: number; messageCount: number; toolCallCount: number }>;
}
interface Insight {
  type: 'warning' | 'tip' | 'info' | 'success';
  title: string;
  description: string;
  agent?: string;
  linkTab?: string;
}
interface CombinedStats {
  agents: AgentStats[];
  dailyActivity: Array<{ date: string; sessionCount: number; messageCount: number }>;
  totalCost: number;
  totalSessions: number;
  totalTokens: number;
  wastedCost: number;
  abandonedSessions: number;
  insights: Insight[];
}
interface Session {
  agent: string;
  session_id: string;
  project_path: string;
  start_time: string;
  duration_minutes: number;
  user_message_count: number;
  assistant_message_count: number;
  input_tokens: number;
  output_tokens: number;
  first_prompt: string;
  estimated_cost: number;
  session_completed: boolean;
  tool_counts: Record<string, number>;
}
interface DailyCost {
  date: string;
  cost: number;
  agent: string;
}
interface CostAnalytics {
  total_cost: number;
  total_savings: number;
  models: Array<{ agent: string; model: string; estimated_cost: number; input_tokens: number; output_tokens: number }>;
  by_project: Array<{ agent: string; display_name: string; estimated_cost: number }>;
  daily_costs: DailyCost[];
}
interface ActivityData {
  daily_activity: Array<{ date: string; sessionCount: number; messageCount: number }>;
  hour_counts: Array<{ hour: number; count: number }>;
  dow_counts: Array<{ day: string; count: number }>;
  streaks: { current: number; longest: number };
  total_active_days: number;
}
interface ToolData {
  agent: string;
  name: string;
  category: string;
  total_calls: number;
  session_count: number;
  error_count: number;
  success_rate: number;
}
interface ToolsData {
  tools: ToolData[];
  total_tool_calls: number;
  total_tool_errors: number;
}
interface EfficiencyAgent {
  agent: string;
  toolSuccessRate: number;
  completedSessions: number;
  totalSessions: number;
  completionRate: number;
  costPerCompletion: number;
  totalToolErrors: number;
  totalToolCalls: number;
}
interface EfficiencyData {
  agents: EfficiencyAgent[];
  combined: {
    toolSuccessRate: number;
    completionRate: number;
    avgCostPerCompletion: number;
  };
}
// Phase 2
interface SessionMessage {
  role: 'user' | 'assistant' | 'tool_result';
  text: string;
  timestamp?: string;
  toolName?: string;
  isError?: boolean;
}
interface SessionDetail {
  session: Session;
  messages: SessionMessage[];
}
interface ProjectAnalytics {
  project_path: string;
  display_name: string;
  agents: string[];
  total_sessions: number;
  completed_sessions: number;
  completion_rate: number;
  total_cost: number;
  wasted_cost: number;
  total_tool_calls: number;
  total_tool_errors: number;
  avg_session_minutes: number;
}
interface SessionsResponse {
  sessions: Session[];
  total: number;
  offset: number;
  limit: number;
}
// Phase 3
interface McpServerSummary {
  server: string;
  agent: string;
  total_calls: number;
  error_count: number;
  success_rate: number;
  tools: Array<{ name: string; calls: number; errors: number }>;
  session_count: number;
}
interface HourlyEffectiveness {
  hour: number;
  total_sessions: number;
  completed_sessions: number;
  completion_rate: number;
  avg_cost: number;
}
interface DurationBucket {
  label: string;
  session_count: number;
  completed_count: number;
  completion_rate: number;
  avg_cost: number;
  total_cost: number;
}
interface ConversationDepthStats {
  avg_depth: number;
  high_backforth_sessions: number;
  high_backforth_completion_rate: number;
  low_backforth_completion_rate: number;
  depth_buckets: Array<{ label: string; session_count: number; completion_rate: number; avg_cost: number }>;
}
interface AdvancedAnalytics {
  mcp: { servers: McpServerSummary[]; total_mcp_calls: number; total_mcp_errors: number };
  hourly_effectiveness: HourlyEffectiveness[];
  duration_distribution: DurationBucket[];
  conversation_depth: ConversationDepthStats;
}
// Phase 4
interface FailurePattern {
  tool: string;
  error_snippet: string;
  occurrences: number;
  sessions: number;
  agent: string;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

type DateRangePreset = 'today' | '7d' | '30d' | 'all';

function getDateRange(preset: DateRangePreset): { from?: string; to?: string } {
  if (preset === 'all') return {};
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (preset === 'today') return { from: to, to };
  const d = new Date(today);
  d.setDate(d.getDate() - (preset === '7d' ? 6 : 29));
  return { from: d.toISOString().slice(0, 10), to };
}

function buildQuery(basePath: string, range: { from?: string; to?: string }, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${ENV_CONFIG.backendUrl}${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
}

// ─── Insight Icons ───────────────────────────────────────────────────────────

const INSIGHT_STYLES: Record<Insight['type'], { bg: string; border: string; icon: string }> = {
  warning: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', icon: '!!' },
  tip:     { bg: 'bg-blue-50 dark:bg-blue-950/30',   border: 'border-blue-200 dark:border-blue-800',   icon: '?' },
  info:    { bg: 'bg-gray-50 dark:bg-gray-900/30',    border: 'border-gray-200 dark:border-gray-700',   icon: 'i' },
  success: { bg: 'bg-green-50 dark:bg-green-950/30',  border: 'border-green-200 dark:border-green-800', icon: '*' },
};

const INSIGHT_ICON_COLORS: Record<Insight['type'], string> = {
  warning: 'text-amber-600 dark:text-amber-400',
  tip:     'text-blue-600 dark:text-blue-400',
  info:    'text-gray-500 dark:text-gray-400',
  success: 'text-green-600 dark:text-green-400',
};

// ─── Insights Banner ─────────────────────────────────────────────────────────

function InsightsBanner({ insights, onTabChange }: { insights: Insight[]; onTabChange: (tab: string) => void }) {
  if (!insights || insights.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Insights & Recommendations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((insight, i) => {
          const style = INSIGHT_STYLES[insight.type];
          return (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-md border ${style.bg} ${style.border} ${insight.linkTab ? 'cursor-pointer hover:opacity-80' : ''}`}
              onClick={() => insight.linkTab && onTabChange(insight.linkTab)}
            >
              <span className={`font-mono font-bold text-sm mt-0.5 w-5 text-center flex-shrink-0 ${INSIGHT_ICON_COLORS[insight.type]}`}>
                {style.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{insight.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{insight.description}</p>
              </div>
              {insight.linkTab && (
                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0 self-center">&rarr;</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Today Summary ───────────────────────────────────────────────────────────

function TodaySummary({ stats }: { stats: CombinedStats }) {
  const totalCompleted = stats.agents.reduce((s, a) => s + a.completedSessions, 0);

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">Today&apos;s Summary</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-2xl font-bold">{stats.totalSessions}</p>
            <p className="text-xs text-muted-foreground">sessions</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{formatCost(stats.totalCost)}</p>
            <p className="text-xs text-muted-foreground">spent</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{totalCompleted}</p>
            <p className="text-xs text-muted-foreground">completed</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${stats.abandonedSessions > 0 ? 'text-amber-600' : ''}`}>
              {stats.abandonedSessions}
            </p>
            <p className="text-xs text-muted-foreground">abandoned</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${stats.wastedCost > 0 ? 'text-red-600' : ''}`}>
              {formatCost(stats.wastedCost)}
            </p>
            <p className="text-xs text-muted-foreground">wasted cost</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats, agents, onTabChange, rangePreset }: { stats: CombinedStats | null; agents: AgentInfo[]; onTabChange: (tab: string) => void; rangePreset: DateRangePreset }) {
  if (!stats) return <OverviewSkeleton />;

  const agentPieData = stats.agents.map(a => ({
    name: AGENT_LABELS[a.agent] ?? a.agent,
    value: a.totalSessions,
    fill: AGENT_COLORS[a.agent] ?? '#6b7280',
  }));

  const recentActivity = stats.dailyActivity.slice(-30);

  // Compute combined metrics for stat cards
  const totalToolCalls = stats.agents.reduce((s, a) => s + a.totalToolCalls, 0);
  const totalToolErrors = stats.agents.reduce((s, a) => s + a.totalToolErrors, 0);
  const toolSuccessRate = totalToolCalls > 0 ? (totalToolCalls - totalToolErrors) / totalToolCalls : 1;
  const totalCompleted = stats.agents.reduce((s, a) => s + a.completedSessions, 0);
  const cacheSavings = stats.agents.reduce((s, a) => s + a.totalCacheSavings, 0);

  return (
    <div className="space-y-6">
      {/* Today summary card — shown when "Today" range is selected */}
      {rangePreset === 'today' && <TodaySummary stats={stats} />}

      {/* Insights banner */}
      <InsightsBanner insights={stats.insights} onTabChange={onTabChange} />

      {/* Key metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Total Sessions" value={String(stats.totalSessions)} />
        <StatCard title="Estimated Cost" value={formatCost(stats.totalCost)} />
        <StatCard title="Tool Success Rate" value={formatPct(toolSuccessRate)} accent={toolSuccessRate < 0.9 ? 'red' : toolSuccessRate < 0.95 ? 'yellow' : 'green'} />
        <StatCard title="Cost / Completion" value={totalCompleted > 0 ? formatCost(stats.totalCost / totalCompleted) : 'N/A'} />
        <StatCard title="Wasted Cost" value={stats.wastedCost > 0 ? formatCost(stats.wastedCost) : '$0.00'} accent={stats.wastedCost > 0.5 ? 'red' : stats.wastedCost > 0 ? 'yellow' : undefined} />
        <StatCard title="Agents Detected" value={String(agents.length)} />
      </div>

      {/* Per-agent breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.agents.map(a => (
          <Card key={a.agent}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: AGENT_COLORS[a.agent] }} />
                <CardTitle className="text-sm font-medium">{AGENT_LABELS[a.agent] ?? a.agent}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Sessions</span><span>{a.totalSessions}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Completed</span><span>{a.completedSessions}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span>{a.totalCost > 0 ? formatCost(a.totalCost) : 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tool Success</span>
                <span className={a.toolSuccessRate < 0.9 ? 'text-red-600' : a.toolSuccessRate < 0.95 ? 'text-yellow-600' : 'text-green-600'}>
                  {formatPct(a.toolSuccessRate)}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tool Errors</span><span>{a.totalToolErrors}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Avg Session</span><span>{formatDuration(a.avgSessionMinutes)}</span></div>
              {a.totalCacheSavings > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Cache Savings</span><span className="text-green-600">{formatCost(a.totalCacheSavings)}</span></div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sessions by Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={agentPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                  {agentPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Activity (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={recentActivity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip labelFormatter={(d: string) => d} />
                <Bar dataKey="sessionCount" fill="#60a5fa" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Session Detail Panel ────────────────────────────────────────────────────

function SessionDetailPanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJson<SessionDetail>(`/api/coding-agents/sessions/${session.agent}/${session.session_id}`)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session.agent, session.session_id]);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-background border-l shadow-xl z-50 overflow-y-auto">
      <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Session Detail</h3>
          <p className="text-xs text-muted-foreground">
            {AGENT_LABELS[session.agent] ?? session.agent} &middot; {new Date(session.start_time).toLocaleString()} &middot; {formatDuration(session.duration_minutes)}
            {session.estimated_cost > 0 && ` \u00b7 ${formatCost(session.estimated_cost)}`}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg px-2">&times;</button>
      </div>

      <div className="p-4 space-y-2">
        {/* Session metadata */}
        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
          <div><span className="text-muted-foreground">Project:</span> {session.project_path.split('/').pop()}</div>
          <div><span className="text-muted-foreground">Status:</span> {session.session_completed ?
            <span className="text-green-600">Completed</span> :
            <span className="text-amber-600">Abandoned</span>}
          </div>
          <div><span className="text-muted-foreground">Messages:</span> {session.user_message_count + session.assistant_message_count}</div>
          <div><span className="text-muted-foreground">Tokens:</span> {formatTokens(session.input_tokens + session.output_tokens)}</div>
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : detail?.messages && detail.messages.length > 0 ? (
          <div className="space-y-2">
            {detail.messages.map((msg, i) => (
              <div key={i} className={`rounded-md p-3 text-sm ${
                msg.role === 'user' ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' :
                msg.role === 'tool_result' ? `border ${msg.isError ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'}` :
                'bg-muted/50 border border-border'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase">{msg.role}</span>
                  {msg.toolName && <Badge variant="secondary" className="text-xs">{msg.toolName}</Badge>}
                  {msg.timestamp && <span className="text-xs text-muted-foreground ml-auto">{new Date(msg.timestamp).toLocaleTimeString()}</span>}
                </div>
                <pre className="whitespace-pre-wrap text-xs font-mono break-all">{msg.text}</pre>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No conversation data available for this session.</p>
        )}
      </div>
    </div>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({ range, loading: initialLoading }: { range: { from?: string; to?: string }; loading: boolean }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [completedFilter, setCompletedFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(initialLoading);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const pageSize = 50;

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const extra: Record<string, string> = { limit: String(pageSize), offset: String(page * pageSize) };
      if (agentFilter !== 'all') extra.agent = agentFilter;
      if (completedFilter !== 'all') extra.completed = completedFilter;
      if (search) extra.search = search;
      const data = await fetchJson<SessionsResponse>(buildQuery('/api/coding-agents/sessions', range, extra));
      setSessions(data.sessions);
      setTotal(data.total);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, agentFilter, completedFilter, search, range]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleSearch = () => { setSearch(searchInput); setPage(0); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="border rounded px-3 py-1.5 text-sm w-64 bg-background"
          placeholder="Search prompts..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} className="px-3 py-1.5 text-sm border rounded hover:bg-muted">Search</button>
        <Select value={agentFilter} onValueChange={v => { setAgentFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            <SelectItem value="claude-code">Claude Code</SelectItem>
            <SelectItem value="kiro">Kiro</SelectItem>
            <SelectItem value="codex">Codex CLI</SelectItem>
          </SelectContent>
        </Select>
        <Select value={completedFilter} onValueChange={v => { setCompletedFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="true">Completed</SelectItem>
            <SelectItem value="false">Abandoned</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} sessions</span>
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>First Prompt</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(s => (
                  <TableRow key={`${s.agent}-${s.session_id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedSession(s)}>
                    <TableCell>
                      <Badge variant="outline" style={{ borderColor: AGENT_COLORS[s.agent], color: AGENT_COLORS[s.agent] }}>
                        {AGENT_LABELS[s.agent] ?? s.agent}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm" title={s.first_prompt}>
                      {s.first_prompt || <span className="text-muted-foreground italic">No prompt</span>}
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate text-sm" title={s.project_path}>
                      {s.project_path.split('/').pop()}
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatDuration(s.duration_minutes)}</TableCell>
                    <TableCell className="text-right text-sm">{s.user_message_count + s.assistant_message_count}</TableCell>
                    <TableCell className="text-right text-sm">
                      {s.input_tokens + s.output_tokens > 0 ? formatTokens(s.input_tokens + s.output_tokens) : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {s.estimated_cost > 0 ? formatCost(s.estimated_cost) : '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.session_completed ? <span className="text-green-600 text-xs">Done</span> : <span className="text-amber-600 text-xs">Abandoned</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(s.start_time).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button className="px-3 py-1 text-sm border rounded disabled:opacity-50" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
                <button className="px-3 py-1 text-sm border rounded disabled:opacity-50" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedSession && <SessionDetailPanel session={selectedSession} onClose={() => setSelectedSession(null)} />}
    </div>
  );
}

// ─── Costs Tab ────────────────────────────────────────────────────────────────

function CostTrendChart({ dailyCosts }: { dailyCosts: DailyCost[] }) {
  if (!dailyCosts || dailyCosts.length === 0) return null;

  // Pivot daily costs into { date, claude-code, kiro, codex } for stacked line chart
  const dateMap = new Map<string, Record<string, string | number>>();
  const agentsInData = new Set<string>();
  for (const dc of dailyCosts) {
    agentsInData.add(dc.agent);
    const entry = dateMap.get(dc.date) ?? { date: dc.date };
    entry[dc.agent] = ((entry[dc.agent] as number) ?? 0) + dc.cost;
    dateMap.set(dc.date, entry);
  }
  const chartData = Array.from(dateMap.values()).sort((a, b) => (a.date as string).localeCompare(b.date as string));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Daily Cost Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
            <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} fontSize={11} />
            <Tooltip formatter={(v: number) => formatCost(v)} labelFormatter={(d: string) => d} />
            <Legend />
            {[...agentsInData].map(agent => (
              <Line
                key={agent}
                type="monotone"
                dataKey={agent}
                name={AGENT_LABELS[agent] ?? agent}
                stroke={AGENT_COLORS[agent] ?? '#6b7280'}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function CostsTab({ costs, loading }: { costs: CostAnalytics | null; loading: boolean }) {
  if (loading || !costs) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Total Estimated Cost" value={formatCost(costs.total_cost)} />
        <StatCard title="Cache Savings" value={formatCost(costs.total_savings)} />
      </div>

      {/* Cost trend chart */}
      <CostTrendChart dailyCosts={costs.daily_costs} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cost by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={costs.models.filter(m => m.estimated_cost > 0)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => formatCost(v)} fontSize={11} />
                <YAxis type="category" dataKey="model" width={150} fontSize={11} />
                <Tooltip formatter={(v: number) => formatCost(v)} />
                <Bar dataKey="estimated_cost" name="Cost">
                  {costs.models.filter(m => m.estimated_cost > 0).map((m, i) => (
                    <Cell key={i} fill={AGENT_COLORS[m.agent] ?? '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Projects by Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={costs.by_project.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => formatCost(v)} fontSize={11} />
                <YAxis type="category" dataKey="display_name" width={120} fontSize={11} />
                <Tooltip formatter={(v: number) => formatCost(v)} />
                <Bar dataKey="estimated_cost" name="Cost">
                  {costs.by_project.slice(0, 10).map((p, i) => (
                    <Cell key={i} fill={AGENT_COLORS[p.agent] ?? '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

function ActivityTab({ activity, loading }: { activity: ActivityData | null; loading: boolean }) {
  if (loading || !activity) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Current Streak" value={`${activity.streaks.current} days`} />
        <StatCard title="Longest Streak" value={`${activity.streaks.longest} days`} />
        <StatCard title="Active Days" value={String(activity.total_active_days)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sessions by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activity.hour_counts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sessions by Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={activity.dow_counts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#f97316" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Daily Activity (Last 90 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap data={activity.daily_activity} />
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityHeatmap({ data }: { data: Array<{ date: string; sessionCount: number }> }) {
  const last90 = data.slice(-90);
  const maxCount = Math.max(...last90.map(d => d.sessionCount), 1);

  return (
    <div className="flex flex-wrap gap-1">
      {last90.map(d => {
        const intensity = d.sessionCount / maxCount;
        const bg = d.sessionCount === 0
          ? 'bg-muted'
          : intensity < 0.33
          ? 'bg-green-200 dark:bg-green-900'
          : intensity < 0.66
          ? 'bg-green-400 dark:bg-green-700'
          : 'bg-green-600 dark:bg-green-500';
        return (
          <div
            key={d.date}
            className={`w-3 h-3 rounded-sm ${bg}`}
            title={`${d.date}: ${d.sessionCount} sessions`}
          />
        );
      })}
    </div>
  );
}

// ─── Efficiency Tab ──────────────────────────────────────────────────────────

function EfficiencyTab({ efficiency, loading }: { efficiency: EfficiencyData | null; loading: boolean }) {
  if (loading || !efficiency) return <Skeleton className="h-64 w-full" />;

  const chartData = efficiency.agents.map(a => ({
    agent: AGENT_LABELS[a.agent] ?? a.agent,
    'Tool Success': Math.round(a.toolSuccessRate * 100),
    'Completion': Math.round(a.completionRate * 100),
    fill: AGENT_COLORS[a.agent] ?? '#6b7280',
  }));

  return (
    <div className="space-y-6">
      {/* Combined metrics */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Overall Tool Success"
          value={formatPct(efficiency.combined.toolSuccessRate)}
          accent={efficiency.combined.toolSuccessRate < 0.9 ? 'red' : efficiency.combined.toolSuccessRate < 0.95 ? 'yellow' : 'green'}
        />
        <StatCard
          title="Overall Completion Rate"
          value={formatPct(efficiency.combined.completionRate)}
          accent={efficiency.combined.completionRate < 0.6 ? 'red' : efficiency.combined.completionRate < 0.8 ? 'yellow' : 'green'}
        />
        <StatCard
          title="Avg Cost / Completion"
          value={efficiency.combined.avgCostPerCompletion > 0 ? formatCost(efficiency.combined.avgCostPerCompletion) : 'N/A'}
        />
      </div>

      {/* Per-agent comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {efficiency.agents.map(a => (
          <Card key={a.agent}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: AGENT_COLORS[a.agent] }} />
                <CardTitle className="text-sm font-medium">{AGENT_LABELS[a.agent] ?? a.agent}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <MetricRow label="Tool Success" value={formatPct(a.toolSuccessRate)} accent={a.toolSuccessRate < 0.9 ? 'red' : a.toolSuccessRate < 0.95 ? 'yellow' : 'green'} />
              <MetricRow label="Completion Rate" value={formatPct(a.completionRate)} accent={a.completionRate < 0.6 ? 'red' : a.completionRate < 0.8 ? 'yellow' : 'green'} />
              <MetricRow label="Cost / Completion" value={a.costPerCompletion > 0 ? formatCost(a.costPerCompletion) : 'N/A'} />
              <MetricRow label="Tool Errors" value={String(a.totalToolErrors)} accent={a.totalToolErrors > 0 ? 'yellow' : undefined} />
              <MetricRow label="Sessions" value={`${a.completedSessions} / ${a.totalSessions}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Comparison chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Agent Comparison (%)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="agent" fontSize={11} />
              <YAxis domain={[0, 100]} fontSize={11} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="Tool Success" fill="#60a5fa" />
              <Bar dataKey="Completion" fill="#a78bfa" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'yellow' | 'green' }) {
  const colorClass = accent === 'red' ? 'text-red-600 dark:text-red-400'
    : accent === 'yellow' ? 'text-yellow-600 dark:text-yellow-400'
    : accent === 'green' ? 'text-green-600 dark:text-green-400'
    : '';
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={colorClass}>{value}</span>
    </div>
  );
}

// ─── Tools Tab (Enhanced) ────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'file-io': '#60a5fa',
  'shell': '#d97706',
  'agent': '#a78bfa',
  'web': '#22c55e',
  'planning': '#fbbf24',
  'todo': '#fb923c',
  'skill': '#38bdf8',
  'mcp': '#34d399',
  'other': '#6b7280',
};

function successRateColor(rate: number): string {
  if (rate >= 0.95) return 'text-green-600 dark:text-green-400';
  if (rate >= 0.80) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function ToolsTab({ tools, loading }: { tools: ToolsData | null; loading: boolean }) {
  if (loading || !tools) return <Skeleton className="h-64 w-full" />;

  const byCategory = new Map<string, number>();
  for (const t of tools.tools) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.total_calls);
  }
  const categoryData = Array.from(byCategory.entries())
    .map(([category, count]) => ({ category, count, fill: CATEGORY_COLORS[category] ?? '#6b7280' }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total Tool Calls" value={formatTokens(tools.total_tool_calls)} />
        <StatCard title="Total Tool Errors" value={String(tools.total_tool_errors)} accent={tools.total_tool_errors > 0 ? 'yellow' : undefined} />
        <StatCard title="Overall Success Rate" value={tools.total_tool_calls > 0 ? formatPct((tools.total_tool_calls - tools.total_tool_errors) / tools.total_tool_calls) : '100%'} accent={tools.total_tool_calls > 0 && (tools.total_tool_calls - tools.total_tool_errors) / tools.total_tool_calls < 0.9 ? 'red' : 'green'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Calls by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" name="Calls">
                  {categoryData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Success %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.tools.slice(0, 20).map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" style={{ borderColor: AGENT_COLORS[t.agent], color: AGENT_COLORS[t.agent] }} className="text-xs">
                        {AGENT_LABELS[t.agent] ?? t.agent}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{t.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{t.total_calls}</TableCell>
                    <TableCell className="text-right text-sm">{t.error_count > 0 ? t.error_count : '-'}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${successRateColor(t.success_rate)}`}>
                      {formatPct(t.success_rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Projects Tab ───────────────────────────────────────────────────────────

function ProjectsTab({ projects, loading }: { projects: ProjectAnalytics[] | null; loading: boolean }) {
  if (loading || !projects) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <span className="text-sm text-muted-foreground">{projects.length} projects</span>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.slice(0, 15).map(p => (
          <Card key={p.project_path}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium truncate" title={p.project_path}>{p.display_name}</CardTitle>
              <div className="flex gap-1">
                {p.agents.map(a => (
                  <div key={a} className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENT_COLORS[a] }} title={AGENT_LABELS[a] ?? a} />
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <MetricRow label="Sessions" value={`${p.completed_sessions}/${p.total_sessions}`} />
              <MetricRow label="Completion" value={formatPct(p.completion_rate)} accent={p.completion_rate < 0.6 ? 'red' : p.completion_rate < 0.8 ? 'yellow' : 'green'} />
              <MetricRow label="Cost" value={p.total_cost > 0 ? formatCost(p.total_cost) : 'N/A'} />
              {p.wasted_cost > 0 && <MetricRow label="Wasted" value={formatCost(p.wasted_cost)} accent="red" />}
              <MetricRow label="Avg Session" value={formatDuration(p.avg_session_minutes)} />
              {p.total_tool_errors > 0 && <MetricRow label="Tool Errors" value={String(p.total_tool_errors)} accent="yellow" />}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Advanced Analytics Tab ─────────────────────────────────────────────────

function AdvancedTab({ advanced, failurePatterns, loading }: {
  advanced: AdvancedAnalytics | null;
  failurePatterns: FailurePattern[] | null;
  loading: boolean;
}) {
  if (loading || !advanced) return <Skeleton className="h-64 w-full" />;

  const { mcp, hourly_effectiveness, duration_distribution, conversation_depth } = advanced;

  return (
    <div className="space-y-6">
      {/* MCP Servers */}
      {mcp.servers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">MCP Servers ({mcp.servers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Success %</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mcp.servers.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{s.server}</TableCell>
                    <TableCell>
                      <Badge variant="outline" style={{ borderColor: AGENT_COLORS[s.agent], color: AGENT_COLORS[s.agent] }} className="text-xs">
                        {AGENT_LABELS[s.agent] ?? s.agent}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{s.total_calls}</TableCell>
                    <TableCell className="text-right text-sm">{s.error_count > 0 ? s.error_count : '-'}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${successRateColor(s.success_rate)}`}>{formatPct(s.success_rate)}</TableCell>
                    <TableCell className="text-right text-sm">{s.session_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hourly Effectiveness */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourly_effectiveness.filter(h => h.total_sessions > 0)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={11} />
                <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPct(v)} fontSize={11} />
                <Tooltip formatter={(v: number) => formatPct(v)} />
                <Bar dataKey="completion_rate" name="Completion Rate">
                  {hourly_effectiveness.filter(h => h.total_sessions > 0).map((h, i) => (
                    <Cell key={i} fill={h.completion_rate >= 0.8 ? '#22c55e' : h.completion_rate >= 0.5 ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Duration Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Session Duration Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={duration_distribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="session_count" fill="#60a5fa" name="Sessions" />
                <Bar dataKey="completed_count" fill="#22c55e" name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Conversation Depth */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Conversation Depth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{conversation_depth.avg_depth.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Avg turns/session</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{formatPct(conversation_depth.low_backforth_completion_rate)}</p>
              <p className="text-xs text-muted-foreground">Completion ({'<'}5 turns)</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${conversation_depth.high_backforth_completion_rate < 0.5 ? 'text-red-600' : 'text-amber-600'}`}>
                {formatPct(conversation_depth.high_backforth_completion_rate)}
              </p>
              <p className="text-xs text-muted-foreground">Completion (5+ turns)</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={conversation_depth.depth_buckets}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="session_count" fill="#8b5cf6" name="Sessions" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Failure Patterns */}
      {failurePatterns && failurePatterns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recurring Failure Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead className="text-right">Occurrences</TableHead>
                  <TableHead className="text-right">Sessions Affected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failurePatterns.slice(0, 10).map((fp, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" style={{ borderColor: AGENT_COLORS[fp.agent], color: AGENT_COLORS[fp.agent] }} className="text-xs">
                        {AGENT_LABELS[fp.agent] ?? fp.agent}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{fp.tool}</TableCell>
                    <TableCell className="text-right text-sm text-red-600">{fp.occurrences}</TableCell>
                    <TableCell className="text-right text-sm">{fp.sessions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StatCard({ title, value, accent }: { title: string; value: string; accent?: 'red' | 'yellow' | 'green' }) {
  const colorClass = accent === 'red' ? 'text-red-600 dark:text-red-400'
    : accent === 'yellow' ? 'text-yellow-600 dark:text-yellow-400'
    : accent === 'green' ? 'text-green-600 dark:text-green-400'
    : '';
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: 'Today',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
  all: 'All Time',
};

export const CodingAgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [stats, setStats] = useState<CombinedStats | null>(null);
  const [costs, setCosts] = useState<CostAnalytics | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [tools, setTools] = useState<ToolsData | null>(null);
  const [efficiency, setEfficiency] = useState<EfficiencyData | null>(null);
  const [projects, setProjects] = useState<ProjectAnalytics[] | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedAnalytics | null>(null);
  const [failurePatterns, setFailurePatterns] = useState<FailurePattern[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [error, setError] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('today');

  const range = getDateRange(rangePreset);

  // Reset lazy-loaded tab data when range changes
  const handleRangeChange = (preset: DateRangePreset) => {
    setRangePreset(preset);
    setCosts(null);
    setActivity(null);
    setTools(null);
    setEfficiency(null);
    setProjects(null);
    setAdvanced(null);
    setFailurePatterns(null);
  };

  const handleExport = (format: 'json' | 'csv') => {
    const url = `${ENV_CONFIG.backendUrl}${buildQuery('/api/coding-agents/export', range, { format })}`;
    window.open(url, '_blank');
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [agentData, statsData] = await Promise.all([
          fetchJson<{ agents: AgentInfo[] }>('/api/coding-agents/available'),
          fetchJson<CombinedStats>(buildQuery('/api/coding-agents/stats', range)),
        ]);
        setAgents(agentData.agents);
        setStats(statsData);

        if (agentData.agents.length === 0) {
          setError('No coding agents detected. Install Claude Code, Kiro, or Codex CLI to see analytics.');
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [rangePreset]);

  // Lazy-load tab data
  useEffect(() => {
    // Sessions tab manages its own data loading now
    if (activeTab === 'costs' && !costs) {
      fetchJson<CostAnalytics>(buildQuery('/api/coding-agents/costs', range))
        .then(d => setCosts(d))
        .catch(() => {});
    }
    if (activeTab === 'activity' && !activity) {
      fetchJson<ActivityData>(buildQuery('/api/coding-agents/activity', range))
        .then(d => setActivity(d))
        .catch(() => {});
    }
    if (activeTab === 'tools' && !tools) {
      fetchJson<ToolsData>(buildQuery('/api/coding-agents/tools', range))
        .then(d => setTools(d))
        .catch(() => {});
    }
    if (activeTab === 'efficiency' && !efficiency) {
      fetchJson<EfficiencyData>(buildQuery('/api/coding-agents/efficiency', range))
        .then(d => setEfficiency(d))
        .catch(() => {});
    }
    if (activeTab === 'projects' && !projects) {
      fetchJson<{ projects: ProjectAnalytics[] }>(buildQuery('/api/coding-agents/projects', range))
        .then(d => setProjects(d.projects))
        .catch(() => {});
    }
    if (activeTab === 'advanced' && !advanced) {
      Promise.all([
        fetchJson<AdvancedAnalytics>(buildQuery('/api/coding-agents/advanced', range)),
        fetchJson<{ patterns: FailurePattern[] }>(buildQuery('/api/coding-agents/failure-patterns', range)),
      ]).then(([adv, fp]) => {
        setAdvanced(adv);
        setFailurePatterns(fp.patterns);
      }).catch(() => {});
    }
  }, [activeTab, rangePreset]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coding Agent Analytics</h1>
          <p className="text-muted-foreground">
            Usage analytics across your coding agents
            {agents.length > 0 && (
              <span className="ml-2">
                {agents.map(a => (
                  <Badge key={a.name} variant="outline" className="ml-1" style={{ borderColor: AGENT_COLORS[a.name], color: AGENT_COLORS[a.name] }}>
                    {a.displayName}
                  </Badge>
                ))}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={rangePreset} onValueChange={(v) => handleRangeChange(v as DateRangePreset)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DATE_RANGE_LABELS) as DateRangePreset[]).map(k => (
                <SelectItem key={k} value={k}>{DATE_RANGE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => handleExport(v as 'json' | 'csv')}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Export" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && agents.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-muted-foreground">{error}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Supported agents: Claude Code (~/.claude), Kiro (~/.kiro), Codex CLI (~/.codex)
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="efficiency">Efficiency</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab stats={stats} agents={agents} onTabChange={setActiveTab} rangePreset={rangePreset} />
          </TabsContent>
          <TabsContent value="sessions" className="mt-4">
            <SessionsTab range={range} loading={loading} />
          </TabsContent>
          <TabsContent value="projects" className="mt-4">
            <ProjectsTab projects={projects} loading={activeTab === 'projects' && !projects} />
          </TabsContent>
          <TabsContent value="costs" className="mt-4">
            <CostsTab costs={costs} loading={activeTab === 'costs' && !costs} />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ActivityTab activity={activity} loading={activeTab === 'activity' && !activity} />
          </TabsContent>
          <TabsContent value="efficiency" className="mt-4">
            <EfficiencyTab efficiency={efficiency} loading={activeTab === 'efficiency' && !efficiency} />
          </TabsContent>
          <TabsContent value="tools" className="mt-4">
            <ToolsTab tools={tools} loading={activeTab === 'tools' && !tools} />
          </TabsContent>
          <TabsContent value="advanced" className="mt-4">
            <AdvancedTab advanced={advanced} failurePatterns={failurePatterns} loading={activeTab === 'advanced' && !advanced} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
