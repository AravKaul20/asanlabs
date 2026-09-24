import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine and pose packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@asan/core", "@asan/poses"],
  // Next otherwise writes its own apps/web/CLAUDE.md and AGENTS.md on every run.
  // A directory-scoped CLAUDE.md of framework boilerplate would compete with the
  // project's actual engineering guide, so keep it out of the tree.
  agentRules: false,
};

export default nextConfig;
