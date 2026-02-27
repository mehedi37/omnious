'use client';

import { AlertTriangle, Loader2, Settings, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
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
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);

  const { data: workspaces } = trpc.workspace.list.useQuery();
  const currentWorkspace = workspaces?.find((w) => w.workspace.id === workspaceId);
  const workspace = currentWorkspace?.workspace;
  const role = currentWorkspace?.role;
  const isOwner = role === 'owner' || role === 'admin';

  const [name, setName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);

  // Load workspace name once
  if (workspace && !nameLoaded) {
    setName(workspace.name);
    setNameLoaded(true);
  }

  const utils = trpc.useUtils();

  const updateMutation = trpc.workspace.update.useMutation({
    onSuccess: () => {
      utils.workspace.list.invalidate();
    },
  });

  const deleteMutation = trpc.workspace.delete.useMutation({
    onSuccess: () => {
      clearWorkspace();
      router.push('/dashboard');
    },
  });

  const handleSave = () => {
    if (!workspaceId || !name.trim()) return;
    updateMutation.mutate({ workspaceId, name: name.trim() });
  };

  const handleDelete = () => {
    if (!workspaceId) return;
    deleteMutation.mutate({ workspaceId });
  };

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workspace Settings</h1>
          <p className="text-sm text-muted-foreground">{workspace.name}</p>
        </div>
      </div>

      <Separator />

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Manage your workspace name and details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
            />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={workspace.slug} disabled />
            <p className="text-xs text-muted-foreground">Slug cannot be changed after creation</p>
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Input value={workspace.plan ?? 'free'} disabled className="capitalize" />
          </div>
          {isOwner && (
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || name === workspace.name}
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      {isOwner && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              These actions are irreversible. Please be certain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete Workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workspace &quot;{workspace.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the workspace, all projects, graphs, traces, and
                    error data. All team members will lose access. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
