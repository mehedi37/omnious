'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Save,
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
  GitBranch,
  Github,
  Globe,
  FolderOpen,
  Copy,
  Eye,
  EyeOff,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

function formatRelativeTime(date: string | null) {
  if (!date) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function gitProviderIcon(provider: string | null) {
  switch (provider) {
    case 'github':
      return <Github className="size-4" />;
    case 'gitlab':
    case 'bitbucket':
      return <Globe className="size-4" />;
    case 'local':
      return <FolderOpen className="size-4" />;
    default:
      return null;
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const params = useParams<{ workspaceSlug: string }>();
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const clearProject = useWorkspaceStore((s) => s.clearProject);
  const [showApiKey, setShowApiKey] = useState(false);

  const projectQuery = trpc.project.getById.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId },
  );

  const statsQuery = trpc.project.stats.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId, staleTime: 60 * 1000 },
  );

  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      toast.success('Project settings saved');
      projectQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      toast.success('Project deleted');
      clearProject();
      router.push(`/dashboard/${params.workspaceSlug}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const reindexMutation = trpc.project.triggerReindex.useMutation({
    onSuccess: () => {
      toast.success('Re-index triggered — status set to importing');
      projectQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const regenerateKeyMutation = trpc.project.regenerateApiKey.useMutation({
    onSuccess: () => {
      toast.success('API key regenerated');
      projectQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const project = projectQuery.data;
  const stats = statsQuery.data;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Sync form state when data loads
  if (project && !name) {
    setName(project.name);
    setDescription(project.description ?? '');
  }

  const handleSave = () => {
    if (!currentProjectId) return;
    updateMutation.mutate({
      projectId: currentProjectId,
      name,
      description,
    });
  };

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Project Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure your project details and integrations
        </p>
      </div>

      <Separator />

      {/* ── General ── */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Basic project information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your project"
              rows={3}
            />
          </div>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* ── Source Details ── */}
      <Card>
        <CardHeader>
          <CardTitle>Source Details</CardTitle>
          <CardDescription>
            Git repository and source information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {gitProviderIcon(project?.git_provider ?? null)}
            <Badge variant="outline" className="capitalize">
              {project?.git_provider ?? 'Not set'}
            </Badge>
            {project?.primary_language && (
              <Badge variant="secondary">{project.primary_language}</Badge>
            )}
            {project?.framework && (
              <Badge variant="secondary">{project.framework}</Badge>
            )}
          </div>
          {project?.git_url && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Repository:</span>
              <a
                href={project.git_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                {project.git_url}
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {project?.git_branch && (
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="size-3.5 text-muted-foreground" />
              <span>{project.git_branch}</span>
            </div>
          )}
          {!project?.git_url && !project?.git_provider && (
            <p className="text-sm text-muted-foreground">
              No git provider configured. Use the Omnious CLI to index your
              project:
            </p>
          )}
          <div className="rounded-md bg-muted p-3 text-sm font-mono">
            <p className="text-muted-foreground">
              # Install CLI and index your project
            </p>
            <p>npx @omnious/cli init</p>
            <p>npx @omnious/cli index</p>
            <p>npx @omnious/cli push</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Indexing Status ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" />
            Indexing Status
          </CardTitle>
          <CardDescription>
            Last indexed{' '}
            {formatRelativeTime(project?.last_indexed_at ?? null)} · OIR
            v{project?.oir_version ?? '—'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                project?.status === 'active'
                  ? 'default'
                  : project?.status === 'importing'
                    ? 'secondary'
                    : 'destructive'
              }
              className="capitalize"
            >
              {project?.status ?? 'unknown'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold">
                {stats?.nodeCount ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">Nodes</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold">
                {stats?.edgeCount ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">Edges</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold">
                {stats?.traceCount ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">Traces</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold">
                {stats?.errorCount ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (currentProjectId)
                reindexMutation.mutate({ projectId: currentProjectId });
            }}
            disabled={reindexMutation.isPending || project?.status === 'importing'}
          >
            {reindexMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Re-index Project
          </Button>
        </CardContent>
      </Card>

      {/* ── API Key ── */}
      <Card>
        <CardHeader>
          <CardTitle>API Key</CardTitle>
          <CardDescription>
            Use this key with the CLI or to ingest traces
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              type={showApiKey ? 'text' : 'password'}
              value={project?.api_key ?? ''}
              className="font-mono text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (project?.api_key) {
                  navigator.clipboard.writeText(project.api_key);
                  toast.success('API key copied');
                }
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (currentProjectId)
                regenerateKeyMutation.mutate({ projectId: currentProjectId });
            }}
            disabled={regenerateKeyMutation.isPending}
          >
            {regenerateKeyMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Regenerate Key
          </Button>
        </CardContent>
      </Card>

      {/* ── Danger Zone ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600 dark:text-red-400">
            Danger Zone
          </CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete{' '}
                  <strong>{project?.name}</strong> and all its data including
                  code nodes, edges, traces, and error snapshots. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    if (currentProjectId)
                      deleteMutation.mutate({ projectId: currentProjectId });
                  }}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
