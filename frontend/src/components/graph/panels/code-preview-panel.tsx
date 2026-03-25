'use client';

import { Box, ExternalLink, FileCode, MousePointerClick } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type OmniousNodeData, useGraphStore } from '@/lib/stores/graph-store';

const Editor = dynamic(() => import('@monaco-editor/react').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Loading editor...
    </div>
  ),
});

/** Map file extension to Monaco language identifier */
function getLanguageFromPath(filePath: string | null): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    java: 'java',
    cs: 'csharp',
    rb: 'ruby',
    rs: 'rust',
    php: 'php',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    xml: 'xml',
    toml: 'ini',
  };
  return map[ext ?? ''] ?? 'plaintext';
}

function useSelectedNodeData(): { nodeId: string; data: OmniousNodeData } | null {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);

  return useMemo(() => {
    if (selectedNodeIds.size === 0) return null;
    const firstId = selectedNodeIds.values().next().value as string;
    const node = nodes.find((n) => n.id === firstId);
    if (!node) return null;
    return { nodeId: firstId, data: node.data };
  }, [selectedNodeIds, nodes]);
}

export function CodePreviewPanel() {
  const selected = useSelectedNodeData();

  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <MousePointerClick className="h-8 w-8 opacity-40" />
        <p className="text-sm">Click a function or class node to view its source code</p>
      </div>
    );
  }

  const { data } = selected;
  const codeBody = data.codeBody;
  const isContainerType = ['module', 'package', 'namespace'].includes(data.oirType);

  if (!codeBody) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        {isContainerType ? (
          <>
            <Box className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">{data.label}</p>
            <p className="text-xs">
              This is a {data.oirType} node — click a function or class inside it to see code.
            </p>
          </>
        ) : (
          <>
            <FileCode className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">{data.label}</p>
            <p className="text-xs">
              No source code available for this node.
              <br />
              Re-sync with{' '}
              <code className="rounded bg-muted px-1 py-0.5">omnious sync --force</code> to push
              code bodies.
            </p>
          </>
        )}
      </div>
    );
  }

  const language = getLanguageFromPath(data.filePath);
  const startLine = data.lineStart ?? 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header with file path + line range + open-in-editor action */}
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <FileCode className="h-3 w-3 shrink-0" />
        <span className="truncate font-mono flex-1">
          {data.filePath ?? 'unknown'}
          {data.lineStart != null && (
            <span className="text-foreground/60">
              :{data.lineStart}
              {data.lineEnd != null && data.lineEnd !== data.lineStart && `–${data.lineEnd}`}
            </span>
          )}
        </span>
        {data.filePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                asChild
              >
                <a
                  href={`vscode://file/${data.filePath}${data.lineStart ? `:${data.lineStart}` : ''}`}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in VS Code</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Monaco Editor (read-only) */}
      <div className="flex-1 min-h-0">
        <Editor
          language={language}
          value={codeBody}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: (lineNumber: number) => String(lineNumber + startLine - 1),
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineHeight: 18,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
            },
            padding: { top: 8 },
            folding: true,
            wordWrap: 'on',
            domReadOnly: true,
          }}
        />
      </div>
    </div>
  );
}
