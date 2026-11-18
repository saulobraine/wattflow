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
          AUTH_SECRET:
            process.env.AUTH_SECRET &&
            process.env.AUTH_SECRET.trim().length >= 32
              ? process.env.AUTH_SECRET
              : "e2e-auth-secret-token-with-at-least-32-chars",
          ALLOW_PUBLIC_REGISTRATION:
            process.env.ALLOW_PUBLIC_REGISTRATION ?? "true",
          DISABLE_LOCAL_CRON:
            process.env.E2E_DISABLE_LOCAL_CRON ?? "false",
          ENCRYPTION_KEY:
            process.env.ENCRYPTION_KEY &&
            /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY.trim()) &&
            !/^([0-9a-f]{2})\1{31}$/i.test(process.env.ENCRYPTION_KEY.trim()) &&
            !/^([0-9a-f]{8})\1{7}$/i.test(process.env.ENCRYPTION_KEY.trim()) &&
            !/^([0-9a-f]{16})\1{3}$/i.test(process.env.ENCRYPTION_KEY.trim())
              ? process.env.ENCRYPTION_KEY
              : "4f8a2c1e9d7b6a3f0e5c8d1a2b4c6e8f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d",
        },
      },
});
