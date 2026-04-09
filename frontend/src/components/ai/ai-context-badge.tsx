'use client';

import { BookOpen, BrainCircuit, FileText, ShieldCheck } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

type ContextLevel = 'full' | 'partial' | 'minimal';

const LEVEL_CONFIG: Record<ContextLevel, { color: string; label: string }> = {
  full: { color: 'bg-green-500', label: 'Full context' },
  partial: { color: 'bg-yellow-500', label: 'Partial context' },
  minimal: { color: 'bg-red-500', label: 'Minimal context' },
};

export function AIContextBadge() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  const { data } = trpc.ai.getContextStatus.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  if (!data) return null;

  const layers = [
    data.hasProfile,
    data.summaryCount > 0,
    data.docCount > 0,
    data.insightCount > 0,
  ];
  const activeCount = layers.filter(Boolean).length;

  const level: ContextLevel =
    activeCount >= 3 ? 'full' : activeCount >= 1 ? 'partial' : 'minimal';
  const config = LEVEL_CONFIG[level];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-default">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${config.color}`} />
            {config.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-1 max-w-56">
          <div className="font-medium mb-1">AI Context Layers</div>
          <ContextLine
            icon={ShieldCheck}
            label="Project profile"
            active={data.hasProfile}
          />
          <ContextLine
            icon={FileText}
            label={`${data.summaryCount} file summaries`}
            active={data.summaryCount > 0}
          />
          <ContextLine
            icon={BookOpen}
            label={`${data.docCount} docs`}
            active={data.docCount > 0}
          />
          <ContextLine
            icon={BrainCircuit}
            label={`${data.insightCount} past insights`}
            active={data.insightCount > 0}
          />
          {level === 'minimal' && (
            <p className="text-muted-foreground/70 pt-1">
              Run <code className="rounded bg-muted px-1 text-[10px]">omnious push</code> to enrich context
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ContextLine({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${active ? '' : 'opacity-40'}`}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      <span className="ml-auto">{active ? '✓' : '✗'}</span>
    </div>
  );
}
