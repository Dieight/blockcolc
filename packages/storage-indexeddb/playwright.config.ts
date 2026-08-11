import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4178", headless: true },
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4178",
    url: "http://127.0.0.1:4178/e2e/",
    reuseExistingServer: false,
  },
});
