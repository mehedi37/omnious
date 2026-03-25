'use client';

import { Bot, FileCode, Info, PanelRightClose } from 'lucide-react';
import { UnifiedAIPanel } from '@/components/ai/unified-ai-panel';
import { CodePreviewPanel } from '@/components/graph/panels/code-preview-panel';
import { NodeDetailPanel } from '@/components/graph/panels/node-detail-panel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AIMessageAttachment } from '@/lib/stores/ai-store';
import { useUIStore } from '@/lib/stores/ui-store';

type ModelTier = 'auto' | 'fast' | 'powerful';

interface InspectorPanelProps {
  onQuery?: (
    query: string,
    contextNodeIds?: string[],
    apiKeyId?: string,
    modelPreference?: ModelTier,
    attachments?: AIMessageAttachment[],
  ) => void;
  onShowErrors?: () => void;
  onLoadOverview?: () => void;
  isQuerying?: boolean;
  onClose?: () => void;
}

export function InspectorPanel({
  onQuery,
  onShowErrors,
  onLoadOverview,
  isQuerying,
  onClose,
}: InspectorPanelProps) {
  const activeTab = useUIStore((s) => s.activeDetailTab);
  const setActiveTab = useUIStore((s) => s.setActiveDetailTab);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      useUIStore.getState().setDetailPanelOpen(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as 'details' | 'code' | 'ai')}
        className="flex h-full flex-col"
      >
        <div className="flex items-center justify-between border-b px-2 py-1">
          <TabsList className="h-7 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="details"
              className="h-6 px-2 text-xs data-[state=active]:bg-accent data-[state=active]:shadow-none"
            >
              <Info className="h-3 w-3 mr-1" />
              Details
            </TabsTrigger>
            <TabsTrigger
              value="code"
              className="h-6 px-2 text-xs data-[state=active]:bg-accent data-[state=active]:shadow-none"
            >
              <FileCode className="h-3 w-3 mr-1" />
              Code
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="h-6 px-2 text-xs data-[state=active]:bg-accent data-[state=active]:shadow-none"
            >
              <Bot className="h-3 w-3 mr-1" />
              AI
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleClose}
            aria-label="Close inspector panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>

        <TabsContent value="details" className="flex-1 m-0 overflow-hidden">
          <NodeDetailPanel />
        </TabsContent>

        <TabsContent value="code" className="flex-1 m-0 overflow-hidden">
          <CodePreviewPanel />
        </TabsContent>

        <TabsContent value="ai" className="flex-1 m-0 overflow-hidden">
          <UnifiedAIPanel
            mode="graph"
            onQuery={onQuery}
            onShowErrors={onShowErrors}
            onLoadOverview={onLoadOverview}
            isQuerying={isQuerying}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
