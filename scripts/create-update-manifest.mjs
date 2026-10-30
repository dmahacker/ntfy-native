import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : entry.isFile() ? [path] : [];
  });
}

export function createUpdateManifest(root, tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag)) throw new Error("Invalid release tag; expected vMAJOR.MINOR.PATCH with optional prerelease/build suffix");
  const files = collect(root);
  const names = new Set();
  for (const path of files) {
    const name = basename(path);
    if (names.has(name)) throw new Error(`Duplicate release asset: ${name}`);
    names.add(name);
  }
  function single(pattern) {
    const found = files.filter(path => pattern.test(basename(path)));
    if (found.length !== 1) throw new Error(`Expected exactly one asset matching ${pattern}; found ${found.length}`);
    if (statSync(found[0]).size === 0) throw new Error(`Empty release asset: ${basename(found[0])}`);
    return found[0];
  }
  single(/\.deb$/); single(/\.rpm$/);
  single(/_aarch64\.dmg$/); single(/_x64\.dmg$/);
  const targets = {
    "linux-x86_64": /\.AppImage$/,
    "windows-x86_64": /-setup\.exe$/,
    "darwin-aarch64": /_aarch64-apple-darwin\.app\.tar\.gz$/,
    "darwin-x86_64": /_x86_64-apple-darwin\.app\.tar\.gz$/,
  };
  const platforms = {};
  for (const [target, pattern] of Object.entries(targets)) {
    const asset = single(pattern);
    const signature = readFileSync(`${asset}.sig`, "utf8").trim();
    if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`Invalid signature for ${target}`);
    platforms[target] = { signature, url: `https://github.com/dmahacker/ntfy-native/releases/download/${tag}/${encodeURIComponent(basename(asset))}` };
  }
  return { version: tag.slice(1), notes: `ntfy-native ${tag}`, pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , root, tag, output] = process.argv;
    if (!root || !output) throw new Error("Usage: create-update-manifest.mjs <asset-directory> <tag> <output.json>");
    const manifest = createUpdateManifest(root, tag);
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Validated all installers and updater assets for ${tag}`);
  } catch (cause) { console.error(String(cause)); process.exitCode = 1; }
}
