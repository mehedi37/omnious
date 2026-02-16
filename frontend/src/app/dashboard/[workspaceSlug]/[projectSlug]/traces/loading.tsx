import { TableSkeleton } from '@/components/shared/loading-skeleton';

export default function TracesLoading() {
  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="space-y-2">
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-6">
        <TableSkeleton />
      </div>
    </div>
  );
}
