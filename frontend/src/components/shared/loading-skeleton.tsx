import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="flex h-screen">
      {/* Sidebar skeleton */}
      <div className="w-64 border-r bg-sidebar p-4">
        <Skeleton className="mb-6 h-8 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-6">
        <Skeleton className="mb-4 h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function GraphSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-muted/30">
      <div className="relative">
        {/* Fake nodes */}
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton
            key={i}
            className="absolute rounded-lg"
            style={{
              width: `${100 + Math.random() * 60}px`,
              height: '48px',
              left: `${i * 120 + Math.random() * 40}px`,
              top: `${Math.random() * 200}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
