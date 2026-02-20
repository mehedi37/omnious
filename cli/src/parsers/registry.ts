import path from 'node:path';
import fs from 'node:fs';
import type { Parser } from './base-parser.js';
import { TypeScriptParser } from './typescript.js';

/**
 * Registry that routes files to the appropriate parser based on extension.
 */
export class ParserRegistry {
  private parsers = new Map<string, Parser>();
  private extensionMap = new Map<string, string>();

  /** Register a language parser */
  register(parser: Parser): void {
    this.parsers.set(parser.language, parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext, parser.language);
    }
  }

  /** Auto-detect parser from file path */
  detect(filePath: string): Parser | null {
    const ext = path.extname(filePath);
    const language = this.extensionMap.get(ext);
    return language ? this.parsers.get(language) ?? null : null;
  }

  /** Get all registered language names */
  languages(): string[] {
    return [...this.parsers.keys()];
  }
}

/**
 * Create the default registry with built-in parsers.
 */
export function createDefaultRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  return registry;
}

/** Language detection heuristics */
const LANGUAGE_INDICATORS: Record<string, string[]> = {
  typescript: ['tsconfig.json'],
  javascript: ['package.json', 'jsconfig.json'],
  python: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
};

/**
 * Auto-detect languages present in a project root.
 */
export function detectLanguages(projectRoot: string): string[] {
  const detected: string[] = [];

  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
    for (const indicator of indicators) {
      if (fs.existsSync(path.join(projectRoot, indicator))) {
        if (!detected.includes(lang)) {
          detected.push(lang);
        }
        break;
      }
    }
  }

  return detected;
}
