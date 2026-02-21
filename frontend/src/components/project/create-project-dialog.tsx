'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

interface CreateProjectDialogProps {
  workspaceId: string;
  workspaceSlug: string;
  children: React.ReactNode;
}

export function CreateProjectDialog({
  workspaceId,
  workspaceSlug,
  children,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [gitProvider, setGitProvider] = useState<string>('');
  const [gitUrl, setGitUrl] = useState('');
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);
  const utils = trpc.useUtils();

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      utils.project.list.invalidate();
      setCurrentProject(project.id, project.slug);
      setOpen(false);
      resetForm();
      toast.success('Project created');
      router.push(`/dashboard/${workspaceSlug}/${project.slug}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function resetForm() {
    setName('');
    setSlug('');
    setDescription('');
    setGitProvider('');
    setGitUrl('');
  }

  function handleNameChange(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            A project represents a codebase you want to visualize and debug.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({
              workspaceId,
              name,
              slug,
              description: description || undefined,
              gitProvider:
                (gitProvider as 'github' | 'gitlab' | 'bitbucket' | 'local') || undefined,
              gitUrl: gitUrl || undefined,
            });
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My Project"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proj-slug">Slug</Label>
            <Input
              id="proj-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-project"
              pattern="^[a-z0-9-]+$"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Git Provider</Label>
              <Select value={gitProvider} onValueChange={setGitProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="gitlab">GitLab</SelectItem>
                  <SelectItem value="bitbucket">Bitbucket</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proj-git">Git URL</Label>
              <Input
                id="proj-git"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
