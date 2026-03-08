import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Rule, RuleContext, Diagnostic, DiagnosticSeverity } from './types.js';
import { resolveLocalBinary } from '../utils/resolve-binary.js';

/** ESLint JSON output shape (subset we care about) */
interface ESLintResult {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: 1 | 2; // 1=warn, 2=error
    message: string;
    line: number;
    endLine?: number;
  }>;
}

/**
 * Runs ESLint with `--format json` and maps rule violations to diagnostics.
 * Skipped gracefully when no ESLint config or binary is found.
 */
export const eslintErrorsRule: Rule = {
  id: 'eslint-errors',
  description: 'ESLint rule violations (errors and warnings)',
  severity: 'warning',

  run(ctx: RuleContext, config?: import('./types.js').RulesConfig): Diagnostic[] {
    if (config?.['eslint-errors']?.skip) return [];
    const diagnostics: Diagnostic[] = [];
    const cwd = process.cwd();

    const eslintBin = resolveLocalBinary(cwd, 'eslint');
    if (!eslintBin) return [];

    // Run ESLint on all source files tracked in the index
    const result = spawnSync(
      eslintBin,
      ['.', '--format', 'json', '--no-error-on-unmatched-pattern'],
      {
        encoding: 'utf-8',
        shell: false,
        cwd,
        timeout: 60_000,
      },
    );

    // ESLint exits 0 (no issues), 1 (lint errors found), 2 (config/flag error)
    if (result.status === 2 || result.status === null) return [];

    let parsed: ESLintResult[] = [];
    try {
      parsed = JSON.parse(result.stdout ?? '[]') as ESLintResult[];
    } catch {
      return []; // Not JSON — probably a config error output
    }

    // Build file-path → OIR node map (normalised absolute paths)
    const nodeByFile = new Map<string, typeof ctx.nodes[0]>();
    for (const node of ctx.nodes) {
      const abs = path.resolve(cwd, node.file_path);
      if (!nodeByFile.has(abs)) nodeByFile.set(abs, node);
    }

    for (const fileResult of parsed) {
      const relPath = path.relative(cwd, fileResult.filePath);
      const node = nodeByFile.get(fileResult.filePath);

      for (const msg of fileResult.messages) {
        const severity: DiagnosticSeverity = msg.severity === 2 ? 'error' : 'warning';

        diagnostics.push({
          rule_id: `eslint-errors`,
          severity,
          message: `[${msg.ruleId ?? 'eslint'}] ${msg.message}`,
          code_node_oir_id: node?.oir_id ?? null,
          file_path: relPath,
          line_start: msg.line,
          line_end: msg.endLine ?? msg.line,
          metadata: {
            eslint_rule_id: msg.ruleId,
            eslint_severity: msg.severity,
          },
        });
      }
    }

    return diagnostics;
  },
};
