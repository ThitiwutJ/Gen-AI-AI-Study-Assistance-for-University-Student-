import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / heavy server-only packages are loaded from node_modules at runtime instead of bundled.
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
