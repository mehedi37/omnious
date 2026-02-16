'use client';

import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { trpc } from '@/trpc/client';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export default function SettingsPage() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  const projectQuery = trpc.project.getById.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId },
  );

  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      toast.success('Project settings saved');
      projectQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const project = projectQuery.data;
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

      <Card>
        <CardHeader>
          <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm">
            Delete Project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
