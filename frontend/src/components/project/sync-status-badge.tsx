'use client';

import { AlertCircle, CheckCircle2, Circle, Clock, HelpCircle, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type SyncState = 'empty' | 'synced' | 'stale' | 'importing' | 'error' | 'unknown';

interface SyncStatusBadgeProps {
  syncState: SyncState;
  /** Compact mode: just the dot icon (for sidebar) */
  compact?: boolean;
  className?: string;
}

const syncConfig: Record<
  SyncState,
  {
    icon: typeof CheckCircle2;
    color: string;
    fillColor: string;
    label: string;
    description: string;
  }
> = {
  synced: {
    icon: CheckCircle2,
    color: 'text-green-500',
    fillColor: 'fill-green-500',
    label: 'Synced',
    description: 'Project graph is up to date',
  },
  stale: {
    icon: Clock,
    color: 'text-amber-500',
    fillColor: 'fill-amber-500',
    label: 'Stale',
    description: 'Last indexed over 7 days ago',
  },
  importing: {
    icon: Loader2,
    color: 'text-blue-500',
    fillColor: 'fill-blue-500',
    label: 'Indexing',
    description: 'Indexing in progress...',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-500',
    fillColor: 'fill-red-500',
    label: 'Error',
    description: 'Indexing encountered an error',
  },
  empty: {
    icon: HelpCircle,
    color: 'text-muted-foreground',
    fillColor: 'fill-muted-foreground',
    label: 'Empty',
    description: 'No data indexed yet',
  },
  unknown: {
    icon: Circle,
    color: 'text-muted-foreground',
    fillColor: 'fill-muted-foreground',
    label: 'Unknown',
    description: 'Sync status unknown',
  },
};

/**
 * Derive sync state from project status when full sync data isn't available.
 * Used in sidebar/project-list where we only have project.status.
 */
export function deriveSyncState(
  status: string,
  lastIndexedAt?: string | null,
  nodeCount?: number,
): SyncState {
  if (status === 'importing') return 'importing';
  if (status === 'error') return 'error';
  if (nodeCount === 0 && !lastIndexedAt) return 'empty';
  if (lastIndexedAt) {
    const lastIndexed = new Date(lastIndexedAt);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return lastIndexed < sevenDaysAgo ? 'stale' : 'synced';
  }
  if (nodeCount && nodeCount > 0) return 'synced';
  return 'unknown';
}

/**
 * Visual indicator for project sync status.
 *
 * - `synced` — green checkmark
 * - `stale` — amber clock (last indexed > 7 days)
 * - `importing` — blue spinner
 * - `error` — red alert
 * - `empty` — gray question mark (no data)
 * - `unknown` — gray dot
 */
export function SyncStatusBadge({ syncState, compact = false, className }: SyncStatusBadgeProps) {
  const config = syncConfig[syncState];
  const Icon = config.icon;
  const isSpinning = syncState === 'importing';

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center', className)}>
            <Icon
              className={cn(
                'size-2.5',
                config.color,
                syncState === 'synced' || syncState === 'unknown' ? 'fill-current' : '',
                isSpinning && 'animate-spin',
              )}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <p className="font-medium">{config.label}</p>
          <p className="text-muted-foreground">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium',
            config.color,
            className,
          )}
        >
          <Icon className={cn('size-3.5', isSpinning && 'animate-spin')} />
          <span>{config.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <p>{config.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
