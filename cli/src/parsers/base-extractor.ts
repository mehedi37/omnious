/**
 * Extractor interface — the new tree-sitter-based replacement for Parser.
 *
 * Each language extractor receives a tree-sitter syntax tree and produces
 * OIR nodes + edges. The tree-sitter engine handles parsing; extractors
 * only handle semantic extraction.
 */
import type Parser from 'tree-sitter';
import type { ParseResult } from '../oir/types.js';
import type { SupportedLanguage } from './languages.js';

/**
 * A language-specific extractor that produces OIR nodes and edges
 * from a tree-sitter concrete syntax tree.
 */
export interface Extractor {
  /** Language this extractor handles */
  readonly language: SupportedLanguage;

  /**
   * Extract OIR nodes and edges from a parsed syntax tree.
   *
   * @param tree   The tree-sitter syntax tree (already parsed)
   * @param source The raw source code (needed for text extraction)
   * @param filePath Relative file path (for OIR ID generation)
   */
  extract(tree: Parser.Tree, source: string, filePath: string): ParseResult;
}
