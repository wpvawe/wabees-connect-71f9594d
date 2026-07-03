import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke tests for owner/agent invite flows.
 * Target: preview URL (override with E2E_BASE_URL).
 */
const baseURL =
  process.env.E2E_BASE_URL ??
  "https://id-preview--373ad4e5-6ba4-4dab-91f0-2449fc57dc00.lovable.app";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1280, height: 1800 },
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Allow sandbox environments to override the bundled Chromium.
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});