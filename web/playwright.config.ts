import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.FREENET_BASE_URL },
  // The looking-glass e2e needs the dev server; reuse an already-running one.
  webServer: process.env.FREENET_BASE_URL
    ? undefined
    : {
        // Explicit host: vite may bind only ::1 for "localhost", and the
        // health check below polls 127.0.0.1.
        command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
        url: "http://127.0.0.1:5173/",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
