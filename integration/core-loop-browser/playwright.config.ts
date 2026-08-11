import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4187",
    headless: true,
  },
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4187",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
