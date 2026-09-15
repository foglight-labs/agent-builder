import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Resolve version metadata at build time so it can be baked into the bundle
// via `env`. Runtime environments here (Cloudflare Workers, Railway) have no
// `git` binary and often no writable filesystem, so this must happen now.
function resolveGitCommit(): string {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    tryExec("git rev-parse HEAD") ||
    "unknown"
  );
}

function resolveGitDirty(): string {
  // Only meaningful for local builds; CI/platform builds check out a clean tree.
  const status = tryExec("git status --porcelain");
  return status === null ? "unknown" : String(status.length > 0);
}

function tryExec(command: string): string | null {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  env: {
    GIT_COMMIT: resolveGitCommit(),
    GIT_DIRTY: resolveGitDirty(),
  },
};

export default nextConfig;
