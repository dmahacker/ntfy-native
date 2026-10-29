import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Generate only desktop assets, leaving mobile icon sets in a temporary directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "ntfy-native-icons-"));
const destination = join(root, "src-tauri/icons");
function generate(source, output, extra = []) {
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "tauri", "icon", join(root, "assets", source), "--output", output, ...extra], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Icon generation failed");
}
try {
  const app = join(temporary, "app");
  generate("icon.svg", app);
  for (const entry of readdirSync(app, { withFileTypes: true })) {
    if (entry.isFile()) copyFileSync(join(app, entry.name), join(destination, entry.name));
  }
  for (const name of ["connected", "unread", "offline", "offline-unread"]) {
    const output = join(temporary, name);
    generate(`tray-${name}.svg`, output, ["--png", "64"]);
    copyFileSync(join(output, "64x64.png"), join(destination, `tray-${name}.png`));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
