import { defineConfig } from "@playwright/test";

// UI flows against the real OpenRig daemon. Two RigApp servers on their own ports,
// so a RigApp you have open on 7480 is not touched: one finds the daemon, the other
// is pointed at a port where nothing answers, to show the setup screen.
// Run `pnpm build` first; the servers serve the built UI.
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: { headless: true, viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  webServer: [
    {
      command: "node ../apps/server/src/bin.ts",
      // Test settings live in test-results, never in your own ~/.rigapp.
      env: { RIGAPP_PORT: "7490", RIGAPP_DATA_DIR: "../test-results/data" },
      url: "http://127.0.0.1:7490",
      reuseExistingServer: false,
    },
    {
      command: "node ../apps/server/src/bin.ts",
      env: { RIGAPP_PORT: "7491", RIGAPP_DAEMON_URL: "http://127.0.0.1:7499", RIGAPP_DATA_DIR: "../test-results/data-setup" },
      url: "http://127.0.0.1:7491",
      reuseExistingServer: false,
    },
  ],
});
