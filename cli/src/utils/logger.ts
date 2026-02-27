import chalk, { type ChalkInstance } from 'chalk';
import boxen, { type Options as BoxenOptions } from 'boxen';

const isCI = process.env['CI'] === 'true';

// ── Theme colors ──
const theme = {
  brand: chalk.hex('#22c55e'),       // green-500
  brandBold: chalk.hex('#22c55e').bold,
  accent: chalk.hex('#10b981'),      // emerald-500
  muted: chalk.hex('#6b7280'),       // gray-500
  subtle: chalk.dim,
  highlight: chalk.hex('#f59e0b'),   // amber-500
  danger: chalk.hex('#ef4444'),      // red-500
  info: chalk.hex('#3b82f6'),        // blue-500
  cyan: chalk.hex('#06b6d4'),        // cyan-500
  white: chalk.white.bold,
};

// ── Node-type colors (matches frontend) ──
const NODE_TYPE_COLORS: Record<string, ChalkInstance> = {
  module:         chalk.hex('#3b82f6'), // blue
  component:      chalk.hex('#8b5cf6'), // violet
  function:       chalk.hex('#22c55e'), // green
  class:          chalk.hex('#f59e0b'), // amber
  route:          chalk.hex('#06b6d4'), // cyan
  middleware:     chalk.hex('#ec4899'), // pink
  database_query: chalk.hex('#f97316'), // orange
  event_emitter:  chalk.hex('#14b8a6'), // teal
  event_listener: chalk.hex('#14b8a6'), // teal
  external_api:   chalk.hex('#6366f1'), // indigo
  variable:       chalk.hex('#6b7280'), // gray
  type_def:       chalk.hex('#a855f7'), // purple
};

/** Format a count with +/- diff coloring */
function formatDiff(value: number): string {
  if (value > 0) return chalk.green(`+${value}`);
  if (value < 0) return chalk.red(`${value}`);
  return chalk.dim('0');
}

/** Terminal OSC 8 hyperlink (supported in iTerm2, Ghostty, WezTerm, VS Code terminal) */
function hyperlink(text: string, url: string): string {
  // Disable hyperlinks in CI or dumb terminals
  if (isCI || process.env['TERM'] === 'dumb') {
    return `${text} ${chalk.dim(`(${url})`)}`;
  }
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** Right-pad a label for aligned key-value output */
function label(text: string, width = 16): string {
  return theme.muted(text.padEnd(width));
}

export const logger = {
  // ── Core log methods ──

  info(msg: string): void {
    console.log(theme.info('●'), msg);
  },
  success(msg: string): void {
    console.log(theme.brand('✔'), msg);
  },
  warn(msg: string): void {
    console.log(theme.highlight('⚠'), msg);
  },
  error(msg: string): void {
    console.error(theme.danger('✖'), msg);
  },
  debug(msg: string): void {
    if (process.env['OMNIOUS_DEBUG'] === 'true') {
      console.log(theme.muted('…'), theme.muted(msg));
    }
  },
  /** Dimmed/muted output */
  dim(msg: string): void {
    console.log(theme.subtle(msg));
  },
  /** Step indicator (arrow) */
  step(msg: string): void {
    console.log(theme.cyan('›'), msg);
  },
  /** Plain output (no prefix) */
  plain(msg: string): void {
    console.log(msg);
  },

  // ── Enhanced output methods ──

  /** Print a section header with underline */
  section(title: string): void {
    console.log('');
    console.log(theme.white(title));
    console.log(theme.muted('─'.repeat(Math.min(title.length + 4, 50))));
  },

  /** Print a key-value pair with aligned labels */
  kv(key: string, value: string | number, width = 16): void {
    console.log(`  ${label(key, width)} ${value}`);
  },

  /** Print a boxed summary (for final output) */
  box(text: string, options?: { color?: string; title?: string; dimBorder?: boolean }): void {
    const boxOpts: BoxenOptions = {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: options?.color ?? 'green',
      dimBorder: options?.dimBorder ?? false,
      title: options?.title,
      titleAlignment: 'left',
    };
    console.log(boxen(text, boxOpts));
  },

  /** Print a success box with title */
  successBox(lines: string[], title?: string): void {
    logger.box(lines.join('\n'), { color: 'green', title: title ?? '✔ Done' });
  },

  /** Print an info box */
  infoBox(lines: string[], title?: string): void {
    logger.box(lines.join('\n'), { color: 'cyan', title: title ?? 'Info' });
  },

  /** Print a warning box */
  warnBox(lines: string[], title?: string): void {
    logger.box(lines.join('\n'), { color: 'yellow', title: title ?? '⚠ Warning' });
  },

  /** Omnious brand banner — shown once on major commands */
  banner(): void {
    const text = theme.brandBold('◆ omnious');
    const ver = theme.muted(` v0.1.0`);
    console.log(`${text}${ver}`);
  },

  /** Print a terminal hyperlink */
  link(text: string, url: string): void {
    console.log(`  ${hyperlink(theme.cyan(text), url)}`);
  },

  /** Format a diff number */
  diff: formatDiff,

  /** Get a node-type color function */
  nodeTypeColor(type: string): ChalkInstance {
    return NODE_TYPE_COLORS[type] ?? theme.muted;
  },

  /** Print node-type breakdown with colored badges */
  nodeTypeBreakdown(nodesByType: Record<string, number>): void {
    const entries = Object.entries(nodesByType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of entries) {
      const color = NODE_TYPE_COLORS[type] ?? theme.muted;
      const badge = color('●');
      console.log(`  ${badge} ${theme.muted(type.padEnd(18))} ${chalk.white(count)}`);
    }
  },

  /** Theme colors for external use */
  theme,

  /** Label formatter for external use */
  label,

  /** Hyperlink helper */
  hyperlink,

  /** Is running in CI mode */
  get isCI(): boolean {
    return isCI;
  },
};
