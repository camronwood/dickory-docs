import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  // Must match src-tauri/tauri.conf.json build.devPath (Tauri loads this URL in dev).
  server: {
    port: 5177,
    strictPort: true,
    // Helps Tauri WKWebView pick up HMR after sidebar edits (avoid stale bundle).
    headers: {
      "Cache-Control": "no-store",
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
