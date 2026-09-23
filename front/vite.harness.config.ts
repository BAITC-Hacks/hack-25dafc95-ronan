import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Test-only entry. Never included in the production dist directory.
export default defineConfig({
  root: "e2e",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../.test-build",
    emptyOutDir: true,
    rollupOptions: { input: "e2e/harness.html" },
  },
});
