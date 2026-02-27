import type { OIRIndex } from '../oir/types.js';
import type { Diagnostic, RuleContext, Rule, RulesConfig } from './types.js';
import { circularDepsRule } from './circular-deps.js';
import { unusedExportsRule } from './unused-exports.js';
import { largeFunctionsRule } from './large-functions.js';
import { hubNodesRule } from './hub-nodes.js';

export type { Diagnostic, DiagnosticSeverity, RulesConfig } from './types.js';

/** All built-in rules */
const BUILT_IN_RULES: Rule[] = [
  circularDepsRule,
  unusedExportsRule,
  largeFunctionsRule,
  hubNodesRule,
];

/**
 * Build the rule context (adjacency lists, node map) from an OIR index.
 */
function buildRuleContext(index: OIRIndex): RuleContext {
  const nodeMap = new Map(index.nodes.map((n) => [n.oir_id, n]));
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const outgoingEdges = new Map<string, typeof index.edges>();

  for (const edge of index.edges) {
    // Outgoing adjacency
    if (!outgoing.has(edge.source_oir_id)) {
      outgoing.set(edge.source_oir_id, new Set());
    }
    outgoing.get(edge.source_oir_id)!.add(edge.target_oir_id);

    // Incoming adjacency
    if (!incoming.has(edge.target_oir_id)) {
      incoming.set(edge.target_oir_id, new Set());
    }
    incoming.get(edge.target_oir_id)!.add(edge.source_oir_id);

    // Outgoing edges grouped
    if (!outgoingEdges.has(edge.source_oir_id)) {
      outgoingEdges.set(edge.source_oir_id, []);
    }
    outgoingEdges.get(edge.source_oir_id)!.push(edge);
  }

  return {
    nodes: index.nodes,
    edges: index.edges,
    nodeMap,
    outgoing,
    incoming,
    outgoingEdges,
  };
}

/**
 * Run all static analysis rules against a parsed OIR index.
 *
 * @param index The full OIR index (nodes + edges)
 * @param ruleIds Optional: only run specific rules (by ID). If omitted, runs all.
 * @param config Optional: per-rule threshold overrides from .omnious.yml
 * @returns Array of diagnostics found
 */
export function runRules(
  index: OIRIndex,
  ruleIds?: string[],
  config?: RulesConfig,
): Diagnostic[] {
  const ctx = buildRuleContext(index);
  const disabled = new Set(config?.disabled ?? []);

  const rulesToRun = ruleIds
    ? BUILT_IN_RULES.filter((r) => ruleIds.includes(r.id) && !disabled.has(r.id))
    : BUILT_IN_RULES.filter((r) => !disabled.has(r.id));

  const diagnostics: Diagnostic[] = [];
  for (const rule of rulesToRun) {
    try {
      const results = rule.run(ctx, config);
      diagnostics.push(...results);
    } catch {
      // A failing rule should not crash the entire analysis
      diagnostics.push({
        rule_id: rule.id,
        severity: 'error',
        message: `Rule "${rule.id}" threw an internal error`,
        code_node_oir_id: null,
        file_path: '',
        line_start: null,
        line_end: null,
        metadata: { internal_error: true },
      });
    }
  }

  return diagnostics;
}

/** List available rule IDs and descriptions */
export function listRules(): Array<{ id: string; description: string; severity: string }> {
  return BUILT_IN_RULES.map((r) => ({
    id: r.id,
    description: r.description,
    severity: r.severity,
  }));
}
