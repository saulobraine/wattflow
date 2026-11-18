import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT || "3005";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${port} -H 127.0.0.1`,
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        env: {
          ...process.env,
          CRON_SECRET_TOKEN:
            process.env.CRON_SECRET_TOKEN &&
            process.env.CRON_SECRET_TOKEN.trim().length >= 32
              ? process.env.CRON_SECRET_TOKEN
              : "e2e-cron-secret-token-with-at-least-32-chars",
        },
      },
});
