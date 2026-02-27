/**
 * Tree-sitter parser engine — singleton that manages grammar loading.
 *
 * Uses node-tree-sitter (native C++ bindings) for maximum performance.
 * Grammars are loaded lazily on first use per language.
 */
import Parser from 'tree-sitter';
import type { SupportedLanguage } from './languages.js';

// Grammar imports — each is a native addon
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Java from 'tree-sitter-java';
import CSharp from 'tree-sitter-c-sharp';

/** Map language → tree-sitter grammar */
const GRAMMARS: Record<SupportedLanguage, unknown> = {
  typescript: TypeScript.typescript,
  python: Python,
  go: Go,
  java: Java,
  csharp: CSharp,
};

/**
 * TSX grammar — separate from TypeScript because tree-sitter-typescript
 * exposes two grammars: `typescript` and `tsx`.
 */
const TSX_GRAMMAR = TypeScript.tsx;

/** Cached parser instances per language (plus tsx variant) */
const parsers = new Map<string, Parser>();

/**
 * Get a tree-sitter Parser instance for the given language.
 * Parsers are cached (one per language) to avoid re-initialization.
 */
export function getParser(language: SupportedLanguage, isTsx = false): Parser {
  const key = language === 'typescript' && isTsx ? 'tsx' : language;

  let parser = parsers.get(key);
  if (parser) return parser;

  parser = new Parser();

  if (key === 'tsx') {
    parser.setLanguage(TSX_GRAMMAR as Parameters<Parser['setLanguage']>[0]);
  } else {
    const grammar = GRAMMARS[language];
    if (!grammar) {
      throw new Error(`No tree-sitter grammar registered for language: ${language}`);
    }
    parser.setLanguage(grammar as Parameters<Parser['setLanguage']>[0]);
  }

  parsers.set(key, parser);
  return parser;
}

/**
 * Parse source code into a tree-sitter syntax tree.
 * Automatically selects the right grammar (including TSX detection).
 */
export function parseSource(
  source: string,
  language: SupportedLanguage,
  filePath: string,
): Parser.Tree {
  const isTsx = language === 'typescript' && /\.[jt]sx$/.test(filePath);
  const parser = getParser(language, isTsx);
  return parser.parse(source);
}
