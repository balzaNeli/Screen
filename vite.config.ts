import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const entry = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// Two entries, one build: the host UI (loaded by Electron from dist/renderer) and the viewer
// (served by the embedded server from dist/viewer). Bundled separately, so the viewer never
// ships host code.
export default defineConfig({
  root: entry("./src"),
  esbuild: { jsx: "automatic" },
  build: {
    outDir: entry("./dist"),
    emptyOutDir: false, // build:main writes dist/main first; emptying would delete it
    rollupOptions: {
      input: {
        renderer: entry("./src/renderer/index.html"),
        viewer: entry("./src/viewer/index.html"),
      },
    },
  },
});
