/**
 * Multi-language stack trace parser.
 *
 * Extracts structured `{file, line, function}` frames from stack traces
 * produced by JavaScript/TypeScript, Python, Go, Java, C#, and Rust.
 *
 * Used by both CLI rules and backend trace ingestion to map errors
 * back to OIR code nodes.
 */

export interface StackFrame {
  /** File path (may be absolute or relative depending on the runtime) */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based, if available) */
  column?: number;
  /** Function or method name */
  function: string;
  /** Detected language of this stack frame */
  language: 'javascript' | 'typescript' | 'python' | 'go' | 'java' | 'csharp' | 'rust' | 'unknown';
}

// ── Language-specific parsers ──

/**
 * JavaScript / TypeScript:
 *   at functionName (file.ts:10:5)
 *   at file.ts:10:5
 *   at Object.<anonymous> (file.js:1:1)
 *   at async functionName (file.ts:10:5)
 */
const JS_FRAME_RE = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

function parseJSFrame(line: string): StackFrame | null {
  const m = JS_FRAME_RE.exec(line);
  if (!m) return null;

  const file = m[2]!;
  const ext = file.split('.').pop()?.toLowerCase();
  const language = ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts'
    ? 'typescript' : 'javascript';

  return {
    file,
    line: parseInt(m[3]!, 10),
    column: parseInt(m[4]!, 10),
    function: m[1] ?? '<anonymous>',
    language,
  };
}

/**
 * Python:
 *   File "path/to/file.py", line 42, in function_name
 *   File "/abs/path/file.py", line 10, in <module>
 */
const PYTHON_FRAME_RE = /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;

function parsePythonFrame(line: string): StackFrame | null {
  const m = PYTHON_FRAME_RE.exec(line);
  if (!m) return null;

  return {
    file: m[1]!,
    line: parseInt(m[2]!, 10),
    function: m[3] ?? '<module>',
    language: 'python',
  };
}

/**
 * Go:
 *   /path/to/file.go:42 +0x1a4
 *   main.functionName(...)
 *   	/path/to/file.go:42
 *
 * Go stack traces come in pairs: function line then file:line line.
 * We parse the file:line entries.
 */
const GO_FRAME_FILE_RE = /^\s*(.+?\.go):(\d+)(?:\s.*)?$/;
const GO_FRAME_FUNC_RE = /^(.+?)\(.*\)$/;

function parseGoFrames(lines: string[]): StackFrame[] {
  const frames: StackFrame[] = [];

  for (let i = 0; i < lines.length; i++) {
    const fileLine = lines[i]!.trim();
    const fileMatch = GO_FRAME_FILE_RE.exec(fileLine);
    if (!fileMatch) continue;

    // Look at previous line for function name
    let funcName = '<unknown>';
    if (i > 0) {
      const funcLine = lines[i - 1]!.trim();
      const funcMatch = GO_FRAME_FUNC_RE.exec(funcLine);
      if (funcMatch) {
        funcName = funcMatch[1]!;
      }
    }

    frames.push({
      file: fileMatch[1]!,
      line: parseInt(fileMatch[2]!, 10),
      function: funcName,
      language: 'go',
    });
  }

  return frames;
}

/**
 * Java:
 *   at com.example.ClassName.methodName(FileName.java:42)
 *   at com.example.ClassName$InnerClass.method(File.java:10)
 *   at java.base/java.util.ArrayList.forEach(ArrayList.java:1511)
 */
const JAVA_FRAME_RE = /^\s*at\s+(.+?)\((.+?\.java):(\d+)\)$/;

function parseJavaFrame(line: string): StackFrame | null {
  const m = JAVA_FRAME_RE.exec(line);
  if (!m) return null;

  return {
    file: m[2]!,
    line: parseInt(m[3]!, 10),
    function: m[1]!,
    language: 'java',
  };
}

/**
 * C#:
 *   at Namespace.Class.Method() in /path/to/File.cs:line 42
 *   at Namespace.Class.Method(String arg) in C:\path\File.cs:line 10
 */
const CSHARP_FRAME_RE = /^\s*at\s+(.+?)\s+in\s+(.+?):line\s+(\d+)$/;

function parseCSharpFrame(line: string): StackFrame | null {
  const m = CSHARP_FRAME_RE.exec(line);
  if (!m) return null;

  return {
    file: m[2]!,
    line: parseInt(m[3]!, 10),
    function: m[1]!,
    language: 'csharp',
  };
}

/**
 * Rust:
 *     at module::function::name (src/file.rs:42:5)
 *   0: rust_begin_unwind
 *          at /rustc/.../std/src/panicking.rs:645:5
 *   1: module::function
 *          at ./src/main.rs:10:5
 */
const RUST_FRAME_RE = /^\s*(?:\d+:\s+)?(?:(.+?)\s+)?at\s+(.+?\.rs):(\d+)(?::(\d+))?$/;

function parseRustFrame(line: string): StackFrame | null {
  const m = RUST_FRAME_RE.exec(line);
  if (!m) return null;

  return {
    file: m[2]!,
    line: parseInt(m[3]!, 10),
    column: m[4] ? parseInt(m[4], 10) : undefined,
    function: m[1] ?? '<unknown>',
    language: 'rust',
  };
}

// ── Composite parser ──

/**
 * Parse a multi-language stack trace string into structured frames.
 *
 * Tries each language parser on every line. Lines that don't match any pattern
 * are silently skipped. Go frames (which span two lines) are handled specially.
 *
 * @param stackTrace  The raw stack trace string (may contain multiple frames)
 * @returns           Array of parsed stack frames in order of appearance
 */
export function parseStackTrace(stackTrace: string): StackFrame[] {
  if (!stackTrace) return [];

  const lines = stackTrace.split('\n');
  const frames: StackFrame[] = [];
  const goLines: string[] = [];
  let hasGoFrames = false;

  // Detect if this looks like a Go stack trace
  // Go stack traces contain "goroutine N [running]:" headers
  if (/goroutine\s+\d+\s+\[/.test(stackTrace) || /\.go:\d+/.test(stackTrace)) {
    hasGoFrames = true;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip common noise lines
    if (trimmed.startsWith('goroutine ')) continue;
    if (trimmed === '---' || trimmed === '...') continue;

    // Try each parser in priority order. The order matters because
    // Java and JS both use "at " prefix — Java is more specific so check first.

    // C# — very specific "in File.cs:line N" pattern
    const csharp = parseCSharpFrame(trimmed);
    if (csharp) { frames.push(csharp); continue; }

    // Java — "at com.pkg.Class.method(File.java:N)"
    const java = parseJavaFrame(trimmed);
    if (java) { frames.push(java); continue; }

    // Rust — "at src/file.rs:N:N"
    const rust = parseRustFrame(trimmed);
    if (rust) { frames.push(rust); continue; }

    // Python — 'File "path", line N'
    const python = parsePythonFrame(trimmed);
    if (python) { frames.push(python); continue; }

    // JS/TS — "at func (file:line:col)" or "at file:line:col"
    const js = parseJSFrame(trimmed);
    if (js) { frames.push(js); continue; }

    // Collect lines for Go (analyzed as pairs)
    if (hasGoFrames) {
      goLines.push(line);
    }
  }

  // Parse Go frames (they come in func/file pairs)
  if (goLines.length > 0) {
    const goFrames = parseGoFrames(goLines);
    frames.push(...goFrames);
  }

  return frames;
}

/**
 * Detect the primary language of a stack trace based on parsed frames.
 *
 * Returns the language that appears most frequently, or 'unknown' if no frames
 * were parsed.
 */
export function detectStackTraceLanguage(
  frames: StackFrame[],
): StackFrame['language'] {
  if (frames.length === 0) return 'unknown';

  const counts = new Map<string, number>();
  for (const frame of frames) {
    counts.set(frame.language, (counts.get(frame.language) ?? 0) + 1);
  }

  let maxLang: StackFrame['language'] = 'unknown';
  let maxCount = 0;
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang as StackFrame['language'];
    }
  }

  return maxLang;
}

/**
 * Map parsed stack frames to OIR node IDs by matching file paths.
 *
 * @param frames     Parsed stack frames
 * @param nodeByFile Map from absolute file path → node oir_id
 * @param cwd        Project root for resolving relative paths
 * @returns          Array of `{frame, oir_id}` for frames that matched a node
 */
export function mapFramesToNodes(
  frames: StackFrame[],
  nodeByFile: Map<string, string>,
  cwd: string,
): Array<{ frame: StackFrame; oir_id: string }> {
  const { resolve, isAbsolute } = require('node:path') as typeof import('node:path');
  const mapped: Array<{ frame: StackFrame; oir_id: string }> = [];

  for (const frame of frames) {
    const absPath = isAbsolute(frame.file)
      ? frame.file
      : resolve(cwd, frame.file);

    const oirId = nodeByFile.get(absPath);
    if (oirId) {
      mapped.push({ frame, oir_id: oirId });
    }
  }

  return mapped;
}
