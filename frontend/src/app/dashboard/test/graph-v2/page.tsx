/**
 * /dashboard/test/graph-v2
 *
 * Isolated PoC route for the PixiJS WebGL graph renderer.
 * Not gated by auth or project context — uses synthetic stub data
 * so the canvas can be evaluated stand-alone during development.
 *
 * Remove this route once DebuggerGraph graduates to production.
 */
'use client';

// Opt out of static generation — prevents Turbopack from analyzing pixi
// modules as part of the static build's SSR module chain.
export const dynamic = 'force-dynamic';

import type { OmniousNode, OmniousEdge } from '@/lib/stores/graph-store';
// DebuggerGraph already handles ssr:false internally — no extra dynamic() needed
import { DebuggerGraph } from '@/components/graph/debugger-graph';

// ─── Stub data ───────────────────────────────────────────────

const STUB_NODES: OmniousNode[] = [
  {
    id: 'n1', type: 'omnious',
    position: { x: 100,  y: 60  },
    data: { label: 'handleRequest', oirType: 'function', filePath: 'src/server.ts', signature: '(req, res) => Promise<void>', oirId: 'n1', connectionCount: 3, docComment: null, lineEnd: null, lineStart: 10, metadata: {}, sizeTier: 'large', isEntryPoint: true },
  },
  {
    id: 'n2', type: 'omnious',
    position: { x: 380,  y: 60  },
    data: { label: 'AuthService', oirType: 'class', filePath: 'src/services/auth.ts', signature: null, oirId: 'n2', connectionCount: 2, docComment: null, lineEnd: null, lineStart: 1, metadata: {} },
  },
  {
    id: 'n3', type: 'omnious',
    position: { x: 660,  y: 60  },
    data: { label: 'getUserById', oirType: 'database_query', filePath: 'src/db/users.ts', signature: '(id: string) => User', oirId: 'n3', connectionCount: 1, docComment: null, lineEnd: null, lineStart: 22, metadata: {} },
  },
  {
    id: 'n4', type: 'omnious',
    position: { x: 100,  y: 280 },
    data: { label: 'router', oirType: 'route', filePath: 'src/routers/api.ts', signature: null, oirId: 'n4', connectionCount: 2, docComment: null, lineEnd: null, lineStart: 5, metadata: {} },
  },
  {
    id: 'n5', type: 'omnious',
    position: { x: 380,  y: 280 },
    data: { label: 'validateToken', oirType: 'middleware', filePath: 'src/middleware/auth.ts', signature: '(ctx) => boolean', oirId: 'n5', connectionCount: 4, docComment: null, lineEnd: null, lineStart: 8, metadata: {} },
  },
  {
    id: 'n6', type: 'omnious',
    position: { x: 660,  y: 280 },
    data: { label: 'UserSchema', oirType: 'type_def', filePath: 'src/types/user.ts', signature: null, oirId: 'n6', connectionCount: 3, docComment: null, lineEnd: null, lineStart: 1, metadata: {} },
  },
  {
    id: 'n7', type: 'omnious',
    position: { x: 100,  y: 500 },
    data: { label: 'EventBus', oirType: 'event_emitter', filePath: 'src/lib/events.ts', signature: null, oirId: 'n7', connectionCount: 5, docComment: null, lineEnd: null, lineStart: 3, metadata: {} },
  },
  {
    id: 'n8', type: 'omnious',
    position: { x: 380,  y: 500 },
    data: { label: 'onUserLogin', oirType: 'event_listener', filePath: 'src/handlers/login.ts', signature: null, oirId: 'n8', connectionCount: 2, docComment: null, lineEnd: null, lineStart: 14, metadata: {} },
  },
];

const STUB_EDGES: OmniousEdge[] = [
  { id: 'e1-2', source: 'n1', target: 'n2', data: { edgeType: 'calls' } },
  { id: 'e2-3', source: 'n2', target: 'n3', data: { edgeType: 'uses' } },
  { id: 'e1-4', source: 'n1', target: 'n4', data: { edgeType: 'imports' } },
  { id: 'e4-5', source: 'n4', target: 'n5', data: { edgeType: 'calls' } },
  { id: 'e5-2', source: 'n5', target: 'n2', data: { edgeType: 'calls' } },
  { id: 'e2-6', source: 'n2', target: 'n6', data: { edgeType: 'uses' } },
  { id: 'e5-7', source: 'n5', target: 'n7', data: { edgeType: 'runtime_call' } },
  { id: 'e7-8', source: 'n7', target: 'n8', data: { edgeType: 'calls' } },
];

// ─── Page ────────────────────────────────────────────────────

export default function GraphV2TestPage() {
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Status bar */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">DebuggerGraph PoC</span>
        <span>PixiJS v8 · @pixi/react v8 · pixi-viewport v6 · pretext v0.0.5</span>
        <span className="ml-auto">{STUB_NODES.length} nodes · {STUB_EDGES.length} edges</span>
      </div>

      {/* Canvas fills remaining height */}
      <div className="min-h-0 flex-1">
        <DebuggerGraph
          nodes={STUB_NODES}
          edges={STUB_EDGES}
          className="h-full w-full"
          onNodeClick={(id) => console.log('[graph-v2] node clicked:', id)}
        />
      </div>
    </div>
  );
}
