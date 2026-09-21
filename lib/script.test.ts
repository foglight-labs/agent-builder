import { describe, expect, it } from "vitest";
import { buildInstallScript } from "@/lib/script";

describe("buildInstallScript", () => {
  it("builds a shebang + set -e + one install line per skill, with no comments", () => {
    const script = buildInstallScript([
      { source: "acme/skills", name: "foo" },
      { source: "other/repo", name: "bar" },
    ]);

    expect(script).toBe(
      ["#!/usr/bin/env bash", "set -e", "", "npx skills add acme/skills --skill foo -y", "npx skills add other/repo --skill bar -y"].join("\n")
    );
    expect(script).not.toContain("#" + " ");
    expect(script.split("\n").filter((l) => l.startsWith("#"))).toEqual(["#!/usr/bin/env bash"]);
  });

  it("returns just the shebang and set -e when there are no skills", () => {
    expect(buildInstallScript([])).toBe(["#!/usr/bin/env bash", "set -e", ""].join("\n"));
  });
});
