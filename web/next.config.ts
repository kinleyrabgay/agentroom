import path from "node:path"
import type { NextConfig } from "next"

// Static export: the AgentRoom server (Hono) serves `out/` and the /api + /ws endpoints.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // The UI imports shared, dependency-free modules from ../src/shared (event types, usage reducer).
  turbopack: { root: path.join(import.meta.dirname, "..") },
}

export default nextConfig
