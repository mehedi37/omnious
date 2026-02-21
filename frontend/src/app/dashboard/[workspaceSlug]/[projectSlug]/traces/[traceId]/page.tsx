import { TraceTimeline } from '@/components/trace/trace-timeline';
import { HydrateClient } from '@/trpc/server';

interface TraceDetailPageProps {
  params: Promise<{ workspaceSlug: string; projectSlug: string; traceId: string }>;
}

export default async function TraceDetailPage({ params }: TraceDetailPageProps) {
  const { traceId } = await params;

  return (
    <HydrateClient>
      <div className="flex h-[calc(100vh-6rem)] flex-col">
        <TraceTimeline traceId={traceId} />
      </div>
    </HydrateClient>
  );
}
