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
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
