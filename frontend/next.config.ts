import type { NextConfig } from 'next';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load monorepo root .env (frontend/ is one level below root)
const dir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(dir, '../.env'), override: false });

const nextConfig: NextConfig = {
  reactCompiler: {
    compilationMode: 'annotation',
  },
  experimental: { viewTransition: true },
  output: 'standalone',
  logging: { fetches: { fullUrl: true } },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
};

export default nextConfig;
