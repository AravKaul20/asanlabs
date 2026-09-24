import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine and pose packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@asan/core", "@asan/poses"],
};

export default nextConfig;
