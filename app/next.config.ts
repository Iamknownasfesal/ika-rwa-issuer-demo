import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  agentRules: false,
  devIndicators: false,
  // The server reads ../deployments and loads the workspace packages, so trace from the repo root.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  outputFileTracingIncludes: {
    "/api/**": ["../deployments/*.json", "../sdk/dist/server.mjs", "../executor/dist/server.mjs", "../*/dist/ika_dwallet.proto"],
  },
};

export default nextConfig;
