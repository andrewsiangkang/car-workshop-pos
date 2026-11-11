import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  // Type errors now fail the build (they were silently ignored before).
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
