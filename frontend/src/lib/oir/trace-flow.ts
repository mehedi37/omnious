import type { Span, CodeEdge } from './types';

/**
 * A single step in the flow animation.
 * Represents one span's position in the call graph.
 */
export interface FlowStep {
  spanId: string;
  nodeId: string | null;
  edgeId: string | null;
  parentNodeId: string | null;
  durationMs: number;
  status: string;
  operation: string;
  depth: number;
  serviceName: string | null;
  errorMessage: string | null;
  startedAt: number; // ms timestamp
  endedAt: number;   // ms timestamp
}

/**
 * A runtime-only edge discovered during trace replay
 * that doesn't exist in the static code graph.
 */
export interface RuntimeEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: 'runtime_call';
}

/**
 * Build a call tree from spans and map them onto the static code graph.
 *
 * For each parent→child span pair, we find the code_edge that connects
 * their code_node_ids. If no static edge exists, a RuntimeEdge is generated.
 *
 * @param spans - All spans for a trace, in any order
 * @param edges - All static code_edges for the project
 * @returns Ordered FlowStep[] (sorted by start time) + any runtime edges
 */
export function buildFlowSteps(
  spans: Span[],
  edges: CodeEdge[],
): { steps: FlowStep[]; runtimeEdges: RuntimeEdge[] } {
  if (spans.length === 0) return { steps: [], runtimeEdges: [] };

  // Index spans by span_id
  const spanMap = new Map<string, Span>();
  for (const s of spans) {
    spanMap.set(s.span_id, s);
  }

  // Build edge lookup: "sourceNodeId:targetNodeId" → edgeId
  const edgeLookup = new Map<string, string>();
  for (const e of edges) {
    edgeLookup.set(`${e.source_node_id}:${e.target_node_id}`, e.id);
  }

  // Calculate depth for each span
  const depthMap = new Map<string, number>();
  function getDepth(span: Span): number {
    const cached = depthMap.get(span.span_id);
    if (cached !== undefined) return cached;

    if (!span.parent_span_id) {
      depthMap.set(span.span_id, 0);
      return 0;
    }

    const parent = spanMap.get(span.parent_span_id);
    if (!parent) {
      depthMap.set(span.span_id, 0);
      return 0;
    }

    const depth = getDepth(parent) + 1;
    depthMap.set(span.span_id, depth);
    return depth;
  }

  const runtimeEdges: RuntimeEdge[] = [];
  const runtimeEdgeSet = new Set<string>(); // dedup

  // Build FlowSteps
  const steps: FlowStep[] = spans
    .filter((s) => s.code_node_id) // only spans mapped to code nodes
    .map((span) => {
      const parentSpan = span.parent_span_id
        ? spanMap.get(span.parent_span_id)
        : null;
      const parentNodeId = parentSpan?.code_node_id ?? null;
      const nodeId = span.code_node_id!;

      // Find the matching static edge
      let edgeId: string | null = null;
      if (parentNodeId) {
        const key = `${parentNodeId}:${nodeId}`;
        edgeId = edgeLookup.get(key) ?? null;

        // If no static edge exists, create a runtime edge
        if (!edgeId && !runtimeEdgeSet.has(key)) {
          runtimeEdgeSet.add(key);
          const runtimeId = `runtime-${parentNodeId}-${nodeId}`;
          runtimeEdges.push({
            id: runtimeId,
            sourceNodeId: parentNodeId,
            targetNodeId: nodeId,
            type: 'runtime_call',
          });
          edgeId = runtimeId;
        } else if (!edgeId) {
          edgeId = `runtime-${parentNodeId}-${nodeId}`;
        }
      }

      const startMs = new Date(span.started_at).getTime();
      const endMs = span.ended_at
        ? new Date(span.ended_at).getTime()
        : startMs + (span.duration_ms ?? 0);

      return {
        spanId: span.span_id,
        nodeId,
        edgeId,
        parentNodeId,
        durationMs: span.duration_ms ?? 0,
        status: span.status,
        operation: span.operation,
        depth: getDepth(span),
        serviceName: span.service_name,
        errorMessage: span.error_message,
        startedAt: startMs,
        endedAt: endMs,
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);

  return { steps, runtimeEdges };
}

/**
 * Get the time bounds of a set of flow steps.
 */
export function getFlowTimeBounds(steps: FlowStep[]): {
  startMs: number;
  endMs: number;
  durationMs: number;
} {
  if (steps.length === 0) return { startMs: 0, endMs: 0, durationMs: 0 };

  const startMs = Math.min(...steps.map((s) => s.startedAt));
  const endMs = Math.max(...steps.map((s) => s.endedAt));

  return { startMs, endMs, durationMs: endMs - startMs || 1 };
}
