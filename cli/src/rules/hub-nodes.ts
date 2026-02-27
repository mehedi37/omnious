import type { Rule, RulesConfig } from './types.js';

/**
 * hub-nodes: Find "god" nodes that have excessively high fan-in or fan-out.
 *
 * Nodes with too many connections are often design-smell hotspots.
 */
const DEFAULT_FAN_IN_THRESHOLD = 20;
const DEFAULT_FAN_OUT_THRESHOLD = 15;

export const hubNodesRule: Rule = {
  id: 'hub-nodes',
  description: 'Flag nodes with excessively high connectivity (potential god modules)',
  severity: 'info',

  run(ctx, config?: RulesConfig) {
    const ruleConfig = config?.['hub-nodes'];
    const maxFanIn = ruleConfig?.max_fan_in ?? DEFAULT_FAN_IN_THRESHOLD;
    const maxFanOut = ruleConfig?.max_fan_out ?? DEFAULT_FAN_OUT_THRESHOLD;
    const diagnostics: ReturnType<Rule['run']> = [];

    for (const node of ctx.nodes) {
      // Module nodes naturally have high connectivity — skip them
      if (node.type === 'module') continue;

      const fanOut = ctx.outgoing.get(node.oir_id)?.size ?? 0;
      const fanIn = ctx.incoming.get(node.oir_id)?.size ?? 0;

      if (fanOut > maxFanOut) {
        diagnostics.push({
          rule_id: 'hub-nodes',
          severity: 'info',
          message: `"${node.name}" depends on ${fanOut} other nodes (threshold: ${maxFanOut})`,
          code_node_oir_id: node.oir_id,
          file_path: node.file_path,
          line_start: node.line_start,
          line_end: node.line_end,
          metadata: { fan_out: fanOut, threshold: maxFanOut, direction: 'outgoing' },
        });
      }

      if (fanIn > maxFanIn) {
        diagnostics.push({
          rule_id: 'hub-nodes',
          severity: 'info',
          message: `"${node.name}" is depended on by ${fanIn} other nodes (threshold: ${maxFanIn})`,
          code_node_oir_id: node.oir_id,
          file_path: node.file_path,
          line_start: node.line_start,
          line_end: node.line_end,
          metadata: { fan_in: fanIn, threshold: maxFanIn, direction: 'incoming' },
        });
      }
    }

    return diagnostics;
  },
};
