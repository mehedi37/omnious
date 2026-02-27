import { describe, it, expect } from 'vitest';
import { circularDepsRule } from '../src/rules/circular-deps.js';
import { unusedExportsRule } from '../src/rules/unused-exports.js';
import { largeFunctionsRule } from '../src/rules/large-functions.js';
import { hubNodesRule } from '../src/rules/hub-nodes.js';
import { runRules } from '../src/rules/index.js';
import type { RuleContext, RulesConfig } from '../src/rules/types.js';
import type { OIRNode, OIREdge, OIRIndex } from '../src/oir/types.js';

// ── Test Helpers ──

function makeNode(overrides: Partial<OIRNode> & { oir_id: string; name: string }): OIRNode {
  return {
    type: 'function',
    file_path: 'src/index.ts',
    line_start: 1,
    line_end: 10,
    signature: null,
    doc_comment: null,
    metadata: {},
    content_hash: 'abc123',
    ...overrides,
  };
}

function makeEdge(source: string, target: string, type: OIREdge['type'] = 'calls'): OIREdge {
  return { source_oir_id: source, target_oir_id: target, type, metadata: {} };
}

function buildContext(nodes: OIRNode[], edges: OIREdge[]): RuleContext {
  const nodeMap = new Map(nodes.map((n) => [n.oir_id, n]));
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const outgoingEdges = new Map<string, OIREdge[]>();

  for (const edge of edges) {
    if (!outgoing.has(edge.source_oir_id)) outgoing.set(edge.source_oir_id, new Set());
    outgoing.get(edge.source_oir_id)!.add(edge.target_oir_id);

    if (!incoming.has(edge.target_oir_id)) incoming.set(edge.target_oir_id, new Set());
    incoming.get(edge.target_oir_id)!.add(edge.source_oir_id);

    if (!outgoingEdges.has(edge.source_oir_id)) outgoingEdges.set(edge.source_oir_id, []);
    outgoingEdges.get(edge.source_oir_id)!.push(edge);
  }

  return { nodes, edges, nodeMap, outgoing, incoming, outgoingEdges };
}

function buildIndex(nodes: OIRNode[], edges: OIREdge[]): OIRIndex {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    project_hash: 'test-hash',
    files: {},
    nodes,
    edges,
    summary: {
      total_files: 0,
      total_nodes: nodes.length,
      total_edges: edges.length,
      nodes_by_type: {},
      edges_by_type: {},
      parse_errors: 0,
    },
  };
}

// ── circular-deps ──

describe('circular-deps rule', () => {
  it('detects a simple A → B → A cycle', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'mod-b', name: 'b.ts', type: 'module', file_path: 'b.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'mod-b', 'imports'),
      makeEdge('mod-b', 'mod-a', 'imports'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = circularDepsRule.run(ctx);

    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(diagnostics.every((d) => d.rule_id === 'circular-deps')).toBe(true);
    expect(diagnostics[0].metadata['cycle_size']).toBe(2);
  });

  it('detects a 3-node cycle', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'mod-b', name: 'b.ts', type: 'module', file_path: 'b.ts' }),
      makeNode({ oir_id: 'mod-c', name: 'c.ts', type: 'module', file_path: 'c.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'mod-b', 'imports'),
      makeEdge('mod-b', 'mod-c', 'imports'),
      makeEdge('mod-c', 'mod-a', 'imports'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = circularDepsRule.run(ctx);

    expect(diagnostics.length).toBe(3);
    expect(diagnostics[0].metadata['cycle_size']).toBe(3);
  });

  it('returns empty for acyclic graph', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'mod-b', name: 'b.ts', type: 'module', file_path: 'b.ts' }),
      makeNode({ oir_id: 'mod-c', name: 'c.ts', type: 'module', file_path: 'c.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'mod-b', 'imports'),
      makeEdge('mod-b', 'mod-c', 'imports'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = circularDepsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });

  it('ignores non-import edges', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'mod-b', name: 'b.ts', type: 'module', file_path: 'b.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'mod-b', 'calls'),
      makeEdge('mod-b', 'mod-a', 'calls'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = circularDepsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });
});

// ── unused-exports ──

describe('unused-exports rule', () => {
  it('flags an export that is never imported', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'fn-helper', name: 'helper', type: 'function', file_path: 'a.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'fn-helper', 'exports'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = unusedExportsRule.run(ctx);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].rule_id).toBe('unused-exports');
    expect(diagnostics[0].metadata['symbol_name']).toBe('helper');
  });

  it('does not flag an export that is imported from another file', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'fn-helper', name: 'helper', type: 'function', file_path: 'a.ts' }),
      makeNode({ oir_id: 'mod-b', name: 'b.ts', type: 'module', file_path: 'b.ts' }),
      makeNode({ oir_id: 'fn-consumer', name: 'consumer', type: 'function', file_path: 'b.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'fn-helper', 'exports'),
      makeEdge('fn-consumer', 'fn-helper', 'imports'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = unusedExportsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });

  it('still flags if only used in the same file', () => {
    const nodes = [
      makeNode({ oir_id: 'mod-a', name: 'a.ts', type: 'module', file_path: 'a.ts' }),
      makeNode({ oir_id: 'fn-helper', name: 'helper', type: 'function', file_path: 'a.ts' }),
      makeNode({ oir_id: 'fn-other', name: 'other', type: 'function', file_path: 'a.ts' }),
    ];
    const edges = [
      makeEdge('mod-a', 'fn-helper', 'exports'),
      makeEdge('fn-other', 'fn-helper', 'calls'),
    ];
    const ctx = buildContext(nodes, edges);
    const diagnostics = unusedExportsRule.run(ctx);

    expect(diagnostics.length).toBe(1);
  });

  it('returns empty when there are no exports', () => {
    const nodes = [
      makeNode({ oir_id: 'fn-a', name: 'a', type: 'function', file_path: 'a.ts' }),
    ];
    const ctx = buildContext(nodes, []);
    const diagnostics = unusedExportsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });
});

// ── large-functions ──

describe('large-functions rule', () => {
  it('flags functions exceeding the default line threshold (80)', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-big',
        name: 'bigFunction',
        line_start: 1,
        line_end: 100,
      }),
    ];
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].rule_id).toBe('large-functions');
    expect(diagnostics[0].metadata['line_count']).toBe(100);
    expect(diagnostics[0].metadata['check']).toBe('line-count');
  });

  it('does not flag functions under the threshold', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-small',
        name: 'smallFunction',
        line_start: 1,
        line_end: 50,
      }),
    ];
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });

  it('flags functions with too many parameters', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-many-params',
        name: 'paramHeavy',
        line_start: 1,
        line_end: 10,
        signature: '(a: string, b: number, c: boolean, d: any, e: Date, f: Error, g: Buffer)',
      }),
    ];
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].metadata['check']).toBe('param-count');
    expect(diagnostics[0].metadata['param_count']).toBe(7);
  });

  it('respects custom max_lines from config', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-medium',
        name: 'mediumFunc',
        line_start: 1,
        line_end: 50,
      }),
    ];
    const config: RulesConfig = { 'large-functions': { max_lines: 30 } };
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx, config);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].metadata['threshold']).toBe(30);
  });

  it('respects custom max_params from config', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-params',
        name: 'someFunc',
        signature: '(a: string, b: number, c: boolean)',
      }),
    ];
    const config: RulesConfig = { 'large-functions': { max_params: 2 } };
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx, config);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].metadata['threshold']).toBe(2);
  });

  it('skips nodes without line info', () => {
    const nodes = [
      makeNode({
        oir_id: 'fn-no-lines',
        name: 'noLines',
        line_start: null,
        line_end: null,
      }),
    ];
    const ctx = buildContext(nodes, []);
    const diagnostics = largeFunctionsRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });
});

// ── hub-nodes ──

describe('hub-nodes rule', () => {
  it('flags a node with excessive fan-out (>15 default)', () => {
    const hub = makeNode({ oir_id: 'hub', name: 'GodClass', type: 'class' });
    const targets = Array.from({ length: 20 }, (_, i) =>
      makeNode({ oir_id: `dep-${i}`, name: `dep${i}` }),
    );
    const edges = targets.map((t) => makeEdge('hub', t.oir_id));
    const ctx = buildContext([hub, ...targets], edges);
    const diagnostics = hubNodesRule.run(ctx);

    const fanOutDiag = diagnostics.filter((d) => d.metadata['direction'] === 'outgoing');
    expect(fanOutDiag.length).toBe(1);
    expect(fanOutDiag[0].metadata['fan_out']).toBe(20);
  });

  it('flags a node with excessive fan-in (>20 default)', () => {
    const central = makeNode({ oir_id: 'central', name: 'utils', type: 'function' });
    const dependents = Array.from({ length: 25 }, (_, i) =>
      makeNode({ oir_id: `user-${i}`, name: `user${i}` }),
    );
    const edges = dependents.map((d) => makeEdge(d.oir_id, 'central'));
    const ctx = buildContext([central, ...dependents], edges);
    const diagnostics = hubNodesRule.run(ctx);

    const fanInDiag = diagnostics.filter((d) => d.metadata['direction'] === 'incoming');
    expect(fanInDiag.length).toBe(1);
    expect(fanInDiag[0].metadata['fan_in']).toBe(25);
  });

  it('skips module-type nodes', () => {
    const mod = makeNode({ oir_id: 'mod', name: 'index.ts', type: 'module' });
    const targets = Array.from({ length: 25 }, (_, i) =>
      makeNode({ oir_id: `dep-${i}`, name: `dep${i}` }),
    );
    const edges = targets.map((t) => makeEdge('mod', t.oir_id));
    const ctx = buildContext([mod, ...targets], edges);
    const diagnostics = hubNodesRule.run(ctx);

    // Module node itself should not be flagged
    expect(diagnostics.filter((d) => d.code_node_oir_id === 'mod')).toEqual([]);
  });

  it('respects custom thresholds from config', () => {
    const hub = makeNode({ oir_id: 'hub', name: 'SmallHub', type: 'class' });
    const targets = Array.from({ length: 5 }, (_, i) =>
      makeNode({ oir_id: `dep-${i}`, name: `dep${i}` }),
    );
    const edges = targets.map((t) => makeEdge('hub', t.oir_id));
    const config: RulesConfig = { 'hub-nodes': { max_fan_out: 3 } };
    const ctx = buildContext([hub, ...targets], edges);
    const diagnostics = hubNodesRule.run(ctx, config);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].metadata['threshold']).toBe(3);
  });

  it('returns empty when connectivity is normal', () => {
    const a = makeNode({ oir_id: 'a', name: 'a' });
    const b = makeNode({ oir_id: 'b', name: 'b' });
    const edges = [makeEdge('a', 'b')];
    const ctx = buildContext([a, b], edges);
    const diagnostics = hubNodesRule.run(ctx);

    expect(diagnostics).toEqual([]);
  });
});

// ── runRules orchestrator ──

describe('runRules orchestrator', () => {
  it('runs all 4 rules by default', () => {
    const nodes = [
      makeNode({ oir_id: 'fn-a', name: 'a', line_start: 1, line_end: 10 }),
    ];
    const index = buildIndex(nodes, []);
    const diagnostics = runRules(index);

    // With a simple graph, we shouldn't get crashes — just check it runs
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it('filters by ruleIds', () => {
    const nodes = [
      makeNode({ oir_id: 'fn-big', name: 'bigFunc', line_start: 1, line_end: 200 }),
    ];
    const index = buildIndex(nodes, []);

    const onlyLarge = runRules(index, ['large-functions']);
    expect(onlyLarge.every((d) => d.rule_id === 'large-functions')).toBe(true);
    expect(onlyLarge.length).toBeGreaterThan(0);
  });

  it('respects disabled rules from config', () => {
    const nodes = [
      makeNode({ oir_id: 'fn-big', name: 'bigFunc', line_start: 1, line_end: 200 }),
    ];
    const index = buildIndex(nodes, []);
    const config: RulesConfig = { disabled: ['large-functions'] };

    const diagnostics = runRules(index, undefined, config);
    expect(diagnostics.filter((d) => d.rule_id === 'large-functions')).toEqual([]);
  });

  it('passes config through to rule implementations', () => {
    const nodes = [
      makeNode({ oir_id: 'fn-med', name: 'medFunc', line_start: 1, line_end: 50 }),
    ];
    const index = buildIndex(nodes, []);

    // With default config, 50 lines should not trigger
    expect(runRules(index, ['large-functions']).length).toBe(0);

    // With custom config, 50 lines should trigger
    const config: RulesConfig = { 'large-functions': { max_lines: 30 } };
    expect(runRules(index, ['large-functions'], config).length).toBe(1);
  });
});
