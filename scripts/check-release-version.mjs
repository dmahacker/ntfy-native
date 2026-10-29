import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function checkReleaseVersions(tag, versions) {
  const version = versions.package;
  if (!version || Object.values(versions).some(value => value !== version)) {
    throw new Error(`Application versions must agree: ${JSON.stringify(versions)}`);
  }
  if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}; received ${JSON.stringify(tag)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = new URL("../", import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    const tauri = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", root), "utf8"));
    // Let Cargo parse TOML instead of maintaining another manifest parser.
    const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--manifest-path", "src-tauri/Cargo.toml", "--no-deps", "--locked", "--format-version", "1"], { cwd: fileURLToPath(root), encoding: "utf8" }));
    const cargo = metadata.packages.find(value => value.name === pkg.name);
    checkReleaseVersions(process.argv[2], { package: pkg.version, tauri: tauri.version, cargo: cargo?.version });
    console.log(`Release version verified: ${pkg.version}`);
  } catch (cause) {
    console.error(String(cause));
    process.exitCode = 1;
  }
}
