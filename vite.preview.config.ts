import { defineConfig } from "vite";

// The badge gallery is a dev-only surface, so it gets its own Vite root: the
// crx plugin never sees it and nothing extra can land in the extension's
// dist/. Run it with `npm run gallery`.
export default defineConfig({
  root: "preview",
  server: { open: true },
  build: { outDir: "../dist-preview", emptyOutDir: true },
});
