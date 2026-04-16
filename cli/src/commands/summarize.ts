import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { logger } from '../utils/logger.js';

const CACHE_DIR = '.omnious';
const CONTEXT_FILE = 'project-context.json';

interface SummarizeOptions {
  config?: string;
  verbose?: boolean;
}

interface ProjectContext {
  name: string;
  description: string;
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  entryPoints: string[];
  domains: string[];
  generatedAt: string;
}

/** Known manifest files and what they tell us */
const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  'requirements.txt',
  'setup.py',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
] as const;

/** Detect entry points by common conventions */
const ENTRY_POINT_PATTERNS = [
  'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
  'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js',
  'main.py', 'app.py', 'manage.py', 'main.go', 'cmd/main.go',
  'src/main.rs', 'Program.cs', 'Main.java',
  'index.html', 'pages/index.tsx', 'app/page.tsx',
  'src/App.tsx', 'src/App.vue', 'src/App.svelte',
];

/**
 * Scan the current project and return extracted metadata (no side effects).
 * Used by both `omnious summarize` (for display + file write) and
 * `omnious sync` (for uploading context to the backend).
 */
export async function extractProjectContext(cwd: string): Promise<ProjectContext> {
  let projectName = path.basename(cwd);

  try {
    const config = (await import('../config/loader.js')).loadConfig();
    if (config.project?.name) projectName = config.project.name;
  } catch { /* ok */ }

  const foundManifests: string[] = [];
  for (const manifest of MANIFEST_FILES) {
    if (fs.existsSync(path.join(cwd, manifest))) foundManifests.push(manifest);
  }

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const buildTools = new Set<string>();
  let description = '';

  for (const manifest of foundManifests) {
    const absPath = path.join(cwd, manifest);
    const content = fs.readFileSync(absPath, 'utf-8');

    if (manifest === 'package.json') {
      extractFromPackageJson(content, languages, frameworks, buildTools);
      try {
        const pkg = JSON.parse(content) as { description?: string; name?: string };
        if (pkg.description) description = pkg.description;
        if (pkg.name && projectName === path.basename(cwd)) projectName = pkg.name;
      } catch { /* skip */ }
    } else if (manifest === 'pyproject.toml' || manifest === 'requirements.txt' || manifest === 'setup.py') {
      languages.add('Python'); extractPythonFrameworks(content, frameworks);
    } else if (manifest === 'go.mod') {
      languages.add('Go'); extractGoFrameworks(content, frameworks);
    } else if (manifest === 'Cargo.toml') {
      languages.add('Rust');
    } else if (manifest === 'pom.xml' || manifest === 'build.gradle') {
      languages.add('Java');
      buildTools.add(manifest === 'pom.xml' ? 'Maven' : 'Gradle');
    } else if (manifest === 'Gemfile') {
      languages.add('Ruby');
      if (content.includes('rails')) frameworks.add('Rails');
    } else if (manifest === 'composer.json') {
      languages.add('PHP');
      if (content.includes('laravel')) frameworks.add('Laravel');
    } else if (manifest === 'Dockerfile') {
      buildTools.add('Docker');
    } else if (manifest === 'docker-compose.yml') {
      buildTools.add('Docker Compose');
    }
  }

  const entryPoints: string[] = [];
  for (const ep of ENTRY_POINT_PATTERNS) {
    if (fs.existsSync(path.join(cwd, ep))) entryPoints.push(ep);
  }

  return {
    name: projectName,
    description,
    languages: [...languages],
    frameworks: [...frameworks],
    buildTools: [...buildTools],
    entryPoints,
    domains: inferDomains(cwd),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * `omnious summarize` — scan project and generate context metadata.
 *
 * Detects languages, frameworks, build tools, and entry points
 * from manifest files. Output is saved to `.omnious/project-context.json`.
 */
export async function summarizeCommand(opts: SummarizeOptions): Promise<void> {
  const cwd = process.cwd();
  logger.banner();
  console.log('');

  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Step 1: Find manifest files
  spinner.start('Scanning for manifest files…');
  const manifestCount = MANIFEST_FILES.filter((m) => fs.existsSync(path.join(cwd, m))).length;
  spinner.succeed(`Found ${logger.theme.brand(String(manifestCount))} manifest files`);

  // Step 2: Extract metadata
  spinner.start('Extracting project metadata…');
  const context = await extractProjectContext(cwd);
  spinner.succeed('Project metadata extracted');

  // Step 3: Write output
  const cacheDir = path.join(cwd, CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const outPath = path.join(cacheDir, CONTEXT_FILE);
  fs.writeFileSync(outPath, JSON.stringify(context, null, 2), 'utf-8');

  // Display summary
  logger.section('Project Context');
  logger.kv('Name', context.name);
  if (context.description) logger.kv('Description', context.description);
  logger.kv('Languages', context.languages.join(', ') || 'none detected');
  logger.kv('Frameworks', context.frameworks.join(', ') || 'none detected');
  logger.kv('Build Tools', context.buildTools.join(', ') || 'none detected');
  logger.kv('Entry Points', context.entryPoints.length > 0 ? context.entryPoints.join(', ') : 'none detected');
  if (context.domains.length > 0) {
    logger.kv('Domains', context.domains.join(', '));
  }

  console.log('');
  logger.success(`Saved to ${logger.theme.accent(path.relative(cwd, outPath))}`);

  if (opts.verbose) {
    console.log('');
    console.log(JSON.stringify(context, null, 2));
  }
}

// ─── Extractors ───────────────────────────────

function extractFromPackageJson(
  content: string,
  languages: Set<string>,
  frameworks: Set<string>,
  buildTools: Set<string>,
): void {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Languages
    if (allDeps['typescript'] || allDeps['ts-node'] || allDeps['tsx']) languages.add('TypeScript');
    languages.add('JavaScript');

    // Frameworks
    const frameworkMap: Record<string, string> = {
      'next': 'Next.js', 'react': 'React', 'vue': 'Vue', 'svelte': 'Svelte',
      '@angular/core': 'Angular', 'express': 'Express', 'fastify': 'Fastify',
      'hono': 'Hono', 'koa': 'Koa', 'nestjs': 'NestJS', '@nestjs/core': 'NestJS',
      'nuxt': 'Nuxt', 'remix': 'Remix', 'astro': 'Astro', 'gatsby': 'Gatsby',
      'electron': 'Electron', 'react-native': 'React Native',
    };
    for (const [dep, name] of Object.entries(frameworkMap)) {
      if (allDeps[dep]) frameworks.add(name);
    }

    // Build tools
    const toolMap: Record<string, string> = {
      'vite': 'Vite', 'webpack': 'Webpack', 'esbuild': 'esbuild',
      'turbo': 'Turborepo', 'tsup': 'tsup', 'rollup': 'Rollup',
      'vitest': 'Vitest', 'jest': 'Jest', 'biome': 'Biome',
      '@biomejs/biome': 'Biome', 'eslint': 'ESLint', 'prettier': 'Prettier',
    };
    for (const [dep, name] of Object.entries(toolMap)) {
      if (allDeps[dep]) buildTools.add(name);
    }
  } catch { /* non-fatal */ }
}

function extractPythonFrameworks(content: string, frameworks: Set<string>): void {
  const pyMap: Record<string, string> = {
    'django': 'Django', 'flask': 'Flask', 'fastapi': 'FastAPI',
    'streamlit': 'Streamlit', 'tensorflow': 'TensorFlow', 'torch': 'PyTorch',
    'pandas': 'Pandas', 'numpy': 'NumPy', 'celery': 'Celery',
  };
  const lc = content.toLowerCase();
  for (const [keyword, name] of Object.entries(pyMap)) {
    if (lc.includes(keyword)) frameworks.add(name);
  }
}

function extractGoFrameworks(content: string, frameworks: Set<string>): void {
  const goMap: Record<string, string> = {
    'gin-gonic/gin': 'Gin', 'gorilla/mux': 'Gorilla Mux',
    'go-chi/chi': 'Chi', 'fiber': 'Fiber', 'echo': 'Echo',
  };
  for (const [keyword, name] of Object.entries(goMap)) {
    if (content.includes(keyword)) frameworks.add(name);
  }
}

function inferDomains(cwd: string): string[] {
  const domains = new Set<string>();
  const domainKeywords: Record<string, string> = {
    'auth': 'Authentication', 'payment': 'Payments', 'billing': 'Billing',
    'user': 'User Management', 'admin': 'Administration', 'dashboard': 'Dashboard',
    'api': 'API', 'chat': 'Chat/Messaging', 'notification': 'Notifications',
    'search': 'Search', 'analytics': 'Analytics', 'graph': 'Graph/Visualization',
    'editor': 'Editor', 'settings': 'Settings', 'profile': 'Profile',
  };

  // Check top-level and src/ directories
  for (const base of [cwd, path.join(cwd, 'src')]) {
    if (!fs.existsSync(base)) continue;
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        for (const [keyword, domain] of Object.entries(domainKeywords)) {
          if (name.includes(keyword)) domains.add(domain);
        }
      }
    } catch { /* skip */ }
  }

  return [...domains];
}
