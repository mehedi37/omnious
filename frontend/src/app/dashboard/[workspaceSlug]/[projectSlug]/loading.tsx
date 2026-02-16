import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectLoading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-4 h-8 w-48" />
      <Skeleton className="h-[60vh] w-full rounded-lg" />
    </div>
  );
}
