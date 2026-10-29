import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    clearMocks: true,
    // Transform the plugin so its real JS bindings share the mocked IPC boundary.
    server: { deps: { inline: ["@tauri-apps/plugin-autostart"] } },
  },
});
