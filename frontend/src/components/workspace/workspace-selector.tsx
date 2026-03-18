'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { CreateWorkspaceDialog } from './create-workspace-dialog';

export function WorkspaceSelector() {
  const router = useRouter();
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const { data: workspaces, isLoading } = trpc.workspace.list.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {workspaces?.map((item) => (
        <Card
          key={item.workspace.id}
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => {
            setCurrentWorkspace(item.workspace.id, item.workspace.slug);
            router.push(`/dashboard/${item.workspace.slug}`);
          }}
        >
          <CardHeader>
            <CardTitle className="text-lg">{item.workspace.name}</CardTitle>
            <CardDescription className="capitalize">
              {item.role} · {item.workspace.plan} plan
            </CardDescription>
          </CardHeader>
        </Card>
      ))}

      <CreateWorkspaceDialog>
        <Card className="flex cursor-pointer border-dashed transition-colors hover:border-primary/50">
          <CardHeader className="flex flex-col items-center justify-center">
            <Plus className="mb-2 size-8 text-muted-foreground" />
            <CardTitle className="text-sm text-muted-foreground">New Workspace</CardTitle>
          </CardHeader>
        </Card>
      </CreateWorkspaceDialog>
    </div>
  );
}
