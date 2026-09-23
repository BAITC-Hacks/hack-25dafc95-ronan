import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_EXTERNAL
    ? undefined
    : [
        {
          command:
            "node node_modules/vite/bin/vite.js preview --configLoader native --host 127.0.0.1 --port 5173 --strictPort",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: true,
        },
        {
          command:
            "node node_modules/vite/bin/vite.js preview --config vite.harness.config.ts --configLoader native --host 127.0.0.1 --port 5174 --strictPort",
          url: "http://127.0.0.1:5174/harness.html",
          reuseExistingServer: true,
        },
      ],
});
