/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ENV_CONFIG } from '@/lib/config';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
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
  tool_counts: Record<string, number>;
}
interface CostAnalytics {
  total_cost: number;
  total_savings: number;
  models: Array<{ agent: string; model: string; estimated_cost: number; input_tokens: number; output_tokens: number }>;
  by_project: Array<{ agent: string; display_name: string; estimated_cost: number }>;
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

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ stats, agents, onTabChange }: { stats: CombinedStats | null; agents: AgentInfo[]; onTabChange: (tab: string) => void }) {
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
      {/* Insights banner */}
      <InsightsBanner insights={stats.insights} onTabChange={onTabChange} />

      {/* Key metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Total Sessions" value={String(stats.totalSessions)} />
        <StatCard title="Estimated Cost" value={formatCost(stats.totalCost)} />
        <StatCard title="Tool Success Rate" value={formatPct(toolSuccessRate)} accent={toolSuccessRate < 0.9 ? 'red' : toolSuccessRate < 0.95 ? 'yellow' : 'green'} />
        <StatCard title="Cost / Completion" value={totalCompleted > 0 ? formatCost(stats.totalCost / totalCompleted) : 'N/A'} />
        <StatCard title="Cache Savings" value={cacheSavings > 0 ? formatCost(cacheSavings) : 'N/A'} accent={cacheSavings > 0 ? 'green' : undefined} />
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

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({ sessions, loading }: { sessions: Session[]; loading: boolean }) {
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const filtered = agentFilter === 'all' ? sessions : sessions.filter(s => s.agent === agentFilter);
  const agents = [...new Set(sessions.map(s => s.agent))];

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents.map(a => (
              <SelectItem key={a} value={a}>{AGENT_LABELS[a] ?? a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} sessions</span>
      </div>

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
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 50).map(s => (
              <TableRow key={`${s.agent}-${s.session_id}`}>
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
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(s.start_time).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ─── Costs Tab ────────────────────────────────────────────────────────────────

function CostsTab({ costs, loading }: { costs: CostAnalytics | null; loading: boolean }) {
  if (loading || !costs) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Total Estimated Cost" value={formatCost(costs.total_cost)} />
        <StatCard title="Cache Savings" value={formatCost(costs.total_savings)} />
      </div>

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

export const CodingAgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [stats, setStats] = useState<CombinedStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [costs, setCosts] = useState<CostAnalytics | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [tools, setTools] = useState<ToolsData | null>(null);
  const [efficiency, setEfficiency] = useState<EfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [agentData, statsData] = await Promise.all([
          fetchJson<{ agents: AgentInfo[] }>('/api/coding-agents/available'),
          fetchJson<CombinedStats>('/api/coding-agents/stats'),
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
  }, []);

  // Lazy-load tab data
  useEffect(() => {
    if (activeTab === 'sessions' && sessions.length === 0) {
      fetchJson<{ sessions: Session[] }>('/api/coding-agents/sessions?limit=200')
        .then(d => setSessions(d.sessions))
        .catch(() => {});
    }
    if (activeTab === 'costs' && !costs) {
      fetchJson<CostAnalytics>('/api/coding-agents/costs')
        .then(d => setCosts(d))
        .catch(() => {});
    }
    if (activeTab === 'activity' && !activity) {
      fetchJson<ActivityData>('/api/coding-agents/activity')
        .then(d => setActivity(d))
        .catch(() => {});
    }
    if (activeTab === 'tools' && !tools) {
      fetchJson<ToolsData>('/api/coding-agents/tools')
        .then(d => setTools(d))
        .catch(() => {});
    }
    if (activeTab === 'efficiency' && !efficiency) {
      fetchJson<EfficiencyData>('/api/coding-agents/efficiency')
        .then(d => setEfficiency(d))
        .catch(() => {});
    }
  }, [activeTab]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
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
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="efficiency">Efficiency</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab stats={stats} agents={agents} onTabChange={setActiveTab} />
          </TabsContent>
          <TabsContent value="sessions" className="mt-4">
            <SessionsTab sessions={sessions} loading={activeTab === 'sessions' && sessions.length === 0 && loading} />
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
        </Tabs>
      )}
    </div>
  );
};
