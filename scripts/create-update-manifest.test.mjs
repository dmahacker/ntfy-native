// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createUpdateManifest } from "./create-update-manifest.mjs";
const dirs = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ntfy-release-")); dirs.push(root);
  const files = ["ntfy_0.2.0_amd64.deb", "ntfy-0.2.0.x86_64.rpm", "ntfy_0.2.0_amd64.AppImage", "ntfy_0.2.0_x64-setup.exe", "ntfy_0.2.0_aarch64.dmg", "ntfy_0.2.0_x64.dmg", "ntfy_aarch64-apple-darwin.app.tar.gz", "ntfy_x86_64-apple-darwin.app.tar.gz"];
  for (const file of files) writeFileSync(join(root, file), "artifact");
  for (const file of files.filter(file => /AppImage$|exe$|tar.gz$/.test(file))) writeFileSync(join(root, `${file}.sig`), "c2lnbmF0dXJl\n");
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("generates four architecture-specific signed entries with fixed release URLs", () => {
  const result = createUpdateManifest(fixture(), "v0.2.0");
  expect(result.version).toBe("0.2.0");
  expect(Object.keys(result.platforms).sort()).toEqual(["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]);
  expect(result.platforms["darwin-aarch64"]).toEqual({ signature: "c2lnbmF0dXJl", url: "https://github.com/dmahacker/ntfy-native/releases/download/v0.2.0/ntfy_aarch64-apple-darwin.app.tar.gz" });
  expect(result.platforms["windows-x86_64"].url).toContain("ntfy_0.2.0_x64-setup.exe");
});
it("URL-encodes asset names without changing the corresponding signature", () => {
  const root = fixture();
  const from = join(root, "ntfy_0.2.0_x64-setup.exe");
  const to = join(root, "ntfy native_0.2.0_x64-setup.exe");
  renameSync(from, to); renameSync(`${from}.sig`, `${to}.sig`);
  const entry = createUpdateManifest(root, "v0.2.0").platforms["windows-x86_64"];
  expect(entry.url).toContain("ntfy%20native_0.2.0_x64-setup.exe");
  expect(entry.signature).toBe("c2lnbmF0dXJl");
});
it("preserves prerelease versions and uses their immutable tag URLs", () => {
  const result = createUpdateManifest(fixture(), "v0.2.0-rc.1");
  expect(result.version).toBe("0.2.0-rc.1");
  expect(result.platforms["linux-x86_64"].url).toContain("/v0.2.0-rc.1/");
});
it.each(["ntfy_0.2.0_amd64.deb", "ntfy_0.2.0_x64.dmg", "ntfy_aarch64-apple-darwin.app.tar.gz", "ntfy_0.2.0_amd64.AppImage.sig"])("rejects an incomplete release missing %s", file => {
  const root = fixture(); rmSync(join(root, file));
  expect(() => createUpdateManifest(root, "v0.2.0")).toThrow();
});
it("rejects empty signatures and duplicate assets", () => {
  const root = fixture(); writeFileSync(join(root, "ntfy_0.2.0_amd64.AppImage.sig"), "\n");
  expect(() => createUpdateManifest(root, "v0.2.0")).toThrow(/signature/i);
  const second = fixture(); mkdirSync(join(second, "duplicate"));
  writeFileSync(join(second, "duplicate", "ntfy_0.2.0_amd64.AppImage"), "duplicate");
  expect(() => createUpdateManifest(second, "v0.2.0")).toThrow(/duplicate/i);
});
it.each(["latest", "v01.2.0", "v0.2.0-", "v0.2.0/../bad"])("rejects invalid release tags %s", tag => {
  expect(() => createUpdateManifest(fixture(), tag)).toThrow(/tag/i);
});
it("runs the real CLI and fails without writing a partial manifest", () => {
  const root = fixture(); const output = join(root, "latest.json");
  const run = tag => spawnSync(process.execPath, ["scripts/create-update-manifest.mjs", root, tag, output], { encoding: "utf8" });
  expect(run("v0.2.0").status).toBe(0);
  expect(JSON.parse(readFileSync(output, "utf8")).platforms["linux-x86_64"].signature).toBe("c2lnbmF0dXJl");
  const previous = readFileSync(output, "utf8");
  rmSync(join(root, "ntfy_0.2.0_x64.dmg"));
  expect(run("v0.2.0").status).toBe(1);
  expect(readFileSync(output, "utf8")).toBe(previous);
});
