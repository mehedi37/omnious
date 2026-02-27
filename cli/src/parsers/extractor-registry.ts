/**
 * Extractor registry — dispatches files to the correct tree-sitter extractor
 * based on file extension.
 *
 * Replaces the old ParserRegistry with tree-sitter-based extractors.
 */
import type { Extractor } from './base-extractor.js';
import type { ParseResult } from '../oir/types.js';
import { getLanguageForFile, type SupportedLanguage } from './languages.js';
import { parseSource } from './tree-sitter-engine.js';

import {
  TypeScriptExtractor,
  PythonExtractor,
  GoExtractor,
  JavaExtractor,
  CSharpExtractor,
} from './extractors/index.js';

/** Map of language → extractor instance */
const extractors = new Map<SupportedLanguage, Extractor>([
  ['typescript', new TypeScriptExtractor()],
  ['python', new PythonExtractor()],
  ['go', new GoExtractor()],
  ['java', new JavaExtractor()],
  ['csharp', new CSharpExtractor()],
]);

/**
 * Parse a source file and extract OIR nodes/edges.
 *
 * This is the main entry point for parsing — it:
 * 1. Detects the language from the file extension
 * 2. Parses the source with the matching tree-sitter grammar
 * 3. Runs the language extractor on the syntax tree
 *
 * Returns null if the file's language is not supported.
 */
export function extractFromFile(
  source: string,
  filePath: string,
): ParseResult | null {
  const language = getLanguageForFile(filePath);
  if (!language) return null;

  const extractor = extractors.get(language);
  if (!extractor) return null;

  // Parse with tree-sitter
  const tree = parseSource(source, language, filePath);

  // Extract OIR nodes + edges
  return extractor.extract(tree, source, filePath);
}

/**
 * Check if a file can be parsed.
 */
export function canExtract(filePath: string): boolean {
  const language = getLanguageForFile(filePath);
  return language !== undefined && extractors.has(language);
}

/**
 * Get all supported language names.
 */
export function supportedLanguages(): SupportedLanguage[] {
  return [...extractors.keys()];
}
