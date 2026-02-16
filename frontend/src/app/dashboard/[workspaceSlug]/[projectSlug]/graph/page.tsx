import { HydrateClient } from '@/trpc/server';
import { GraphCanvas } from '@/components/graph/graph-canvas';

export const metadata = { title: 'Graph' };

export default async function GraphPage() {
  return (
    <HydrateClient>
      <div className="h-[calc(100vh-6rem)]">
        <GraphCanvas />
      </div>
    </HydrateClient>
  );
}
