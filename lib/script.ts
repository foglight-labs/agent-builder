/**
 * Build the copyable install script for a set of skills. Deliberately no
 * comments (task/source headers, per-skill reasons): the script is meant to
 * be pasted and run as-is, and any explanation belongs in the UI, not in the
 * shell output.
 */
export function buildInstallScript(skills: { source: string; name: string }[]): string {
  return ["#!/usr/bin/env bash", "set -e", "", ...skills.map((s) => `npx skills add ${s.source} --skill ${s.name} -y`)].join("\n");
}
