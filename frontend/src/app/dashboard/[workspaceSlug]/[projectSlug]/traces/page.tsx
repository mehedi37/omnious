import { Suspense } from 'react';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { TraceList } from '@/components/trace/trace-list';
import { HydrateClient } from '@/trpc/server';

export default async function TracesPage() {
  return (
    <HydrateClient>
      <div className="flex h-[calc(100dvh-4rem)] md:h-[calc(100dvh-6rem)] flex-col">
        <div className="flex items-center justify-between border-b px-3 md:px-6 py-3 md:py-4">
          <div>
            <h2 className="text-lg font-semibold">Traces</h2>
            <p className="text-sm text-muted-foreground">
              Distributed trace data flowing through your codebase
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<TableSkeleton />}>
            <TraceList />
          </Suspense>
        </div>
      </div>
    </HydrateClient>
  );
}
