import type { Rule, RulesConfig } from './types.js';

/** Default thresholds — can be overridden via .omnious.yml rules config */
const DEFAULT_MAX_LINES = 80;
const DEFAULT_MAX_PARAMS = 6;

/**
 * large-functions: Flag functions/methods that exceed complexity thresholds.
 *
 * Checks:
 * - Function body exceeding a configurable line count
 * - Functions with too many parameters (from signature)
 */
export const largeFunctionsRule: Rule = {
  id: 'large-functions',
  description: 'Flag overly large or complex functions',
  severity: 'warning',

  run(ctx, config?: RulesConfig) {
    const ruleConfig = config?.['large-functions'];
    const maxLines = ruleConfig?.max_lines ?? DEFAULT_MAX_LINES;
    const maxParams = ruleConfig?.max_params ?? DEFAULT_MAX_PARAMS;
    const diagnostics: ReturnType<Rule['run']> = [];

    const functionNodes = ctx.nodes.filter(
      (n) => n.type === 'function' || n.type === 'route' || n.type === 'middleware',
    );

    for (const node of functionNodes) {
      const lineStart = node.line_start;
      const lineEnd = node.line_end;

      // Check body line count
      if (lineStart != null && lineEnd != null) {
        const lineCount = lineEnd - lineStart + 1;
        if (lineCount > maxLines) {
          diagnostics.push({
            rule_id: 'large-functions',
            severity: 'warning',
            message: `Function "${node.name}" is ${lineCount} lines (threshold: ${maxLines})`,
            code_node_oir_id: node.oir_id,
            file_path: node.file_path,
            line_start: lineStart,
            line_end: lineEnd,
            metadata: {
              line_count: lineCount,
              threshold: maxLines,
              check: 'line-count',
            },
          });
        }
      }

      // Check parameter count from signature
      if (node.signature) {
        const paramCount = countParams(node.signature);
        if (paramCount > maxParams) {
          diagnostics.push({
            rule_id: 'large-functions',
            severity: 'info',
            message: `Function "${node.name}" has ${paramCount} parameters (threshold: ${maxParams})`,
            code_node_oir_id: node.oir_id,
            file_path: node.file_path,
            line_start: lineStart,
            line_end: lineEnd,
            metadata: {
              param_count: paramCount,
              threshold: maxParams,
              check: 'param-count',
            },
          });
        }
      }
    }

    return diagnostics;
  },
};

/**
 * Count parameters in a function signature string.
 * For signatures like "(a: string, b: number, c?: boolean)" returns 3.
 * Handles nested generics and destructured params.
 */
function countParams(sig: string): number {
  // Extract content between first ( and its matching )
  const start = sig.indexOf('(');
  if (start === -1) return 0;

  let depth = 0;
  let paramContent = '';
  for (let i = start; i < sig.length; i++) {
    const ch = sig[i];
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1 && i > start) paramContent += ch;
  }

  if (paramContent.trim().length === 0) return 0;

  // Split by commas at depth 0
  let splitDepth = 0;
  let count = 1;
  for (const ch of paramContent) {
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') splitDepth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') splitDepth--;
    else if (ch === ',' && splitDepth === 0) count++;
  }

  return count;
}
