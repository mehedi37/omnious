'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

interface PushEvent {
  project_name: string;
  nodes_upserted: number;
  edges_upserted: number;
  pushed_at: string;
}

/**
 * Subscribe to Supabase Realtime push_completed events for the current project.
 * Auto-invalidates graph queries and shows a toast when a CLI push finishes.
 */
export function usePushNotifications() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const utils = trpc.useUtils();
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserClient>['channel']> | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`project:${projectId}`)
      .on('broadcast', { event: 'push_completed' }, (msg) => {
        const payload = msg.payload as PushEvent;

        // Invalidate queries so the graph and status data refreshes
        utils.ai.getOverview.invalidate({ projectId });
        utils.graph.listNodes.invalidate();
        utils.graph.getClusters.invalidate({ projectId });

        // Show toast
        const parts: string[] = [];
        if (payload.nodes_upserted > 0) parts.push(`${payload.nodes_upserted} nodes`);
        if (payload.edges_upserted > 0) parts.push(`${payload.edges_upserted} edges`);
        const changeStr = parts.length > 0 ? parts.join(', ') : 'no changes';

        toast.success('Graph updated from CLI push', {
          description: `${changeStr} synced`,
          duration: 5000,
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [projectId, utils]);
}
