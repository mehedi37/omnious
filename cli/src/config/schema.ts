import { z } from 'zod';

/** Zod schema for .omnious.yml */
export const configSchema = z.object({
  version: z.literal(1),

  api: z.object({
    url: z.string().url().default('http://localhost:4000'),
    project_key: z.string().optional(),
  }),

  project: z
    .object({
      id: z.string().uuid().optional(),
      workspace: z.string().optional(),
      slug: z.string().optional(),
    })
    .optional(),

  group: z
    .object({
      slug: z.string().optional(),
    })
    .optional(),

  index: z
    .object({
      include: z
        .array(z.string())
        .default(['src/**/*.{ts,tsx,js,jsx}']),
      exclude: z
        .array(z.string())
        .default([
          '**/*.test.{ts,tsx,js,jsx}',
          '**/*.spec.{ts,tsx,js,jsx}',
          '**/*.d.ts',
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
        ]),
      languages: z.array(z.string()).optional(),
      max_file_size: z.number().default(524_288), // 500KB
      max_files: z.number().default(10_000),
    })
    .default({}),

  watch: z
    .object({
      debounce_ms: z.number().default(500),
      auto_push: z.boolean().default(true),
    })
    .optional(),

  trace: z
    .object({
      enabled: z.boolean().default(false),
      otel_endpoint: z.string().default('http://localhost:4318'),
      forward_to: z.string().default('omnious'),
    })
    .optional(),

  ci: z
    .object({
      fail_on_error: z.boolean().default(false),
      summary_comment: z.boolean().default(true),
    })
    .optional(),
});

export type OmniousConfig = z.infer<typeof configSchema>;

/** Default config template written by `omnious init` */
export function defaultConfigYaml(opts: {
  apiUrl: string;
  projectKey?: string;
  projectId?: string;
  workspace?: string;
  slug?: string;
  include?: string[];
}): string {
  const lines = [
    '# .omnious.yml — Omnious project configuration',
    'version: 1',
    '',
    '# API connection',
    'api:',
    `  url: "${opts.apiUrl}"`,
  ];

  if (opts.projectKey) {
    lines.push(`  project_key: "\${OMNIOUS_PROJECT_KEY}"`);
  }

  lines.push('');

  if (opts.projectId || opts.workspace || opts.slug) {
    lines.push('# Project identification');
    lines.push('project:');
    if (opts.projectId) lines.push(`  id: "${opts.projectId}"`);
    if (opts.workspace) lines.push(`  workspace: "${opts.workspace}"`);
    if (opts.slug) lines.push(`  slug: "${opts.slug}"`);
    lines.push('');
  }

  lines.push('# Indexing configuration');
  lines.push('index:');
  lines.push('  include:');
  for (const pattern of opts.include ?? ['src/**/*.{ts,tsx,js,jsx}']) {
    lines.push(`    - "${pattern}"`);
  }
  lines.push('  exclude:');
  lines.push('    - "**/*.test.{ts,tsx,js,jsx}"');
  lines.push('    - "**/*.spec.{ts,tsx,js,jsx}"');
  lines.push('    - "**/*.d.ts"');
  lines.push('    - "**/node_modules/**"');
  lines.push('    - "**/dist/**"');
  lines.push('    - "**/build/**"');
  lines.push('    - "**/.next/**"');

  lines.push('');
  return lines.join('\n') + '\n';
}
