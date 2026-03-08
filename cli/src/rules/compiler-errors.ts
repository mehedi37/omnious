import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { Rule, RuleContext, Diagnostic, DiagnosticSeverity, RulesConfig } from './types.js';
import { resolveLocalBinary } from '../utils/resolve-binary.js';

// ── Output parsers per language ──

interface CompilerError {
  file: string;
  line: number;
  endLine?: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  metadata: Record<string, unknown>;
}

// ── Go ──

function runGoVet(cwd: string): CompilerError[] {
  const goBin = resolveLocalBinary(cwd, 'go');
  if (!goBin) return [];

  const result = spawnSync(goBin, ['vet', '-json', './...'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 120_000,
  });

  if (result.status === null) return []; // timed out

  const errors: CompilerError[] = [];
  const output = (result.stdout ?? '') + (result.stderr ?? '');

  // `go vet -json` outputs one JSON object per line (ndjson-style)
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const entry = JSON.parse(trimmed) as {
        posn?: string; // "file.go:line:col"
        message?: string;
      };
      if (!entry.posn || !entry.message) continue;
      const m = /^(.+?):(\d+)(?::\d+)?$/.exec(entry.posn);
      if (!m) continue;
      errors.push({
        file: m[1]!,
        line: parseInt(m[2]!, 10),
        severity: 'warning',
        message: entry.message,
        code: 'go-vet',
        metadata: { tool: 'go vet' },
      });
    } catch {
      // not valid JSON — skip
    }
  }

  // Also try `go build` for compile errors
  const buildResult = spawnSync(goBin, ['build', '-o', '/dev/null', './...'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 120_000,
  });

  if (buildResult.status !== null && buildResult.status !== 0) {
    const buildOutput = (buildResult.stdout ?? '') + (buildResult.stderr ?? '');
    // Go build errors: file.go:line:col: message
    const GO_BUILD_RE = /^(.+?\.go):(\d+):\d+:\s+(.+)$/;
    for (const raw of buildOutput.split('\n')) {
      const m = GO_BUILD_RE.exec(raw.trim());
      if (!m) continue;
      errors.push({
        file: m[1]!,
        line: parseInt(m[2]!, 10),
        severity: 'error',
        message: m[3]!,
        code: 'go-build',
        metadata: { tool: 'go build' },
      });
    }
  }

  return errors;
}

// ── Python ──

function runPythonChecker(cwd: string): CompilerError[] {
  // Prefer mypy (more common), fall back to pyright
  const mypyBin = resolveLocalBinary(cwd, 'mypy');
  if (mypyBin) return runMypy(cwd, mypyBin);

  const pyrightBin = resolveLocalBinary(cwd, 'pyright');
  if (pyrightBin) return runPyright(cwd, pyrightBin);

  return [];
}

function runMypy(cwd: string, bin: string): CompilerError[] {
  const result = spawnSync(bin, ['.', '--no-color-output', '--no-error-summary'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 120_000,
  });

  if (result.status === null) return [];

  const errors: CompilerError[] = [];
  const output = (result.stdout ?? '').trim();
  if (!output) return errors;

  // mypy output: file.py:line: severity: message  [code]
  const MYPY_RE = /^(.+?):(\d+):\s+(error|warning|note):\s+(.+?)(?:\s+\[(.+)\])?$/;

  for (const raw of output.split('\n')) {
    const m = MYPY_RE.exec(raw.trim());
    if (!m) continue;
    const severity = m[3] === 'error' ? 'error' : m[3] === 'warning' ? 'warning' : 'info';
    errors.push({
      file: m[1]!,
      line: parseInt(m[2]!, 10),
      severity: severity as DiagnosticSeverity,
      message: m[4]!,
      code: m[5] ?? 'mypy',
      metadata: { tool: 'mypy', mypy_code: m[5] ?? null },
    });
  }

  return errors;
}

function runPyright(cwd: string, bin: string): CompilerError[] {
  const result = spawnSync(bin, ['--outputjson'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 120_000,
  });

  if (result.status === null) return [];

  const errors: CompilerError[] = [];
  try {
    const parsed = JSON.parse(result.stdout ?? '{}') as {
      generalDiagnostics?: Array<{
        file: string;
        range: { start: { line: number }; end: { line: number } };
        severity: string;
        message: string;
        rule?: string;
      }>;
    };

    for (const diag of parsed.generalDiagnostics ?? []) {
      const severity = diag.severity === 'error' ? 'error'
        : diag.severity === 'warning' ? 'warning' : 'info';
      errors.push({
        file: diag.file,
        line: diag.range.start.line + 1, // pyright uses 0-based
        endLine: diag.range.end.line + 1,
        severity: severity as DiagnosticSeverity,
        message: diag.message,
        code: diag.rule ?? 'pyright',
        metadata: { tool: 'pyright', pyright_rule: diag.rule ?? null },
      });
    }
  } catch {
    // Not valid JSON — skip
  }

  return errors;
}

// ── Java ──

function runJavaChecker(cwd: string): CompilerError[] {
  // Prefer gradle (more common for projects), fall back to mvn
  if (fs.existsSync(path.join(cwd, 'build.gradle')) ||
      fs.existsSync(path.join(cwd, 'build.gradle.kts'))) {
    return runGradleCheck(cwd);
  }
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
    return runMvnCompile(cwd);
  }
  return [];
}

function runGradleCheck(cwd: string): CompilerError[] {
  // Try gradlew first, then gradle on PATH
  let gradleBin = path.join(cwd, 'gradlew');
  if (!fs.existsSync(gradleBin)) {
    gradleBin = resolveLocalBinary(cwd, 'gradle') ?? '';
    if (!gradleBin) return [];
  }

  const result = spawnSync(gradleBin, ['compileJava', '--console=plain', '-q'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 180_000,
  });

  if (result.status === null) return [];
  if (result.status === 0) return [];

  return parseJavacOutput(cwd, (result.stdout ?? '') + (result.stderr ?? ''));
}

function runMvnCompile(cwd: string): CompilerError[] {
  const mvnBin = resolveLocalBinary(cwd, 'mvn');
  if (!mvnBin) return [];

  const result = spawnSync(mvnBin, ['compile', '-q'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 180_000,
  });

  if (result.status === null || result.status === 0) return [];
  return parseJavacOutput(cwd, (result.stdout ?? '') + (result.stderr ?? ''));
}

function parseJavacOutput(cwd: string, output: string): CompilerError[] {
  const errors: CompilerError[] = [];
  // javac errors: /path/to/File.java:line: error: message
  const JAVAC_RE = /^(.+\.java):(\d+):\s+(error|warning):\s+(.+)$/;

  for (const raw of output.split('\n')) {
    const m = JAVAC_RE.exec(raw.trim());
    if (!m) continue;
    const severity = m[3] === 'error' ? 'error' : 'warning';
    errors.push({
      file: path.relative(cwd, m[1]!),
      line: parseInt(m[2]!, 10),
      severity: severity as DiagnosticSeverity,
      message: m[4]!,
      code: 'javac',
      metadata: { tool: m[1]!.includes('gradle') ? 'gradle' : 'javac' },
    });
  }

  return errors;
}

// ── C# ──

function runCsharpChecker(cwd: string): CompilerError[] {
  const dotnetBin = resolveLocalBinary(cwd, 'dotnet');
  if (!dotnetBin) return [];

  // Check for .csproj or .sln file
  const hasCsproj = fs.readdirSync(cwd).some((f) =>
    f.endsWith('.csproj') || f.endsWith('.sln'),
  );
  if (!hasCsproj) return [];

  const result = spawnSync(dotnetBin, ['build', '--no-restore', '-v', 'quiet'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 180_000,
  });

  if (result.status === null) return [];
  if (result.status === 0) return [];

  const errors: CompilerError[] = [];
  const output = (result.stdout ?? '') + (result.stderr ?? '');

  // MSBuild errors: File.cs(line,col): error CS1234: message
  const DOTNET_RE = /^(.+?)\((\d+),\d+\):\s+(error|warning)\s+(CS\d+):\s+(.+)$/;

  for (const raw of output.split('\n')) {
    const m = DOTNET_RE.exec(raw.trim());
    if (!m) continue;
    const severity = m[3] === 'error' ? 'error' : 'warning';
    errors.push({
      file: path.relative(cwd, m[1]!),
      line: parseInt(m[2]!, 10),
      severity: severity as DiagnosticSeverity,
      message: `${m[4]}: ${m[5]}`,
      code: m[4]!,
      metadata: { tool: 'dotnet build', cs_code: m[4] },
    });
  }

  return errors;
}

// ── Rust ──

function runRustChecker(cwd: string): CompilerError[] {
  const cargoBin = resolveLocalBinary(cwd, 'cargo');
  if (!cargoBin) return [];
  if (!fs.existsSync(path.join(cwd, 'Cargo.toml'))) return [];

  const result = spawnSync(cargoBin, ['check', '--message-format=json', '-q'], {
    encoding: 'utf-8',
    shell: false,
    cwd,
    timeout: 180_000,
  });

  if (result.status === null) return [];

  const errors: CompilerError[] = [];
  const output = (result.stdout ?? '').trim();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const msg = JSON.parse(trimmed) as {
        reason?: string;
        message?: {
          level: string;
          message: string;
          code?: { code: string };
          spans?: Array<{
            file_name: string;
            line_start: number;
            line_end: number;
          }>;
        };
      };
      if (msg.reason !== 'compiler-message' || !msg.message) continue;
      const primary = msg.message.spans?.[0];
      if (!primary) continue;

      const severity = msg.message.level === 'error' ? 'error'
        : msg.message.level === 'warning' ? 'warning' : 'info';

      errors.push({
        file: primary.file_name,
        line: primary.line_start,
        endLine: primary.line_end,
        severity: severity as DiagnosticSeverity,
        message: msg.message.message,
        code: msg.message.code?.code ?? 'rustc',
        metadata: { tool: 'cargo check', rust_code: msg.message.code?.code ?? null },
      });
    } catch {
      // not valid JSON — skip
    }
  }

  return errors;
}

// ── Language detection (lightweight) ──

interface LangDetection {
  go: boolean;
  python: boolean;
  java: boolean;
  csharp: boolean;
  rust: boolean;
}

function detectLanguages(cwd: string): LangDetection {
  const exists = (f: string) => fs.existsSync(path.join(cwd, f));
  const globExt = (ext: string) => {
    try {
      return fs.readdirSync(cwd).some((f) => f.endsWith(ext));
    } catch {
      return false;
    }
  };

  return {
    go: exists('go.mod'),
    python: exists('pyproject.toml') || exists('setup.py') ||
            exists('requirements.txt') || exists('Pipfile'),
    java: exists('pom.xml') || exists('build.gradle') || exists('build.gradle.kts'),
    csharp: globExt('.csproj') || globExt('.sln'),
    rust: exists('Cargo.toml'),
  };
}

// ── Main Rule ──

/**
 * Multi-language compiler/checker rule.
 *
 * Detects the project language(s) by looking at manifest files, then runs the
 * appropriate compiler/checker:
 *   - Go:     `go vet` + `go build`
 *   - Python: `mypy` or `pyright`
 *   - Java:   `gradle compileJava` or `mvn compile`
 *   - C#:     `dotnet build`
 *   - Rust:   `cargo check`
 *
 * TS/JS are handled by the dedicated `tsc-errors` and `eslint-errors` rules.
 * Skipped gracefully when no relevant tooling is installed.
 */
export const compilerErrorsRule: Rule = {
  id: 'compiler-errors',
  description: 'Multi-language compiler and type checker errors',
  severity: 'error',

  run(ctx: RuleContext, config?: RulesConfig): Diagnostic[] {
    if (config?.['compiler-errors']?.skip) return [];
    const cwd = process.cwd();
    const langs = detectLanguages(cwd);
    const allErrors: CompilerError[] = [];

    if (langs.go) allErrors.push(...runGoVet(cwd));
    if (langs.python) allErrors.push(...runPythonChecker(cwd));
    if (langs.java) allErrors.push(...runJavaChecker(cwd));
    if (langs.csharp) allErrors.push(...runCsharpChecker(cwd));
    if (langs.rust) allErrors.push(...runRustChecker(cwd));

    if (allErrors.length === 0) return [];

    // Map compiler errors to OIR nodes by file path
    const nodeByFile = new Map<string, typeof ctx.nodes[0]>();
    for (const node of ctx.nodes) {
      const abs = path.resolve(cwd, node.file_path);
      if (!nodeByFile.has(abs)) nodeByFile.set(abs, node);
    }

    return allErrors.map((err) => {
      const absFile = path.isAbsolute(err.file)
        ? err.file
        : path.resolve(cwd, err.file);
      const node = nodeByFile.get(absFile);
      const relPath = path.relative(cwd, absFile);

      return {
        rule_id: 'compiler-errors',
        severity: err.severity,
        message: err.code ? `[${err.code}] ${err.message}` : err.message,
        code_node_oir_id: node?.oir_id ?? null,
        file_path: relPath,
        line_start: err.line,
        line_end: err.endLine ?? err.line,
        metadata: err.metadata,
      };
    });
  },
};
