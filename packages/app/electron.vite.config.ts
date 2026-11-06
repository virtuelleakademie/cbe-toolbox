import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/main", lib: { entry: "src/main/index.ts" } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/preload", lib: { entry: "src/preload/index.ts" } },
  },
  renderer: {
    root: path.join(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: path.join(__dirname, "src/renderer/index.html") },
    },
  },
});
