'use client';

import { UnifiedAIPanel } from '@/components/ai/unified-ai-panel';

export default function AIPage() {
  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <UnifiedAIPanel mode="standalone" />
    </div>
  );
}
