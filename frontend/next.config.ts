import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: process.env.NODE_ENV !== "production",
  experimental: { viewTransition: true },
  output: "standalone",
  logging: { fetches: { fullUrl: true } },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
};

export default nextConfig;
