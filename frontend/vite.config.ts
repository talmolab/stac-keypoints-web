import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages: /stac-keypoints-web/
  // For local dev: /
  base: process.env.GITHUB_PAGES ? "/stac-keypoints-web/" : "/",
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  optimizeDeps: {
    exclude: ["mujoco-js"],
  },
  assetsInclude: ["**/*.wasm"],
});
