/**
 * Language extension mapping — GitHub Linguist-style.
 * Maps file extensions to parseable language identifiers.
 */

export type SupportedLanguage =
  | 'typescript'
  | 'python'
  | 'go'
  | 'java'
  | 'csharp';

/** Extension → Language mapping (all extensions lowercase, with leading dot) */
const EXTENSION_MAP: ReadonlyMap<string, SupportedLanguage> = new Map([
  // TypeScript / JavaScript
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'typescript'],
  ['.jsx', 'typescript'],
  ['.mjs', 'typescript'],
  ['.cjs', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],

  // Python
  ['.py', 'python'],
  ['.pyi', 'python'],
  ['.pyw', 'python'],

  // Go
  ['.go', 'go'],

  // Java
  ['.java', 'java'],

  // C#
  ['.cs', 'csharp'],
]);

/** All supported extensions (for display and filtering) */
export const SUPPORTED_EXTENSIONS: readonly string[] = [...EXTENSION_MAP.keys()];

/** Language display names for CLI output */
export const LANGUAGE_DISPLAY_NAMES: Readonly<Record<SupportedLanguage, string>> = {
  typescript: 'TypeScript / JavaScript',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  csharp: 'C#',
};

/** Language indicator files — used by detectLanguages() for project scanning */
export const LANGUAGE_INDICATORS: Readonly<Record<SupportedLanguage, readonly string[]>> = {
  typescript: ['tsconfig.json', 'package.json', 'jsconfig.json'],
  python: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg'],
  go: ['go.mod', 'go.sum'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
  csharp: ['*.csproj', '*.sln', 'Directory.Build.props'],
};

/**
 * Determine the language for a given file path.
 * Returns undefined if the extension is not supported.
 */
export function getLanguageForFile(filePath: string): SupportedLanguage | undefined {
  const ext = getExtension(filePath);
  return EXTENSION_MAP.get(ext);
}

/**
 * Check if a file extension is parseable (has a registered language).
 */
export function isParseableFile(filePath: string): boolean {
  return EXTENSION_MAP.has(getExtension(filePath));
}

/**
 * Get all extensions for a given language.
 */
export function getExtensionsForLanguage(language: SupportedLanguage): string[] {
  const exts: string[] = [];
  for (const [ext, lang] of EXTENSION_MAP) {
    if (lang === language) exts.push(ext);
  }
  return exts;
}

/**
 * Get all supported language identifiers.
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return [...new Set(EXTENSION_MAP.values())];
}

/** Normalize file extension (lowercase, with leading dot) */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}
