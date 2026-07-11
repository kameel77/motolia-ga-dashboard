import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@google-analytics/data",
    "@prisma/client",
    "ioredis",
    "node-cron",
    "csv-parse",
    "jsonwebtoken",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
