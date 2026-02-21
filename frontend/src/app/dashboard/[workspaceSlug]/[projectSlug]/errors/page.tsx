import { Suspense } from 'react';
import { ErrorList } from '@/components/error/error-list';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { HydrateClient } from '@/trpc/server';

export default async function ErrorsPage() {
  return (
    <HydrateClient>
      <div className="flex h-[calc(100vh-6rem)] flex-col">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Errors</h2>
            <p className="text-sm text-muted-foreground">
              Aggregated error snapshots across your codebase
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<TableSkeleton />}>
            <ErrorList />
          </Suspense>
        </div>
      </div>
    </HydrateClient>
  );
}
