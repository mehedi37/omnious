import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: { viewTransition: true },
  output: 'standalone',
  logging: { fetches: { fullUrl: true } },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
};

export default nextConfig;
