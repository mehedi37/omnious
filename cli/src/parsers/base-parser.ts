import type { ParseResult } from '../oir/types.js';

/**
 * Abstract parser interface.
 * All language parsers implement this contract.
 */
export interface Parser {
  /** Language identifier */
  readonly language: string;
  /** File extensions this parser handles */
  readonly extensions: string[];
  /** Parse a single file and return OIR nodes + edges */
  parse(source: string, filePath: string): ParseResult;
}
