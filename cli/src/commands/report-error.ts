import fs from 'node:fs';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';

interface ReportErrorOptions {
  file?: string;
  type?: string;
  severity?: 'error' | 'warning' | 'info';
  apiKey?: string;
  config?: string;
  verbose?: boolean;
}

interface ParsedError {
  error_type: string;
  error_message: string;
  error_stack: string;
  frames: StackFrame[];
  severity: 'error' | 'warning' | 'info';
}

interface StackFrame {
  file_path: string;
  function_name: string | null;
  line: number | null;
  column: number | null;
}

/**
 * `omnious report-error` — parse runtime errors and push to Omnious.
 *
 * Reads error text from --file or stdin, parses the stack trace,
 * resolves frames to code nodes, and creates error snapshots.
 */
export async function reportErrorCommand(opts: ReportErrorOptions): Promise<void> {
  logger.banner();
  console.log('');

  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Load config
  const config = loadConfig(opts.config);

  // Resolve API key
  const apiKey = resolveApiKey({
    cliFlag: opts.apiKey,
    configKey: config.api.project_key,
  });

  if (!apiKey) {
    logger.error('No API key found.');
    logger.dim('  Set OMNIOUS_PROJECT_KEY env var, run `omnious login`, or add project_key to .omnious.yml');
    process.exitCode = 1;
    return;
  }

  // Read error input
  spinner.start('Reading error input…');
  let errorText: string;

  if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      spinner.fail(`File not found: ${opts.file}`);
      process.exitCode = 1;
      return;
    }
    errorText = fs.readFileSync(opts.file, 'utf-8');
  } else if (!process.stdin.isTTY) {
    // Read from stdin (piped input)
    errorText = await readStdin();
  } else {
    spinner.fail('No input provided. Use --file <path> or pipe error text via stdin.');
    logger.dim('  Example: cat error.log | omnious report-error');
    logger.dim('  Example: omnious report-error --file error.log');
    process.exitCode = 1;
    return;
  }

  if (!errorText.trim()) {
    spinner.fail('Empty error input');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Error input loaded');

  // Parse the error
  spinner.start('Parsing stack trace…');
  const parsed = parseErrorText(errorText, opts.type, opts.severity ?? 'error');
  spinner.succeed(
    `Parsed: ${logger.theme.brand(parsed.error_type)} with ${parsed.frames.length} frame(s)`,
  );

  if (opts.verbose) {
    console.log('');
    logger.dim(`  Message: ${parsed.error_message.slice(0, 120)}`);
    for (const frame of parsed.frames.slice(0, 5)) {
      logger.dim(`  → ${frame.function_name ?? '(anonymous)'} at ${frame.file_path}:${frame.line ?? '?'}`);
    }
    if (parsed.frames.length > 5) {
      logger.dim(`  … and ${parsed.frames.length - 5} more`);
    }
  }

  // Connect and push
  const client = new OmniousApiClient(config.api.url, apiKey);
  spinner.start('Connecting to Omnious…');
  const healthy = await client.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot reach API at ${config.api.url}`);
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Connected');

  spinner.start('Reporting error…');
  try {
    const result = await client.reportError({
      error_type: parsed.error_type,
      error_message: parsed.error_message,
      error_stack: parsed.error_stack,
      frames: parsed.frames,
      severity: parsed.severity,
    });
    spinner.succeed(
      `Error reported → ${result.snapshot_id ? 'snapshot created' : 'snapshot updated'} (${result.frames_matched} frame(s) matched to code nodes)`,
    );
  } catch (err) {
    spinner.fail('Failed to report error');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
  }
}

// ─── Parsers ──────────────────────────────────────────────────

function parseErrorText(
  raw: string,
  overrideType?: string,
  severity: 'error' | 'warning' | 'info' = 'error',
): ParsedError {
  const lines = raw.split('\n');

  // Try to extract error type and message from the first non-empty line
  let errorType = overrideType ?? 'Error';
  let errorMessage = '';
  let stackStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Pattern: "ErrorType: message"
    const colonMatch = /^([A-Z]\w*(?:Error|Exception|Warning|Fault))\s*:\s*(.+)/i.exec(line);
    if (colonMatch) {
      if (!overrideType) errorType = colonMatch[1];
      errorMessage = colonMatch[2];
      stackStartIdx = i + 1;
      break;
    }

    // Python-style: last line has "ErrorType: message"
    // Check if this line starts with "at " or matches a stack frame pattern
    if (/^\s+at\s/.test(line) || /^\s*File\s+"/.test(line)) {
      // This is a stack frame — use the previous line as the error line
      if (i > 0) {
        const prevLine = lines[i - 1].trim();
        const pyMatch = /^([A-Z]\w*(?:Error|Exception))\s*:\s*(.+)/i.exec(prevLine);
        if (pyMatch) {
          if (!overrideType) errorType = pyMatch[1];
          errorMessage = pyMatch[2];
        } else {
          errorMessage = prevLine;
        }
      }
      stackStartIdx = i;
      break;
    }

    // If no pattern matches, first line is the error message
    if (i === 0) {
      errorMessage = line;
      stackStartIdx = 1;
    }
  }

  if (!errorMessage) {
    errorMessage = lines[0]?.trim() ?? 'Unknown error';
  }

  // Parse stack frames
  const frames: StackFrame[] = [];
  for (let i = stackStartIdx; i < lines.length; i++) {
    const frame = parseStackFrame(lines[i]);
    if (frame) frames.push(frame);
  }

  return {
    error_type: errorType,
    error_message: errorMessage.slice(0, 2000),
    error_stack: raw.slice(0, 8000),
    frames,
    severity,
  };
}

/**
 * Parse a single stack trace line into a frame.
 * Supports: Node.js/V8, Python, Go, Java, C#.
 */
function parseStackFrame(line: string): StackFrame | null {
  const trimmed = line.trim();

  // Node.js / V8: "at functionName (file:line:col)" or "at file:line:col"
  const v8Match = /^\s*at\s+(?:(.+?)\s+\()?((?:\/|[A-Z]:\\|\.\/)[\w/\\.\-@]+):(\d+)(?::(\d+))?\)?/.exec(trimmed);
  if (v8Match) {
    return {
      function_name: v8Match[1] || null,
      file_path: v8Match[2],
      line: parseInt(v8Match[3], 10),
      column: v8Match[4] ? parseInt(v8Match[4], 10) : null,
    };
  }

  // Python: '  File "path", line N, in funcName'
  const pyMatch = /^\s*File\s+"([^"]+)",\s*line\s+(\d+)(?:,\s*in\s+(\S+))?/.exec(trimmed);
  if (pyMatch) {
    return {
      file_path: pyMatch[1],
      line: parseInt(pyMatch[2], 10),
      function_name: pyMatch[3] || null,
      column: null,
    };
  }

  // Go: "goroutine N [...]\n\tpackage/file.go:line +0xHEX"
  const goMatch = /^\s*(\S+\/\S+\.go):(\d+)\s/.exec(trimmed);
  if (goMatch) {
    return {
      file_path: goMatch[1],
      line: parseInt(goMatch[2], 10),
      function_name: null,
      column: null,
    };
  }

  // Java: "at package.Class.method(File.java:line)"
  const javaMatch = /^\s*at\s+([\w.$]+)\(([\w.]+):(\d+)\)/.exec(trimmed);
  if (javaMatch) {
    return {
      function_name: javaMatch[1],
      file_path: javaMatch[2],
      line: parseInt(javaMatch[3], 10),
      column: null,
    };
  }

  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    // Timeout after 5s if no data
    setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8')), 5000);
  });
}
