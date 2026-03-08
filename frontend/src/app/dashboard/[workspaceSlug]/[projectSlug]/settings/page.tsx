'use client';

import {
  BarChart3,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  GitBranch,
  Github,
  Globe,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Check,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { ApiKeyManager } from '@/components/ai/api-key-manager';
import { deriveSyncState, SyncStatusBadge } from '@/components/project/sync-status-badge';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

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

function SettingsPageContent() {
  const router = useRouter();
  const params = useParams<{ workspaceSlug: string }>();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') ?? 'general';
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const clearProject = useWorkspaceStore((s) => s.clearProject);
  const [showApiKey, setShowApiKey] = useState(false);

  const queryClient = trpc.useUtils();

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
      queryClient.project.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      toast.success('Project deleted');
      queryClient.project.list.invalidate();
      clearProject();
      router.push(`/dashboard/${params.workspaceSlug}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const reindexMutation = trpc.project.triggerReindex.useMutation({
    onSuccess: () => {
      toast.success('Re-index triggered — status set to importing');
      projectQuery.refetch();
      queryClient.project.list.invalidate();
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

  const setSelectedKeyMutation = trpc.project.setSelectedKey.useMutation({
    onSuccess: () => {
      toast.success('Default AI key updated');
      projectQuery.refetch();
      queryClient.project.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const apiKeysQuery = trpc.ai.listApiKeys.useQuery();

  const project = projectQuery.data;
  const stats = statsQuery.data;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  // Sync form state when data loads
  if (project && !name) {
    setName(project.name);
    setDescription(project.description ?? '');
    setSelectedKeyId((project as any).selected_key_id ?? null);
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

      <Tabs defaultValue={initialTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="indexing">Indexing</TabsTrigger>
          <TabsTrigger value="ai-keys">AI Keys</TabsTrigger>
          <TabsTrigger value="danger" className="text-red-600 dark:text-red-400">
            Danger
          </TabsTrigger>
        </TabsList>

        {/* ── General Tab ── */}
        <TabsContent value="general" className="space-y-4">
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

          {/* Source Details */}
          <Card>
            <CardHeader>
              <CardTitle>Source Details</CardTitle>
              <CardDescription>Git repository and source information</CardDescription>
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
                {project?.framework && <Badge variant="secondary">{project.framework}</Badge>}
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
                  No git provider configured. Use the Omnious CLI to index your project:
                </p>
              )}
              <div className="rounded-md bg-muted p-3 text-sm font-mono">
                <p className="text-muted-foreground"># Install CLI and index your project</p>
                <p>npx @omnious/cli init</p>
                <p>npx @omnious/cli index</p>
                <p>npx @omnious/cli push</p>
              </div>
            </CardContent>
          </Card>

          {/* API Key (CLI/Ingestion) */}
          <Card>
            <CardHeader>
              <CardTitle>Project API Key</CardTitle>
              <CardDescription>Use this key with the CLI or to ingest traces</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type={showApiKey ? 'text' : 'password'}
                  value={project?.api_key ?? ''}
                  className="font-mono text-sm"
                />
                <Button variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
        </TabsContent>

        {/* ── Indexing Tab ── */}
        <TabsContent value="indexing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-5" />
                Indexing Status
              </CardTitle>
              <CardDescription>
                Last indexed {formatRelativeTime(project?.last_indexed_at ?? null)} · OIR v
                {project?.oir_version ?? '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <SyncStatusBadge
                  syncState={deriveSyncState(
                    project?.status ?? 'unknown',
                    project?.last_indexed_at,
                    stats?.nodeCount,
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{stats?.nodeCount ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Nodes</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{stats?.edgeCount ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Edges</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{stats?.traceCount ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Traces</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{stats?.errorCount ?? '—'}</p>
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
        </TabsContent>

        {/* ── AI Keys Tab ── */}
        <TabsContent value="ai-keys" className="space-y-4">
          {/* Project default key selection */}
          <Card>
            <CardHeader>
              <CardTitle>Default AI Key</CardTitle>
              <CardDescription>Select which API key this project uses by default</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiKeysQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading keys...</div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="default-key">API Key</Label>
                    <div className="flex gap-2">
                      <select
                        id="default-key"
                        value={selectedKeyId ?? ''}
                        onChange={(e) => {
                          const newKeyId = e.target.value || null;
                          setSelectedKeyId(newKeyId);
                        }}
                        className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                      >
                        <option value="">Account default (primary active key)</option>
                        {(apiKeysQuery.data ?? []).map((key) => (
                          <option key={key.id} value={key.id}>
                            {key.label} ({key.provider}) — {key.key_prefix}...
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => {
                          if (currentProjectId) {
                            setSelectedKeyMutation.mutate({
                              projectId: currentProjectId,
                              keyId: selectedKeyId,
                            });
                          }
                        }}
                        disabled={setSelectedKeyMutation.isPending}
                        size="sm"
                      >
                        {setSelectedKeyMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {(apiKeysQuery.data?.length ?? 0) === 0 && (
                    <div className="text-sm text-muted-foreground">
                      No API keys added yet. Add one in the Account Keys section below.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Account-level key management */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Account API Keys (BYOK)</h3>
          </div>
          <ApiKeyManager />
        </TabsContent>

        {/* ── Danger Tab ── */}
        <TabsContent value="danger" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
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
                      This will permanently delete <strong>{project?.name}</strong> and all its data
                      including code nodes, edges, traces, and error snapshots. This action cannot be
                      undone.
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl space-y-6 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    }>
      <SettingsPageContent />
    </Suspense>
  );
}
