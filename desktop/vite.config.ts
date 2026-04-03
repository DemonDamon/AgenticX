import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Packaged Electron uses file:// to load dist/index.html.
  // Build must emit relative asset URLs, while dev server keeps root URLs.
  base: command === "serve" ? "/" : "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  }
}));
