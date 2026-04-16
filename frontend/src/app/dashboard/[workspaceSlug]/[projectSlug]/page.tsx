'use client';

import {
  Activity,
  AlertTriangle,
  Brain,
  GitGraph,
  Layers,
  Network,
  FileText,
  Terminal,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BarChart3,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { deriveSyncState, SyncStatusBadge } from '@/components/project/sync-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  subtitle,
}: {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  subtitle?: string;
}) {
  const content = (
    <Card className={href ? 'transition-colors hover:border-primary/40' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

export default function ProjectPage() {
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  const { data: overview, isLoading } = trpc.project.getProjectOverview.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId, refetchInterval: 30_000 },
  );

  const basePath = `/dashboard/${params.workspaceSlug}/${params.projectSlug}`;

  if (isLoading || !overview) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const syncState = deriveSyncState(
    overview.status ?? 'active',
    overview.last_indexed_at,
    overview.counts.nodes,
  );

  const typeEntries = Object.entries(overview.node_type_breakdown)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{overview.name}</h1>
          <p className="text-sm text-muted-foreground">{overview.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatusBadge syncState={syncState} />
          {overview.last_indexed_at && (
            <span className="text-xs text-muted-foreground">
              Last push {formatRelativeTime(overview.last_indexed_at)}
            </span>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Nodes"
          value={overview.counts.nodes.toLocaleString()}
          icon={Network}
          href={`${basePath}/graph`}
          subtitle="Code entities"
        />
        <StatCard
          title="Edges"
          value={overview.counts.edges.toLocaleString()}
          icon={GitGraph}
          href={`${basePath}/graph`}
          subtitle="Relationships"
        />
        <StatCard
          title="Traces"
          value={overview.counts.traces.toLocaleString()}
          icon={Activity}
          href={`${basePath}/traces`}
          subtitle="Execution traces"
        />
        <StatCard
          title="Errors"
          value={overview.counts.errors.toLocaleString()}
          icon={AlertTriangle}
          href={`${basePath}/errors`}
          subtitle="Unresolved"
        />
      </div>

      {/* AI Coverage + Node Types */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* AI Intelligence Coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" /> AI Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CoverageRow label="Summaries" count={overview.counts.summaries} total={overview.counts.nodes} icon={FileText} />
            <CoverageRow label="Clusters" count={overview.counts.clusters} icon={Layers} />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" /> AI Profile
              </span>
              {overview.has_ai_profile ? (
                <span className="flex items-center gap-1 text-green-500 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Generated</span>
              ) : (
                <span className="flex items-center gap-1 text-yellow-500 text-xs"><AlertCircle className="h-3.5 w-3.5" /> Pending push</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Node Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" /> Node Types
            </CardTitle>
          </CardHeader>
          <CardContent>
            {typeEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No nodes indexed yet.</p>
            ) : (
              <div className="space-y-2">
                {typeEntries.slice(0, 8).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-muted-foreground">{type.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 rounded-full bg-primary/60"
                        style={{ width: `${Math.max(12, (count / overview.counts.nodes) * 120)}px` }}
                      />
                      <span className="w-8 text-right font-mono text-xs">{count}</span>
                    </div>
                  </div>
                ))}
                {typeEntries.length > 8 && (
                  <p className="text-xs text-muted-foreground">+{typeEntries.length - 8} more types</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions / Empty State */}
      {overview.counts.nodes === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Terminal className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-1">No code indexed yet</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Run the CLI to index your codebase and push the graph to this project.
            </p>
            <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono">
              npx @omnious/cli index && npx @omnious/cli push
            </pre>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <Link href={`${basePath}/graph`}>
            <Card className="transition-colors hover:border-primary/40 cursor-pointer">
              <CardContent className="flex items-center gap-3 py-4">
                <GitGraph className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Explore Graph</p>
                  <p className="text-xs text-muted-foreground">Visualize architecture</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href={`${basePath}/ai`}>
            <Card className="transition-colors hover:border-primary/40 cursor-pointer">
              <CardContent className="flex items-center gap-3 py-4">
                <Brain className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Ask AI</p>
                  <p className="text-xs text-muted-foreground">Query with context</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href={`${basePath}/errors`}>
            <Card className="transition-colors hover:border-primary/40 cursor-pointer">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertTriangle className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">View Errors</p>
                  <p className="text-xs text-muted-foreground">{overview.counts.errors} unresolved</p>
                </div>
                <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      )}
    </div>
  );
}

function CoverageRow({
  label,
  count,
  total,
  icon: Icon,
}: {
  label: string;
  count: number;
  total?: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="font-mono text-xs">
        {count.toLocaleString()}
        {total != null && <span className="text-muted-foreground"> / {total.toLocaleString()}</span>}
      </span>
    </div>
  );
}
