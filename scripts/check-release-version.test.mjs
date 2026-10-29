// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkReleaseVersions } from "./check-release-version.mjs";

const versions = { package: "0.1.0", tauri: "0.1.0", cargo: "0.1.0" };

describe("release version gate", () => {
  it("accepts a matching version tag", () => {
    expect(() => checkReleaseVersions("v0.1.0", versions)).not.toThrow();
  });
  it.each(["v0.2.0", "0.1.0", "", "v0.1.0-rc.1"])("rejects a mismatched or missing tag (%s)", tag => {
    expect(() => checkReleaseVersions(tag, versions)).toThrow(/tag/i);
  });
  it.each(["package", "tauri", "cargo"])("rejects a mismatched %s version", key => {
    expect(() => checkReleaseVersions("v0.1.0", { ...versions, [key]: "0.2.0" })).toThrow(/version/i);
  });
  it("accepts prereleases when all versions and the tag agree", () => {
    expect(() => checkReleaseVersions("v0.2.0-rc.1", { package: "0.2.0-rc.1", tauri: "0.2.0-rc.1", cargo: "0.2.0-rc.1" })).not.toThrow();
  });
  it("runs the real CLI against all three repository manifests", () => {
    const script = fileURLToPath(new URL("./check-release-version.mjs", import.meta.url));
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(execFileSync(process.execPath, [script, `v${version}`], { encoding: "utf8" })).toContain(version);
    const rejected = spawnSync(process.execPath, [script, "not-a-version-tag"], { encoding: "utf8" });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toMatch(/tag/i);
  });
});
