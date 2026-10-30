import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "jsdom",
    clearMocks: true,
    // Transform the plugin so its real JS bindings share the mocked IPC boundary.
    server: { deps: { inline: ["@tauri-apps/plugin-autostart"] } },
  },
});
