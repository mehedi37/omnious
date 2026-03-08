import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Rule, RuleContext, Diagnostic, DiagnosticSeverity } from './types.js';
import { resolveLocalBinary } from '../utils/resolve-binary.js';

/**
 * Runs `tsc --noEmit` in the project root and maps TypeScript compiler errors
 * to diagnostics linked to OIR nodes by file path.
 *
 * Requires TypeScript to be installed in the project (either locally or globally).
 * Skipped gracefully if `tsc` is not found.
 */
export const tscErrorsRule: Rule = {
  id: 'tsc-errors',
  description: 'TypeScript compiler errors (tsc --noEmit)',
  severity: 'error',

  run(ctx: RuleContext, config?: import('./types.js').RulesConfig): Diagnostic[] {
    if (config?.['tsc-errors']?.skip) return [];
    const diagnostics: Diagnostic[] = [];
    const cwd = process.cwd();

    // Prefer local node_modules/.bin/tsc, fall back to PATH
    const tscBin = resolveLocalBinary(cwd, 'tsc');
    if (!tscBin) return []; // tsc not available — skip silently

    const result = spawnSync(tscBin, ['--noEmit', '--pretty', 'false'], {
      encoding: 'utf-8',
      shell: false,
      cwd,
      timeout: 60_000,
    });

    // Exit 0 = clean, 1 = type errors, 2 = fatal config error, null = timeout
    if (result.status === null) {
      diagnostics.push(makeMeta('tsc --noEmit timed out after 60s', 'warning', { tsc_timeout: true }));
      return diagnostics;
    }

    if (result.status === 2) {
      const msg = ((result.stdout ?? '') + (result.stderr ?? '')).trim().slice(0, 400);
      diagnostics.push(makeMeta(`tsc config error: ${msg}`, 'warning', { tsc_status: 2 }));
      return diagnostics;
    }

    const output = (result.stdout ?? '').trim();
    if (!output) return diagnostics;

    // Build file-path → OIR node map (normalised absolute paths)
    const nodeByFile = new Map<string, typeof ctx.nodes[0]>();
    for (const node of ctx.nodes) {
      const abs = path.resolve(cwd, node.file_path);
      if (!nodeByFile.has(abs)) nodeByFile.set(abs, node);
    }

    // Parse tsc output: path/to/file.ts(line,col): error TS1234: message
    const TSC_LINE = /^(.+?)\((\d+),\d+\):\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/;

    for (const raw of output.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = TSC_LINE.exec(line);
      if (!m) continue;

      const [, filePart, lineStr, severityStr, tsCode, message] = m;
      const absFile = path.resolve(cwd, filePart!.trim());
      const lineNum = parseInt(lineStr!, 10);
      const severity = severityStr === 'error' ? 'error' : severityStr === 'warning' ? 'warning' : 'info';
      const node = nodeByFile.get(absFile);
      const relPath = path.relative(cwd, absFile);

      diagnostics.push({
        rule_id: 'tsc-errors',
        severity: severity as DiagnosticSeverity,
        message: `${tsCode}: ${message}`,
        code_node_oir_id: node?.oir_id ?? null,
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        metadata: { ts_code: tsCode, raw_file: filePart!.trim() },
      });
    }

    return diagnostics;
  },
};



function makeMeta(message: string, severity: DiagnosticSeverity, metadata: Record<string, unknown>): Diagnostic {
  return {
    rule_id: 'tsc-errors',
    severity,
    message,
    code_node_oir_id: null,
    file_path: '',
    line_start: null,
    line_end: null,
    metadata,
  };
}
