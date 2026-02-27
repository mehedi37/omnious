import path from 'node:path';
import fs from 'node:fs';

// ── Helpers ──

/** Safely read a file; returns empty string on failure */
function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Check if any file matching a glob-like pattern exists (only supports *.ext) */
function globExists(dir: string, pattern: string): boolean {
  if (!pattern.startsWith('*.')) return fs.existsSync(path.join(dir, pattern));
  const ext = pattern.slice(1); // e.g. '.csproj'
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(ext));
  } catch {
    return false;
  }
}

// ── Language indicators ──

/** Language detection heuristics */
const LANGUAGE_INDICATORS: Record<string, string[]> = {
  typescript: ['tsconfig.json'],
  javascript: ['package.json', 'jsconfig.json'],
  python: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg'],
  go: ['go.mod'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
  csharp: ['*.csproj', '*.sln', 'Directory.Build.props'],
  rust: ['Cargo.toml'],
  php: ['composer.json'],
  ruby: ['Gemfile', 'Rakefile'],
};

// ── Framework signals per ecosystem ──

/** Framework detection via package.json dependency keys (JS/TS) */
const JS_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  nextjs:   ['next'],
  react:    ['react', 'react-dom'],
  vue:      ['vue', 'nuxt'],
  svelte:   ['svelte', '@sveltejs/kit'],
  astro:    ['astro'],
  angular:  ['@angular/core'],
  remix:    ['@remix-run/node', '@remix-run/react'],
  express:  ['express'],
  fastify:  ['fastify'],
  nestjs:   ['@nestjs/core'],
  electron: ['electron'],
  hono:     ['hono'],
  elysia:   ['elysia'],
};

/** Go framework signals (module paths in go.mod) */
const GO_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  gin:    ['github.com/gin-gonic/gin'],
  echo:   ['github.com/labstack/echo'],
  fiber:  ['github.com/gofiber/fiber'],
  chi:    ['github.com/go-chi/chi'],
  mux:    ['github.com/gorilla/mux'],
  gorm:   ['gorm.io/gorm'],
  ent:    ['entgo.io/ent'],
  cobra:  ['github.com/spf13/cobra'],
};

/** Python framework signals (package names in requirements / pyproject) */
const PYTHON_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  django:     ['django'],
  fastapi:    ['fastapi'],
  flask:      ['flask'],
  starlette:  ['starlette'],
  tornado:    ['tornado'],
  sanic:      ['sanic'],
  scrapy:     ['scrapy'],
  sqlalchemy: ['sqlalchemy'],
  celery:     ['celery'],
  pytest:     ['pytest'],
};

/** Java framework signals (artifact IDs / group IDs in pom.xml or build.gradle) */
const JAVA_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  'spring-boot': ['spring-boot', 'org.springframework.boot'],
  quarkus:       ['quarkus', 'io.quarkus'],
  micronaut:     ['micronaut', 'io.micronaut'],
  vertx:         ['vertx', 'io.vertx'],
  'jakarta-ee':  ['jakarta.', 'javax.servlet'],
};

/** C# framework signals (package refs in .csproj) */
const CSHARP_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  aspnet:        ['Microsoft.AspNetCore'],
  efcore:        ['Microsoft.EntityFrameworkCore'],
  blazor:        ['Microsoft.AspNetCore.Components'],
  maui:          ['Microsoft.Maui'],
  'avalonia-ui': ['Avalonia'],
};

/** Rust framework signals (crate names in Cargo.toml) */
const RUST_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  axum:       ['axum'],
  'actix-web': ['actix-web'],
  rocket:     ['rocket'],
  warp:       ['warp'],
  tokio:      ['tokio'],
  diesel:     ['diesel'],
  sqlx:       ['sqlx'],
  serde:      ['serde'],
};

/** PHP framework signals (package names in composer.json) */
const PHP_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  laravel:  ['laravel/framework', 'laravel/laravel'],
  symfony:  ['symfony/symfony', 'symfony/framework-bundle'],
  slim:     ['slim/slim'],
  codeigniter: ['codeigniter4/framework'],
  wordpress:   ['johnpbloch/wordpress'],
};

/** Ruby framework signals (gem names in Gemfile) */
const RUBY_FRAMEWORK_SIGNALS: Record<string, string[]> = {
  rails:   ['rails'],
  sinatra: ['sinatra'],
  hanami:  ['hanami'],
  grape:   ['grape'],
  jekyll:  ['jekyll'],
};

/** Monorepo tool indicators */
const MONOREPO_INDICATORS = [
  'turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml',
  'go.work',
];

export interface DetectionResult {
  languages: string[];
  frameworks: string[];
  isMonorepo: boolean;
  hasTypeScript: boolean;
}

/**
 * Full stack detection — languages, frameworks, monorepo status.
 * Pure file-system logic — no parser dependencies.
 */
export function detectStack(projectRoot: string): DetectionResult {
  const detected: string[] = [];
  const frameworks: string[] = [];
  let hasTypeScript = false;
  let isMonorepo = false;

  // 1. Language indicators (file existence)
  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
    for (const indicator of indicators) {
      if (globExists(projectRoot, indicator)) {
        if (!detected.includes(lang)) {
          detected.push(lang);
        }
        if (lang === 'typescript') hasTypeScript = true;
        break;
      }
    }
  }

  // 2. JS/TS framework detection via package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFile(pkgPath)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        workspaces?: string[] | { packages: string[] };
      };

      const allDeps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);

      // Check for TypeScript in deps even without tsconfig.json
      if (allDeps.has('typescript') && !hasTypeScript) {
        hasTypeScript = true;
        if (!detected.includes('typescript')) {
          detected.push('typescript');
        }
      }

      // JS/TS framework signals
      for (const [framework, signals] of Object.entries(JS_FRAMEWORK_SIGNALS)) {
        if (signals.some((dep) => allDeps.has(dep))) {
          if (framework === 'react' && (frameworks.includes('nextjs') || frameworks.includes('remix'))) continue;
          frameworks.push(framework);
        }
      }

      // npm/yarn/pnpm workspaces → monorepo
      if (pkg.workspaces) {
        isMonorepo = true;
      }
    } catch {
      // Invalid package.json — skip
    }
  }

  // 3. Go framework detection via go.mod
  const goModPath = path.join(projectRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const goMod = readFile(goModPath);
    for (const [framework, signals] of Object.entries(GO_FRAMEWORK_SIGNALS)) {
      if (signals.some((sig) => goMod.includes(sig))) {
        frameworks.push(framework);
      }
    }
  }

  // 4. Python framework detection via requirements.txt / pyproject.toml / Pipfile
  detectPythonFrameworks(projectRoot, frameworks);

  // 5. Java framework detection via pom.xml / build.gradle
  detectJavaFrameworks(projectRoot, frameworks);

  // 6. C# framework detection via *.csproj
  detectCsharpFrameworks(projectRoot, frameworks);

  // 7. Rust framework detection via Cargo.toml
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const cargo = readFile(cargoPath);
    for (const [framework, signals] of Object.entries(RUST_FRAMEWORK_SIGNALS)) {
      if (signals.some((sig) => cargo.includes(sig))) {
        frameworks.push(framework);
      }
    }
    // Cargo workspaces → monorepo
    if (cargo.includes('[workspace]')) {
      isMonorepo = true;
    }
  }

  // 8. PHP framework detection via composer.json
  const composerPath = path.join(projectRoot, 'composer.json');
  if (fs.existsSync(composerPath)) {
    try {
      const composer = JSON.parse(readFile(composerPath)) as {
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
      };
      const allDeps = new Set([
        ...Object.keys(composer.require ?? {}),
        ...Object.keys(composer['require-dev'] ?? {}),
      ]);
      for (const [framework, signals] of Object.entries(PHP_FRAMEWORK_SIGNALS)) {
        if (signals.some((dep) => allDeps.has(dep))) {
          frameworks.push(framework);
        }
      }
    } catch {
      // Invalid composer.json — skip
    }
  }

  // 9. Ruby framework detection via Gemfile
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  if (fs.existsSync(gemfilePath)) {
    const gemfile = readFile(gemfilePath);
    for (const [framework, signals] of Object.entries(RUBY_FRAMEWORK_SIGNALS)) {
      if (signals.some((sig) => {
        // Match gem '<name>' or gem "<name>" to avoid false positives
        const re = new RegExp(`gem\\s+['"]${sig}['"]`);
        return re.test(gemfile);
      })) {
        frameworks.push(framework);
      }
    }
  }

  // 10. Monorepo tool indicators
  for (const indicator of MONOREPO_INDICATORS) {
    if (fs.existsSync(path.join(projectRoot, indicator))) {
      isMonorepo = true;
      break;
    }
  }

  return { languages: detected, frameworks, isMonorepo, hasTypeScript };
}

// ── Ecosystem-specific helpers ──

/**
 * Detect Python frameworks from requirements.txt, pyproject.toml, or Pipfile.
 * Normalizes package names (e.g. Django → django, FastAPI → fastapi).
 */
function detectPythonFrameworks(root: string, frameworks: string[]): void {
  const depNames = new Set<string>();

  // requirements.txt — one package per line, optional version spec
  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const lines = readFile(reqPath).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      // Extract package name before version specifiers (>=, ==, ~=, etc.)
      const name = trimmed.split(/[>=<~!;\s\[]/)[0].toLowerCase().replace(/-/g, '_');
      if (name) depNames.add(name);
    }
  }

  // pyproject.toml — look for dependencies = ["package>=ver"]
  const pyprojectPath = path.join(root, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const content = readFile(pyprojectPath);
    const depMatches = content.matchAll(/["']([a-zA-Z0-9_-]+)/g);
    for (const match of depMatches) {
      depNames.add(match[1].toLowerCase().replace(/-/g, '_'));
    }
  }

  // Pipfile — [packages] section
  const pipfilePath = path.join(root, 'Pipfile');
  if (fs.existsSync(pipfilePath)) {
    const content = readFile(pipfilePath);
    // Simple extraction: lines like `django = "*"` or `flask = {version = ">=2.0"}`
    const pkgMatches = content.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
    for (const match of pkgMatches) {
      const name = match[1].toLowerCase().replace(/-/g, '_');
      if (name !== 'python_version' && name !== 'url' && name !== 'verify_ssl' && name !== 'name') {
        depNames.add(name);
      }
    }
  }

  for (const [framework, signals] of Object.entries(PYTHON_FRAMEWORK_SIGNALS)) {
    if (signals.some((sig) => depNames.has(sig))) {
      frameworks.push(framework);
    }
  }
}

/**
 * Detect Java frameworks from pom.xml or build.gradle(.kts).
 * Searches for known artifactId / groupId strings.
 */
function detectJavaFrameworks(root: string, frameworks: string[]): void {
  // Read whichever build file exists
  let buildContent = '';
  for (const file of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) {
      buildContent += readFile(p) + '\n';
    }
  }
  if (!buildContent) return;

  for (const [framework, signals] of Object.entries(JAVA_FRAMEWORK_SIGNALS)) {
    if (signals.some((sig) => buildContent.includes(sig))) {
      frameworks.push(framework);
    }
  }
}

/**
 * Detect C# frameworks from .csproj files.
 * Searches top-level directory for any .csproj and scans PackageReference elements.
 */
function detectCsharpFrameworks(root: string, frameworks: string[]): void {
  let csprojContent = '';
  try {
    const files = fs.readdirSync(root);
    for (const f of files) {
      if (f.endsWith('.csproj')) {
        csprojContent += readFile(path.join(root, f)) + '\n';
      }
    }
  } catch {
    return;
  }
  if (!csprojContent) return;

  for (const [framework, signals] of Object.entries(CSHARP_FRAMEWORK_SIGNALS)) {
    if (signals.some((sig) => csprojContent.includes(sig))) {
      frameworks.push(framework);
    }
  }
}
