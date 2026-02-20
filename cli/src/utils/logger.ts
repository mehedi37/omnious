import chalk from 'chalk';

const isCI = process.env['CI'] === 'true';

export const logger = {
  info(msg: string): void {
    console.log(chalk.blue('ℹ'), msg);
  },
  success(msg: string): void {
    console.log(chalk.green('✓'), msg);
  },
  warn(msg: string): void {
    console.log(chalk.yellow('⚠'), msg);
  },
  error(msg: string): void {
    console.error(chalk.red('✗'), msg);
  },
  debug(msg: string): void {
    if (process.env['OMNIOUS_DEBUG'] === 'true') {
      console.log(chalk.gray('…'), msg);
    }
  },
  /** Dimmed/muted output */
  dim(msg: string): void {
    console.log(chalk.dim(msg));
  },
  /** Step indicator (numbered or arrow) */
  step(msg: string): void {
    console.log(chalk.cyan('→'), msg);
  },
  /** Plain output (no prefix) */
  plain(msg: string): void {
    console.log(msg);
  },
  /** Is running in CI mode */
  get isCI(): boolean {
    return isCI;
  },
};
