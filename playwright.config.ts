import { defineConfig } from "@playwright/test";
import { assertIsolatedTestEnvironment } from "./tests/auth-fixture";

assertIsolatedTestEnvironment();
if (!process.env.WORLDFORGE_TEST_ORIGIN) {
  throw new Error("Set WORLDFORGE_TEST_ORIGIN to the server using the same isolated database and asset directory.");
}

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.WORLDFORGE_TEST_ORIGIN,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
