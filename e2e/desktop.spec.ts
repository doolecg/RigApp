import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";

// The built desktop app (pnpm --filter @rigapp/desktop build). Playwright's own Electron
// launcher fails with Electron 45, so start it with a debugging port and attach to its page.
const DESKTOP = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const PORT = 9333;

test("the desktop app starts its server, shows RigApp and exposes the desktop bridge", async () => {
  test.setTimeout(60_000);
  test.skip(!existsSync(`${DESKTOP}dist/main.cjs`), "Build the desktop app first: pnpm --filter @rigapp/desktop build");
  const exe = `${DESKTOP}node_modules/electron/dist/${readFileSync(`${DESKTOP}node_modules/electron/path.txt`, "utf8").trim()}`;
  // A shell that runs Electron as plain Node would stop the app from starting.
  const env = { ...process.env, RIGAPP_DATA_DIR: fileURLToPath(new URL("../test-results/data-desktop", import.meta.url)) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(exe, [".", `--remote-debugging-port=${PORT}`], { cwd: DESKTOP, env, windowsHide: true });
  // The app prints its server's address once the server answers.
  const url = new Promise<string>((resolve) => {
    let out = "";
    app.stdout.on("data", (chunk) => {
      out += String(chunk);
      const found = /RigApp on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (found) resolve(found[1]!);
    });
  });
  try {
    const address = await Promise.race([url, new Promise<string>((_, no) => setTimeout(() => no(new Error("the server did not start")), 30_000))]);
    // Attach again until the window has loaded RigApp; an early attach can miss the window.
    let browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const deadline = Date.now() + 30_000;
    let page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(address));
    while (!page && Date.now() < deadline) {
      await browser.close();
      await new Promise((r) => setTimeout(r, 500));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(address));
    }
    if (!page) throw new Error(`no window showed ${address}`);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible({ timeout: 30_000 });
    const bridge = await page.evaluate(async () => ({ version: window.rigapp?.version, update: await window.rigapp?.getUpdate() }));
    expect(bridge.version).toBe("0.1.0");
    expect(bridge.update?.status).toBeTruthy();
    await browser.close();
  } finally {
    // Stop only the app this test started, with its server child.
    if (process.platform === "win32" && app.pid) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true });
    else app.kill();
  }
});
